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
import { safeText, suppliedError } from '../support/failure-observation.mjs';

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
  // The only natural smoke: a short real render creates the verified old movie.
  const baseline = await render(file, output, { noCache: true });
  assert.equal(baseline.studioExport.status, 'registered');
  const previousCopy = join(project, baseline.studioExport.path);
  const originalOutput = await tree(output), previousHash = hashBytes(await real.readFile(previousCopy));
  const libraryBefore = await tree(join(project, 'exports'));
  const evidence = { kind: 'fault-injection, not natural Windows cause', naturalSmoke: 'NOT REPRODUCED', scenarios: [] };

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
  console.log(JSON.stringify({ fixture: '<fixture>', scenarios: evidence.scenarios.map(s => ({ phase: s.phase, refusals: s.refusals, preservation: s.preservation, code: s.actualError.code })), naturalSmoke: evidence.naturalSmoke }));
});

async function treeLock(target) {
  try { await real.stat(join(target, '.render.lock')); return { present: true }; }
  catch (error) { if (error.code === 'ENOENT') return { present: false }; throw error; }
}
async function treeVisible(target) {
  const snapshot = await tree(target);
  return Object.fromEntries(Object.entries(snapshot).filter(([name]) => !name.startsWith('failures/') && !name.startsWith('.job-') && !name.startsWith('.previous-') && name !== '.render.lock'));
}
