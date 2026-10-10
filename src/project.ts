import { mkdir, readFile, writeFile, rename, rm, realpath, open, stat, readdir } from 'node:fs/promises';
import { resolve, dirname, join, extname, basename, relative, sep, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashBytes, loadManifest, validateManifest, validateActionShape, assertSupportedText } from './spec.js';
import { parseJsonInput } from './json-input.js';
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

export async function createProject(directory: string, options: { aspect?: Manifest['video']['aspectRatio']; title?: string } = {}) {
  const dir = resolve(directory); await mkdir(dir, { recursive: true });
  const file = join(dir, 'project.json');
  const manifest: Manifest = {
    schemaVersion: 2, id: 'my-film', seed: 7, revision: randomUUID(), history: [],
    video: { aspectRatio: options.aspect ?? '16:9', fps: 30, style: 'kinetic' },
    brand: { theme: 'dark', background: '#10171C', foreground: '#F4F1E9', accent: '#D9EE86', font: 'builtin-sans' },
    assets: {}, audio: { narration: { provider: 'none' }, music: { provider: 'none' } },
    scenes: [{ id: 'opening', type: 'kinetic_title', text: options.title ?? 'Новый фильм', durationFrames: 120 }]
  };
  validateManifest(manifest);
  await writeFile(file, json(manifest), { flag: 'wx' });
  return { created: true, project: file };
}

export async function readProject(file: string) {
  let content: Buffer;
  try { content = await readFile(resolve(file)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new StudioError('PROJECT_NOT_FOUND', 'input', `Project file does not exist: ${file}`, 2);
    }
    throw error;
  }
  const manifest = validateManifest(parseJsonInput(content.toString('utf8'), file));
  return { manifest, etag: hashBytes(content) };
}

export async function withProjectLock<T>(file: string, task: () => Promise<T>): Promise<T> {
  let canonical: string;
  try { canonical = await realpath(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new StudioError('PROJECT_NOT_FOUND', 'input', `Project file does not exist: ${file}`, 2);
    }
    throw error;
  }
  const lockPath = `${canonical}.edit-lock`;
  let lock;
  try { lock = await open(lockPath, 'wx'); await lock.writeFile(json({ pid: process.pid })); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new StudioError('PROJECT_BUSY', 'project', 'Another edit/export is using this project. Try again after it finishes.', 2); throw error; }
  try { return await task(); } finally { await lock.close(); await rm(lockPath, { force: true }); }
}

function snapshot(manifest: Manifest, label: string): Revision {
  return { id: manifest.revision ?? randomUUID(), label, createdAt: new Date().toISOString(), scenes: structuredClone(manifest.scenes), video: structuredClone(manifest.video), audio: structuredClone(manifest.audio), brand: structuredClone(manifest.brand) };
}

