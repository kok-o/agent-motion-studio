import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StudioError } from './errors.js';

export type CachePublication = { status: 'published' | 'reused' | 'busy'; renameRetries: number };
type Dependencies = {
  rename: typeof rename;
  delay: (milliseconds: number) => Promise<void>;
};
const defaults: Dependencies = { rename: (from, to) => rename(from, to), delay: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) };
const retryDelays = [100, 200, 400, 800, 1600];

async function directoryExists(path: string) {
  try {
    const entry = await lstat(path);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new StudioError('CACHE_PATH', 'render', 'A cache entry must be an ordinary directory.', 4);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

// Output folders have separate render locks, but publishers of the same project
// fingerprint share this lock. Never delete or adopt another publisher's stage.
// A leftover lock only disables cache writes; --no-cache and exports still work.
export async function publishCache(options: {
  root: string;
  fingerprint: string;
  prepare: (stage: string) => Promise<void>;
  valid: (directory: string) => Promise<boolean>;
  checkCancelled?: () => void;
}, dependencies: Partial<Dependencies> = {}): Promise<CachePublication> {
  if (!/^[a-f0-9]{64}$/.test(options.fingerprint)) throw new StudioError('CACHE_PATH', 'render', 'Invalid cache fingerprint.', 4);
  const io = { ...defaults, ...dependencies };
  const target = join(options.root, options.fingerprint);
  const lockPath = join(options.root, `.${options.fingerprint}.publish.lock`);
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { status: 'busy', renameRetries: 0 };
    throw error;
  }
  const nonce = randomUUID();
  const stage = join(options.root, `.job-${nonce}`);
  const backup = join(options.root, `.previous-${options.fingerprint}-${nonce}`);
  let backedUp = false, promoted = false, stageCreated = false, renameRetries = 0;
  const move = async (from: string, to: string) => {
    for (let attempt = 0; ; attempt++) {
      try { await io.rename(from, to); return; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // EPERM from this directory rename was observed on Windows. Retry only
        // EPERM/EBUSY, for at most 3.1 seconds; the source of the OS refusal is
        // unknown. Other I/O failures surface immediately.
        if (!['EPERM', 'EBUSY'].includes(code ?? '') || attempt === retryDelays.length) throw error;
        renameRetries++;
        await io.delay(retryDelays[attempt]);
      }
    }
  };
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, nonce, fingerprint: options.fingerprint }));
    options.checkCancelled?.();
    const exists = await directoryExists(target);
    if (exists && await options.valid(target)) return { status: 'reused', renameRetries };
    await mkdir(stage); stageCreated = true;
    await options.prepare(stage);
    if (!await options.valid(stage)) throw new StudioError('CACHE_INTEGRITY', 'render', 'Prepared cache failed integrity verification.', 4);
    options.checkCancelled?.();
    if (exists) { await move(target, backup); backedUp = true; }
    try {
      options.checkCancelled?.();
      await move(stage, target); promoted = true;
    } catch (error) {
      // Cache is optional, but an exhausted failure must not discard its old
      // contents or overwrite the previous exported movie. Roll back before the
      // error reaches engine.publishWork. A failed rollback retains its backup.
      if (backedUp) {
        try { await move(backup, target); backedUp = false; }
        catch { throw new StudioError('CACHE_ROLLBACK_FAILED', 'render', `Cache publication and rollback failed. Previous cache retained in ${backup}.`, 4); }
      }
      throw error;
    }
    if (backedUp) { await rm(backup, { recursive: true, maxRetries: 5, retryDelay: 100 }); backedUp = false; }
    return { status: 'published', renameRetries };
  } finally {
    try {
      if (stageCreated && !promoted) await rm(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } finally { await lock.close(); await rm(lockPath); }
  }
}
