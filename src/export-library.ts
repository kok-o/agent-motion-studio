import { copyFile, lstat, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { BigIntStats } from 'node:fs';
import { StudioError } from './errors.js';
import { throwIfCancelled } from './runtime.js';

export type ExportRegistration = { status: 'registered' | 'in-library'; id: string; path: string } | { status: 'unavailable'; message: string };

const promotionDelays = [100, 200, 400, 800, 1600]; // Six attempts, at most 3.1 seconds of waiting.
type Identity = Pick<BigIntStats, 'dev' | 'ino'>;
const sameDirectory = (info: BigIntStats, expected: Identity) => info.isDirectory() && !info.isSymbolicLink() && info.dev === expected.dev && info.ino === expected.ino;

async function ownedStage(root: string, rootInfo: Identity, stage: string, stageInfo: Identity) {
  try {
    return sameDirectory(await lstat(root, { bigint: true }), rootInfo) && await realpath(root) === root &&
      sameDirectory(await lstat(stage, { bigint: true }), stageInfo) && await realpath(stage) === stage;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function vacantDestination(destination: string) {
  try { await lstat(destination); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  throw new StudioError('EXPORT_PATH', 'project', 'The export destination already exists; it cannot be replaced or adopted.', 2);
}

// Serve only owned copies under the project, never arbitrary --out paths.
// The original output, accepted manifest and history remain untouched.
export async function registerExport(projectFile: string, output: string, manifest: Buffer, summary: { durationSeconds: number; totalFrames: number }): Promise<ExportRegistration> {
  let stage: string | undefined;
  let owner: { root: string; rootInfo: Identity; stageInfo: Identity } | undefined;
  try {
    throwIfCancelled();
    const root = dirname(await realpath(projectFile)), library = join(root, 'exports');
    const rootInfo = await lstat(root, { bigint: true });
    await mkdir(library, { recursive: true });
    const info = await lstat(library, { bigint: true }), actual = await realpath(library), rel = relative(root, actual);
    if (!info.isDirectory() || info.isSymbolicLink() || rel.startsWith('..') || isAbsolute(rel)) {
      throw new StudioError('EXPORT_PATH', 'project', 'The exports folder must be a regular directory inside the project.', 2);
    }
    const source = await realpath(output);
    if (dirname(source) === actual && /^[a-zA-Z0-9_-]+$/.test(basename(source))) {
      const id = basename(source); return { status: 'in-library', id, path: `exports/${id}/output.mp4` };
    }
    const video = join(source, 'output.mp4'), videoInfo = await lstat(video);
    if (!videoInfo.isFile() || videoInfo.isSymbolicLink()) throw new StudioError('EXPORT_PATH', 'project', 'The verified MP4 must be a regular file.', 2);
    stage = await mkdtemp(join(root, '.studio-export-'));
    owner = { root, rootInfo, stageInfo: await lstat(stage, { bigint: true }) };
    await copyFile(video, join(stage, 'output.mp4'));
    await writeFile(join(stage, 'manifest.json'), manifest);
    await writeFile(join(stage, 'render-report.json'), JSON.stringify({ status: 'verified', ...summary, createdAt: new Date().toISOString() }, null, 2) + '\n');
    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const prepared = stage, destination = join(actual, id);
    // Append one owned prepared copy. Unlike cache replacement, this operation
    // never moves old entries, creates backups, adopts a target or repeats work.
    for (let attempt = 0; ; attempt++) {
      throwIfCancelled();
      if (!await ownedStage(root, rootInfo, prepared, owner.stageInfo)) throw new StudioError('EXPORT_PATH', 'project', 'The project or owned export stage changed during registration.', 2);
      if (!sameDirectory(await lstat(library, { bigint: true }), info) || await realpath(library) !== actual) throw new StudioError('EXPORT_PATH', 'project', 'The exports folder changed during registration.', 2);
      await vacantDestination(destination);
      // Cancellation may arrive while any awaited path check is resolving.
      // Keep this last gate synchronous with dispatching the promotion syscall.
      throwIfCancelled();
      try { await rename(prepared, destination); stage = undefined; break; }
      catch (error) {
        throwIfCancelled();
        const code = (error as NodeJS.ErrnoException).code;
        // The observed OS refusal's cause is UNKNOWN. This narrow Windows
        // tolerance does not retry preparation, renders or registerExport itself.
        if (process.platform !== 'win32' || !['EPERM', 'EBUSY'].includes(code ?? '') || attempt === promotionDelays.length) throw error;
        await delay(promotionDelays[attempt]);
      }
    }
    return { status: 'registered', id, path: `exports/${id}/output.mp4` };
  } catch (error) {
    if (error instanceof StudioError && error.code === 'CANCELLED') throw error;
    return { status: 'unavailable', message: `MP4 exported, but its studio copy could not be saved in project/exports: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    // A moved/replaced root or stage is no longer ours to clean by this path.
    // Retain it for inspection rather than following a link or deleting a peer.
    if (stage && owner && await ownedStage(owner.root, owner.rootInfo, stage, owner.stageInfo)) await rm(stage, { recursive: true, force: true });
  }
}
