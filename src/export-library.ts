import { copyFile, lstat, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StudioError } from './errors.js';
import { throwIfCancelled } from './runtime.js';

export type ExportRegistration = { status: 'registered' | 'in-library'; id: string; path: string } | { status: 'unavailable'; message: string };

// Serve only owned copies under the project, never arbitrary --out paths.
// The original output, accepted manifest and history remain untouched.
export async function registerExport(projectFile: string, output: string, manifest: Buffer, summary: { durationSeconds: number; totalFrames: number }): Promise<ExportRegistration> {
  let stage: string | undefined;
  try {
    throwIfCancelled();
    const root = dirname(await realpath(projectFile)), library = join(root, 'exports');
    await mkdir(library, { recursive: true });
    const info = await lstat(library), actual = await realpath(library), rel = relative(root, actual);
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
    await copyFile(video, join(stage, 'output.mp4'));
    await writeFile(join(stage, 'manifest.json'), manifest);
    await writeFile(join(stage, 'render-report.json'), JSON.stringify({ status: 'verified', ...summary, createdAt: new Date().toISOString() }, null, 2) + '\n');
    throwIfCancelled();
    if ((await lstat(library)).isSymbolicLink() || await realpath(library) !== actual) throw new StudioError('EXPORT_PATH', 'project', 'The exports folder changed during registration.', 2);
    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    await rename(stage, join(actual, id)); stage = undefined;
    return { status: 'registered', id, path: `exports/${id}/output.mp4` };
  } catch (error) {
    if (error instanceof StudioError && error.code === 'CANCELLED') throw error;
    return { status: 'unavailable', message: `MP4 exported, but its studio copy could not be saved in project/exports: ${error instanceof Error ? error.message : String(error)}` };
  } finally { if (stage) await rm(stage, { recursive: true, force: true }); }
}
