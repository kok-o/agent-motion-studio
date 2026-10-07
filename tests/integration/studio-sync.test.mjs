import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { startStudio } from '../../dist/server.js';
import { createProject, editProject, readProject } from '../../dist/project.js';
import { launchBrowser, findTools, runProcess } from '../../dist/runtime.js';

const root = resolve('artifacts/olzhas-regressions', randomUUID()); await mkdir(root, { recursive: true });
const cli = resolve('dist/cli.js');
async function cliRender(file, out) {
  const result = await new Promise((ok, bad) => {
    const child = spawn(process.execPath, [cli, 'render', file, '--out', out, '--no-cache', '--json'], { windowsHide: true, env: process.env });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.once('error', bad); child.once('close', code => ok({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout); assert.equal(report.cache.status, 'disabled');
  await writeFile(join(out, 'cli-process.json'), JSON.stringify(result, null, 2));
  return report;
}

test('independent uncached CLI exports appear live, keep a dirty UI draft, survive moving outputs and preserve title/history', { timeout: 180000 }, async () => {
  const file = (await createProject(join(root, 'trial-fastgrep'), { title: 'Independent export' })).project;
  await editProject(file, { type: 'edit-scene', sceneId: 'opening', patch: { durationFrames: 30 } });
  const accepted = await readFile(file), studio = await startStudio(file, 0), browser = await launchBrowser(findTools().chrome);
  const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  let closed = false;
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.evaluateOnNewDocument(() => localStorage.setItem('ams-language', 'ru'));
    await page.goto(studio.url, { waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('#project-title', node => node.textContent), 'trial-fastgrep');
    assert.equal(await page.title(), 'trial-fastgrep · Agent Motion Studio');
    assert.equal(await page.$eval('#export-state', node => node.textContent), 'Нет экспорта');
    await page.$eval('#scene-text', node => { node.value = 'UNSAVED USER DRAFT'; node.dispatchEvent(new Event('input', { bubbles: true })); });
    const exports = [], frames = [];
    for (const number of [1, 2]) {
      const out = join(root, `ordinary-agent-export-${number}`), report = await cliRender(file, out);
      assert.equal(report.studioExport.status, 'registered'); assert.equal(report.totalFrames, 30);
      await page.waitForFunction(count => document.querySelector('#exports').options.length === count, { timeout: 10000 }, number);
      assert.equal(await page.$eval('#scene-text', node => node.value), 'UNSAVED USER DRAFT');
      assert.equal(await page.$eval('#draft-status', node => node.textContent), 'Есть несохранённые изменения');
      assert.equal(await page.$eval('#export-state', node => node.textContent), 'Текущая версия');
      assert.equal(await page.$eval('#exports', node => node.value), report.studioExport.id);
      assert.deepEqual(await readFile(file), accepted);
      exports.push(await readFile(join(out, 'output.mp4')));
      frames.push((await runProcess(findTools().ffmpeg, ['-v', 'error', '-threads', '1', '-i', join(out, 'output.mp4'), '-map', '0:v:0', '-f', 'framemd5', '-'])).stdout);
      assert.deepEqual(await readFile(join(resolve(file, '..'), report.studioExport.path)), exports.at(-1));
    }
    assert.deepEqual(exports[0], exports[1], 'separate CLI/browser sessions must agree without cache');
    assert.equal(frames[0], frames[1]); assert.equal(frames[0].split('\n').filter(line => /^0,/.test(line)).length, 30);
    const origin = new URL(studio.url).origin;
    const outputUrl = await page.$eval('#player', node => node.getAttribute('src'));
    assert.equal((await fetch(origin + outputUrl)).status, 401, 'registered outputs still require a private session');
    assert.equal((await fetch(origin + outputUrl, { headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
    for (const number of [1, 2]) await rm(join(root, `ordinary-agent-export-${number}`), { recursive: true });
    assert.equal(await page.evaluate(async url => (await fetch(url)).status, outputUrl), 200);
    await page.$eval('#player', node => node.load());
    await page.waitForFunction(() => document.querySelector('#player').readyState >= 1, { timeout: 10000 });
    assert.equal(await page.$eval('#player', node => node.duration), 1);
    await page.click('#project-title');
    await page.$eval('#player', async node => { node.currentTime = 0; await node.play(); });
    await page.waitForFunction(() => document.querySelector('#player').currentTime >= 0.2, { timeout: 10000 });
    await page.$eval('#player', node => { node.pause(); node.currentTime = 0.5; });
    await page.waitForFunction(() => !document.querySelector('#player').seeking && document.querySelector('#player').readyState >= 2);
    await page.screenshot({ path: join(root, 'cli-export-with-draft.png') });
    await studio.close(); closed = true;
    await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('остановлена или недоступна'), { timeout: 10000 });
    assert.equal(await page.$eval('#scene-text', node => node.value), 'UNSAVED USER DRAFT');
    assert.deepEqual(await readFile(file), accepted); assert.deepEqual(errors, []);
  } finally { await browser.close(); if (!closed) await studio.close(); }
});

async function signalStudio(file, name) {
  const wrapper = join(root, `signal-${name}.mjs`);
  await writeFile(wrapper, `const log = console.log;
console.log = (...args) => { log(...args); if (String(args[0]).startsWith('Local studio:')) process.send({ ready: /http:\\/\\/127\\.0\\.0\\.1:\\d+\\/#[a-f0-9]+/.exec(args[0])[0] }); };
process.on('message', value => { if (value === 'SIGINT') process.emit('SIGINT'); });
try { await import(${JSON.stringify(pathToFileURL(cli).href)}); } finally { process.disconnect(); }\n`);
  const child = spawn(process.execPath, [wrapper, 'studio', file, '--port', '0', '--json'], { windowsHide: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
  const done = new Promise((ok, bad) => { child.once('error', bad); child.once('close', code => ok({ code, stdout: stdout.replace(/http:\/\/127\.0\.0\.1:\d+\/#[a-f0-9]+/g, '[private loopback session]'), stderr })); });
  const url = await new Promise((ok, bad) => {
    const timer = setTimeout(() => { child.kill(); bad(new Error('Studio startup timed out.')); }, 15000);
    child.once('message', message => { clearTimeout(timer); ok(message.ready); });
    child.once('error', error => { clearTimeout(timer); bad(error); });
    child.once('close', () => { clearTimeout(timer); bad(new Error('Studio stopped before readiness.')); });
  });
  return { child, url, done };
}

test('CLI studio shutdown is successful when idle and awaits cancellation cleanup during export', { timeout: 120000 }, async () => {
  const file = (await createProject(join(root, 'shutdown-project'), { title: 'Cancellation check' })).project;
  await editProject(file, { type: 'edit-scene', sceneId: 'opening', patch: { durationFrames: 30 } });
  let active;
  try {
    active = await signalStudio(file, 'idle'); active.child.send('SIGINT');
    const idle = await active.done; assert.equal(idle.code, 0, idle.stdout + idle.stderr);
    assert.deepEqual(JSON.parse(idle.stdout.trim().split('\n').at(-1)), { stopped: true, message: 'Local studio stopped.' });
    await assert.rejects(fetch(new URL(active.url).origin));
    const previous = await cliRender(file, join(root, 'previous-output'));
    const previousBytes = await readFile(join(resolve(file, '..'), previous.studioExport.path));
    await editProject(file, { type: 'edit-scene', sceneId: 'opening', patch: { durationFrames: 150 } });
    const accepted = await readFile(file), etag = (await readProject(file)).etag;
    active = await signalStudio(file, 'export');
    const url = new URL(active.url), session = await fetch(url.origin + '/api/session', { method: 'POST', headers: { Origin: url.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: url.hash.slice(1) }) });
    assert.equal(session.status, 200);
    const cookie = session.headers.get('set-cookie').split(';')[0];
    const exported = await fetch(url.origin + '/api/export', { method: 'POST', headers: { Origin: url.origin, Cookie: cookie, 'If-Match': etag, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(exported.status, 202); const job = await exported.json();
    active.child.send('SIGINT'); const stopped = await active.done;
    assert.equal(stopped.code, 0, stopped.stdout + stopped.stderr);
    assert.equal(JSON.parse(stopped.stdout.trim().split('\n').at(-1)).renderCancelled, true);
    await assert.rejects(fetch(url.origin));
    assert.deepEqual(await readFile(file), accepted);
    assert.deepEqual(await readFile(join(resolve(file, '..'), previous.studioExport.path)), previousBytes);
    await assert.rejects(readFile(file + '.edit-lock'), /ENOENT/);
    const out = join(resolve(file, '..'), 'exports', job.exportId);
    const entries = await readdir(out).catch(() => []);
    assert.ok(!entries.some(name => name === '.render.lock' || name.startsWith('.job-')));
    await writeFile(join(root, 'shutdown-results.json'), JSON.stringify({ trigger: 'controlled SIGINT event in real independent CLI processes; native macOS Ctrl+C unverified', idle, stopped, previousPreserved: true, acceptedPreserved: true }, null, 2));
  } finally { if (active?.child.exitCode === null) active.child.kill(); }
});
