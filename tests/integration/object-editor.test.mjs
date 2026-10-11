import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProject, editProject, readProject, importMedia } from '../../dist/project.js';
import { startStudio } from '../../dist/server.js';
import { findTools, launchBrowser, runProcess } from '../../dist/runtime.js';
import { sampleObject } from '../../dist/composition.js';
import { loadManifest, hashBytes } from '../../dist/spec.js';
import { openRenderer } from '../../dist/browser.js';
import { render } from '../../dist/engine.js';
import { request as httpRequest } from 'node:http';
import filesystem from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

const root = resolve('artifacts/object-editor', randomUUID());
await mkdir(root, { recursive: true });
const tools = findTools();
async function fixture(aspect) {
  const dir = join(root, `${aspect.replace(':', '-')}-${randomUUID()}`); await mkdir(dir);
  const image = join(dir, 'synthetic.png');
  await runProcess(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x2392b0:s=64x64', '-frames:v', '1', '-threads', '1', image]);
  const file = (await createProject(join(dir, 'film'), { aspect, title: 'Native editor fixture' })).project;
  const imported = await importMedia(file, 'synthetic.png', await readFile(image));
  const asset = Object.keys(imported.manifest.assets)[0];
  const scene = { id: 'objects', type: 'composition', durationFrames: 30, background: '#14212e', objects: [
    { id: 'back', type: 'shape', shape: 'rect', x: 80, y: 80, width: 500, height: 320, color: '#37687a', rotation: 20, radius: 12, opacity: 0.9, keyframes: [{ frame: 18, opacity: 0.7, easing: 'inOutCubic' }] },
    { id: 'title', type: 'text', text: 'Original title', fontSize: 32, weight: 400, x: 130, y: 140, width: 400, height: 160, rotation: 13, opacity: 0.8, reveal: 1, keyframes: [{ frame: 15, x: 150, rotation: 18, opacity: 0.6, reveal: 0.8, easing: 'outCubic' }, { frame: 28, y: 200, easing: 'linear' }] },
    { id: 'image', type: 'image', asset, x: 640, y: 120, width: 180, height: 180, fit: 'contain', focalPoint: { x: 0.4, y: 0.6 }, rotation: -17 }
  ] };
  await editProject(file, { type: 'add-scene', scene });
  await editProject(file, { type: 'edit-scene', sceneId: 'opening', patch: { durationFrames: 6 } });
  return { file, scene, dir, asset };
}
async function field(page, selector, value) {
  await page.click(selector); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
  await page.keyboard.type(String(value)); await page.keyboard.press('Tab');
}
async function ready(page) { await page.waitForFunction(() => !document.querySelector('#object-editor').hidden && !document.querySelector('#visual-x').disabled); }
async function previewDraft(page) { await page.waitForFunction(() => !document.querySelector('#preview-scene').disabled); await page.click('#preview-scene'); }
async function nativePoint(page, x, y) {
  return page.$eval('#stage', (canvas, p) => { const r = canvas.getBoundingClientRect(); return { x: r.left + p.x * r.width / canvas.width, y: r.top + p.y * r.height / canvas.height }; }, { x, y });
}
async function drag(page, from, to) { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up(); }

for (const aspect of ['16:9', '9:16']) test(`native object editor mouse/keyboard and explicit preview/apply ${aspect}`, { timeout: 180000 }, async () => {
  const { file, scene, dir } = await fixture(aspect), studio = await startStudio(file, 0), browser = await launchBrowser(tools.chrome), page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const writes = []; page.on('request', request => { if (request.method() === 'POST' && /\/api\/(edit|visual\/apply|export)$/.test(new URL(request.url()).pathname)) writes.push(new URL(request.url()).pathname); });
  let frozenAction, previewResponse;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/visual/preview') frozenAction = { baseETag: request.headers()['if-match'], action: JSON.parse(request.postData()) }; });
  page.on('response', async response => { if (new URL(response.url()).pathname === '/api/visual/preview' && response.ok()) previewResponse = await response.json(); });
  try {
    await page.setViewport({ width: 1440, height: 1100 });
    await page.evaluateOnNewDocument(() => localStorage.setItem('ams-language', 'en'));
    await page.goto(studio.url, { waitUntil: 'networkidle0' });
    await page.click('[data-scene-id="objects"]'); await ready(page);
    await page.$eval('#visual-stage-wrap', node => node.scrollIntoView({ block: 'center' }));
    const accepted = await readFile(file), before = await readProject(file);
    assert.equal(await page.$eval('#stage', node => node.width), aspect === '16:9' ? 1920 : 1080);
    // Overlap selects the topmost text, independent of layer list/storage order.
    await drag(page, await nativePoint(page, 250, 220), await nativePoint(page, 290, 240));
    assert.match(await page.$eval('#visual-selection-name', node => node.textContent), /^title /);
    assert.ok(Math.abs(Number(await page.$eval('#visual-x', node => node.value)) - 170) < 0.05);
    assert.deepEqual(await readFile(file), accepted); assert.deepEqual(writes, []);
    // Escape and pointercancel roll back only the active gesture, preserving the earlier draft.
    const draftX = await page.$eval('#visual-x', node => node.value);
    for (const cancel of ['Escape', 'pointercancel']) {
      const from = await nativePoint(page, 290, 240), to = await nativePoint(page, 330, 270);
      await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 3 });
      if (cancel === 'Escape') await page.keyboard.press('Escape');
      else await page.$eval('#visual-overlay', node => node.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })));
      await page.mouse.up(); assert.equal(await page.$eval('#visual-x', node => node.value), draftX);
      assert.deepEqual(await readFile(file), accepted);
    }
    await page.click('#export'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-stay');
    assert.deepEqual(await readFile(file), accepted); assert.deepEqual(writes, []);
    // Responsive coordinates are computed from native canvas dimensions.
    await page.setViewport({ width: 1100, height: 1100 });
    await page.$eval('#visual-stage-wrap', node => node.scrollIntoView({ block: 'center' }));
    const handle = await page.$eval('[data-resize="2"]', node => { const r = node.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    const cx = Number(await page.$eval('#visual-x', node => node.value)) + 200, cy = Number(await page.$eval('#visual-y', node => node.value)) + 80;
    const center = await nativePoint(page, cx, cy);
    await drag(page, handle, { x: center.x + (handle.x - center.x) * 1.2, y: center.y + (handle.y - center.y) * 1.2 });
    assert.ok(Math.abs(Number(await page.$eval('#visual-width', node => node.value)) / Number(await page.$eval('#visual-height', node => node.value)) - 2.5) < 0.001);
    await page.click('#visual-text'); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.type('W'.repeat(200));
    await page.waitForFunction(() => document.querySelector('#visual-status').textContent.includes('TEXT_OVERFLOW'));
    assert.equal(await page.$eval('#visual-text', node => node.disabled), false, 'an invalid local render must remain editable');
    assert.deepEqual(await readFile(file), accepted);
    await field(page, '#visual-text', 'Edited title');
    await field(page, '#duration', '1.1');
    await page.select('#visual-mode', 'key');
    await page.focus('#visual-frame'); await page.keyboard.press('Home'); for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
    assert.match(await page.$eval('#visual-frame-label', node => node.textContent), /^15 /);
    await field(page, '#visual-x', 220);
    assert.deepEqual(await readFile(file), accepted);
    await previewDraft(page); await page.waitForFunction(() => !document.querySelector('#scene-preview').hidden && !document.querySelector('#save-scene').disabled, { timeout: 60000 });
    await page.focus('#visual-frame'); await page.keyboard.press('ArrowRight');
    assert.equal(await page.$eval('#save-scene', node => node.disabled), true);
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.$eval('#save-scene', node => node.disabled), true, 'returning to a frame does not revive a previous preview ticket');
    await previewDraft(page); await page.waitForFunction(() => !document.querySelector('#scene-preview').hidden && !document.querySelector('#save-scene').disabled, { timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('#scene-preview').readyState >= 2);
    await page.$eval('#scene-preview', node => { node.currentTime = 0.5; });
    await page.waitForFunction(() => !document.querySelector('#scene-preview').seeking && document.querySelector('#scene-preview').readyState >= 2);
    await page.screenshot({ path: join(dir, 'preview.png') });
    await (await page.$('#object-editor')).screenshot({ path: join(dir, 'native-editor.png') });
    await page.waitForFunction(() => document.querySelector('#stage').dataset.rendered === document.querySelector('#stage').dataset.renderRequest);
    const livePNG = Buffer.from((await page.$eval('#stage', node => node.toDataURL('image/png'))).split(',')[1], 'base64');
    const cookie = (await page.cookies()).find(item => item.name === 'studio');
    const previewURL = await page.$eval('#scene-preview', node => node.getAttribute('src'));
    const previewVideo = join(dir, 'preview.mp4');
    await writeFile(previewVideo, Buffer.from(await (await fetch(new URL(previewURL, studio.url), { headers: { Cookie: `studio=${cookie.value}` } })).arrayBuffer()));
    assert.deepEqual(await readFile(file), accepted);
    await page.click('#save-scene'); await page.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('Previewed edit accepted'));
    const after = await readProject(file), changed = after.manifest.scenes.find(item => item.id === 'objects');
    assert.equal(after.manifest.history.length, before.manifest.history.length + 1);
    assert.equal(changed.durationFrames, 33); assert.equal(changed.objects[1].text, 'Edited title');
    assert.deepEqual(changed.objects.map(item => item.id), scene.objects.map(item => item.id));
    assert.deepEqual(changed.objects[0], scene.objects[0]); assert.deepEqual(changed.objects[2], scene.objects[2]);
    for (const key of ['rotation', 'opacity', 'reveal', 'weight', 'fontSize']) assert.equal(changed.objects[1][key], scene.objects[1][key]);
    assert.deepEqual(changed.objects[1].keyframes[1], scene.objects[1].keyframes[1]);
    for (const key of ['rotation', 'opacity', 'reveal', 'easing']) assert.equal(changed.objects[1].keyframes[0][key], scene.objects[1].keyframes[0][key]);
    assert.equal(sampleObject(changed.objects[1], 15).x, 220);
    assert.deepEqual(after.manifest.assets, before.manifest.assets);
    assert.deepEqual(writes, ['/api/visual/apply']); assert.deepEqual(errors, []);
    const renderer = await openRenderer(await loadManifest(file), tools.chrome);
    const frameProof = [];
    try {
      for (const local of [0, 15, 32]) frameProof.push({ local, global: 6 + local, nativePNG: hashBytes(await renderer.frame(6 + local)) });
      assert.equal(hashBytes(livePNG), frameProof[1].nativePNG, 'live native Canvas must equal accepted native renderer at non-first scene offset');
    } finally { await renderer.finish(); }
    const exported = join(dir, 'export'); await render(file, exported, { noCache: true });
    const decoded = async video => (await runProcess(tools.ffmpeg, ['-v', 'error', '-threads', '1', '-i', video, '-map', '0:v:0', '-f', 'framemd5', '-'])).stdout.split('\n').filter(line => /^0,/.test(line)).map(line => line.split(',').at(-1).trim());
    const previewFrames = await decoded(previewVideo), exportFrames = await decoded(join(exported, 'output.mp4'));
    assert.equal(previewFrames.length, 33); assert.equal(exportFrames.length, 39);
    assert.deepEqual(previewFrames, exportFrames.slice(6), 'all scene MP4 frames agree after non-first scene offset');
    await writeFile(join(dir, 'accepted.json'), JSON.stringify({ beforeETag: before.etag, afterETag: after.etag, frozenAction, previewResponse, frameProof, decodedFramesCompared: 33, scene: changed }, null, 2));
  } finally { await browser.close(); await studio.close(); }
});

