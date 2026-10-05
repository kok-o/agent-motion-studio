import { mkdir, readFile, writeFile, rename, rm, realpath, open, stat } from 'node:fs/promises';
import { resolve, dirname, join, extname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashBytes, loadManifest, validateManifest } from './spec.js';
import { StudioError } from './errors.js';
import type { Manifest, Scene, Asset, Revision } from './types.js';

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const fail = (message: string) => new StudioError('PROJECT_EDIT', 'project', message, 2);

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

async function commit(file: string, before: Manifest, next: Manifest, label: string) {
  next.schemaVersion = 2;
  next.history = [...(before.history ?? []), snapshot(before, label)].slice(-100);
  next.revision = randomUUID(); validateManifest(next);
  const temporary = join(dirname(resolve(file)), `.project-${randomUUID()}.json`);
  try {
    await writeFile(temporary, json(next), { flag: 'wx' });
    await loadManifest(temporary);
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
    const dir = await realpath(dirname(resolve(file))); await mkdir(join(dir, 'assets'), { recursive: true });
    if (await realpath(join(dir, 'assets')) !== join(dir, 'assets')) throw fail('The assets directory must not be a symlink.');
    const path = `assets/${sha256}${extension}`, destination = join(dir, path);
    let created = false;
    try {
      try { await writeFile(destination, content, { flag: 'wx' }); created = true; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if ((await stat(destination)).size !== content.length || hashBytes(await readFile(destination)) !== sha256) throw fail('Existing imported source is corrupt.');
      }
      const next = structuredClone(before);
      next.assets[id] = { type, path, sha256, name: basename(name).slice(0, 200) };
      return { ...(await commit(file, before, next, `import ${basename(name).slice(0, 160)}`)), importedId: id };
    } catch (error) { if (created) await rm(destination, { force: true }); throw error; }
  });
}
