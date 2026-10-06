import { mkdir, readFile, writeFile, rename, rm, realpath, open, stat } from 'node:fs/promises';
import { resolve, dirname, join, extname, basename, relative, sep, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashBytes, loadManifest, validateManifest } from './spec.js';
import { StudioError } from './errors.js';
import type { Manifest, Scene, Asset, Revision, OperationReceipt } from './types.js';

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const fail = (message: string) => new StudioError('PROJECT_EDIT', 'project', message, 2);

/** This invocation failed before it could publish an accepted manifest. */
export class ProjectPrecommitError extends StudioError {
  constructor(cause: unknown) {
    const original = cause instanceof StudioError ? cause : undefined;
    const code = original?.code ?? (cause as NodeJS.ErrnoException | undefined)?.code ?? 'PROJECT_EDIT';
    super(code, original?.stage ?? 'project', cause instanceof Error ? cause.message : String(cause), original?.exitCode ?? 4, original?.field);
    this.name = 'ProjectPrecommitError';
    this.cause = cause;
  }
}

export async function createProject(directory: string) {
  const dir = resolve(directory); await mkdir(dir, { recursive: true });
  const file = join(dir, 'project.json');
  const manifest: Manifest = {
    schemaVersion: 2, id: 'my-film', seed: 7, revision: randomUUID(), history: [],
    video: { aspectRatio: '16:9', fps: 30, style: 'kinetic' },
    brand: { theme: 'dark', background: '#10171C', foreground: '#F4F1E9', accent: '#D9EE86', font: 'builtin-sans' },
    assets: {}, audio: { narration: { provider: 'none' }, music: { provider: 'none' } },
    scenes: [{ id: 'opening', type: 'kinetic_title', text: 'Новый фильм', durationFrames: 120 }]
  };
  await writeFile(file, json(manifest), { flag: 'wx' });
  return { created: true, project: file };
}

export async function readProject(file: string) {
  const content = await readFile(file);
  const manifest = validateManifest(JSON.parse(content.toString('utf8')));
  return { manifest, etag: hashBytes(content) };
}

export async function withProjectLock<T>(file: string, task: () => Promise<T>): Promise<T> {
  const canonical = await realpath(file); const lockPath = `${canonical}.edit-lock`;
  let lock;
  try { lock = await open(lockPath, 'wx'); await lock.writeFile(json({ pid: process.pid })); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new StudioError('PROJECT_BUSY', 'project', 'Another edit/export is using this project. Try again after it finishes.', 2); throw error; }
  try { return await task(); } finally { await lock.close(); await rm(lockPath, { force: true }); }
}

function snapshot(manifest: Manifest, label: string): Revision {
  return { id: manifest.revision ?? randomUUID(), label, createdAt: new Date().toISOString(), scenes: structuredClone(manifest.scenes), video: structuredClone(manifest.video), audio: structuredClone(manifest.audio), brand: structuredClone(manifest.brand) };
}

async function commit(file: string, before: Manifest, next: Manifest, label: string, operation?: Omit<OperationReceipt, 'revisionId'>, beforeManifestRename?: () => void) {
  next.schemaVersion = 2;
  next.history = [...(before.history ?? []), snapshot(before, label)].slice(-100);
  next.revision = randomUUID();
  if (operation) next.operationReceipts = [...(before.operationReceipts ?? []), { ...operation, revisionId: next.revision }].slice(-100);
  validateManifest(next);
  const temporary = join(dirname(resolve(file)), `.project-${randomUUID()}.json`);
  try {
    await writeFile(temporary, json(next), { flag: 'wx' });
    await loadManifest(temporary);
    // Once rename is attempted, a thrown error must not assert that publication
    // did not happen. Receipts, not the exception, resolve an uncertain outcome.
    beforeManifestRename?.();
    await rename(temporary, resolve(file));
  } finally { await rm(temporary, { force: true }); }
  return readProject(file);
}

