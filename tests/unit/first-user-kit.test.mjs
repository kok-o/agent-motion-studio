import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { command, prepareUserKit, verifyKit, sourceStamp, recordKitSmoke } from '../../scripts/first-user-kit.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ams-kit-unit-'));
  for (const file of ['docs/USER_TRIAL_RU.md', 'docs/USER_TRIAL_RESULTS_RU.md', 'examples/coffee-ritual/CREDITS.md', 'examples/coffee-ritual/LICENSE.md', 'LICENSE', 'assets/fonts/OFL.txt']) {
    await mkdir(join(root, file, '..'), { recursive: true }); await copyFile(resolve(file), join(root, file));
  }
  await mkdir(join(root, 'docs/media'), { recursive: true }); await writeFile(join(root, 'docs/media/coffee-original.mp4'), 'controlled media bytes; unit composition only');
  command('git', ['init', '-b', 'main'], root); command('git', ['add', '.'], root);
  command('git', ['-c', 'user.name=Kit Test', '-c', 'user.email=kit-test@example.invalid', 'commit', '-m', 'fixture'], root);
  const source = sourceStamp(root), out = join(root, 'ignored-output'); await mkdir(out);
  const runtime = join(out, 'agent-motion-studio-0.1.0.tgz'); await writeFile(runtime, 'controlled archive bytes; not an installed runtime');
  return { root, out, source, runtime, create: () => prepareUserKit({ root, out, version: '0.1.0', runtime, source }) };
}

test('a kit binds the clean Git SHA, permits only delivered files and survives ZIP extraction with correct paths', async () => {
  const f = await fixture();
  try {
    assert.equal(f.source.dirty, false);
    const kit = await f.create(), manifest = await verifyKit(kit.directory);
    assert.deepEqual(manifest.source, f.source); assert.equal(manifest.version, '0.1.0'); assert.equal(manifest.verification.status, 'not-run');
    const unpacked = join(f.root, 'unpacked'); await mkdir(unpacked);
    if (process.platform === 'win32') command('tar', ['-xf', kit.archive, '-C', unpacked]);
    else command('unzip', ['-q', kit.archive, '-d', unpacked]);
    assert.deepEqual(await verifyKit(join(unpacked, kit.name)), manifest);
    const guide = await readFile(join(unpacked, kit.name, 'START_HERE_RU.md'), 'utf8');
    assert.ok(guide.includes(f.source.gitSha)); assert.match(guide, /\.\.\/agent-motion-studio-0\.1\.0\.tgz/);
    assert.match(guide, /\]\(RESULTS_BLANK_RU\.md\)/); assert.ok(!guide.includes('](GETTING_STARTED.md)'));
    const blank = await readFile(join(kit.directory, 'RESULTS_BLANK_RU.md'), 'utf8');
    assert.equal(blank.split('\n').filter(line => /^\|[^|]+\| \|$/.test(line)).length, 14);
    await writeFile(join(kit.directory, 'coffee-original.mp4'), 'tampered');
    await assert.rejects(verifyKit(kit.directory));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('dirty provenance is explicit and cannot be accepted as a clean-commit smoke; unexpected personal files are rejected', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, 'local.md'), 'uncommitted source');
    f.source = sourceStamp(f.root); assert.equal(f.source.dirty, true);
    const kit = await prepareUserKit({ ...f, version: '0.1.0' });
    assert.ok(kit.name.endsWith('-dirty'));
    assert.equal((await verifyKit(kit.directory, { requireClean: false })).source.dirty, true);
    await assert.rejects(verifyKit(kit.directory), /dirty kit/);
    await writeFile(join(kit.directory, '.env'), 'controlled forbidden file');
    await assert.rejects(verifyKit(kit.directory, { requireClean: false }), /deep-equal|equal/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('a technical smoke record reseals the kit without modifying the empty human protocol or using a self-referential archive hash', async () => {
  const f = await fixture();
  try {
    const kit = await f.create(), initial = await verifyKit(kit.directory), blank = await readFile(join(kit.directory, 'RESULTS_BLANK_RU.md'));
    const report = { status: 'self-run-passed', gitSha: initial.source.gitSha, runtimeSha256: initial.runtime.sha256, environment: { os: { platform: 'controlled-unit-fixture' } }, limitations: { independentHuman: 'NOT RUN' } };
    await recordKitSmoke({ kit, report });
    const sealed = await verifyKit(kit.directory); assert.equal(sealed.verification.status, 'self-run-passed');
    assert.ok(sealed.files.some(item => item.file === 'SELF_RUN.json'));
    assert.ok(!sealed.files.some(item => item.file === 'KIT_MANIFEST.json' || item.file === 'SHA256SUMS.txt' || item.file === `${kit.name}.zip`));
    assert.deepEqual(await readFile(join(kit.directory, 'RESULTS_BLANK_RU.md')), blank);
    const unpacked = join(f.root, 'verified-unpacked'); await mkdir(unpacked);
    if (process.platform === 'win32') command('tar', ['-xf', kit.archive, '-C', unpacked]);
    else command('unzip', ['-q', kit.archive, '-d', unpacked]);
    assert.deepEqual(await verifyKit(join(unpacked, kit.name)), sealed);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
