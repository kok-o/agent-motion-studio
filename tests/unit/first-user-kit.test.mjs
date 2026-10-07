import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { extractZip } from '../../scripts/zip-archive.mjs';
import { tmpdir } from 'node:os';
import { command, prepareUserKit, verifyKit, sourceStamp, recordKitSmoke, kitDocuments } from '../../scripts/first-user-kit.mjs';

async function removeFixture(root) {
  const target = resolve(root), within = relative(resolve(tmpdir()), target);
  assert.ok(within && !within.startsWith('..') && !isAbsolute(within));
  assert.ok(basename(target).startsWith('ams kit Проверка '));
  await rm(target, { recursive: true, force: true });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ams kit Проверка '));
  for (const file of [...Object.keys(kitDocuments), 'examples/coffee-ritual/CREDITS.md', 'examples/coffee-ritual/LICENSE.md', 'LICENSE', 'assets/fonts/OFL.txt']) {
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
    extractZip(kit.archive, unpacked);
    assert.deepEqual(await verifyKit(join(unpacked, kit.name)), manifest);
    const guide = await readFile(join(unpacked, kit.name, 'START_HERE_RU.md'), 'utf8');
    assert.ok(guide.includes(f.source.gitSha)); assert.match(guide, /\.\.\/agent-motion-studio-0\.1\.0\.tgz/);
    assert.match(guide, /\]\(RESULTS_BLANK_RU\.md\)/); assert.ok(guide.includes('](GETTING_STARTED.md)'));
    assert.ok(guide.includes('](AGENT_WORKFLOW_RU.md)')); assert.ok(guide.includes('](STATUS.md)'));
    // Read every local document/link directly from the extracted ZIP, before npm installation.
    for (const name of Object.values(kitDocuments)) {
      const body = await readFile(join(unpacked, kit.name, name), 'utf8');
      for (const [, href] of body.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (!/^(https?:|mailto:|#)/.test(href)) await readFile(resolve(unpacked, kit.name, href.split('#')[0]));
        else if (href.startsWith('https://github.com/kok-o/agent-motion-studio/blob/')) assert.match(body.split('\n').find(line => line.includes(href)), /optional GitHub reference/);
      }
    }
    const installation = await readFile(join(unpacked, kit.name, 'GETTING_STARTED.md'), 'utf8');
    assert.match(installation, /brew install node@24 ffmpeg/); assert.match(installation, /export CHROME_PATH=/);
    const workflow = await readFile(join(unpacked, kit.name, 'AGENT_WORKFLOW_RU.md'), 'utf8');
    assert.match(workflow, /\]\(BRIEF_TO_FILM.md\)/); assert.match(workflow, /preview.projectHash/);
    const blank = await readFile(join(kit.directory, 'RESULTS_BLANK_RU.md'), 'utf8');
    assert.equal(blank.split('\n').filter(line => /^\|[^|]+\| \|$/.test(line)).length, 14);
    await writeFile(join(kit.directory, 'coffee-original.mp4'), 'tampered');
    await assert.rejects(verifyKit(kit.directory));
  } finally { await removeFixture(f.root); }
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
  } finally { await removeFixture(f.root); }
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
    extractZip(kit.archive, unpacked);
    assert.deepEqual(await verifyKit(join(unpacked, kit.name)), sealed);
  } finally { await removeFixture(f.root); }
});

test('Windows kit creation, extraction and resealing ignore a conflicting PATH tar and diagnose missing bsdtar', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture();
  try {
    const fakeBin = join(f.root, 'fake bin'); await mkdir(fakeBin);
    // A real conflicting executable, without shell wrappers or global PATH changes.
    await copyFile(process.execPath, join(fakeBin, 'tar.exe'));
    const script = `
      import assert from 'node:assert/strict';
      import { mkdir, copyFile } from 'node:fs/promises';
      import { join } from 'node:path';
      import { command, prepareUserKit, verifyKit, recordKitSmoke } from ${JSON.stringify(pathToFileURL(resolve('scripts/first-user-kit.mjs')).href)};
      import { extractZip, windowsZipTool } from ${JSON.stringify(pathToFileURL(resolve('scripts/zip-archive.mjs')).href)};
      const f = ${JSON.stringify({ root: f.root, out: f.out, source: f.source, runtime: f.runtime, version: '0.1.0' })};
      assert.match(command('tar', ['--version']), /^v\\d/); // PATH really selects the conflicting executable.
      assert.throws(() => windowsZipTool({ env: { SystemRoot: f.root } }), /Windows ZIP support requires built-in bsdtar/);
      await mkdir(join(f.root, 'System32')); await copyFile(process.execPath, join(f.root, 'System32', 'tar.exe'));
      assert.throws(() => windowsZipTool({ env: { SystemRoot: f.root } }), /Windows ZIP support requires built-in bsdtar/);
      const kit = await prepareUserKit(f), manifest = await verifyKit(kit.directory);
      const unpacked = join(f.root, 'Первое извлечение'); await mkdir(unpacked); extractZip(kit.archive, unpacked);
      assert.deepEqual(await verifyKit(join(unpacked, kit.name)), manifest);
      await recordKitSmoke({ kit, report: { status: 'self-run-passed', gitSha: f.source.gitSha, runtimeSha256: manifest.runtime.sha256, environment: {} } });
      const resealed = join(f.root, 'Повторное извлечение'); await mkdir(resealed); extractZip(kit.archive, resealed);
      assert.deepEqual(await verifyKit(join(resealed, kit.name)), await verifyKit(kit.directory));
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', windowsHide: true, env: { ...process.env, PATH: `${fakeBin};${process.env.PATH}` } });
    assert.equal(child.status, 0, child.stderr || child.error || child.stdout);
  } finally { await removeFixture(f.root); }
});