export type ProjectAction =
  | { type: 'add-scene'; scene: Scene }
  | { type: 'edit-scene'; sceneId: string; patch: { [Key in keyof Scene]?: Scene[Key] | null } }
  | { type: 'remove-scene'; sceneId: string }
  | { type: 'move-scene'; sceneId: string; index: number }
  | { type: 'music'; asset?: string; gainDb?: number; provider?: 'none' | 'procedural' }
  | { type: 'composition'; video: Manifest['video'] }
  | { type: 'restore'; revisionId: string }
  | { type: 'restore-scene'; revisionId: string; sceneId: string };

/** Shared by accepted edits and unsaved scene previews. No persistence here. */
export function patchScene(scene: Scene, patch: Extract<ProjectAction, { type: 'edit-scene' }>['patch']): Scene {
  if (!patch || Object.hasOwn(patch, 'id') || Object.hasOwn(patch, 'type')) throw fail('Scene id/type are stable; add a scene to change its type.');
  if (Object.keys(patch).some(key => !['durationFrames', 'trimStartSeconds', 'text', 'highlight', 'label', 'asset', 'caption', 'fit', 'focalPoint', 'fontSize', 'narration', 'captions'].includes(key))) throw fail('Scene patch contains unknown additional properties.');
  const revised = { ...scene } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) { if (value === null) delete revised[key]; else revised[key] = value; }
  return revised as Scene;
}

export async function editProject(file: string, action: ProjectAction, expectedEtag?: string) {
  return withProjectLock(file, async () => {
    const { manifest: before, etag } = await readProject(file);
    if (expectedEtag && expectedEtag !== etag) throw new StudioError('PROJECT_CONFLICT', 'project', 'Project changed elsewhere. Reload before editing.', 2);
    const next = structuredClone(before);
    const allowed: Record<ProjectAction['type'], string[]> = {
      'add-scene': ['type', 'scene'], 'edit-scene': ['type', 'sceneId', 'patch'], 'remove-scene': ['type', 'sceneId'], 'move-scene': ['type', 'sceneId', 'index'],
      music: ['type', 'asset', 'gainDb', 'provider'], composition: ['type', 'video'], restore: ['type', 'revisionId'], 'restore-scene': ['type', 'revisionId', 'sceneId']
    };
    if (!action || !allowed[action.type] || Object.keys(action).some(key => !allowed[action.type].includes(key))) throw fail('Unknown action or fields.');
    const index = 'sceneId' in action ? next.scenes.findIndex(scene => scene.id === action.sceneId) : -1;
    if ('sceneId' in action && index < 0) throw fail('Scene does not exist.');
    switch (action.type) {
      case 'add-scene': next.scenes.push(action.scene); break;
      case 'edit-scene': {
        next.scenes[index] = patchScene(next.scenes[index], action.patch); break;
      }
      case 'remove-scene': next.scenes.splice(index, 1); break;
      case 'move-scene':
        if (!Number.isInteger(action.index) || action.index < 0 || action.index >= next.scenes.length) throw fail('Invalid scene position.');
        next.scenes.splice(action.index, 0, next.scenes.splice(index, 1)[0]); break;
      case 'music':
        if (action.asset && action.provider) throw fail('Choose either a file asset or a music provider.');
        next.audio.music = action.asset ? { provider: 'file', asset: action.asset, gainDb: action.gainDb ?? -12 } : { provider: action.provider ?? 'none', gainDb: action.gainDb ?? -12 }; break;
      case 'composition': next.video = action.video; break;
      case 'restore': case 'restore-scene': {
        const revision = before.history?.find(item => item.id === action.revisionId);
        if (!revision) throw fail('Revision does not exist.');
        if (action.type === 'restore') {
          next.scenes = revision.scenes; next.video = revision.video; next.audio = revision.audio; next.brand = revision.brand;
        } else {
          const scene = revision.scenes.find(item => item.id === action.sceneId);
          if (!scene) throw fail('Scene did not exist in that revision.');
          next.scenes[index] = scene;
        }
        break;
      }
    }
    return commit(file, before, next, action.type);
  });
}

