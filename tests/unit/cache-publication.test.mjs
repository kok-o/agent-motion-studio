import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rename, readdir, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { publishCache } from '../../dist/cache-publication.js';

const fingerprint = 'a'.repeat(64);
const failure = code => Object.assign(new Error(`Injected ${code}`), { code });
const valid = async directory => {
  try { return await readFile(join(directory, 'output.mp4'), 'utf8') === 'verified movie'; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
const prepare = stage => writeFile(join(stage, 'output.mp4'), 'verified movie');
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'ams-cache-'));
  try { await run({ root, target: join(root, fingerprint), options: { root, fingerprint, prepare, valid } }); }
  finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}
async function oldCache(target) { await mkdir(target); await writeFile(join(target, 'output.mp4'), 'damaged previous cache'); }

test('cache publication retries only bounded EPERM/EBUSY directory renames', () => fixture(async ({ root, target, options }) => {
  let attempts = 0; const delays = [];
  const result = await publishCache(options, {
    rename: async (from, to) => { attempts++; if (attempts <= 2) throw failure(attempts === 1 ? 'EPERM' : 'EBUSY'); await rename(from, to); },
    delay: async milliseconds => { delays.push(milliseconds); }
  });
  assert.deepEqual(result, { status: 'published', renameRetries: 2 });
  assert.equal(attempts, 3); assert.deepEqual(delays, [100, 200]);
  assert.equal(await valid(target), true); assert.deepEqual(await readdir(root), [fingerprint]);
}));

test('exhausted cache promotion restores the previous cache and removes only its own stage', () => fixture(async ({ root, target, options }) => {
  await oldCache(target); await mkdir(join(root, '.job-another-publisher')); await writeFile(join(root, '.job-another-publisher', 'owned'), 'keep');
  let attempts = 0; const delays = [];
  await assert.rejects(publishCache(options, {
    rename: async (from, to) => { if (basename(from).startsWith('.job-')) { attempts++; throw failure('EPERM'); } await rename(from, to); },
    delay: async milliseconds => { delays.push(milliseconds); }
  }), error => error.code === 'EPERM');
  assert.equal(attempts, 6); assert.deepEqual(delays, [100, 200, 400, 800, 1600]);
  assert.equal(await readFile(join(target, 'output.mp4'), 'utf8'), 'damaged previous cache');
  assert.equal(await readFile(join(root, '.job-another-publisher', 'owned'), 'utf8'), 'keep');
  assert.deepEqual((await readdir(root)).sort(), ['.job-another-publisher', fingerprint].sort());
}));

test('cache publication surfaces arbitrary I/O failure immediately with previous cache intact', () => fixture(async ({ root, target, options }) => {
  await oldCache(target); let attempts = 0;
  await assert.rejects(publishCache(options, {
    rename: async (from, to) => { if (basename(from).startsWith('.job-')) { attempts++; throw failure('EIO'); } await rename(from, to); },
    delay: async () => assert.fail('EIO must not retry')
  }), error => error.code === 'EIO');
  assert.equal(attempts, 1); assert.equal(await readFile(join(target, 'output.mp4'), 'utf8'), 'damaged previous cache');
  assert.deepEqual(await readdir(root), [fingerprint]);
}));

test('valid cache remains immutable for readers and a later publisher reuses it', () => fixture(async ({ root, target, options }) => {
  await publishCache(options);
  const reader = async () => { for (let i = 0; i < 10; i++) assert.equal(await valid(target), true); };
  const publisher = publishCache({ ...options, prepare: async () => assert.fail('valid cache must not be replaced') }, {
    rename: async () => assert.fail('valid cache must not move')
  });
  const [result] = await Promise.all([publisher, reader(), reader()]);
  assert.deepEqual(result, { status: 'reused', renameRetries: 0 }); assert.deepEqual(await readdir(root), [fingerprint]);
}));

test('competing cache publisher cannot delete the active owner stage or lock', () => fixture(async ({ root, target, options }) => {
  let signal, release;
  const ready = new Promise(resolve => { signal = resolve; }), proceed = new Promise(resolve => { release = resolve; });
  const first = publishCache({ ...options, prepare: async stage => { await prepare(stage); signal(); await proceed; } });
  try {
    await ready;
    const before = (await readdir(root)).sort(); assert.equal(before.length, 2);
    const second = await publishCache({ ...options, prepare: async () => assert.fail('busy publisher must not prepare') });
    assert.deepEqual(second, { status: 'busy', renameRetries: 0 }); assert.deepEqual((await readdir(root)).sort(), before);
  } finally { release(); }
  assert.deepEqual(await first, { status: 'published', renameRetries: 0 });
  assert.equal(await valid(target), true); assert.deepEqual(await readdir(root), [fingerprint]);
}));

test('invalid prepared cache cannot displace an older cache', () => fixture(async ({ root, target, options }) => {
  await oldCache(target);
  await assert.rejects(publishCache({ ...options, prepare: stage => writeFile(join(stage, 'output.mp4'), 'broken') }), error => error.code === 'CACHE_INTEGRITY');
  assert.equal(await readFile(join(target, 'output.mp4'), 'utf8'), 'damaged previous cache');
  assert.deepEqual(await readdir(root), [fingerprint]);
}));

test('failed cache rollback retains the owned backup for recovery', () => fixture(async ({ root, target, options }) => {
  await oldCache(target);
  await assert.rejects(publishCache(options, {
    rename: async (from, to) => {
      if (basename(from).startsWith('.job-')) throw failure('EPERM');
      if (basename(from).startsWith('.previous-')) throw failure('EACCES');
      await rename(from, to);
    }, delay: async () => {}
  }), error => error.code === 'CACHE_ROLLBACK_FAILED');
  const entries = await readdir(root); assert.equal(entries.length, 1); assert.match(entries[0], /^\.previous-/);
  assert.equal(await readFile(join(root, entries[0], 'output.mp4'), 'utf8'), 'damaged previous cache');
}));

test('cache publication does not remove a file occupying its target directory', () => fixture(async ({ root, target, options }) => {
  await writeFile(target, 'keep');
  await assert.rejects(publishCache(options), error => error.code === 'CACHE_PATH');
  assert.equal(await readFile(target, 'utf8'), 'keep'); assert.deepEqual(await readdir(root), [fingerprint]);
}));