async function cliEdit(file, action, dir) {
  const input = join(dir, `action-${randomUUID()}.json`); await writeFile(input, JSON.stringify(action));
  await runProcess(process.execPath, [resolve('dist/cli.js'), 'edit', file, '--action', input, '--if-match', (await readProject(file)).etag, '--json']);
}
for (const finish of ['Escape', 'pointercancel', 'move']) test(`held pointer keeps its original ETag across external edit and ${finish}`, { timeout: 90000 }, async () => {
  const { file, scene, dir } = await fixture('16:9'), studio = await startStudio(file, 0), browser = await launchBrowser(tools.chrome), page = await browser.newPage();
  try {
    await page.setViewport({ width: 1440, height: 1100 }); await page.evaluateOnNewDocument(() => localStorage.setItem('ams-language', 'en'));
    await page.goto(studio.url, { waitUntil: 'networkidle0' }); await page.click('[data-scene-id="objects"]'); await ready(page); await page.click('[data-object-id="title"]');
    await page.$eval('#visual-stage-wrap', node => node.scrollIntoView({ block: 'center' }));
    const before = await readProject(file), start = await nativePoint(page, 250, 220);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    const externalObjects = structuredClone(scene.objects); externalObjects[1].x = 300;
    await cliEdit(file, { type: 'edit-scene', sceneId: 'objects', patch: { objects: externalObjects } }, dir);
    const external = await readProject(file);
    await page.waitForResponse(async response => new URL(response.url()).pathname === '/api/state' && (await response.json()).etag === external.etag, { timeout: 10000 });
    if (finish === 'Escape') await page.keyboard.press('Escape');
    else if (finish === 'pointercancel') await page.$eval('#visual-overlay', node => node.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true })));
    else await page.mouse.move(start.x + 20, start.y + 10, { steps: 3 });
    await page.mouse.up();
    // Correct path keeps the old model stale until explicit reread. The pre-fix path
    // instead allows text/Apply under the fresh ETag and demonstrably clobbers x=300.
    const stale = await page.$eval('#preview-scene', node => node.disabled);
    if (stale) {
      assert.match(await page.$eval('#visual-status', node => node.textContent), /changed externally/);
      assert.equal(await page.$eval('#save-scene', node => node.disabled), true);
      assert.equal((await readProject(file)).etag, external.etag);
      await page.click('#reload'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-discard'); await ready(page);
      assert.equal(Number(await page.$eval('#visual-x', node => node.value)), 300);
    }
    await field(page, '#visual-text', 'Text after external edit');
    await previewDraft(page); await page.waitForFunction(() => !document.querySelector('#save-scene').disabled, { timeout: 60000 });
    await page.click('#save-scene'); await page.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('Previewed edit accepted'));
    const accepted = await readProject(file);
    assert.equal(accepted.manifest.scenes[1].objects[1].x, 300, 'old gesture geometry must never be adopted under a fresh ETag');
    assert.equal(stale, true, 'the held old draft must be marked stale rather than automatically rebased');
    assert.equal(accepted.manifest.history.length, before.manifest.history.length + 2);
    await writeFile(join(dir, `held-${finish}.json`), JSON.stringify({ beforeETag: before.etag, externalETag: external.etag, finalETag: accepted.etag, staleDraftBlocked: stale, preservedExternalX: 300, finalRevisions: 2 }, null, 2));
  } finally { await browser.close(); await studio.close(); }
});
test('external native CLI conflict, lost commit reply, reconciliation and new-session restore/reopen', { timeout: 180000 }, async () => {
  const { file, scene, dir } = await fixture('16:9'); let studio = await startStudio(file, 0);
  const browser = await launchBrowser(tools.chrome), page = await browser.newPage(), errors = [], applied = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/visual/apply') applied.push(request.postData()); });
  try {
    await page.setViewport({ width: 1440, height: 1100 });
    await page.evaluateOnNewDocument(() => localStorage.setItem('ams-language', 'en'));
    await page.goto(studio.url, { waitUntil: 'networkidle0' });
    await page.click('[data-scene-id="objects"]'); await ready(page); await page.click('[data-object-id="title"]');
    await field(page, '#visual-text', 'Local draft'); await field(page, '#duration', 1.1);
    // A scene/aspect transition asks explicitly; staying keeps scalar and object drafts together.
    await page.select('#aspect', '9:16'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-stay');
    assert.equal(await page.$eval('#aspect', node => node.value), '16:9');
    await page.click('[data-scene-id="opening"]'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-stay');
    assert.equal(await page.$eval('#visual-text', node => node.value), 'Local draft'); assert.equal(await page.$eval('#duration', node => node.value), '1.1');
    await previewDraft(page); await page.waitForFunction(() => !document.querySelector('#save-scene').disabled, { timeout: 60000 });
    const externalObjects = structuredClone(scene.objects); externalObjects[0].x += 7;
    await cliEdit(file, { type: 'edit-scene', sceneId: 'objects', patch: { objects: externalObjects } }, dir);
    const external = await readProject(file);
    await page.waitForFunction(() => document.querySelector('#visual-status').textContent.includes('changed externally'), { timeout: 10000 });
    assert.equal(await page.$eval('#visual-text', node => node.value), 'Local draft');
    assert.equal(await page.$eval('#save-scene', node => node.disabled), true);
    assert.equal(await page.$eval('#preview-scene', node => node.disabled), true);
    assert.deepEqual(applied, []);
    await page.screenshot({ path: join(dir, 'external-conflict.png') });
    await page.click('#reload'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-stay');
    assert.equal(await page.$eval('#visual-text', node => node.value), 'Local draft'); assert.equal((await readProject(file)).etag, external.etag);
    await page.click('#reload'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-discard'); await ready(page);
    assert.equal(await page.$eval('#visual-text', node => node.value), 'Original title');
    assert.equal(await page.$eval('#duration', node => node.value), '1');
    await field(page, '#visual-text', 'Unknown commit title');
    await previewDraft(page); await page.waitForFunction(() => !document.querySelector('#save-scene').disabled, { timeout: 60000 });
    const cdp = await page.createCDPSession(); let committedReply;
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/visual/apply', requestStage: 'Response' }] });
    cdp.on('Fetch.requestPaused', async event => {
      try {
        const body = await cdp.send('Fetch.getResponseBody', { requestId: event.requestId });
        committedReply = JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString() : body.body);
        await cdp.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{unreadable').toString('base64') });
      } catch (error) { errors.push(error.message); }
    });
    await page.click('#save-scene');
    await page.waitForFunction(() => document.querySelector('#visual-status').textContent.includes('outcome unknown'), { timeout: 15000 });
    const committed = await readProject(file);
    assert.equal(committedReply.committed, true); assert.equal(committedReply.etag, committed.etag);
    assert.equal(committed.manifest.history.length, external.manifest.history.length + 1);
    assert.equal(committed.manifest.scenes[1].objects[1].text, 'Unknown commit title');
    assert.deepEqual(committed.manifest.scenes[1].objects[0], externalObjects[0]);
    // Allow a real background poll/unlock cycle; no ordinary edit retry is possible.
    await page.waitForFunction(() => document.querySelector('#save-scene').disabled && document.querySelector('#export').disabled && document.querySelector('#visual-text').disabled);
    await page.waitForFunction(start => performance.now() - start > 2600, { polling: 100 }, await page.evaluate(() => performance.now()));
    assert.equal(await page.$eval('#export', node => node.disabled), true);
    assert.match(await page.$eval('#visual-status', node => node.textContent), /outcome unknown/);
    await page.click('#save-scene'); assert.equal(applied.length, 1);
    await page.screenshot({ path: join(dir, 'unknown-outcome.png') });
    await cdp.send('Fetch.disable'); await cdp.detach();
    await page.click('#reload'); await page.waitForSelector('#visual-dialog[open]');
    await page.waitForFunction(start => performance.now() - start > 2200, { polling: 100 }, await page.evaluate(() => performance.now()));
    assert.equal(await page.$eval('#visual-dialog-discard', node => node.disabled), false);
    await page.click('#visual-dialog-discard'); await ready(page);
    assert.equal(await page.$eval('#visual-text', node => node.value), 'Unknown commit title');
    assert.equal((await readProject(file)).etag, committed.etag); assert.equal(applied.length, 1);
    const restore = committed.manifest.history.find(item => item.scenes[1]?.objects[1].text === 'Original title' && item.scenes[1]?.objects[0].x === externalObjects[0].x);
    assert.ok(restore);
    await cliEdit(file, { type: 'restore', revisionId: restore.id }, dir);
    const restored = await readProject(file); assert.deepEqual(restored.manifest.scenes, external.manifest.scenes); assert.deepEqual(restored.manifest.assets, external.manifest.assets);
    await studio.close(); studio = await startStudio(file, 0);
    await page.goto(studio.url, { waitUntil: 'networkidle0' }); await page.click('[data-scene-id="objects"]'); await ready(page); await page.click('[data-object-id="title"]');
    assert.equal(await page.$eval('#visual-text', node => node.value), 'Original title');
    assert.deepEqual(errors, []);
    await writeFile(join(dir, 'conflict-unknown-restore.json'), JSON.stringify({ externalETag: external.etag, committedETag: committed.etag, restoredETag: restored.etag, revisionDelta: 1, applyRequests: applied.length, actualCommittedReplyObserved: true, newServerSessionReopened: true }, null, 2));
  } finally { await browser.close(); await studio.close(); }
});

test('visual routes retain session/Origin/Host/path/CSP and mandatory exact preview guards', { timeout: 90000 }, async () => {
  const { file, asset, dir } = await fixture('16:9'), studio = await startStudio(file, 0), origin = new URL(studio.url).origin;
  try {
    const session = await fetch(origin + '/api/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: new URL(studio.url).hash.slice(1) }) });
    const cookie = session.headers.get('set-cookie').split(';')[0], state = await readProject(file), accepted = await readFile(file);
    const headers = { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'If-Match': state.etag };
    const action = { type: 'edit-scene', sceneId: 'objects', patch: { objects: structuredClone(state.manifest.scenes[1].objects) } }; action.patch.objects[1].text = 'Preview ticket';
    const call = (route, input, overrides = {}) => fetch(origin + route, { method: 'POST', headers: { ...headers, ...overrides }, body: JSON.stringify(input) });
    for (const route of ['/visual/entry.js', '/fonts/noto-sans-latin-700-normal.woff2', `/assets/${asset}`, '/api/visual/state?scene=objects']) {
      assert.equal((await fetch(origin + route)).status, 401);
      assert.equal((await fetch(origin + route, { headers: { ...headers, Origin: 'https://foreign.invalid' } })).status, 403);
      const response = await fetch(origin + route, { headers }); assert.equal(response.status, 200);
      assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      if (route.includes('.woff2')) assert.equal(response.headers.get('content-type'), 'font/woff2');
      if (route.includes('/state')) { const raw = await response.text(); assert.doesNotMatch(raw, /absolutePath|projectDir|operationReceipts|history/); }
    }
    for (const route of ['/fonts/private.woff2', '/visual/index.html', '/assets/not-imported', '/assets/..%2Fprivate', '/fonts/%2e%2e%2fpackage.json']) assert.equal((await fetch(origin + route, { headers })).status, 404);
    const foreignHost = await new Promise((resolve, reject) => { const req = httpRequest(origin + '/visual/entry.js', { headers: { Host: 'foreign.invalid', Cookie: cookie } }, response => { response.resume(); resolve(response.statusCode); }); req.on('error', reject); req.end(); }); assert.equal(foreignHost, 403);
    assert.equal((await call('/api/visual/preview', action, { 'If-Match': '' })).status, 400);
    assert.equal((await call('/api/visual/apply', { action }, { 'If-Match': '' })).status, 400);
    assert.equal((await call('/api/visual/apply', { action, previewId: 'missing' })).status, 400);
    assert.equal((await call('/api/visual/preview', action, { 'If-Match': '0'.repeat(64) })).status, 409);
    const preview = await (await call('/api/visual/preview', action)).json(); assert.ok(preview.previewId);
    const mismatch = structuredClone(action); mismatch.patch.objects[1].x += 1;
    assert.equal((await call('/api/visual/apply', { action: mismatch, previewId: preview.previewId })).status, 400);
    assert.deepEqual(await readFile(file), accepted);
    const applied = await call('/api/visual/apply', { action, previewId: preview.previewId }); assert.equal(applied.status, 200);
    assert.equal((await readProject(file)).manifest.history.length, state.manifest.history.length + 1);
    assert.equal((await call('/api/visual/apply', { action, previewId: preview.previewId })).status, 409);
    const fresh = await readProject(file);
    assert.equal((await call('/api/visual/apply', { action, previewId: preview.previewId }, { 'If-Match': fresh.etag })).status, 400);
    // Compatibility: legacy edits still accept no If-Match and need no visual ticket.
    assert.equal((await call('/api/edit', { type: 'edit-scene', sceneId: 'opening', patch: { text: 'Legacy edit' } }, { 'If-Match': '' })).status, 200);
    const browser = await launchBrowser(tools.chrome), page = await browser.newPage();
    try {
      await page.goto(studio.url, { waitUntil: 'networkidle0' });
      await page.evaluate(() => { const iframe = document.createElement('iframe'); iframe.id = 'blocked-frame'; iframe.src = '/'; document.body.append(iframe); });
      await page.waitForFunction(() => document.querySelector('#blocked-frame').contentDocument === null);
      assert.equal(page.frames().some(frame => frame !== page.mainFrame() && frame.url() === origin + '/'), false, 'global frame-ancestors none is enforced by a real browser');
    } finally { await browser.close(); }
    await writeFile(join(dir, 'guards.json'), JSON.stringify({ sessionProtectedRoutes: 4, originRejectedRoutes: 4, foreignHostRejected: true, pathNegatives: 5, CSPException: false, browserEmbeddingBlocked: true, missingAndStaleETagRejected: true, mismatchedPreviewRejected: true, ticketConsumedOnce: true, legacyEditWithoutETag: true }, null, 2));
  } finally { await studio.close(); }
});

test('context resolution preserves music intent and rejects deleted scene targets from stale UI', { timeout: 90000 }, async () => {
  const { file, dir } = await fixture('16:9');
  await editProject(file, { type: 'add-scene', scene: { id: 'doomed', type: 'cta', text: 'Third scene', label: 'Test', durationFrames: 30 } });
  const studio = await startStudio(file, 0), browser = await launchBrowser(tools.chrome), page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setViewport({ width: 1440, height: 1100 }); await page.evaluateOnNewDocument(() => localStorage.setItem('ams-language', 'en'));
    await page.goto(studio.url, { waitUntil: 'networkidle0' }); await page.click('[data-scene-id="objects"]'); await ready(page); await page.click('[data-object-id="title"]');
    await field(page, '#visual-text', 'Music applies'); await previewDraft(page); await page.waitForFunction(() => !document.querySelector('#save-scene').disabled, { timeout: 60000 });
    await page.select('#music', '__procedural'); await field(page, '#gain', -18); await page.click('#save-music');
    await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-apply');
    await page.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('Saved to project.json'));
    const musicAccepted = await readProject(file);
    assert.equal(musicAccepted.manifest.audio.music.provider, 'procedural'); assert.equal(musicAccepted.manifest.audio.music.gainDb, -18);
    assert.equal(musicAccepted.manifest.scenes[1].objects[1].text, 'Music applies');
    await ready(page); await field(page, '#visual-text', 'Keep before deleted');
    await cliEdit(file, { type: 'remove-scene', sceneId: 'doomed' }, dir);
    const removedCard = await readProject(file);
    await page.waitForFunction(() => document.querySelector('#visual-status').textContent.includes('changed externally'), { timeout: 10000 });
    await page.click('[data-scene-id="doomed"]'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-discard');
    await page.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('This scene was removed externally'));
    assert.equal((await readProject(file)).etag, removedCard.etag); await ready(page);
    assert.equal(await page.$eval('#visual-text', node => node.value), 'Music applies');
    // The same async boundary must not retarget Remove to a different fresh scene.
    await field(page, '#visual-text', 'Second stale draft');
    await cliEdit(file, { type: 'batch', actions: [{ type: 'remove-scene', sceneId: 'objects' }, { type: 'edit-scene', sceneId: 'opening', patch: { durationFrames: 30 } }] }, dir);
    const removedCurrent = await readProject(file);
    await page.waitForFunction(() => document.querySelector('#visual-status').textContent.includes('changed externally'), { timeout: 10000 });
    await page.click('#remove-scene'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-discard');
    await page.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('This scene was removed externally'));
    assert.equal((await readProject(file)).etag, removedCurrent.etag); assert.equal(removedCurrent.manifest.scenes[0].id, 'opening');
    assert.deepEqual(errors, []);
    await writeFile(join(dir, 'context-intent.json'), JSON.stringify({ proceduralGainDb: -18, deletedCardNoMutation: true, deletedSelectedSceneNoRetarget: true, pageErrors: errors }, null, 2));
  } finally { await browser.close(); await studio.close(); }
});

test('visual Apply preserves known committed final-read failure and requires reconciliation once', { timeout: 90000 }, async () => {
  const { file, dir } = await fixture('16:9'), studio = await startStudio(file, 0), browser = await launchBrowser(tools.chrome), page = await browser.newPage();
  const originalRename = filesystem.rename, originalReadFile = filesystem.readFile; let published = false, failedReads = 0;
  try {
    await page.setViewport({ width: 1440, height: 1100 }); await page.evaluateOnNewDocument(() => localStorage.setItem('ams-language', 'en'));
    await page.goto(studio.url, { waitUntil: 'networkidle0' }); await page.click('[data-scene-id="objects"]'); await ready(page); await page.click('[data-object-id="title"]');
    await field(page, '#visual-text', 'Known committed title'); await previewDraft(page); await page.waitForFunction(() => !document.querySelector('#save-scene').disabled, { timeout: 60000 });
    const before = await readProject(file);
    filesystem.rename = async (from, to) => { const result = await originalRename(from, to); if (to === resolve(file)) published = true; return result; };
    filesystem.readFile = async (...args) => { if (published && args[0] === file && failedReads === 0) { failedReads++; throw Object.assign(new Error('Injected final read after accepted rename'), { code: 'EIO' }); } return originalReadFile(...args); };
    syncBuiltinESMExports();
    const reply = page.waitForResponse(response => new URL(response.url()).pathname === '/api/visual/apply');
    await page.click('#save-scene'); const response = await reply, result = await response.json();
    filesystem.rename = originalRename; filesystem.readFile = originalReadFile; syncBuiltinESMExports();
    assert.equal(response.status(), 503); assert.equal(result.committed, true); assert.equal(result.reconcileRequired, true);
    assert.equal(result.error.code, 'INTERNAL_ERROR'); assert.equal(result.error.stage, 'project'); assert.equal(result.exitCode, 4);
    assert.match(result.error.message, /^Manifest was committed but reading the result failed:/);
    await page.waitForFunction(() => document.querySelector('#visual-status').textContent.startsWith('Edit was committed'));
    const after = await readProject(file); assert.equal(published, true); assert.equal(failedReads, 1);
    assert.equal(after.manifest.history.length, before.manifest.history.length + 1); assert.equal(after.manifest.scenes[1].objects[1].text, 'Known committed title');
    assert.equal(await page.$eval('#export', node => node.disabled), true); assert.equal(await page.$eval('#save-scene', node => node.disabled), true);
    await page.screenshot({ path: join(dir, 'known-committed-reconcile.png') });
    await page.click('#reload'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-discard'); await ready(page);
    assert.equal((await readProject(file)).etag, after.etag); assert.equal(await page.$eval('#visual-text', node => node.value), 'Known committed title');
    await writeFile(join(dir, 'known-committed.json'), JSON.stringify({ nativeError: { code: result.error.code, stage: result.error.stage, exitCode: result.exitCode }, committed: true, reconcileRequired: true, finalReadFailures: failedReads, revisionDelta: 1, afterETag: after.etag }, null, 2));
  } finally { filesystem.rename = originalRename; filesystem.readFile = originalReadFile; syncBuiltinESMExports(); await browser.close(); await studio.close(); }
});
