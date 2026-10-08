import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { get } from 'node:http';
import { safeError } from './kit-ui-observer.mjs';

const timeoutError = code => Object.assign(new Error(code), { code });
async function bounded(promise, milliseconds, code) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError(code)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

// Use the installed CLI's ordinary SIGINT cleanup. The session URL is held only
// in memory; neither subprocess output nor project paths enter the report.
export async function openKitStudio({ cli, workspace, file, report, label }) {
  assert.match(label, /^[a-z-]+$/);
  const entry = { label, startedAt: new Date().toISOString(), startup: { status: 'running' }, process: { status: 'starting' }, cleanupErrors: [] };
  (report.studio ??= []).push(entry);
  const wrapper = join(workspace, `kit-studio-${randomUUID()}.mjs`);
  await writeFile(wrapper, `const log = console.log;
console.log = (...args) => {
  if (String(args[0]).startsWith('Local studio:')) {
    const ready = /http:\\/\\/127\\.0\\.0\\.1:\\d+\\/#[a-f0-9]+/.exec(String(args[0]))?.[0];
    if (ready) process.send({ ready });
  } else log(...args);
};
process.on('message', value => { if (value === 'SIGINT') process.emit('SIGINT'); });
try { await import(${JSON.stringify(pathToFileURL(cli).href)}); }
finally { if (process.connected) process.disconnect(); }
`, { flag: 'wx' });
  const started = performance.now();
  const child = spawn(process.execPath, [wrapper, 'studio', file, '--port', '0', '--json'], {
    cwd: workspace, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: process.env,
  });
  let exited = false;
  const done = new Promise(resolve => {
    child.once('error', error => { entry.process.error = safeError(error); resolve({ error }); });
    child.once('close', (exitCode, signal) => {
      exited = true;
      Object.assign(entry.process, { status: 'exited', exitCode, signal, elapsedMs: Math.round(performance.now() - started) });
      resolve({ exitCode, signal });
    });
  });
  async function forceStop() {
    if (exited) return;
    child.kill();
    try { await bounded(done, 1000, 'STUDIO_TERM_TIMEOUT'); }
    catch { child.kill('SIGKILL'); await bounded(done, 1000, 'STUDIO_KILL_TIMEOUT'); }
  }
  let url;
  try {
    url = await bounded(new Promise((resolve, reject) => {
      child.once('message', value => {
        try {
          const parsed = new URL(value?.ready);
          assert.equal(parsed.protocol, 'http:'); assert.equal(parsed.hostname, '127.0.0.1');
          assert.equal(parsed.pathname, '/'); assert.match(parsed.hash, /^#[a-f0-9]{64}$/);
          assert.ok(Number(parsed.port) > 0); assert.equal(parsed.search, '');
          resolve(value.ready);
        } catch (error) { reject(error); }
      });
      child.once('error', reject);
      child.once('close', () => reject(timeoutError('STUDIO_EXIT_BEFORE_READY')));
    }), 15000, 'STUDIO_START_TIMEOUT');
    entry.startup = { status: 'passed', elapsedMs: Math.round(performance.now() - started), loopback: true };
    entry.process.status = 'running';
  } catch (error) {
    entry.startup = { status: 'failed', elapsedMs: Math.round(performance.now() - started), failure: safeError(error) };
    try { await forceStop(); } catch (cleanupError) { entry.cleanupErrors.push(safeError(cleanupError)); }
    throw error;
  }
  let closing;
  return { url, close() {
    closing ??= (async () => {
      const stopStarted = performance.now(); entry.stop = { status: 'running', controlledSigint: true };
      try {
        const stopped = await bounded((async () => {
          if (!exited) await new Promise((resolve, reject) => child.send('SIGINT', error => error ? reject(error) : resolve()));
          return await done;
        })(), 15000, 'STUDIO_STOP_TIMEOUT');
        if (stopped.error) throw stopped.error;
        assert.equal(stopped.exitCode, 0, 'Installed studio must exit successfully after controlled idle SIGINT');
        assert.equal(stopped.signal, null, 'Installed studio must handle controlled idle SIGINT');
        entry.stop = { status: 'passed', controlledSigint: true, exitCode: stopped.exitCode, elapsedMs: Math.round(performance.now() - stopStarted) };
        (report.commands ??= []).push({ command: 'agent-motion-studio studio / controlled idle SIGINT', exitCode: stopped.exitCode });
      } catch (error) {
        entry.stop = { status: 'failed', controlledSigint: true, failure: safeError(error), elapsedMs: Math.round(performance.now() - stopStarted) };
        try { await forceStop(); } catch (cleanupError) { entry.cleanupErrors.push(safeError(cleanupError)); }
        throw error;
      }
    })();
    return closing;
  } };
}

// A bounded, read-only public-document probe supplements the passive browser
// trace. It does not authenticate, persist a URL, or make a readiness decision.
export async function observeKitStudioHealth(url, report, label) {
  const entry = { label, loopback: true, request: 'public-document', status: 'running' };
  (report.health ??= []).push(entry);
  const started = performance.now();
  try {
    const target = new URL('/', url);
    assert.equal(target.protocol, 'http:'); assert.equal(target.hostname, '127.0.0.1');
    await new Promise(resolve => {
      let settled = false, timer;
      const finish = value => { if (settled) return; settled = true; clearTimeout(timer); Object.assign(entry, value); resolve(); };
      const request = get(target, response => {
        finish({ status: 'observed', httpStatus: response.statusCode });
        // Header health is sufficient; stop the body/socket so this extra
        // diagnostic cannot outlive its bounded observation.
        response.destroy();
      });
      request.once('error', error => finish({ status: 'unavailable', failure: safeError(error) }));
      timer = setTimeout(() => {
        finish({ status: 'unavailable', timedOut: true }); request.destroy();
      }, 1000);
    });
  } catch (error) { Object.assign(entry, { status: 'unavailable', failure: safeError(error) }); }
  entry.elapsedMs = Math.round(performance.now() - started);
  return entry;
}
