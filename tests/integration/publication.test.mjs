import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve, basename, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { render } from '../../dist/engine.js';
import { createProject, readProject, editProject, importMedia } from '../../dist/project.js';
import { hashBytes } from '../../dist/spec.js';
import { verifyVideo } from '../../dist/media.js';
import { findTools } from '../../dist/runtime.js';
import { safeText, suppliedError, probeStates } from '../support/failure-observation.mjs';

const real = { ...fs };
async function tree(directory) {
  const files = {};
  async function visit(dir, prefix = '') {
    for (const entry of await real.readdir(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await visit(join(dir, entry.name), name + '/');
      else files[name] = hashBytes(await real.readFile(join(dir, entry.name)));
    }
  }
  try { await visit(directory); return files; }
  catch (error) { if (error.code === 'ENOENT') return { absent: true }; throw error; }
}
async function entries(directory) { return (await real.readdir(directory)).sort(); }

// Test-only, installed before the first render. Observe the actual syscall and
// work cleanup without converting an unexpected baseline failure into a pass.
async function observedBaseline({ root, file, output, roots, evidence, natural = true, extraProbes = {} }, task) {
  const delegate = { ...fs }; // May contain the deterministic test's one-shot fault.
  const baseline = evidence.baseline = { phase: 'baseline', mode: natural ? 'passive' : 'controlled-observer-regression', status: 'running', moves: [], failures: [], cleanup: [] };
  let work, backup;
  const persist = async () => {
    try { await real.writeFile(join(root, 'observation.json'), JSON.stringify(evidence, null, 2) + '\n'); }
    catch (error) { (baseline.persistenceErrors ??= []).push(suppliedError(error, roots)); }
  };
  const capture = () => probeStates({
    acceptedHash: async () => hashBytes(await real.readFile(file)),
    sourceHashes: () => tree(join(dirname(file), 'assets')),
    historyHash: async () => hashBytes(JSON.stringify((await readProject(file)).manifest.history)),
    library: () => tree(join(dirname(file), 'exports')),
    work: () => work ? tree(work) : { absent: true },
    backup: () => backup ? tree(backup) : { absent: true },
    output: () => treeVisible(output), lock: () => treeLock(output),
    failureLogs: () => work ? tree(join(output, 'failures', basename(work), 'logs')) : { absent: true },
    failureReport: async () => {
      if (!work) return { absent: true };
      const report = JSON.parse(await real.readFile(join(output, 'failures', basename(work), 'failure-report.json'), 'utf8'));
      return { ...report, error: { ...report.error, message: safeText(report.error.message, roots) } };
    },
    ...extraProbes
  }, roots);
  baseline.before = await capture();
  await persist();
  fs.rename = async (from, to, ...args) => {
    if (dirname(dirname(from)) === output && basename(dirname(from)).startsWith('.job-')) work = dirname(from);
    if (dirname(dirname(to)) === output && basename(dirname(to)).startsWith('.previous-')) backup = dirname(to);
    const operation = { operation: 'rename', from: safeText(from, roots), to: safeText(to, roots) };
    baseline.moves.push(operation);
    try { const result = await delegate.rename(from, to, ...args); operation.status = 'moved'; return result; }
    catch (error) {
      operation.error = suppliedError(error, roots);
      const observation = { operation, states: await capture() };
      baseline.atFailure ??= observation;
      baseline.failures.push(observation);
      await persist();
      throw error;
    }
  };
  fs.rm = async (path, ...args) => {
    const ownedWork = dirname(path) === output && basename(path).startsWith('.job-');
    if (ownedWork) work = path;
    if (ownedWork || path === backup || path === join(output, '.render.lock')) {
      const operation = { operation: 'rm', path: safeText(path, roots) }; baseline.cleanup.push(operation);
      if (ownedWork) baseline.beforeCleanup = await capture();
      await persist();
      try { const result = await delegate.rm(path, ...args); operation.status = 'removed'; return result; }
      catch (error) { operation.error = suppliedError(error, roots); throw error; }
    }
    return delegate.rm(path, ...args);
  };
  syncBuiltinESMExports();
  try {
    const result = await task(); baseline.status = 'returned'; return result;
  } catch (error) {
    baseline.status = 'failed'; baseline.primaryError = suppliedError(error, roots);
    evidence.naturalSmoke = natural ? 'FAILED; no retry; OS cause UNKNOWN' : 'NOT RUN (controlled observer failure)';
    throw error; // Preserve the exact original error, including cancellation.
  } finally {
    Object.assign(fs, delegate); syncBuiltinESMExports();
    baseline.afterCleanup = await capture();
    await persist();
  }
}

test('one controlled logs promotion refusal preserves fresh/overwrite outputs and observes rollback before cleanup', { timeout: 120000 }, async () => {
  const root = resolve('artifacts/windows-publication-evidence', randomUUID());
  const project = join(root, 'project'), output = join(root, 'overwrite'), fresh = join(root, 'fresh');
  const roots = [[root, '<fixture>'], [process.cwd(), '<checkout>']];
  await createProject(project, { title: 'Publication control' });
  const file = join(project, 'project.json');
  let state = await readProject(file);
  await importMedia(file, 'permitted.png', await real.readFile('examples/repo-promo/assets/studio.png'), state.etag);
  state = await readProject(file);
  await editProject(file, { type: 'edit-scene', sceneId: 'opening', patch: { durationFrames: 30 } }, state.etag);
  const accepted = await real.readFile(file), sourceBefore = await tree(join(project, 'assets'));
  const acceptedState = await readProject(file);
  assert.ok(acceptedState.manifest.history.length > 0);
  const evidence = { kind: 'passive baseline + controlled publication failures', naturalSmoke: 'NOT RUN', controlledPhases: 'NOT RUN', scenarios: [] };
  // Observers and initial hashes are persisted before this natural baseline.
  const baseline = await observedBaseline({ root, file, output, roots, evidence }, () => render(file, output, { noCache: true }));
  assert.equal(baseline.studioExport.status, 'registered');
  evidence.naturalSmoke = 'NOT REPRODUCED'; evidence.controlledPhases = 'STARTED';
  const previousCopy = join(project, baseline.studioExport.path);
  const originalOutput = await tree(output), previousHash = hashBytes(await real.readFile(previousCopy));
  const libraryBefore = await tree(join(project, 'exports'));

  for (const [phase, target] of [['fresh', fresh], ['overwrite', output], ['overwrite-rollback-refusal', output]]) {
    let refusals = 0, rollbackRefusals = 0, work, backup, beforeCleanup, atRefusal, actualError;
    const previousFailures = phase === 'overwrite-rollback-refusal' ? await entries(join(target, 'failures')) : [];
    const moves = [];
    fs.rename = async (from, to) => {
      const operation = { from: safeText(from, roots), to: safeText(to, roots) }; moves.push(operation);
      if (basename(dirname(to)).startsWith('.previous-')) backup = dirname(to);
      if (phase === 'overwrite-rollback-refusal' && from === join(backup ?? target, 'logs') && to === join(target, 'logs') && refusals === 1) {
        rollbackRefusals++;
        const error = Object.assign(new Error('Controlled old logs rollback refusal'), { code: 'EACCES', syscall: 'rename', path: from, dest: to });
        operation.error = suppliedError(error, roots); throw error;
      }
      if (basename(from) === 'logs' && basename(dirname(from)).startsWith('.job-') && to === join(target, 'logs')) {
        refusals++; work = dirname(from);
        const backups = (await entries(target)).filter(name => name.startsWith('.previous-'));
        assert.equal(backups.length, 1); backup = join(target, backups[0]);
        atRefusal = { work: await tree(work), backup: await tree(backup), outputEntries: await entries(target), lock: await treeLock(target) };
        const error = Object.assign(new Error(`Controlled logs promotion refusal: rename '${from}' -> '${to}'`), { code: 'EPERM', syscall: 'rename', path: from, dest: to });
        operation.error = suppliedError(error, roots); throw error;
      }
      try { await real.rename(from, to); operation.status = 'moved'; }
      catch (error) { operation.error = suppliedError(error, roots); throw error; }
    };
    fs.rm = async (path, ...args) => {
      if (path === work) {
        beforeCleanup = { work: await tree(work), backup: await tree(backup), output: await treeVisible(target), lock: await treeLock(target) };
      }
      return real.rm(path, ...args);
    };
    syncBuiltinESMExports();
    try {
      await render(file, target, { noCache: true, overwrite: phase !== 'fresh' });
      assert.fail('The controlled publication refusal must remain a real failure');
    } catch (error) { actualError = suppliedError(error, roots); }
    finally { Object.assign(fs, real); syncBuiltinESMExports(); }

    const failureNames = (await entries(join(target, 'failures'))).filter(name => !previousFailures.includes(name));
    assert.equal(failureNames.length, 1);
    const failureDir = join(target, 'failures', failureNames[0]);
    const report = JSON.parse(await real.readFile(join(failureDir, 'failure-report.json'), 'utf8'));
    const rollbackFailed = phase === 'overwrite-rollback-refusal';
    const scenario = { phase, refusals, rollbackRefusals, actualError, moves, atRefusal, beforeCleanup,
      afterCleanup: { entries: await entries(target), output: await treeVisible(target), work: await tree(work), backup: await tree(backup), lock: await treeLock(target) },
      failureReport: { ...report, error: { ...report.error, message: safeText(report.error.message, roots) } },
      failureLogs: await tree(join(failureDir, 'logs')),
      preservation: { accepted: accepted.equals(await real.readFile(file)), sources: JSON.stringify(sourceBefore) === JSON.stringify(await tree(join(project, 'assets'))),
        history: JSON.stringify(acceptedState.manifest.history) === JSON.stringify((await readProject(file)).manifest.history),
        previousMovie: previousHash === hashBytes(await real.readFile(previousCopy)), library: JSON.stringify(libraryBefore) === JSON.stringify(await tree(join(project, 'exports'))) }
    };
    evidence.scenarios.push(scenario);
    // Persist observations before acceptance assertions so a RED remains useful.
    await real.writeFile(join(root, 'observation.json'), JSON.stringify(evidence, null, 2) + '\n');
    assert.equal(refusals, 1, 'no engine/test retry');
    assert.equal(actualError.code, rollbackFailed ? 'PUBLISH_ROLLBACK_FAILED' : 'EPERM');
    assert.equal(actualError.syscall, rollbackFailed ? 'not-supplied' : 'rename');
    assert.ok(atRefusal.work['output.mp4'], 'new movie verified before refusal');
    assert.ok(beforeCleanup.work['output.mp4'], 'failed new movie still present before cleanup');
    assert.equal(moves.some(move => move.from.endsWith('/output.mp4') && move.to === safeText(join(target, 'output.mp4'), roots) && move.from.includes('/.job-')), false);
    if (rollbackFailed) {
      assert.equal(rollbackRefusals, 1);
      const oldLogs = Object.fromEntries(Object.entries(originalOutput).filter(([name]) => name.startsWith('logs/')));
      assert.deepEqual(beforeCleanup.backup, oldLogs, 'failed rollback retains the original logs');
      assert.deepEqual(scenario.afterCleanup.backup, oldLogs, 'retained backup must survive engine cleanup');
      assert.deepEqual({ ...beforeCleanup.output, ...beforeCleanup.backup }, originalOutput, 'all previous output bytes remain recoverable');
      assert.deepEqual({ ...scenario.afterCleanup.output, ...scenario.afterCleanup.backup }, originalOutput, 'all previous bytes remain recoverable after cleanup');
    } else {
      assert.equal(rollbackRefusals, 0);
      assert.deepEqual(beforeCleanup.backup, { absent: true }, 'successful rollback removes backup');
      assert.deepEqual(scenario.afterCleanup.backup, { absent: true });
    }
    assert.equal(beforeCleanup.lock.present, true);
    assert.deepEqual(scenario.afterCleanup.work, { absent: true }); assert.equal(scenario.afterCleanup.lock.present, false);
    assert.equal(report.exitCode, 4); assert.equal(report.error.code, rollbackFailed ? 'PUBLISH_ROLLBACK_FAILED' : 'INTERNAL_ERROR'); assert.equal(report.error.stage, rollbackFailed ? 'publish' : 'render'); assert.match(report.error.message, /Controlled logs promotion refusal/);
    assert.ok(Object.keys(scenario.failureLogs).length > 0, 'logs survive work cleanup');
    assert.ok(Object.values(scenario.preservation).every(Boolean), JSON.stringify(scenario.preservation));
    if (phase === 'fresh') { assert.deepEqual(beforeCleanup.output, {}); assert.deepEqual(await treeVisible(target), {}); }
    else if (!rollbackFailed) { assert.deepEqual(beforeCleanup.output, originalOutput); assert.deepEqual(await treeVisible(target), originalOutput); }
  }
  await verifyVideo(join(output, 'output.mp4'), findTools(), { width: 1920, height: 1080, fps: 30, totalFrames: 30, audio: false });
  assert.equal(hashBytes(await real.readFile(previousCopy)), previousHash);
  evidence.controlledPhases = 'COMPLETED';
  await real.writeFile(join(root, 'observation.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ fixture: '<fixture>', scenarios: evidence.scenarios.map(s => ({ phase: s.phase, refusals: s.refusals, preservation: s.preservation, code: s.actualError.code })), naturalSmoke: evidence.naturalSmoke }));
});

test('early baseline refusal is observed before cleanup, persists unavailable probes and rethrows the original error', { timeout: 60000 }, async () => {
  const root = resolve('artifacts/windows-publication-evidence', randomUUID()), project = join(root, 'project'), output = join(root, 'overwrite');
  const file = join(project, 'project.json'), roots = [[root, '<fixture>'], [process.cwd(), '<checkout>']];
  await createProject(project, { title: 'Early observation control' });
  let state = await readProject(file);
  await importMedia(file, 'permitted.png', await real.readFile('examples/repo-promo/assets/studio.png'), state.etag);
  state = await readProject(file);
  await editProject(file, { type: 'edit-scene', sceneId: 'opening', patch: { durationFrames: 30 } }, state.etag);
  const acceptedHash = hashBytes(await real.readFile(file)), sourceHashes = await tree(join(project, 'assets'));
  const historyHash = hashBytes(JSON.stringify((await readProject(file)).manifest.history));
  const evidence = { kind: 'deterministic early-observer control, not natural OS cause', naturalSmoke: 'NOT RUN', controlledPhases: 'NOT RUN', scenarios: [] };
  let refusals = 0, injected;
  fs.rename = async (from, to, ...args) => {
    if (basename(from) === 'logs' && basename(dirname(from)).startsWith('.job-') && to === join(output, 'logs')) {
      refusals++;
      injected = Object.assign(new Error(`Controlled early baseline refusal: rename '${from}' -> '${to}'`), { code: 'EPERM', syscall: 'rename', path: from, dest: to });
      throw injected;
    }
    return real.rename(from, to, ...args);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(observedBaseline({ root, file, output, roots, evidence, natural: false,
      extraProbes: { inaccessible: async () => { throw Object.assign(new Error('Controlled probe unavailable'), { code: 'EACCES' }); } }
    }, () => render(file, output, { noCache: true })), error => error === injected && error.code === 'EPERM');
  } finally { Object.assign(fs, real); syncBuiltinESMExports(); }
  const saved = JSON.parse(await real.readFile(join(root, 'observation.json'), 'utf8')), observation = saved.baseline;
  assert.equal(refusals, 1); assert.equal(observation.phase, 'baseline'); assert.equal(observation.status, 'failed');
  assert.equal(observation.mode, 'controlled-observer-regression'); assert.equal(observation.failures.length, 1);
  assert.equal(saved.controlledPhases, 'NOT RUN'); assert.deepEqual(saved.scenarios, []);
  assert.equal(observation.primaryError.code, 'EPERM'); assert.equal(observation.primaryError.syscall, 'rename');
  assert.match(observation.primaryError.path, /^<fixture>\/overwrite\/\.job-[^/]+\/logs$/);
  assert.equal(observation.primaryError.dest, '<fixture>/overwrite/logs');
  assert.equal(observation.atFailure.operation.operation, 'rename'); assert.equal(observation.atFailure.operation.error.code, 'EPERM');
  for (const snapshot of [observation.before, observation.atFailure.states, observation.beforeCleanup, observation.afterCleanup]) {
    assert.equal(snapshot.acceptedHash, acceptedHash); assert.deepEqual(snapshot.sourceHashes, sourceHashes); assert.equal(snapshot.historyHash, historyHash);
    assert.equal(snapshot.inaccessible.unavailable.code, 'EACCES');
  }
  assert.ok(observation.atFailure.states.work['output.mp4']); assert.ok(observation.beforeCleanup.work['output.mp4']);
  assert.equal(observation.beforeCleanup.lock.present, true);
  assert.deepEqual(observation.afterCleanup.work, { absent: true }); assert.deepEqual(observation.afterCleanup.backup, { absent: true });
  assert.deepEqual(observation.afterCleanup.output, {}); assert.equal(observation.afterCleanup.lock.present, false);
  assert.equal(observation.afterCleanup.failureReport.exitCode, 4); assert.equal(observation.afterCleanup.failureReport.error.code, 'INTERNAL_ERROR');
  assert.ok(observation.afterCleanup.failureLogs['render.log']); assert.ok(observation.afterCleanup.failureLogs['decode.log']);
  assert.ok(!JSON.stringify(saved).includes(root) && !JSON.stringify(saved).includes(root.replaceAll('\\', '/')));
});

async function treeLock(target) {
  try { await real.stat(join(target, '.render.lock')); return { present: true }; }
  catch (error) { if (error.code === 'ENOENT') return { present: false }; throw error; }
}
async function treeVisible(target) {
  const snapshot = await tree(target);
  return Object.fromEntries(Object.entries(snapshot).filter(([name]) => !name.startsWith('failures/') && !name.startsWith('.job-') && !name.startsWith('.previous-') && name !== '.render.lock'));
}
