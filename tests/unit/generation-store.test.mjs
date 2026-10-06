import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { GenerationStore } from '../../dist/generation-store.js';

test('generation ownership excludes another process and crashed lock never silently replays a job', { timeout: 10_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ams-lock-')), project = join(root, 'project.json');
  await writeFile(project, '{}');
  const store = new GenerationStore(project), module = pathToFileURL(resolve('dist/generation-store.js')).href;
  // An unresolved Promise alone does not keep Node's event loop alive. Keep
  // the owner running until we explicitly kill it to simulate a crashed job.
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { GenerationStore } from ${JSON.stringify(module)}; const store = new GenerationStore(${JSON.stringify(project)}); await store.locked(async()=>{await store.write('saved-job',{status:'submitting',submissions:1}); setInterval(()=>{},1000); console.log('owned'); await new Promise(()=>{});});`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const closed = new Promise(ok => child.once('close', ok));
  try {
    await new Promise((ok, bad) => { child.stdout.once('data', ok); child.once('error', bad); child.once('exit', code => bad(new Error(`child exited ${code}`))); });
    await assert.rejects(store.locked(async () => assert.fail('competing writer ran')), error => error.code === 'GENERATION_BUSY');
    child.kill(); await closed;
    await assert.rejects(store.locked(async () => assert.fail('crashed job silently replayed')), error => error.code === 'GENERATION_BUSY');
    assert.deepEqual(await store.read('saved-job'), { status: 'submitting', submissions: 1 });
    // Explicit recovery after observing the owning process exit: keep all job data.
    await rm(join(root, '.studio/generation/runner.lock'));
    await store.locked(async () => assert.deepEqual(await store.read('saved-job'), { status: 'submitting', submissions: 1 }));
  } finally { child.kill(); await closed; await rm(root, { recursive: true, force: true }); }
});

test('generation store retains corrupt state and rejects traversal and a linked private directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ams-store-')), outside = await mkdtemp(join(tmpdir(), 'ams-outside-'));
  const project = join(root, 'project.json'); await writeFile(project, '{}'); const store = new GenerationStore(project);
  try {
    await store.write('job', { status: 'prepared' });
    const file = join(root, '.studio/generation/jobs/job.json'); await writeFile(file, '{broken');
    await assert.rejects(store.read('job'), error => error.code === 'GENERATION_CORRUPT');
    assert.equal(await readFile(file, 'utf8'), '{broken');
    await assert.rejects(store.read('../project'), error => error.code === 'GENERATION_ID');
    await assert.rejects(store.path('candidates', '../escape.mp4'), error => error.code === 'GENERATION_PATH');
    await symlink(outside, join(root, '.studio/generation/candidates'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(store.path('candidates', 'clip.mp4'), error => error.code === 'GENERATION_PATH');
    await rm(join(root, '.studio/generation/candidates'));
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('generation state belongs to one manifest per directory and legacy ownership is explicit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ams-owner-'));
  const first = join(root, 'first.json'), second = join(root, 'second.json');
  await writeFile(first, '{}'); await writeFile(second, '{}');
  const firstStore = new GenerationStore(first), secondStore = new GenerationStore(second);
  try {
    const legacyDir = join(root, '.studio/generation/jobs'); await mkdir(legacyDir, { recursive: true });
    const legacyFile = join(legacyDir, 'uncertain.json'), original = '{"status":"submission_unknown","submissions":1}';
    await writeFile(legacyFile, original);
    await assert.rejects(firstStore.ids(), error => error.code === 'GENERATION_STORE_UNBOUND');
    await assert.rejects(secondStore.ids(), error => error.code === 'GENERATION_STORE_UNBOUND');
    const lock = join(root, '.studio/generation/runner.lock'); await writeFile(lock, 'keep crashed owner');
    await assert.rejects(firstStore.bindLegacy(), error => error.code === 'GENERATION_BUSY');
    assert.equal(await readFile(lock, 'utf8'), 'keep crashed owner'); await rm(lock);
    assert.deepEqual(await firstStore.bindLegacy(), { bound: true, manifest: 'first.json' });
    assert.deepEqual(await firstStore.ids(), ['uncertain']);
    assert.equal(await readFile(legacyFile, 'utf8'), original);
    assert.deepEqual(await new GenerationStore(first).read('uncertain'), JSON.parse(original));
    await assert.rejects(secondStore.ids(), error => error.code === 'GENERATION_PROJECT_MISMATCH');
    await assert.rejects(secondStore.read('uncertain'), error => error.code === 'GENERATION_PROJECT_MISMATCH');
    await assert.rejects(secondStore.write('new', {}), error => error.code === 'GENERATION_PROJECT_MISMATCH');
    await assert.rejects(secondStore.bindLegacy(), error => error.code === 'GENERATION_PROJECT_MISMATCH');
    assert.equal(await readFile(legacyFile, 'utf8'), original);
    assert.deepEqual(await firstStore.ids(), ['uncertain']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('concurrent first readers see one complete generation owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ams-owner-race-')), project = join(root, 'project.json');
  await writeFile(project, '{}');
  try {
    const results = await Promise.all(Array.from({ length: 16 }, () => new GenerationStore(project).ids()));
    assert.deepEqual(results, Array.from({ length: 16 }, () => []));
    assert.deepEqual(JSON.parse(await readFile(join(root, '.studio/generation/owner.json'), 'utf8')), { schemaVersion: 1, manifest: 'project.json' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
