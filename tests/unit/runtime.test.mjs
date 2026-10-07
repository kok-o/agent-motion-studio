import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, stat, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProject } from '../../dist/project.js';

test('cancelled runtime refuses subsequent process and browser launches before side effects', async () => {
  const directory = path.resolve('.cache/tests', `cancel-guard-${randomUUID()}`); await mkdir(directory, { recursive: true });
  const marker = path.join(directory, 'child-launched.txt');
  const source = `import { cancelProcesses, runProcess, launchBrowser } from './dist/runtime.js';
    cancelProcesses(); cancelProcesses();
    const results = [];
    for (const operation of [() => runProcess(process.execPath, ['-e', ${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'launched')`)}]), () => launchBrowser('definitely-missing-browser')]) {
      try { await operation(); results.push('unexpected-success'); } catch (error) { results.push({ code: error.code, exitCode: error.exitCode }); }
    }
    console.log(JSON.stringify(results));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [{ code: 'CANCELLED', exitCode: 130 }, { code: 'CANCELLED', exitCode: 130 }]);
  await assert.rejects(stat(marker), /ENOENT/, 'cancelled retries must not spawn another process');
  await rm(directory, { recursive: true, force: true });
});

test('doctor reports every missing dependency with recovery hints instead of stopping at the browser', () => {
  const absent = path.resolve('.cache/tests', `absent-tool-${randomUUID()}`);
  const result = spawnSync(process.execPath, ['dist/cli.js', 'doctor', '--json'], {
    encoding: 'utf8', timeout: 10000, windowsHide: true,
    env: { ...process.env, CHROME_PATH: absent, FFMPEG_PATH: absent, FFPROBE_PATH: absent }
  });
  assert.equal(result.status, 3, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ready, false);
  assert.equal(report.node.supported, true);
  for (const name of ['browser', 'ffmpeg', 'ffprobe']) {
    assert.equal(report[name].ready, false, name);
    assert.ok(report[name].error, name);
    assert.ok(report[name].hint, name);
  }
});

test('doctor rejects an explicit Brave executable with a compatibility diagnosis before launch', async () => {
  const directory = path.resolve('.cache/tests', `brave-diagnosis-${randomUUID()}`); await mkdir(directory, { recursive: true });
  const executable = path.join(directory, 'brave.exe'); await writeFile(executable, 'controlled non-browser fixture');
  try {
    const result = spawnSync(process.execPath, ['dist/cli.js', 'doctor', '--json'], {
      encoding: 'utf8', timeout: 10000, windowsHide: true,
      env: { ...process.env, CHROME_PATH: executable, FFMPEG_PATH: path.join(directory, 'absent'), FFPROBE_PATH: path.join(directory, 'absent') }
    });
    assert.equal(result.status, 3, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.browser.ready, false); assert.equal(report.browser.code, 'BROWSER_UNSUPPORTED');
    assert.match(report.browser.error, /Brave.*Canvas/s); assert.match(report.browser.error, /CHROME_PATH/);
    assert.match(report.browser.hint, /sandbox/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a blocked renderer loopback listener gives an environment diagnosis before browser launch', async () => {
  const directory = path.resolve('.cache/tests', `blocked-loopback-${randomUUID()}`);
  const file = (await createProject(directory)).project;
  try {
    const source = `import { Server } from 'node:http';
      import { validateForRender } from './dist/engine.js';
      Server.prototype.listen = function () { process.nextTick(() => this.emit('error', Object.assign(new Error('controlled listen denial'), { code: 'EPERM' }))); return this; };
      try { await validateForRender(${JSON.stringify(file)}); console.log('unexpected-success'); }
      catch (error) { console.log(JSON.stringify({ code: error.code, stage: error.stage, exitCode: error.exitCode, message: error.message })); }`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const error = JSON.parse(result.stdout);
    assert.equal(error.code, 'LOOPBACK_UNAVAILABLE'); assert.equal(error.stage, 'environment'); assert.equal(error.exitCode, 3);
    assert.match(error.message, /EPERM.*127\.0\.0\.1.*sandbox/s);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
