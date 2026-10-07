import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, rename, symlink } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { registerExport } from '../../dist/export-library.js';

async function fixture() {
  const parent = resolve('.cache/tests'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'export-library-'));
  const project = join(root, 'project'), output = join(root, 'external');
  await mkdir(project); await mkdir(output);
  const file = join(project, 'project.json'), manifest = Buffer.from('{"history":["kept"]}\n');
  await writeFile(file, manifest); await writeFile(join(output, 'output.mp4'), 'verified-output-fixture');
  return { root, project, output, file, manifest };
}
const summary = { durationSeconds: 1, totalFrames: 30 };

function safeReason(message, f) {
  // The runtime already returned the cause. Keep it; do not infer an errno.
  let text = String(message).replaceAll('\\', '/');
  const root = f.root.replaceAll('\\', '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  text = text.replace(new RegExp(root, process.platform === 'win32' ? 'gi' : 'g'), '<fixture>');
  text = text.replace(/(?:https?|file):\/\/[^\s'"<>]+/gi, '<redacted-url>');
  text = text.replace(/\b(?:sk-(?:proj-|ant-)?[a-z0-9_-]+|gh[pousr]_[a-z0-9_]+)\b/gi, '<redacted-secret>');
  text = text.replace(/\b(token|api[_-]?key|password|secret|authorization)\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi, '$1=<redacted-secret>');
  text = text.replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer <redacted-secret>');
  // Unknown absolute paths may contain spaces; quoted OS paths end at the quote.
  return text.replace(/(^|[\s'"(=])(?:[a-z]:\/|\/)[^'"\r\n]*/gi, '$1<external-path>');
}

function assertRegistered(result, f, phase) {
  const previousExports = phase === 'first' ? 0 : 1;
  const reason = result.status === 'unavailable' ? safeReason(result.message, f) : 'not supplied';
  assert.equal(result.status, 'registered', `registerExport ${phase} registration; fixture: project=<fixture>/project/project.json, output=<fixture>/external/output.mp4, previousExports=${previousExports}; returned reason: ${reason}`);
}

async function removeFixture(f) {
  const within = relative(resolve('.cache/tests'), resolve(f.root));
  assert.ok(within.startsWith('export-library-') && !within.includes('/') && !within.includes('\\') && !isAbsolute(within));
  await rm(f.root, { recursive: true, force: true });
}

test('registered exports are independent portable copies and keep earlier versions and accepted bytes', async () => {
  const f = await fixture();
  try {
    const first = await registerExport(f.file, f.output, f.manifest, summary);
    assertRegistered(first, f, 'first');
    assert.equal(await readFile(join(f.project, first.path), 'utf8'), 'verified-output-fixture');
    await writeFile(join(f.output, 'output.mp4'), 'next-output-fixture');
    const second = await registerExport(f.file, f.output, f.manifest, summary);
    assertRegistered(second, f, 'second'); assert.notEqual(first.id, second.id);
    assert.equal(relative(f.root, f.output), 'external');
    await rm(f.output, { recursive: true });
    assert.equal(await readFile(join(f.project, first.path), 'utf8'), 'verified-output-fixture');
    assert.equal(await readFile(join(f.project, second.path), 'utf8'), 'next-output-fixture');
    assert.deepEqual(await readFile(f.file), f.manifest);
    assert.deepEqual(await readFile(join(f.project, 'exports', first.id, 'manifest.json')), f.manifest);
    assert.deepEqual((await readdir(join(f.project, 'exports'))).sort(), [first.id, second.id].sort());
    const report = await readFile(join(f.project, 'exports', first.id, 'render-report.json'), 'utf8');
    assert.equal(JSON.parse(report).status, 'verified'); assert.ok(!report.includes(f.output));
  } finally { await removeFixture(f); }
});

test('an export already in the project library is not duplicated', async () => {
  const f = await fixture();
  try {
    const output = join(f.project, 'exports', 'existing-export'); await mkdir(output, { recursive: true });
    await writeFile(join(output, 'output.mp4'), 'existing');
    const result = await registerExport(f.file, output, f.manifest, summary);
    assert.equal(result.status, 'in-library'); assert.equal(result.id, 'existing-export');
    assert.deepEqual(await readdir(join(f.project, 'exports')), ['existing-export']);
    assert.equal(await readFile(join(output, 'output.mp4'), 'utf8'), 'existing');
  } finally { await removeFixture(f); }
});

test('a linked exports directory cannot redirect registration outside the project', async () => {
  const f = await fixture();
  try {
    const outside = join(f.root, 'outside'); await mkdir(outside);
    await symlink(outside, join(f.project, 'exports'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = await registerExport(f.file, f.output, f.manifest, summary);
    assert.equal(result.status, 'unavailable'); assert.match(result.message, /regular directory inside the project/);
    assert.deepEqual(await readdir(outside), []); assert.deepEqual(await readFile(f.file), f.manifest);
    assert.equal(await readFile(join(f.output, 'output.mp4'), 'utf8'), 'verified-output-fixture');
  } finally { await removeFixture(f); }
});

test('a controlled library obstruction exposes the returned cause safely for first and second registration', async () => {
  // This deliberate mkdir failure checks diagnostics, not the sporadic cause.
  for (const phase of ['first', 'second']) {
    const f = await fixture();
    try {
      let first;
      if (phase === 'second') {
        first = await registerExport(f.file, f.output, f.manifest, summary);
        assertRegistered(first, f, 'first');
        const library = join(f.project, 'exports'), retained = join(f.project, 'earlier-exports');
        assert.equal(relative(f.root, library), join('project', 'exports'));
        assert.equal(relative(f.root, retained), join('project', 'earlier-exports'));
        await rename(library, retained);
      }
      await writeFile(join(f.project, 'exports'), 'controlled obstruction');
      const result = await registerExport(f.file, f.output, f.manifest, summary);
      assert.equal(result.status, 'unavailable');
      assert.throws(() => assertRegistered(result, f, phase), error => {
        assert.ok(error.message.includes(`${phase} registration`));
        assert.ok(error.message.includes(`previousExports=${phase === 'first' ? 0 : 1}`));
        // Preserve the actual OS explanation before its quoted fixture path.
        assert.ok(error.message.includes(result.message.split("'")[0]));
        assert.ok(error.message.includes('mkdir') && error.message.includes('<fixture>/project/exports'));
        assert.ok(!error.message.includes(f.root) && !error.message.includes(f.root.replaceAll('\\', '/')));
        return true;
      });
      assert.deepEqual(await readFile(f.file), f.manifest);
      assert.equal(await readFile(join(f.output, 'output.mp4'), 'utf8'), 'verified-output-fixture');
      if (first) assert.equal(await readFile(join(f.project, 'earlier-exports', first.id, 'output.mp4'), 'utf8'), 'verified-output-fixture');
      assert.deepEqual((await readdir(f.project)).sort(), (first ? ['earlier-exports', 'exports', 'project.json'] : ['exports', 'project.json']).sort());
    } finally { await removeFixture(f); }
  }
});

test('diagnostic assertions redact other absolute paths, credentials and session URLs without inventing a cause', () => {
  const f = { root: resolve('.cache/tests/export-library-diagnostic') };
  const secret = 'sk-' + 'proj-' + 'x'.repeat(40);
  const session = 'http://127.0.0.1:4173/#' + 'a'.repeat(48);
  const externalPaths = ['C:' + '/Users/' + 'private user/file.mp4', '/' + 'home/' + 'private-user/file.mp4'];
  const message = `EACCES: denied rename '${f.root}/project/.studio-export-controlled' -> '${f.root}/project/exports/next'; other '${externalPaths[0]}' '${externalPaths[1]}'; ${secret}; token=private-token; ${session}`;
  assert.throws(() => assertRegistered({ status: 'unavailable', message }, f, 'second'), error => {
    assert.ok(error.message.includes('EACCES: denied rename'));
    assert.ok(error.message.includes('<fixture>/project/.studio-export-controlled'));
    assert.ok(error.message.includes('<fixture>/project/exports/next'));
    for (const privateValue of [f.root, ...externalPaths, secret, 'private-token', session]) assert.ok(!error.message.includes(privateValue), 'Diagnostic exposed a private value');
    assert.ok(error.message.includes('<external-path>') && error.message.includes('<redacted-secret>') && error.message.includes('<redacted-url>'));
    return true;
  });
  const unknown = 'the runtime returned no operation or error code';
  assert.throws(() => assertRegistered({ status: 'unavailable', message: unknown }, f, 'first'), error => {
    assert.ok(error.message.includes(unknown)); assert.ok(!/\b(?:EACCES|EPERM|ENOENT|EBUSY)\b/.test(error.message));
    return true;
  });
});
