import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { observeKitPage, runWithCleanup, safeError } from '../../scripts/kit-ui-observer.mjs';

const secret = 'PRIVATE_SENTINEL';
const privateHome = '/' + ['Users', 'private', 'project'].join('/');
function pageFixture({ ready = true, media = [], evaluate } = {}) {
  const page = new EventEmitter(), browser = new EventEmitter();
  const nodes = ready ? {
    'project-title': { textContent: 'film' },
    exports: { options: [{}, {}, {}], value: 'controlled-export' },
    'export-state': { textContent: 'Текущая версия' },
    player: { getAttribute: () => `/exports/${secret}/output.mp4` },
    notice: { classList: { contains: () => false } },
  } : { notice: { classList: { contains: () => true } } };
  page.browser = () => browser; page.mainFrame = () => page;
  page.evaluate = evaluate ?? (async (fn, expected) => runInNewContext(`(${fn.toString()})(expected)`, { expected, document: { readyState: 'complete', title: ready ? 'film · Agent Motion Studio' : `${secret} shell`, getElementById: id => nodes[id], querySelectorAll: () => media } }));
  return { page, browser };
}
function request(path, type = 'fetch', method = 'GET') { return { url: () => `http://127.0.0.1:49123${path}?token=${secret}#${secret}`, resourceType: () => type, method: () => method }; }
function response(page, req, status = 200) { page.emit('response', { request: () => req, status: () => status }); }
function portable(report) {
  const json = JSON.stringify(report);
  for (const forbidden of [secret, '127.0.0.1', 'http:', 'Cookie', '/' + 'Users/', 'C:\\', 'Bearer', 'projectPath']) assert.ok(!json.includes(forbidden), `Evidence leaked ${forbidden}`);
}

test('ready UI with an unfinished media request is observed separately from network idle', async () => {
  const { page } = pageFixture({ media: [{ id: 'player', closest: () => null, readyState: 1, networkState: 2, error: null, paused: true, seeking: false, duration: 20, currentTime: 0, currentSrc: secret }] });
  const report = {}, observer = observeKitPage(page, report, 'reopen', { expectedExports: 3 });
  const doc = request('/', 'document'), state = request('/api/state'), media = request(`/exports/${secret}/output.mp4`, 'media');
  page.emit('request', doc); response(page, doc); page.emit('requestfinished', doc);
  page.emit('request', state); response(page, state); page.emit('requestfinished', state);
  page.emit('request', media); response(page, media, 206); page.emit('domcontentloaded'); page.emit('load');
  const trace = await observer.snapshot();
  assert.equal(trace.dom.titleMatches, true); assert.equal(trace.dom.exportsMatch, true); assert.equal(trace.dom.currentVersion, true);
  assert.equal(trace.api.state.lastStatus, 200); assert.equal(trace.requests.inFlight, 1); assert.equal(trace.requests.pending[0].class, 'media');
  assert.equal(trace.dom.media[0].readyState, 1); assert.equal(trace.dom.media[0].networkState, 2);
  portable(report); observer.detach();
});

test('a loaded HTML shell and failed session/state API cannot be mistaken for ready UI', async () => {
  const { page, browser } = pageFixture({ ready: false }), report = {};
  const observer = observeKitPage(page, report, 'failed-open', { expectedExports: 3 });
  const doc = request('/', 'document'), session = request('/api/session', 'fetch', 'POST'), state = request('/api/state');
  for (const [req, status] of [[doc, 200], [session, 403], [state, 401]]) { page.emit('request', req); response(page, req, status); page.emit('requestfinished', req); }
  page.emit('domcontentloaded'); page.emit('load'); page.emit('pageerror', new Error(`${secret} Cookie Bearer http://127.0.0.1:49123/#${secret} ${privateHome}`));
  page.emit('console', { type: () => 'error', text: () => secret }); browser.emit('disconnected');
  const trace = await observer.snapshot();
  assert.equal(trace.dom.readyState, 'complete'); assert.equal(trace.dom.titleMatches, false); assert.equal(trace.dom.exportsMatch, false); assert.equal(trace.dom.currentVersion, false);
  assert.equal(trace.api.session.lastStatus, 403); assert.equal(trace.api.state.failedResponses, 1); assert.equal(trace.requests.inFlight, 0);
  assert.equal(trace.diagnostics.pageErrors.length, 1); assert.equal(trace.diagnostics.console.error, 1); assert.equal(trace.diagnostics.browserDisconnected, true);
  portable(report); observer.detach();
});

