import { mkdir, readFile, writeFile, rename, rm, realpath, open, lstat, readdir, link } from 'node:fs/promises';
import { basename, dirname, join, relative, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { StudioError } from './errors.js';

export const generationError = (code: string, message: string) => new StudioError(code, 'generation', message, 2);
export function checkedId(id: string) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) throw generationError('GENERATION_ID', 'Invalid local generation ID.');
  return id;
}
/** Private sidecar. All writes are serialized, but never hold the project edit lock. */
export class GenerationStore {
  constructor(readonly project: string) {}
  private async directory() {
    const root = await realpath(dirname(resolve(this.project)));
    let current = root;
    for (const part of ['.studio', 'generation']) {
      current = join(current, part); await mkdir(current, { recursive: true });
      if (await realpath(current) !== current) throw generationError('GENERATION_PATH', 'Generation state directories must not be links.');
    }
    return current;
  }
  private async owner(root: string, allowLegacy: boolean): Promise<void> {
    const manifest = basename(await realpath(resolve(this.project))), file = join(root, 'owner.json');
    let saved: { schemaVersion: number; manifest: string };
    try {
      if ((await lstat(file)).isSymbolicLink() || await realpath(file) !== file) throw generationError('GENERATION_PATH', 'Generation owner must not be a link.');
      saved = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        if (error instanceof StudioError) throw error;
        throw generationError('GENERATION_CORRUPT', 'Generation owner metadata is damaged. Keep the saved state for diagnosis.');
      }
      const entries = await readdir(root);
      if (entries.includes('owner.json')) return this.owner(root, false);
      if (!allowLegacy && entries.some(name => !/^\.owner-[a-f0-9-]+\.tmp$/.test(name))) throw generationError('GENERATION_STORE_UNBOUND', 'Legacy generation state has no manifest owner. Verify which manifest owns these jobs, then run generation bind-store with that file. No saved job was opened or changed.');
      const temporary = join(root, `.owner-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify({ schemaVersion: 1, manifest }) + '\n', { flag: 'wx', mode: 0o600 });
        // Publish complete metadata exclusively; concurrent first readers never
        // see partially written JSON and another manifest cannot replace it.
        try { await link(temporary, file); }
        catch (writeError) { if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') throw writeError; }
      } finally { await rm(temporary, { force: true }); }
      return this.owner(root, false);
    }
    if (!saved || saved.schemaVersion !== 1 || typeof saved.manifest !== 'string' || basename(saved.manifest) !== saved.manifest) throw generationError('GENERATION_CORRUPT', 'Generation owner metadata is invalid. Keep the saved state for diagnosis.');
    const normalize = (name: string) => process.platform === 'win32' ? name.toLowerCase() : name;
    if (normalize(saved.manifest) !== normalize(manifest)) throw generationError('GENERATION_PROJECT_MISMATCH', 'This directory already has generation state owned by another manifest. Use one project manifest per directory; keep its assets and private state together.');
  }
  async root() { const root = await this.directory(); await this.owner(root, false); return root; }
  /** Explicit local migration for pre-owner stores; never reassign an existing owner. */
  async bindLegacy() {
    const root = await this.directory(), lockPath = join(root, 'runner.lock');
    let handle;
    try { handle = await open(lockPath, 'wx', 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw generationError('GENERATION_BUSY', 'Generation state is locked. Verify that its owning process has stopped before recovering the lock; keep all jobs.'); throw error; }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), root, nonce: randomUUID() })); await this.owner(root, true); return { bound: true, manifest: basename(await realpath(this.project)) }; }
    finally { await handle.close(); await rm(lockPath, { force: true }); }
  }
  async path(folder: 'jobs' | 'candidates' | 'staging' | 'previews', name: string) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name.includes('..')) throw generationError('GENERATION_PATH', 'Invalid generation filename.');
    const root = await this.root(), dir = join(root, folder); await mkdir(dir, { recursive: true });
    if (await realpath(dir) !== dir) throw generationError('GENERATION_PATH', 'Generation directory must not be a link.');
    const target = join(dir, name);
    try { if ((await lstat(target)).isSymbolicLink() || await realpath(target) !== target) throw generationError('GENERATION_PATH', 'Generation file must not be a link.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return target;
  }
  async contained(file: string) {
    const root = await this.root(), actual = await realpath(file), rel = relative(root, actual);
    if (rel.startsWith('..') || isAbsolute(rel)) throw generationError('GENERATION_PATH', 'Generation file escapes its private directory.');
    return actual;
  }
  async read(id: string): Promise<unknown> {
    const file = await this.path('jobs', `${checkedId(id)}.json`);
    try {
      const bytes = await readFile(file);
      if (bytes.length > 128 * 1024) throw new Error('size');
      return JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw generationError('GENERATION_NOT_FOUND', 'Generation job does not exist.');
      throw generationError('GENERATION_CORRUPT', 'Saved generation state is damaged. It was preserved; do not submit again.');
    }
  }
  async write(id: string, value: unknown) {
    const target = await this.path('jobs', `${checkedId(id)}.json`), temp = await this.path('jobs', `${randomUUID()}.tmp`);
    try { await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await rename(temp, target); }
    finally { await rm(temp, { force: true }); }
  }
  async ids() { const dir = dirname(await this.path('jobs', 'placeholder.json')); return (await readdir(dir)).filter(name => name.endsWith('.json')).map(name => checkedId(name.slice(0, -5))); }
  async locked<T>(task: () => Promise<T>): Promise<T> {
    const root = await this.root(), lockPath = join(root, 'runner.lock'), nonce = randomUUID();
    let handle;
    try { handle = await open(lockPath, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw generationError('GENERATION_BUSY', 'Another generation operation owns this project. If it crashed, verify that process has stopped and remove only .studio/generation/runner.lock. Job state must be kept.');
      throw error;
    }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), root, nonce })); return await task(); }
    finally { await handle.close(); await rm(lockPath, { force: true }); }
  }
}
