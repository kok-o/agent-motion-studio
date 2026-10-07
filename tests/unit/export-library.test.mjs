import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, rename, symlink } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { registerExport } from '../../dist/export-library.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

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

function assertRegistered(result, f, phase, observations) {
  const previousExports = phase === 'first' ? 0 : 1;
  const reason = result.status === 'unavailable' ? safeReason(result.message, f) : 'not supplied';
  assert.equal(result.status, 'registered', `registerExport ${phase} registration; fixture: project=<fixture>/project/project.json, output=<fixture>/external/output.mp4, previousExports=${previousExports}; returned reason: ${reason}${observations ? `; observations: ${JSON.stringify(observations)}` : ''}`);
}

async function assertFixtureRegistered(result, f, phase, { expectedOutput, previousPath } = {}) {
  if (result.status === 'registered') return;
  const probes = {
    acceptedManifestKept: () => readFile(f.file).then(bytes => bytes.equals(f.manifest)),
    externalOutputKept: () => readFile(join(f.output, 'output.mp4'), 'utf8').then(bytes => bytes === expectedOutput),
    stagingDirectoriesLeft: () => readdir(f.project).then(names => names.filter(name => name.startsWith('.studio-export-')).length),
    libraryEntries: () => readdir(join(f.project, 'exports')).then(names => names.length),
    previousCopyKept: () => previousPath ? readFile(join(f.project, previousPath), 'utf8').then(bytes => bytes === 'verified-output-fixture') : 'not-applicable'
  };
  const observations = {};
  for (const [name, probe] of Object.entries(probes)) {
    try { observations[name] = await probe(); }
    catch (error) { observations[name] = { unavailableCode: typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'not-supplied' }; }
  }
  // A failed read must not replace the original registration cause.
  assertRegistered(result, f, phase, observations);
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
    await assertFixtureRegistered(first, f, 'first', { expectedOutput: 'verified-output-fixture' });
    assert.equal(await readFile(join(f.project, first.path), 'utf8'), 'verified-output-fixture');
    await writeFile(join(f.output, 'output.mp4'), 'next-output-fixture');
    const second = await registerExport(f.file, f.output, f.manifest, summary);
    await assertFixtureRegistered(second, f, 'second', { expectedOutput: 'next-output-fixture', previousPath: first.path }); assert.notEqual(first.id, second.id);
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

// Built-in seams live only in an isolated child. No runtime options or public
// action are added, and the final successful move is the real filesystem rename.
async function promotionScenario({ mode, code = 'EPERM', phase = 'first', platform = 'win32', moduleUrl }) {
  const assert = (await import('node:assert/strict')).default;
  const fs = (await import('node:fs/promises')).default;
  const timers = (await import('node:timers/promises')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const { resolve, join, dirname, basename, relative, isAbsolute } = await import('node:path');
  const real = { ...fs }, realDelay = timers.setTimeout;
  const parent = resolve('.cache/tests'); await real.mkdir(parent, { recursive: true });
  const root = await real.mkdtemp(join(parent, 'export-library-promotion-'));
  const project = join(root, 'project'), output = join(root, 'external');
  await real.mkdir(project); await real.mkdir(output);
  const file = join(project, 'project.json'), manifest = Buffer.from('{"history":["kept"]}\n');
  await real.writeFile(file, manifest);
  await real.mkdir(join(project, 'assets')); await real.writeFile(join(project, 'assets/source.mp4'), 'source-kept');
  await real.mkdir(join(project, 'history')); await real.writeFile(join(project, 'history/kept.json'), 'history-kept');
  await real.writeFile(join(output, 'output.mp4'), 'verified-output-fixture');
  const summary = { durationSeconds: 1, totalFrames: 30 };
  Object.defineProperty(process, 'platform', { value: platform });
  const runtime = await import(new URL('runtime.js', moduleUrl));
  const { registerExport } = await import(moduleUrl);
  let previous;
  try {
    if (phase === 'second') {
      previous = await registerExport(file, output, manifest, summary);
      assert.equal(previous.status, 'registered', previous.message);
    }
    const foreignStage = join(project, '.studio-export-foreign');
    await real.mkdir(foreignStage); await real.writeFile(join(foreignStage, 'owned'), 'foreign-kept');
    const attempts = [], delays = []; let copies = 0, stages = 0, manifests = 0, stage, destination, cancelledAtValidation = false;
    const validationCancellation = ['cancel-validation-initial', 'cancel-validation-retry'].includes(mode);
    fs.mkdtemp = async (...args) => { stages++; return real.mkdtemp(...args); };
    fs.copyFile = async (...args) => {
      copies++;
      if (mode === 'copy-failure') throw Object.assign(new Error('injected EPERM copy'), { code: 'EPERM' });
      return real.copyFile(...args);
    };
    fs.writeFile = async (...args) => { if (basename(args[0]) === 'manifest.json') manifests++; return real.writeFile(...args); };
    fs.lstat = async (path, ...args) => {
      try { return await real.lstat(path, ...args); }
      catch (error) {
        // Deliver the real vacancy ENOENT, setting cancellation while the last
        // awaited check is resolving, after the attempt's first cancellation gate.
        const priorMoves = mode === 'cancel-validation-retry' ? 1 : 0;
        if (validationCancellation && error.code === 'ENOENT' && dirname(path) === join(project, 'exports') && attempts.length === priorMoves) {
          runtime.cancelProcesses(); cancelledAtValidation = runtime.cancelled;
        }
        throw error;
      }
    };
    fs.rename = async (from, to) => {
      assert.ok(basename(from).startsWith('.studio-export-') && basename(dirname(to)) === 'exports', 'only promotion is intercepted');
      stage = from; destination = to; attempts.push({ from, to });
      if (mode === 'transient' && attempts.length > 1 || validationCancellation && (mode === 'cancel-validation-initial' || attempts.length > 1)) return real.rename(from, to);
      if (mode === 'uncertain') await real.rename(from, to);
      throw Object.assign(new Error(`injected ${code ?? 'unknown'} promotion attempt ${attempts.length}`), code === null ? {} : { code });
    };
    timers.setTimeout = async milliseconds => {
      delays.push(milliseconds);
      if (mode === 'cancel') runtime.cancelProcesses();
      if (mode === 'library-link' || mode === 'library-replaced') {
        await real.rename(join(project, 'exports'), join(project, 'retained-exports'));
        if (mode === 'library-link') {
          const outside = join(root, 'outside'); await real.mkdir(outside);
          await real.writeFile(join(outside, 'owned'), 'outside-kept');
          await real.symlink(outside, join(project, 'exports'), process.platform === 'win32' && platform === 'win32' ? 'junction' : 'dir');
        } else { await real.mkdir(join(project, 'exports')); await real.writeFile(join(project, 'exports/owned'), 'replacement-kept'); }
      }
      if (mode === 'destination-occupied') { await real.mkdir(destination); await real.writeFile(join(destination, 'owned'), 'destination-kept'); }
      if (mode === 'stage-replaced') {
        await real.rename(stage, join(root, 'retained-stage'));
        await real.mkdir(stage); await real.writeFile(join(stage, 'owned'), 'stage-kept');
      }
      if (mode === 'root-link') {
        await real.rename(project, join(root, 'retained-project'));
        const outside = join(root, 'outside'); await real.mkdir(outside);
        await real.mkdir(join(outside, basename(stage))); await real.writeFile(join(outside, basename(stage), 'owned'), 'outside-stage-kept');
        await real.symlink(outside, project, 'junction');
      }
    };
    syncBuiltinESMExports();
    let result, cancellation;
    try { result = await registerExport(file, output, manifest, summary); }
    catch (error) { cancellation = error; }
    if (mode === 'transient' && platform === 'win32') {
      assert.equal(result?.status, 'registered', result?.message);
      assert.equal(attempts.length, 2); assert.deepEqual(delays, [100]);
      assert.equal(await real.readFile(join(project, result.path), 'utf8'), 'verified-output-fixture');
    } else if (mode === 'cancel' || validationCancellation) {
      assert.equal(cancellation?.code, 'CANCELLED'); assert.equal(cancellation?.exitCode, 130);
      const priorMoves = mode === 'cancel-validation-initial' ? 0 : 1;
      assert.equal(attempts.length, priorMoves); assert.deepEqual(delays, priorMoves ? [100] : []);
      if (validationCancellation) assert.equal(cancelledAtValidation, true, 'Cancel inside the actual final vacancy check');
    } else {
      assert.equal(result?.status, 'unavailable'); assert.equal(cancellation, undefined);
      const exhausted = mode === 'permanent' && platform === 'win32' && ['EPERM', 'EBUSY'].includes(code);
      assert.equal(attempts.length, mode === 'copy-failure' ? 0 : exhausted ? 6 : 1);
      assert.deepEqual(delays, mode === 'copy-failure' || platform !== 'win32' || !['EPERM', 'EBUSY'].includes(code) ? [] : exhausted ? [100, 200, 400, 800, 1600] : [100]);
      if (exhausted || mode === 'transient' || mode === 'non-retryable' || mode === 'copy-failure') {
        assert.ok(result.message.includes(`injected ${code ?? 'unknown'}`));
        if (exhausted) assert.ok(result.message.includes('attempt 6'), 'keep the last actual failure');
      } else assert.match(result.message, /changed|exists|ENOENT|owned/i);
    }
    assert.equal(stages, 1); assert.equal(copies, 1); assert.equal(manifests, mode === 'copy-failure' ? 0 : 1);
    assert.equal(new Set(attempts.map(item => item.from)).size, attempts.length ? 1 : 0);
    assert.equal(new Set(attempts.map(item => item.to)).size, attempts.length ? 1 : 0);
    const retainedProject = mode === 'root-link' ? join(root, 'retained-project') : project;
    assert.deepEqual(await real.readFile(join(retainedProject, 'project.json')), manifest);
    assert.equal(await real.readFile(join(retainedProject, 'assets/source.mp4'), 'utf8'), 'source-kept');
    assert.equal(await real.readFile(join(retainedProject, 'history/kept.json'), 'utf8'), 'history-kept');
    assert.equal(await real.readFile(join(output, 'output.mp4'), 'utf8'), 'verified-output-fixture');
    assert.equal(await real.readFile(join(retainedProject, '.studio-export-foreign/owned'), 'utf8'), 'foreign-kept');
    const retainedLibrary = ['library-link', 'library-replaced'].includes(mode) ? join(project, 'retained-exports') : join(retainedProject, 'exports');
    if (previous) assert.equal(await real.readFile(join(retainedLibrary, previous.id, 'output.mp4'), 'utf8'), 'verified-output-fixture');
    const libraryEntries = await real.readdir(retainedLibrary);
    assert.equal(libraryEntries.length, (previous ? 1 : 0) + (result?.status === 'registered' || ['destination-occupied', 'uncertain'].includes(mode) ? 1 : 0));
    const stageNames = (await real.readdir(retainedProject)).filter(name => name.startsWith('.studio-export-'));
    assert.equal(stageNames.length, ['stage-replaced', 'root-link'].includes(mode) ? 2 : 1);
    if (mode === 'library-link') assert.equal(await real.readFile(join(root, 'outside/owned'), 'utf8'), 'outside-kept');
    if (mode === 'library-replaced') assert.equal(await real.readFile(join(project, 'exports/owned'), 'utf8'), 'replacement-kept');
    if (mode === 'destination-occupied') assert.equal(await real.readFile(join(destination, 'owned'), 'utf8'), 'destination-kept');
    if (mode === 'stage-replaced') assert.equal(await real.readFile(join(stage, 'owned'), 'utf8'), 'stage-kept');
    if (mode === 'root-link') assert.equal(await real.readFile(join(project, basename(stage), 'owned'), 'utf8'), 'outside-stage-kept');
    console.log(JSON.stringify({ mode, phase, platform, code, status: result?.status ?? cancellation.code, attempts: attempts.length, delays, stages, copies, manifests, preservation: true }));
  } finally {
    Object.assign(fs, real); timers.setTimeout = realDelay; syncBuiltinESMExports();
    const within = relative(parent, root); assert.ok(within.startsWith('export-library-promotion-') && !within.includes('/') && !within.includes('\\') && !isAbsolute(within));
    await real.rm(root, { recursive: true, force: true });
  }
}

async function controlledPromotion(options) {
  const moduleUrl = pathToFileURL(resolve('dist/export-library.js')).href;
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', `await (${promotionScenario.toString()})(JSON.parse(process.argv[1]));`, JSON.stringify({ ...options, moduleUrl })], { windowsHide: true, timeout: 15000 });
    return JSON.parse(stdout);
  } catch (error) { throw new Error(safeReason(error.stderr || error.message, { root: process.cwd() })); }
}

for (const code of ['EPERM', 'EBUSY']) for (const phase of ['first', 'second']) test(`Windows promotion recovers one ${code} without repeating preparation, ${phase}`, async () => {
  await controlledPromotion({ mode: 'transient', code, phase });
});

test('Windows promotion exhausts exactly six attempts and preserves previous entries and the last cause', async () => {
  for (const code of ['EPERM', 'EBUSY']) for (const phase of ['first', 'second']) await controlledPromotion({ mode: 'permanent', code, phase });
});

test('arbitrary errors, non-Windows promotion and non-promotion failures never retry', async () => {
  for (const code of ['EACCES', 'EIO', null]) await controlledPromotion({ mode: 'non-retryable', code, phase: 'second' });
  for (const platform of ['linux', 'darwin']) for (const code of ['EPERM', 'EBUSY']) await controlledPromotion({ mode: 'transient', code, platform });
  await controlledPromotion({ mode: 'copy-failure', phase: 'second' });
});

test('cancellation during promotion delay stops before another rename and keeps earlier output', async () => {
  for (const phase of ['first', 'second']) await controlledPromotion({ mode: 'cancel', phase });
});

for (const phase of ['first', 'second']) for (const attempt of ['initial', 'retry']) test(`cancellation during final destination validation prevents the ${attempt} rename, ${phase}`, async () => {
  await controlledPromotion({ mode: `cancel-validation-${attempt}`, phase });
});

test('promotion revalidates library, stage, root and destination after waiting and never deletes foreign data', async () => {
  for (const mode of ['library-link', 'library-replaced', 'destination-occupied', 'stage-replaced', 'root-link', 'uncertain']) {
    await controlledPromotion({ mode, phase: 'second' });
  }
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
        await assertFixtureRegistered(first, f, 'first', { expectedOutput: 'verified-output-fixture' });
        const library = join(f.project, 'exports'), retained = join(f.project, 'earlier-exports');
        assert.equal(relative(f.root, library), join('project', 'exports'));
        assert.equal(relative(f.root, retained), join('project', 'earlier-exports'));
        await rename(library, retained);
      }
      await writeFile(join(f.project, 'exports'), 'controlled obstruction');
      const result = await registerExport(f.file, f.output, f.manifest, summary);
      assert.equal(result.status, 'unavailable');
      await assert.rejects(assertFixtureRegistered(result, f, phase, { expectedOutput: 'verified-output-fixture', previousPath: first ? join('earlier-exports', first.id, 'output.mp4') : undefined }), error => {
        assert.ok(error.message.includes(`${phase} registration`));
        assert.ok(error.message.includes(`previousExports=${phase === 'first' ? 0 : 1}`));
        // Preserve the actual OS explanation before its quoted fixture path.
        assert.ok(error.message.includes(result.message.split("'")[0]));
        assert.ok(error.message.includes('mkdir') && error.message.includes('<fixture>/project/exports'));
        assert.ok(!error.message.includes(f.root) && !error.message.includes(f.root.replaceAll('\\', '/')));
        assert.ok(error.message.includes('"acceptedManifestKept":true') && error.message.includes('"externalOutputKept":true'));
        assert.ok(error.message.includes('"stagingDirectoriesLeft":0'));
        assert.ok(error.message.includes('"unavailableCode":')); // The obstruction is a file, not a directory.
        if (first) assert.ok(error.message.includes('"previousCopyKept":true'));
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
  const externalPaths = ['C:' + '/' + 'Users' + '/' + 'private user/file.mp4', '/' + 'home/' + 'private-user/file.mp4'];
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