test('request accounting is bounded, statuses survive failures, and detach removes passive listeners', async () => {
  const { page, browser } = pageFixture(), report = {}, observer = observeKitPage(page, report, 'bounded', { maxEvents: 2, maxPending: 1 });
  const requests = [request('/api/state'), request('/api/generation/jobs'), request(`/media/${secret}`, 'media')];
  for (const req of requests) page.emit('request', req);
  response(page, requests[0], 503); page.emit('requestfailed', requests[0]); page.emit('requestfailed', requests[0]);
  page.emit('domcontentloaded'); page.emit('load');
  const trace = await observer.snapshot();
  assert.equal(trace.events.length, 2); assert.ok(trace.eventsDropped > 0); assert.equal(trace.requests.inFlight, 2); assert.equal(trace.requests.failed, 1); assert.equal(trace.requests.pendingOmitted, 2);
  assert.equal(trace.api.state.lastStatus, 503); assert.equal(trace.api.state.failedResponses, 1);
  assert.equal(typeof trace.lifecycle.load, 'number');
  observer.detach(); observer.detach(); assert.equal(page.eventNames().length, 0); assert.equal(browser.eventNames().length, 0);
  portable(report);
});

test('unavailable or hung DOM diagnostics are bounded and do not turn failed observations into readiness', async () => {
  const { page } = pageFixture({ evaluate: async () => new Promise(() => {}) }), report = {};
  const observer = observeKitPage(page, report, 'unavailable', { snapshotTimeout: 5 });
  const trace = await observer.snapshot(); assert.equal(trace.dom, undefined); assert.equal(trace.snapshotError.name, 'TimeoutError');
  portable(report); observer.detach();
});

test('a later unavailable snapshot does not retain a previously ready DOM', async () => {
  const { page } = pageFixture(), report = {}, observer = observeKitPage(page, report, 'lost-page');
  assert.equal((await observer.snapshot()).dom.titleMatches, true);
  page.evaluate = async () => { throw new Error(secret); };
  const trace = await observer.snapshot(); assert.equal(trace.dom, undefined); assert.ok(trace.snapshotError);
  portable(report); observer.detach();
});

test('cleanup or recovery cannot overwrite the first failure-time snapshot', async () => {
  const { page } = pageFixture(), report = {}, observer = observeKitPage(page, report, 'reopen');
  const media = request('/media/unfinished', 'media'); page.emit('request', media);
  const failed = await observer.snapshot({ failure: true });
  const captured = JSON.stringify(failed.failureSnapshot);
  page.emit('requestfinished', media);
  page.evaluate = async () => { throw new Error(secret); };
  await observer.snapshot(); await observer.snapshot({ failure: true });
  assert.equal(JSON.stringify(failed.failureSnapshot), captured);
  assert.equal(failed.failureSnapshot.requests.inFlight, 1);
  assert.equal(failed.failureSnapshot.dom.titleMatches, true);
  assert.equal(failed.requests.inFlight, 0); assert.equal(failed.dom, undefined);
  portable(report); observer.detach();
});