export async function importMedia(file: string, name: string, content: Buffer, expectedEtag?: string) {
  return withProjectLock(file, async () => {
    const { manifest: before, etag } = await readProject(file);
    if (expectedEtag && expectedEtag !== etag) throw new StudioError('PROJECT_CONFLICT', 'project', 'Project changed elsewhere. Reload before importing.', 2);
    const extension = extname(name).toLowerCase();
    const type: Asset['type'] | undefined = ['.png', '.jpg', '.jpeg'].includes(extension) ? 'image' : extension === '.mp4' ? 'video' : ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac'].includes(extension) ? 'audio' : undefined;
    if (!type) throw fail('Import MP4, PNG/JPEG, WAV/MP3/M4A/AAC/OGG/FLAC.');
    const limit = (type === 'video' ? 512 : type === 'image' ? 20 : 100) * 1024 * 1024;
    if (!content.length || content.length > limit) throw fail(`File must be 1 byte to ${limit / 1024 / 1024} MiB.`);
    const sha256 = hashBytes(content), id = `media-${sha256.slice(0, 24)}`;
    if (before.assets[id]) return { ...(await readProject(file)), importedId: id };
    if (Object.keys(before.assets).length >= 24) throw fail('Accepted asset registry is full (24 assets). The imported file was not accepted.');
    const path = await storeImmutableSource(file, extension, content, sha256);
    const next = structuredClone(before);
    next.assets[id] = { type, path, sha256, name: basename(name).slice(0, 200) };
    // A commit may have renamed the manifest before its final read fails. Keep the
    // immutable source in either case; removing an orphan needs a reference audit.
    return { ...(await commit(file, before, next, `import ${basename(name).slice(0, 160)}`)), importedId: id };
  });
}