async function readExternalRevision(projectDir: string, revisionId: string): Promise<Revision | undefined> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(revisionId)) return undefined;
  try {
    const canonicalDir = await realpath(projectDir);
    const historyDir = join(canonicalDir, '.history');
    if (await realpath(historyDir) !== historyDir) return undefined;
    const filePath = join(historyDir, `${revisionId}.json`);
    if (await realpath(filePath) !== filePath) return undefined;
    const content = await readFile(filePath, 'utf8');
    if (content.length > 10 * 1024 * 1024) return undefined;
    const parsed = JSON.parse(content) as Revision;
    if (parsed && typeof parsed === 'object' && parsed.id === revisionId && Array.isArray(parsed.scenes)) {
      return parsed;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function commit(file: string, before: Manifest, next: Manifest, label: string, operation?: Omit<OperationReceipt, 'revisionId'>, beforeManifestRename?: () => void) {
  next.schemaVersion = 2;
  const newRev = snapshot(before, label);
  const allRevisions = [...(before.history ?? []), newRev];
  const budgetedInline: Revision[] = [];
  let inlineBytes = 0;
  for (let i = allRevisions.length - 1; i >= 0; i--) {
    const rev = allRevisions[i];
    const revSize = Buffer.byteLength(json(rev), 'utf8');
    if (budgetedInline.length >= 15 || (budgetedInline.length >= 1 && inlineBytes + revSize > 200 * 1024)) {
      break;
    }
    budgetedInline.unshift(rev);
    inlineBytes += revSize;
  }
  next.history = budgetedInline;
  next.revision = randomUUID();
  if (operation) next.operationReceipts = [...(before.operationReceipts ?? []), { ...operation, revisionId: next.revision }].slice(-100);

  // 1. Validate manifest before modifying any filesystem state
  validateManifest(next);

  // 2. Ensure project directory and .history directory are safe and accessible
  const projectDir = dirname(resolve(file));
  const canonicalDir = await realpath(projectDir);
  const historyDir = join(canonicalDir, '.history');
  try {
    await mkdir(historyDir, { recursive: true });
    if (await realpath(historyDir) !== historyDir) {
      throw fail('The history directory must not be a symlink.');
    }
  } catch (error) {
    throw fail(`Cannot access history directory: ${(error as Error).message}`);
  }

  // 3. Write temporary manifest file and verify it loads
  const temporary = join(canonicalDir, `.project-${randomUUID()}.json`);
  let stagedRevPath: string | undefined;
  try {
    await writeFile(temporary, json(next), { flag: 'wx' });
    await loadManifest(temporary);

    // 4. Ensure all revisions in before.history are validly preserved in .history.
    // If an external snapshot file is missing or corrupted, heal it from the intact inline copy.
    for (const rev of before.history ?? []) {
      const existing = await readExternalRevision(canonicalDir, rev.id);
      if (!existing || existing.id !== rev.id) {
        const revTmp = join(historyDir, `.tmp-${randomUUID()}.json`);
        try {
          await writeFile(revTmp, json(rev), { flag: 'w' });
          await rename(revTmp, join(historyDir, `${rev.id}.json`));
        } finally {
          await rm(revTmp, { force: true });
        }
        const verified = await readExternalRevision(canonicalDir, rev.id);
        if (!verified || verified.id !== rev.id) {
          throw fail(`External history snapshot ${rev.id} is corrupt and cannot be healed.`);
        }
      }
    }

    // 5. Verify that any revision about to be evicted from inline history is safely preserved externally
    for (const rev of allRevisions) {
      if (!budgetedInline.some(r => r.id === rev.id)) {
        const verified = await readExternalRevision(canonicalDir, rev.id);
        if (!verified || verified.id !== rev.id) {
          throw fail(`Cannot evict revision ${rev.id} from inline history: external snapshot is corrupt or missing.`);
        }
      }
    }

    // 6. Write the new revision snapshot atomically
    const tmpRev = join(historyDir, `.tmp-${randomUUID()}.json`);
    try {
      await writeFile(tmpRev, json(newRev), { flag: 'wx' });
      await rename(tmpRev, join(historyDir, `${newRev.id}.json`));
      stagedRevPath = join(historyDir, `${newRev.id}.json`);
    } finally {
      await rm(tmpRev, { force: true });
    }

    // 6. Manifest publication
    beforeManifestRename?.();
    await rename(temporary, resolve(file));
    stagedRevPath = undefined;
  } catch (error) {
    if (stagedRevPath) {
      await rm(stagedRevPath, { force: true });
    }
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }

  // 7. Prune retained history to 100 entries using logical createdAt timestamps
  try {
    const entries = await readdir(historyDir, { withFileTypes: true });
    const revFiles = entries.filter(e => e.isFile() && e.name.endsWith('.json') && !e.name.startsWith('.tmp-'));
    if (revFiles.length > 100) {
      const withStats = await Promise.all(revFiles.map(async f => {
        try {
          const content = await readFile(join(historyDir, f.name), 'utf8');
          const parsed = JSON.parse(content);
          const time = typeof parsed.createdAt === 'string' ? Date.parse(parsed.createdAt) : 0;
          return { name: f.name, time: isNaN(time) ? 0 : time };
        } catch {
          return { name: f.name, time: 0 };
        }
      }));
      withStats.sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
      const toRemove = withStats.slice(0, withStats.length - 100);
      for (const r of toRemove) {
        await rm(join(historyDir, r.name), { force: true });
      }
    }
  } catch {
    // Non-fatal if post-commit pruning fails
  }

  return readProject(file);
}

export type OrdinaryAction =
  | { type: 'add-scene'; scene: Scene }
  | { type: 'edit-scene'; sceneId: string; patch: { [Key in keyof Scene]?: Scene[Key] | null } }
  | { type: 'remove-scene'; sceneId: string }
  | { type: 'move-scene'; sceneId: string; index: number }
  | { type: 'music'; asset?: string; gainDb?: number; provider?: 'none' | 'procedural' }
  | { type: 'composition'; video: Partial<Manifest['video']> & { aspectRatio: Manifest['video']['aspectRatio'] } }
  | { type: 'brand'; patch: Partial<Omit<Manifest['brand'], 'font'>> };
export type ProjectAction = OrdinaryAction
  | { type: 'batch'; actions: OrdinaryAction[]; label?: string }
  | { type: 'restore'; revisionId: string }
  | { type: 'restore-scene'; revisionId: string; sceneId: string };

/** Shared by accepted edits and unsaved scene previews. No persistence here. */
export function patchScene(scene: Scene, patch: Extract<ProjectAction, { type: 'edit-scene' }>['patch']): Scene {
  if (!patch || Object.hasOwn(patch, 'id') || Object.hasOwn(patch, 'type')) throw fail('Scene id/type are stable; add a scene to change its type.');
  if (Object.keys(patch).some(key => !['durationFrames', 'trimStartSeconds', 'text', 'highlight', 'label', 'asset', 'caption', 'fit', 'focalPoint', 'fontSize', 'narration', 'captions', 'objects', 'background'].includes(key))) throw fail('Scene patch contains unknown additional properties.');
  if (scene.type !== 'video' && patch.trimStartSeconds !== undefined && patch.trimStartSeconds !== null) throw fail('trimStartSeconds only applies to video scenes.');
  validateActionShape('patch', patch);
  const revised = { ...scene } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) { if (value === null) delete revised[key]; else revised[key] = value; }
  validateActionShape('scene', revised);
  return revised as Scene;
}

const palettes = {
  dark: { background: '#10171C', foreground: '#F4F1E9', accent: '#D9EE86' },
  light: { background: '#F4F1E9', foreground: '#10171C', accent: '#285A36' }
};

/** Shared validation/application for single edits and each batch child. No IO. */
async function applyAction(next: Manifest, before: Manifest, action: ProjectAction, projectDir: string, inBatch = false) {
  const allowed: Record<ProjectAction['type'], string[]> = {
    'add-scene': ['type', 'scene'], 'edit-scene': ['type', 'sceneId', 'patch'], 'remove-scene': ['type', 'sceneId'], 'move-scene': ['type', 'sceneId', 'index'],
    music: ['type', 'asset', 'gainDb', 'provider'], composition: ['type', 'video'], brand: ['type', 'patch'], batch: ['type', 'actions', 'label'], restore: ['type', 'revisionId'], 'restore-scene': ['type', 'revisionId', 'sceneId']
  };
  if (!action || typeof action !== 'object' || Array.isArray(action) || !Object.hasOwn(allowed, action.type) || Object.keys(action).some(key => !allowed[action.type].includes(key))) throw fail('Unknown action or fields.');
  if (inBatch && ['batch', 'restore', 'restore-scene'].includes(action.type)) throw fail('Nested batch and restore actions are forbidden inside batch.');
  const id = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value);
  if (['edit-scene', 'remove-scene', 'move-scene', 'restore-scene'].includes(action.type) && (!('sceneId' in action) || !id(action.sceneId))) throw fail('A valid sceneId is required.');
  if (['restore', 'restore-scene'].includes(action.type) && (!('revisionId' in action) || typeof action.revisionId !== 'string' || !action.revisionId)) throw fail('A revisionId is required.');
  const index = 'sceneId' in action ? next.scenes.findIndex(scene => scene.id === action.sceneId) : -1;
  if ('sceneId' in action && index < 0) throw fail('Scene does not exist.');
  const sceneReferences = (scene: Scene) => {
    if (scene.asset && next.assets[scene.asset]?.type !== (scene.type === 'video' ? 'video' : 'image')) throw fail('Scene requires an imported source of the right type.');
    for (const key of ['text', 'highlight', 'label', 'caption'] as const) if (scene[key]) assertSupportedText(scene[key]!, key);
    if (scene.highlight && !scene.text?.includes(scene.highlight)) throw fail('highlight must occur in text.');
  };
  switch (action.type) {
    case 'batch': {
      if (!Array.isArray(action.actions) || action.actions.length < 1 || action.actions.length > 32 || (action.label !== undefined && (typeof action.label !== 'string' || !action.label.trim() || action.label.length > 80 || /[\r\n]/.test(action.label)))) throw fail('Batch requires 1–32 ordinary actions and an optional 1–80 character single-line label.');
      for (const [childIndex, child] of action.actions.entries()) {
        try { await applyAction(next, before, child, projectDir, true); }
        catch (error) { throw fail(`Batch action[${childIndex}]: ${error instanceof Error ? error.message : String(error)}`); }
      }
      break;
    }
    case 'add-scene':
      validateActionShape('scene', action.scene); sceneReferences(action.scene);
      if (next.scenes.some(scene => scene.id === action.scene.id)) throw fail('Duplicate scene ID.');
      next.scenes.push(structuredClone(action.scene)); break;
    case 'edit-scene': {
      const revised = patchScene(next.scenes[index], action.patch); sceneReferences(revised); next.scenes[index] = revised; break;
    }
    case 'remove-scene': next.scenes.splice(index, 1); break;
    case 'move-scene':
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= next.scenes.length) throw fail('Invalid scene position.');
      next.scenes.splice(action.index, 0, next.scenes.splice(index, 1)[0]); break;
    case 'music': {
      if ((action.asset !== undefined && !id(action.asset)) || (action.provider !== undefined && !['none', 'procedural'].includes(action.provider)) || (action.gainDb !== undefined && (!Number.isFinite(action.gainDb) || action.gainDb < -60 || action.gainDb > 0))) throw fail('Invalid music asset, provider or gainDb.');
      if (action.asset && action.provider) throw fail('Choose either a file asset or a music provider.');
      if (action.asset === undefined && action.provider === undefined && action.gainDb === undefined) throw fail('Music action requires at least one of asset, provider or gainDb.');
      if (action.asset) {
        if (next.assets[action.asset]?.type !== 'audio') throw fail('Music requires an imported audio asset.');
        next.audio.music = { provider: 'file', asset: action.asset, gainDb: action.gainDb ?? before.audio.music.gainDb ?? -12 };
      } else if (action.provider !== undefined) {
        next.audio.music = { provider: action.provider, gainDb: action.gainDb ?? before.audio.music.gainDb ?? -12 };
      } else if (action.gainDb !== undefined) {
        const current = before.audio.music;
        if (current.provider === 'file' && current.asset) {
          next.audio.music = { provider: 'file', asset: current.asset, gainDb: action.gainDb };
        } else if (current.provider === 'procedural') {
          next.audio.music = { provider: 'procedural', gainDb: action.gainDb };
        } else {
          next.audio.music = { provider: 'none', gainDb: action.gainDb };
        }
      }
      break;
    }
    case 'composition': {
      if (!action.video || typeof action.video !== 'object') throw fail('Composition action requires video settings.');
      const mergedVideo = Object.assign({ fps: 30 }, before.video, action.video);
      validateActionShape('video', mergedVideo);
      next.video = mergedVideo as Manifest['video'];
      break;
    }
    case 'brand':
      validateActionShape('brand', action.patch);
      next.brand = { ...next.brand, ...(action.patch.theme ? palettes[action.patch.theme] : {}), ...action.patch }; break;
    case 'restore': case 'restore-scene': {
      let revision = before.history?.find(item => item.id === action.revisionId);
      if (!revision) {
        revision = await readExternalRevision(projectDir, action.revisionId);
      }
      if (!revision) throw fail('Revision does not exist.');
      if (action.type === 'restore') {
        next.scenes = structuredClone(revision.scenes);
        next.video = structuredClone(revision.video);
        next.audio = structuredClone(revision.audio);
        next.brand = structuredClone(revision.brand);
      } else {
        const scene = revision.scenes.find(item => item.id === action.sceneId);
        if (!scene) throw fail('Scene did not exist in that revision.');
        next.scenes[index] = structuredClone(scene);
      }
      break;
    }
  }
}

export async function editProject(file: string, action: ProjectAction, expectedEtag?: string) {
  return withProjectLock(file, async () => {
    const { manifest: before, etag } = await readProject(file);
    if (expectedEtag && expectedEtag !== etag) throw new StudioError('PROJECT_CONFLICT', 'project', 'Project changed elsewhere. Reload before editing.', 2);
    const next = structuredClone(before);
    await applyAction(next, before, action, dirname(resolve(file)));
    return commit(file, before, next, action.type === 'batch' ? action.label ?? 'batch' : action.type);
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