test('known browser network failure codes survive while arbitrary failure text stays private', async () => {
  const { page } = pageFixture(), report = {}, observer = observeKitPage(page, report, 'network-failures');
  const aborted = request(`/media/${secret}`, 'media'), privateError = request('/api/state');
  aborted.failure = () => ({ errorText: 'net::ERR_ABORTED' }); privateError.failure = () => ({ errorText: `net::ERR_FAILED http://host.invalid/${secret} ${privateHome}` });
  for (const req of [aborted, privateError]) { page.emit('request', req); page.emit('requestfailed', req); }
  assert.equal(observer.trace.events.filter(item => item.type === 'request-failed')[0].failureCode, 'net::ERR_ABORTED');
  assert.equal(observer.trace.events.filter(item => item.type === 'request-failed')[1].failureCode, 'unavailable');
  portable(report); observer.detach();
});

test('error evidence permits canonical navigation timeout but withholds arbitrary strings, stacks and names', () => {
  assert.deepEqual(safeError(Object.assign(new Error('Navigation timeout of 30000 ms exceeded'), { name: 'TimeoutError' })), { name: 'TimeoutError', message: 'Navigation timeout of 30000 ms exceeded' });
  const error = Object.assign(new Error(`C:\\Users\\${secret}\\project path /private/tmp/${secret} https://host.invalid/?secret=${secret}`), { name: secret, code: secret });
  portable(safeError(error)); assert.equal(safeError(error).name, 'Error');
});

test('primary failure identity and partial failed evidence survive cleanup and persistence failures', async () => {
  const primary = new Error('Navigation timeout of 30000 ms exceeded'), cleanup = new Error(secret), disk = new Error(secret);
  primary.name = 'TimeoutError'; const report = { status: 'running', commands: [{ command: 'state', exitCode: 0 }], checks: { installed: true } };
  const saves = [], calls = []; let count = 0;
  await assert.rejects(runWithCleanup({ report, run: async () => { throw primary; }, save: async () => { saves.push(JSON.parse(JSON.stringify(report))); if (++count === 1) throw disk; }, cleanups: [{ label: 'browser', run: async () => { calls.push('browser'); throw cleanup; } }, { label: 'studio', run: async () => { calls.push('studio'); } }] }), error => error === primary);
  assert.deepEqual(calls, ['browser', 'studio']); assert.equal(saves[0].status, 'failed'); assert.equal(saves[0].checks.installed, true);
  assert.equal(saves.at(-1).cleanupErrors.length, 1); assert.equal(saves.at(-1).evidenceErrors.length, 1); assert.equal(report.failure.message, 'Navigation timeout of 30000 ms exceeded');
  portable(report);
});

test('cleanup or persistence failure cannot leave a successful report or suppress later cleanup', async () => {
  const primary = new Error(secret), report = { status: 'self-run-passed' }, calls = [];
  await assert.rejects(runWithCleanup({ report, run: async () => 'value', cleanups: [{ label: 'browser', run: async () => { throw primary; } }, { label: 'studio', run: async () => { calls.push('studio'); } }] }), error => error === primary);
  assert.equal(report.status, 'failed'); assert.deepEqual(calls, ['studio']);
  const disk = new Error(secret), writeReport = { status: 'self-run-passed' };
  await assert.rejects(runWithCleanup({ report: writeReport, run: async () => {}, save: async () => { throw disk; } }), error => error === disk);
  assert.equal(writeReport.status, 'failed'); portable(report); portable(writeReport);
});

test('failed work or cleanup prevents the success-only kit sealing continuation', async () => {
  for (const failAt of ['work', 'cleanup']) {
    const primary = new Error(secret), report = { status: 'running', checks: { installed: true } };
    let sealed = false, recorded;
    async function verifyAndSeal() {
      await runWithCleanup({ report,
        run: async () => { if (failAt === 'work') throw primary; report.status = 'self-run-passed'; },
        cleanups: [{ label: 'studio', run: async () => { if (failAt === 'cleanup') throw primary; } }],
        save: async () => { recorded = JSON.parse(JSON.stringify(report)); },
      });
      sealed = true; // The verifier's recordKitSmoke/candidate reseal is here.
    }
    await assert.rejects(verifyAndSeal(), error => error === primary);
    assert.equal(sealed, false); assert.equal(recorded.status, 'failed'); assert.equal(recorded.checks.installed, true); portable(recorded);
  }
});