async function storeImmutableSource(file: string, extension: string, content: Buffer, sha256: string) {
  const dir = await realpath(dirname(resolve(file))), assets = join(dir, 'assets');
  await mkdir(assets, { recursive: true });
  if (await realpath(assets) !== assets) throw fail('The assets directory must not be a symlink.');
  const path = `assets/${sha256}${extension}`, destination = join(dir, path);
  try { await writeFile(destination, content, { flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const info = await stat(destination);
    if (await realpath(destination) !== destination || !info.isFile() || info.size !== content.length || hashBytes(await readFile(destination)) !== sha256) throw fail('Existing imported source is corrupt or unsafe.');
  }
  return path;
}

export type GeneratedTakeDraft = {
  sceneId: string; candidateSha256: string; baseEtag: string;
  trimStartSeconds: number; fit: 'cover' | 'contain'; focalPoint: { x: number; y: number };
};
export type GeneratedTakeIntent = GeneratedTakeDraft & { operationId: string; requestHash: string; candidatePath: string };

/** Shared fingerprint of the exact candidate draft and accepted context viewed. */
export function generatedTakeRequestHash(draft: GeneratedTakeDraft) {
  if (!draft || typeof draft.sceneId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(draft.sceneId) || !/^[a-f0-9]{64}$/.test(draft.candidateSha256) || !/^[a-f0-9]{64}$/.test(draft.baseEtag)) throw fail('Invalid generated take identity or context.');
  if (!Number.isFinite(draft.trimStartSeconds) || draft.trimStartSeconds < 0 || draft.trimStartSeconds > 3600 || !['cover', 'contain'].includes(draft.fit) || !draft.focalPoint || Object.keys(draft.focalPoint).some(key => !['x', 'y'].includes(key)) || ![draft.focalPoint.x, draft.focalPoint.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw fail('Invalid generated take trim, fit or focal point.');
  return hashBytes(JSON.stringify({ sceneId: draft.sceneId, candidateSha256: draft.candidateSha256, baseEtag: draft.baseEtag, trimStartSeconds: draft.trimStartSeconds, fit: draft.fit, focalPoint: { x: draft.focalPoint.x, y: draft.focalPoint.y } }));
}

/** One accepted commit: immutable source, full prior scene history and receipt. */
export async function acceptGeneratedTake(file: string, intent: GeneratedTakeIntent, expectedEtag: string) {
  let mayHaveCommitted = false;
  try {
    if (!intent || Object.keys(intent).some(key => !['sceneId', 'candidateSha256', 'baseEtag', 'trimStartSeconds', 'fit', 'focalPoint', 'operationId', 'requestHash', 'candidatePath'].includes(key)) || typeof intent.operationId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(intent.operationId)) throw fail('Invalid generated take operation or fields.');
    const requestHash = generatedTakeRequestHash(intent);
    if (intent.requestHash !== requestHash) throw fail('Generated take draft fingerprint does not match the intent. Preview these parameters again.');
    return await withProjectLock(file, async () => {
      const current = await readProject(file), before = current.manifest;
      const receipt = before.operationReceipts?.find(item => item.operationId === intent.operationId);
      if (receipt) {
        mayHaveCommitted = true;
        if (receipt.requestHash !== requestHash) throw fail('This accepted operation ID already belongs to another generated take intent.');
        // Receipts precede ETag, candidate availability and current scene checks.
        // Retrying after restore or another edit must never reapply the old take.
        return { ...current, receipt, importedId: `media-${intent.candidateSha256.slice(0, 24)}`, repeated: true };
      }
      if (!expectedEtag || current.etag !== expectedEtag || intent.baseEtag !== expectedEtag) throw new StudioError('PROJECT_CONFLICT', 'project', 'Project changed after the candidate preview. Reload and preview the current scene before accepting.', 2);
      const index = before.scenes.findIndex(scene => scene.id === intent.sceneId);
      if (index < 0 || before.scenes[index].type !== 'video') throw fail('Generated takes replace an existing video scene only.');
      await loadManifest(file); // Check all accepted assets and history before promotion.
      const dir = await realpath(dirname(resolve(file)));
      if (typeof intent.candidatePath !== 'string' || extname(intent.candidatePath).toLowerCase() !== '.mp4') throw fail('Generated candidate must be a local MP4.');
      const candidate = await realpath(resolve(dir, intent.candidatePath)), rel = relative(dir, candidate);
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw fail('Generated candidate must resolve inside the project.');
      const info = await stat(candidate);
      if (!info.isFile() || !info.size || info.size > 512 * 1024 * 1024) throw fail('Generated candidate must be a regular MP4 up to 512 MiB.');
      const content = await readFile(candidate);
      if (hashBytes(content) !== intent.candidateSha256) throw fail('Generated candidate changed after preview. Download and preview it again.');
      const id = `media-${intent.candidateSha256.slice(0, 24)}`;
      const existing = before.assets[id];
      if (existing && (existing.type !== 'video' || existing.sha256 !== intent.candidateSha256)) throw fail('Generated candidate asset ID conflicts with an existing accepted asset.');
      if (!existing && Object.keys(before.assets).length >= 24) throw fail('Accepted asset registry is full (24 assets). Candidate remains available and was not accepted.');
      const path = await storeImmutableSource(file, '.mp4', content, intent.candidateSha256);
      const next = structuredClone(before);
      next.assets[id] ??= { type: 'video', path, sha256: intent.candidateSha256, name: 'Generated take.mp4' };
      next.scenes[index] = patchScene(next.scenes[index], { asset: id, trimStartSeconds: intent.trimStartSeconds, fit: intent.fit, focalPoint: intent.focalPoint });
      const accepted = await commit(file, before, next, `accept generated take ${intent.sceneId}`, { operationId: intent.operationId, requestHash }, () => { mayHaveCommitted = true; });
      return { ...accepted, receipt: accepted.manifest.operationReceipts!.find(item => item.operationId === intent.operationId)!, importedId: id, repeated: false };
    });
  } catch (error) {
    if (mayHaveCommitted) throw error;
    throw new ProjectPrecommitError(error);
  }
}
