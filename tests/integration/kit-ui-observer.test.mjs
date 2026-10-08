import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { findTools, launchBrowser } from '../../dist/runtime.js';
import { observeKitPage, runWithCleanup } from '../../scripts/kit-ui-observer.mjs';

// Controlled browser fixtures prove the observer's distinction, not the cause
// of the historical installed-kit failure. The natural probe uses real Studio.
test('real browser distinguishes ready UI with a held request from a loaded failed shell', { timeout: 20000 }, async () => {
  const held = new Set(), report = { status: 'running' };
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/media/unfinished') { held.add(response); response.on('close', () => held.delete(response)); return; }
    if (url.pathname === '/api/state') {
      response.writeHead(url.searchParams.has('fail') ? 503 : 200, { 'Content-Type': 'application/json' });
      response.end('{}'); return;
    }
    const failed = url.pathname === '/failed';
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>Controlled observer fixture</title>
      <h1 id="project-title"></h1><select id="exports"></select><p id="export-state"></p>
      <script>
        fetch('/api/state${failed ? '?fail=1' : ''}').then(response => {
          if (!response.ok) return;
          document.title = 'film · Agent Motion Studio';
          document.getElementById('project-title').textContent = 'film';
          document.getElementById('exports').innerHTML = '<option>a</option><option>b</option><option>c</option>';
          document.getElementById('export-state').textContent = 'Текущая версия';
          fetch('/media/unfinished');
        });
      </script>`);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let browser, observer;
  await runWithCleanup({ report, run: async () => {
    browser = await launchBrowser(findTools().chrome);
    const page = await browser.newPage(), origin = `http://127.0.0.1:${server.address().port}`;
    observer = observeKitPage(page, report, 'controlled-ready-held', { expectedExports: 3 });
    // Longer than Chromium's 500ms idle window; only this synthetic control has
    // a short deadline. The production 30000ms gate remains unchanged.
    await assert.rejects(page.goto(origin, { waitUntil: 'networkidle0', timeout: 1500 }), error => error.name === 'TimeoutError');
    const ready = await observer.snapshot({ failure: true }); observer.detach();
    assert.equal(ready.dom.readyState, 'complete');
    assert.equal(ready.dom.titleMatches, true); assert.equal(ready.dom.exportsMatch, true); assert.equal(ready.dom.currentVersion, true);
    assert.equal(ready.api.state.lastStatus, 200);
    assert.ok(ready.requests.pending.some(request => request.class === 'media'));
    assert.ok(ready.failureSnapshot.requests.pending.some(request => request.class === 'media'));

    for (const response of held) response.end();
    observer = observeKitPage(page, report, 'controlled-failed-shell', { expectedExports: 3 });
    await page.goto(`${origin}/failed`, { waitUntil: 'networkidle0', timeout: 5000 });
    const failed = await observer.snapshot(); observer.detach();
    assert.equal(failed.dom.readyState, 'complete'); assert.equal(failed.requests.inFlight, 0);
    assert.equal(failed.api.document.lastStatus, 200); assert.equal(failed.api.state.lastStatus, 503);
    assert.equal(failed.dom.titleMatches, false); assert.equal(failed.dom.exportsMatch, false); assert.equal(failed.dom.currentVersion, false);
    assert.ok(!JSON.stringify(report).includes(origin));
    report.status = 'controlled-observer-passed';
  }, cleanups: [
    { label: 'observer', run: async () => observer?.detach() },
    { label: 'browser', run: async () => browser?.close() },
    { label: 'server', run: async () => { for (const response of held) response.end(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } },
  ] });
});
