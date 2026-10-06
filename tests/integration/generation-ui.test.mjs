import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startStudio } from '../../dist/server.js';
import { createProject, importMedia, editProject, readProject } from '../../dist/project.js';
import { replicateCapabilities } from '../../dist/generation-provider.js';
import { findTools, launchBrowser, runProcess } from '../../dist/runtime.js';

test('generation UI keeps candidate separate, resumes one saved submission, and rechecks external edits', { timeout: 180000 }, async () => {
  const root = resolve('artifacts/generation/ui', randomUUID()); await mkdir(root, { recursive: true });
  const file = (await createProject(root)).project, tools = findTools(), original = join(root, 'original.mp4'), candidate = join(root, 'candidate.mp4');
  for (const [output, color] of [[original, 'red'], [candidate, 'blue']]) await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=160x90:r=30:d=2`, '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', output]);
  const source = await importMedia(file, 'original.mp4', await readFile(original));
  const reference = await importMedia(file, 'reference.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
  await editProject(file, { type: 'add-scene', scene: { id: 'shot', type: 'video', asset: source.importedId, durationFrames: 30, trimStartSeconds: 0.5, fit: 'contain', focalPoint: { x: .3, y: .7 } } });
  const before = await readProject(file), initialBytes = await readFile(file), observations = [], requests = [], pageErrors = []; let damaged = true;
  const remote = createServer(async (req, res) => {
    requests.push({ method: req.method, path: req.url });
    if (req.url === '/submit') { for await (const _ of req) { /* Consume request body without logging private prompt. */ } res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ remoteId: 'controlled-job-1', status: 'queued' })); }
    else if (req.url === '/status/controlled-job-1') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ remoteId: 'controlled-job-1', status: 'output_ready' })); }
    else if (req.url === '/media/controlled-job-1') res.end(damaged ? Buffer.from('<html>expired download</html>') : await readFile(candidate));
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise(ok => remote.listen(0, '127.0.0.1', ok)); const remoteBase = `http://127.0.0.1:${remote.address().port}`;
  const provider = {
    capabilities: () => replicateCapabilities(true),
    submit: async input => (await fetch(`${remoteBase}/submit`, { method: 'POST', body: JSON.stringify(input) })).json(),
    status: async id => (await fetch(`${remoteBase}/status/${id}`)).json(),
    download: async (id, path) => writeFile(path, Buffer.from(await (await fetch(`${remoteBase}/media/${id}`)).arrayBuffer())),
  };
  let studio = await startStudio(file, 0, { provider }); const browser = await launchBrowser(tools.chrome), page = await browser.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
  const click = selector => page.locator(selector).setTimeout(10000).setWaitForEnabled(true).setWaitForStableBoundingBox(true).click();
  const idle = () => page.waitForFunction(() => !document.querySelector('#generation-refresh').disabled);
  const set = (id, value) => page.$eval(`#${id}`, (element, value) => { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  const selectShot = async () => { await click('[data-scene-id="shot"]'); await idle(); };
  const readyPreview = () => page.waitForFunction(() => !document.querySelector('#generation-preview-player').hidden);
  const conflictOpen = () => page.waitForFunction(() => document.querySelector('#generation-conflict-dialog').open);
  const count = path => requests.filter(item => item.path === path).length;
  const disk = async () => (await readProject(file)).manifest;
  try {
    const localOrigin = new URL(studio.url).origin;
    assert.equal((await fetch(`${localOrigin}/api/generation/jobs`)).status, 401);
    assert.equal(await new Promise((ok, bad) => { const req = httpRequest(localOrigin + '/api/generation/capabilities', { headers: { Host: 'untrusted.invalid' } }, res => { res.resume(); ok(res.statusCode); }); req.on('error', bad); req.end(); }), 403);
    await page.setViewport({ width: 1440, height: 1100 }); await page.goto(studio.url, { waitUntil: 'networkidle0' }); await selectShot();
    const cookies = await page.cookies(); assert.equal((await fetch(`${localOrigin}/api/generation/prepare`, { method: 'POST', headers: { Cookie: cookies.map(item => `${item.name}=${item.value}`).join('; '), 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    const traversal = await page.evaluate(async () => (await fetch('/api/generation/%2e%2e/candidate')).status); assert.ok(traversal >= 400);
    observations.push('new API requires session, real Host and same-origin POST; candidate traversal denied');
    await set('trim', '.6'); assert.equal(await page.$eval('#generation-prepare', element => element.disabled), true); await click('#generation-discard-draft'); await idle(); assert.ok((await readFile(file)).equals(initialBytes));
    await set('generation-prompt', '<b>move closer</b>'); await page.select('#generation-reference', reference.importedId); await set('generation-resolution', '480p');
    await click('#generation-prepare'); await page.waitForFunction(() => document.querySelector('#generation-status').textContent.includes('Подготовлено')); await idle();
    assert.ok((await readFile(file)).equals(initialBytes)); assert.equal(requests.length, 0); assert.equal(await page.$eval('#generation-data', element => element.querySelector('b') !== null), false);
    await click('#generation-consent'); await set('generation-budget', '.05');
    await page.$eval('#generation-submit', element => { element.click(); element.click(); }); await page.waitForFunction(() => document.querySelector('#generation-status').textContent.includes('В очереди')); await idle(); assert.equal(count('/submit'), 1);
    await page.reload({ waitUntil: 'networkidle0' }); await selectShot(); assert.equal(count('/submit'), 1); assert.equal(count('/status/controlled-job-1'), 0);
    await studio.close(); studio = await startStudio(file, 0, { provider }); await page.goto(studio.url, { waitUntil: 'networkidle0' }); await selectShot();
    await click('#generation-resume'); await page.waitForFunction(() => document.querySelector('#generation-status').textContent.includes('Результат готов')); await idle(); assert.equal(count('/status/controlled-job-1'), 1); assert.equal(count('/submit'), 1);
    observations.push('prepare has no remote traffic; double click and UI/server restart retain one submission and known remote status');
    await click('#generation-download'); await idle(); assert.ok((await readFile(file)).equals(initialBytes)); assert.equal(await page.$eval('#generation-download', element => element.disabled), false);
    damaged = false; await click('#generation-download'); await page.waitForFunction(() => !document.querySelector('#generation-candidate').hidden); await idle(); assert.equal(count('/media/controlled-job-1'), 2); assert.equal(count('/submit'), 1);
    await click('#generation-preview'); await readyPreview(); await idle(); assert.ok((await readFile(file)).equals(initialBytes));
    await click('#generation-viewed'); assert.equal(await page.$eval('#generation-accept', element => element.disabled), false);
    let previewJob = JSON.parse(await page.$eval('#generation-diagnostics', element => element.textContent));
    await rm(join(root, '.studio/generation/candidates', `${previewJob.candidate.sha256}.mp4`));
    await click('#generation-accept'); await idle();
    const failedAccept = JSON.parse(await page.$eval('#generation-diagnostics', element => element.textContent));
    assert.ok((await readFile(file)).equals(initialBytes)); assert.equal(failedAccept.acceptance, undefined); assert.equal(failedAccept.preview, undefined); assert.equal(await page.$eval('#generation-accept', element => element.disabled), true); assert.equal(count('/submit'), 1);
    await click('#generation-download'); await idle(); assert.equal(count('/media/controlled-job-1'), 3); assert.equal(count('/submit'), 1); assert.ok((await readFile(file)).equals(initialBytes));
    await click('#generation-preview'); await readyPreview(); await idle(); await click('#generation-viewed');
    previewJob = JSON.parse(await page.$eval('#generation-diagnostics', element => element.textContent));
    observations.push('missing candidate at Accept proves precommit failure, clears only new acceptance/preview, disables stale Accept, and redownloads the same result without another generation');
    await set('candidate-x', '.8'); assert.equal(await page.$eval('#generation-accept', element => element.disabled), true);
    const stale = await page.evaluate(async ({ id, previewId, etag }) => { const res = await fetch(`/api/generation/${id}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': etag }, body: JSON.stringify({ draft: { trimStartSeconds: 0, fit: 'contain', focalPoint: { x: .8, y: .7 } }, previewId, operationId: 'unviewed-crop' }) }); return { status: res.status, json: await res.json() }; }, { id: previewJob.id, previewId: previewJob.preview.previewId, etag: previewJob.preview.baseEtag });
    assert.ok(stale.status >= 400); assert.equal(stale.json.error.code, 'GENERATION_PREVIEW_STALE'); assert.ok((await readFile(file)).equals(initialBytes));
    await click('#generation-preview'); await readyPreview(); await idle(); await click('#generation-viewed');
    await editProject(file, { type: 'edit-scene', sceneId: 'shot', patch: { focalPoint: { x: .4, y: .7 } } }); const externalBytes = await readFile(file);
    await click('#generation-accept'); await conflictOpen(); await idle(); assert.ok((await readFile(file)).equals(externalBytes));
    await editProject(file, { type: 'edit-scene', sceneId: 'opening', patch: { text: 'EXTERNAL SECOND EDIT' } }); const racedBytes = await readFile(file);
    await click('#generation-conflict-preview'); await idle(); assert.equal(await page.$eval('#generation-conflict-dialog', element => element.open), true); assert.match(await page.$eval('#notice', element => element.textContent), /снова изменён/); assert.ok((await readFile(file)).equals(racedBytes));
    await click('#generation-conflict-preview'); await page.waitForFunction(() => !document.querySelector('#generation-conflict-dialog').open); await readyPreview(); await idle(); assert.ok((await readFile(file)).equals(racedBytes));
    observations.push('damaged download retries only old output; preview leaves bytes unchanged; crop changes require fresh server fingerprint; two external edits require fresh context acknowledgment');
    await page.screenshot({ path: join(root, 'candidate-preview.png') }); await click('#generation-viewed'); await click('#generation-accept'); await page.waitForFunction(() => document.querySelector('#generation-status').textContent.includes('дубль принят')); await idle();
    const accepted = await disk(); assert.equal(accepted.scenes[1].durationFrames, 30); assert.equal(accepted.scenes[1].trimStartSeconds, 0); assert.equal(accepted.scenes[1].focalPoint.x, .8); assert.equal(accepted.scenes[0].text, 'EXTERNAL SECOND EDIT'); assert.notEqual(accepted.scenes[1].asset, source.importedId); assert.equal(accepted.operationReceipts.length, 1);
    await click('#restore-scene'); await idle(); const restored = await disk(); assert.equal(restored.scenes[1].asset, source.importedId); assert.equal(restored.scenes[1].trimStartSeconds, .5); assert.deepEqual(restored.scenes[1].focalPoint, { x: .4, y: .7 }); assert.equal(restored.scenes[0].text, 'EXTERNAL SECOND EDIT'); assert.equal(restored.operationReceipts.length, 1);
    observations.push('Accept preserves duration and unrelated latest edit; restore returns complete prior accepted scene while retaining immutable sources and receipt');
    await click('#generation-prepare'); await page.waitForFunction(() => document.querySelector('#generation-status').textContent.includes('Подготовлено')); await idle();
    const preparedAfterRestore = JSON.parse(await page.$eval('#generation-diagnostics', element => element.textContent)); assert.notEqual(preparedAfterRestore.id, previewJob.id); assert.equal(count('/submit'), 1);
    await editProject(file, { type: 'edit-scene', sceneId: 'opening', patch: { text: 'EXTERNAL PREPARE CONTEXT' } }); const changedContextBytes = await readFile(file);
    await click('#reload'); await idle(); await click('#generation-prepare'); await idle();
    const preparedAfterExternal = JSON.parse(await page.$eval('#generation-diagnostics', element => element.textContent)); assert.notEqual(preparedAfterExternal.id, preparedAfterRestore.id); assert.equal(preparedAfterExternal.status, 'prepared'); assert.equal(count('/submit'), 1); assert.ok((await readFile(file)).equals(changedContextBytes));
    await click('#generation-stop'); await idle(); await click('#generation-prepare'); await idle();
    const preparedAfterCancel = JSON.parse(await page.$eval('#generation-diagnostics', element => element.textContent)); assert.notEqual(preparedAfterCancel.id, preparedAfterExternal.id); assert.equal(preparedAfterCancel.status, 'prepared'); assert.equal(count('/submit'), 1); assert.ok((await readFile(file)).equals(changedContextBytes));
    observations.push('explicit preparation after accepted context change or local cancellation creates fresh local intent without submission or project mutation');
    assert.deepEqual(pageErrors, []); await writeFile(join(root, 'verification.json'), JSON.stringify({ passed: true, observations, controlledRequests: requests, liveProvider: 'NOT RUN', pageErrors }, null, 2));
  } catch (error) {
    try {
      await page.screenshot({ path: join(root, 'failure.png'), fullPage: true });
      const layout = await page.evaluate(() => {
        const selectors = ['#generation-candidate', '#generation-raw', '#generation-preview', '#generation-preview-player', '#generation-accept', '#generation-refresh', '#generation-conflict-dialog'];
        return { viewport: { width: innerWidth, height: innerHeight, scrollY }, notice: document.querySelector('#notice').textContent, controls: selectors.map(selector => {
          const element = document.querySelector(selector), bounds = element.getBoundingClientRect(), style = getComputedStyle(element), x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
          return { selector, hidden: element.hidden, disabled: element.disabled, display: style.display, visibility: style.visibility, bounds: bounds.toJSON(), centerElement: document.elementFromPoint(x, y)?.id, readyState: element instanceof HTMLVideoElement ? element.readyState : undefined, videoWidth: element instanceof HTMLVideoElement ? element.videoWidth : undefined, videoHeight: element instanceof HTMLVideoElement ? element.videoHeight : undefined };
        }) };
      });
      await writeFile(join(root, 'failure.json'), JSON.stringify({ failure: error.message, layout, controlledRequests: requests, pageErrors }, null, 2));
    } catch { /* Preserve the original test failure even if browser teardown started. */ }
    throw error;
  } finally { await browser.close(); await studio.close(); await new Promise(ok => remote.close(ok)); }
});

test('unknown submission UI preserves possible charge and needs explicit resolution before separately approved new intent', { timeout: 90000 }, async () => {
  const root = resolve('artifacts/generation/unknown-ui', randomUUID()); await mkdir(root, { recursive: true });
  const file = (await createProject(root)).project, sample = (await readProject('examples/coffee-ritual/project.json')).manifest;
  const sampleScene = sample.scenes.find(scene => scene.type === 'video');
  const source = await importMedia(file, 'original.mp4', await readFile(join('examples/coffee-ritual', sample.assets[sampleScene.asset].path)));
  const reference = await importMedia(file, 'reference.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
  await editProject(file, { type: 'add-scene', scene: { id: 'shot', type: 'video', asset: source.importedId, durationFrames: 30, trimStartSeconds: 0, fit: 'contain' } });
  const before = await readFile(file), requests = [], pageErrors = [];
  const remote = createServer(async (req, res) => {
    requests.push({ method: req.method, path: req.url });
    if (req.url === '/submit') {
      for await (const _ of req) { /* Receive the single submission before dropping its first response. */ }
      if (requests.filter(item => item.path === '/submit').length === 1) { res.socket.destroy(); return; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ remoteId: 'controlled-second-job', status: 'queued' }));
    } else { res.statusCode = 404; res.end(); }
  });
  await new Promise(ok => remote.listen(0, '127.0.0.1', ok)); const remoteBase = `http://127.0.0.1:${remote.address().port}`;
  const provider = { capabilities: () => replicateCapabilities(true), submit: async input => (await fetch(`${remoteBase}/submit`, { method: 'POST', body: JSON.stringify(input) })).json(), status: async () => { throw new Error('No status read expected in this scenario.'); }, download: async () => { throw new Error('No download expected in this scenario.'); } };
  let studio = await startStudio(file, 0, { provider }); const browser = await launchBrowser(findTools().chrome), page = await browser.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
  const click = selector => page.locator(selector).setTimeout(10000).setWaitForEnabled(true).setWaitForStableBoundingBox(true).click();
  const idle = () => page.waitForFunction(() => !document.querySelector('#generation-refresh').disabled);
  const diagnostic = () => page.$eval('#generation-diagnostics', element => JSON.parse(element.textContent));
  const selectShot = async () => { await click('[data-scene-id="shot"]'); await idle(); };
  const prepare = async () => { await click('#generation-prepare'); await page.waitForFunction(() => document.querySelector('#generation-status').textContent.includes('Подготовлено')); await idle(); return diagnostic(); };
  const approveAndSubmit = async () => { await click('#generation-consent'); await page.$eval('#generation-budget', element => { element.value = '.05'; element.dispatchEvent(new Event('input', { bubbles: true })); }); await click('#generation-submit'); await idle(); };
  try {
    await page.setViewport({ width: 1440, height: 1100 }); await page.goto(studio.url, { waitUntil: 'networkidle0' }); await selectShot();
    await page.$eval('#generation-prompt', element => { element.value = 'Controlled unknown outcome test'; element.dispatchEvent(new Event('input', { bubbles: true })); }); await page.select('#generation-reference', reference.importedId);
    const original = await prepare(); await approveAndSubmit();
    await page.waitForFunction(() => document.querySelector('#generation-status').textContent.includes('Исход первой отправки неизвестен')); await idle();
    let unknown = await diagnostic(); assert.equal(unknown.status, 'submission_unknown'); assert.equal(unknown.submissions, 1); assert.equal(unknown.unknownResolution, undefined); assert.equal(requests.length, 1);
    assert.equal(await page.$eval('#generation-prepare', element => element.disabled), true);
    await click('#generation-stop'); await idle(); assert.equal((await diagnostic()).status, 'submission_unknown'); assert.equal(await page.$eval('#generation-prepare', element => element.disabled), true);
    await studio.close(); studio = await startStudio(file, 0, { provider }); await page.goto(studio.url, { waitUntil: 'networkidle0' }); await selectShot();
    assert.equal(requests.length, 1); assert.equal(await page.$eval('#generation-prepare', element => element.disabled), true); assert.equal(await page.$eval('#generation-resolve-unknown', element => element.disabled), true);
    await click('#generation-account-checked'); assert.equal(await page.$eval('#generation-resolve-unknown', element => element.disabled), true);
    await click('#generation-possible-charge'); await click('#generation-resolve-unknown'); await idle();
    unknown = await diagnostic(); assert.equal(unknown.id, original.id); assert.equal(unknown.status, 'submission_unknown'); assert.equal(unknown.submissions, 1); assert.equal(unknown.requestHash, original.requestHash); assert.equal(unknown.resolution, '480p'); assert.equal(unknown.unknownResolution.kind, 'user_acknowledged'); assert.equal(unknown.unknownResolution.accountChecked, true); assert.equal(unknown.unknownResolution.acknowledgePossibleCharge, true); assert.equal(requests.length, 1); assert.ok((await readFile(file)).equals(before));
    const resolutionSnapshot = structuredClone(unknown.unknownResolution);
    const oldRepeat = await page.evaluate(async ({ id, requestHash }) => {
      const response = await fetch(`/api/generation/${id}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestHash, maxSubmissions: 1, maxCostUsd: .05, uploadReference: true }) });
      return { status: response.status, job: await response.json() };
    }, { id: original.id, requestHash: original.requestHash });
    assert.equal(oldRepeat.status, 200); assert.equal(oldRepeat.job.status, 'submission_unknown'); assert.equal(oldRepeat.job.submissions, 1); assert.equal(requests.length, 1);
    await page.reload({ waitUntil: 'networkidle0' }); await selectShot(); assert.deepEqual((await diagnostic()).unknownResolution, resolutionSnapshot); assert.equal(requests.length, 1);
    const next = await prepare(); assert.notEqual(next.id, original.id); assert.notEqual(next.requestHash, original.requestHash); assert.equal(next.submissions, 0); assert.equal(requests.length, 1); assert.equal(await page.$eval('#generation-submit', element => element.disabled), true);
    await approveAndSubmit(); await page.waitForFunction(() => document.querySelector('#generation-status').textContent.includes('В очереди')); await idle(); assert.equal(requests.length, 2);
    const all = await page.evaluate(async () => (await fetch('/api/generation/jobs')).json()); const retained = all.find(item => item.id === original.id);
    assert.equal(retained.status, 'submission_unknown'); assert.equal(retained.submissions, 1); assert.deepEqual(retained.unknownResolution, resolutionSnapshot); assert.equal(all.find(item => item.id === next.id).submissions, 1); assert.ok((await readFile(file)).equals(before)); assert.deepEqual(pageErrors, []);
    await page.screenshot({ path: join(root, 'resolved-unknown.png') }); await writeFile(join(root, 'verification.json'), JSON.stringify({ passed: true, checks: ['first response lost after one controlled POST', 'Stop and server restart retain unresolved block', 'two explicit account/possible-charge acknowledgments', 'resolution and reload create zero provider requests', 'old unknown request and original submission retained', 'new intent requires separate approval and one new POST', 'accepted bytes unchanged'], controlledRequests: requests, liveProvider: 'NOT RUN', pageErrors }, null, 2));
  } catch (error) {
    try { await page.screenshot({ path: join(root, 'failure.png'), fullPage: true }); await writeFile(join(root, 'failure.json'), JSON.stringify({ failure: error.message, controlledRequests: requests, pageErrors, status: await page.$eval('#generation-status', element => element.textContent) }, null, 2)); } catch { /* Keep the original failure. */ }
    throw error;
  } finally { await browser.close(); await studio.close(); await new Promise(ok => remote.close(ok)); }
});
