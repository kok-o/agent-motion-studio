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
import { openKitStudio } from '../../scripts/kit-studio-process.mjs';

const root = resolve('artifacts/object-editor', randomUUID());
await mkdir(root, { recursive: true });
const tools = findTools();
const cli = resolve('dist/cli.js');
async function propertiesFixture(aspect) {
  const result = await fixture(aspect), state = await readProject(result.file), objects = structuredClone(state.manifest.scenes[1].objects);
  objects[2].x = 250; objects[2].y = 190;
  objects.push({ id: 'ellipse', type: 'shape', shape: 'ellipse', x: 850, y: 600, width: 100, height: 100, color: 'accent' });
  await editProject(result.file, { type: 'edit-scene', sceneId: 'objects', patch: { objects } }, state.etag);
  return result;
}
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
  if (String(value) === '') await page.keyboard.press('Backspace'); else await page.keyboard.type(String(value)); await page.keyboard.press('Tab');
}
async function ready(page) { await page.waitForFunction(() => !document.querySelector('#object-editor').hidden && !document.querySelector('#visual-x').disabled); }
async function previewDraft(page) { await page.waitForFunction(() => !document.querySelector('#preview-scene').disabled); await page.click('#preview-scene'); }
async function nativePoint(page, x, y) {
  return page.$eval('#stage', (canvas, p) => { const r = canvas.getBoundingClientRect(); return { x: r.left + p.x * r.width / canvas.width, y: r.top + p.y * r.height / canvas.height }; }, { x, y });
}
async function drag(page, from, to) { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up(); }

async function entryFixture(aspect) {
  const dir = join(root, `entry-${aspect.replace(':', '-')}-${randomUUID()}`); await mkdir(dir);
  const reply = await runProcess(process.execPath, [cli, 'new', '--dir', join(dir, 'film'), '--aspect', aspect, '--title', 'Neutral entry fixture', '--json']);
  const file = JSON.parse(reply.stdout).project; assert.equal(resolve(file), resolve(dir, 'film/project.json')); assert.equal((await readProject(file)).manifest.schemaVersion, 2);
  return { dir, file };
}
const settledEntry = page => page.waitForFunction(() => !document.querySelector('#object-editor').hidden && !document.querySelector('#visual-x').disabled && document.querySelector('#stage').dataset.rendered === document.querySelector('#stage').dataset.renderRequest);
async function entryIntent(page) {
  await page.click('#add-composition'); await page.waitForSelector('#composition-dialog[open]');
  return page.$eval('#composition-dialog', node => ({ sceneId: node.dataset.sceneId, objectId: node.dataset.objectId }));
}
async function acceptEntry(page, intent) {
  await page.click('#composition-confirm'); await page.waitForFunction(id => document.querySelector('.scene-card.selected')?.dataset.sceneId === id, {}, intent.sceneId); await settledEntry(page);
}

for (const aspect of ['16:9', '9:16']) test(`new CLI to Studio composition entry and object draft without JSON ${aspect}`, { timeout: 120000 }, async () => {
  const { dir, file } = await entryFixture(aspect), language = aspect === '16:9' ? 'ru' : 'en', processReport = {}, browser = await launchBrowser(tools.chrome), page = await browser.newPage(), errors = [], requests = [];
  let studio = await openKitStudio({ cli, workspace: dir, file, report: processReport, label: 'entry' });
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/edit') requests.push(JSON.parse(request.postData())); });
  try {
    await page.setViewport({ width: 1440, height: 1200 }); await page.evaluateOnNewDocument(value => localStorage.setItem('ams-language', value), language);
    await page.goto(studio.url, { waitUntil: 'networkidle0' }); await page.waitForFunction(() => !document.querySelector('#add-composition').disabled);
    assert.equal(await page.$eval('#add-composition', node => node.textContent), language === 'ru' ? '+ Композиция' : '+ Composition');
    const image = join(dir, 'own-entry-image.png'); await runProcess(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x345678:s=64x64', '-frames:v', '1', '-threads', '1', image]);
    const imported = page.waitForResponse(response => new URL(response.url()).pathname === '/api/import'); await (await page.$('#import')).uploadFile(image); await imported;
    await page.waitForFunction(() => document.querySelector('#library').textContent.includes('own-entry-image.png') && !document.querySelector('#add-composition').disabled);
    const before = await readProject(file), bytes = await readFile(file), asset = Object.keys(before.manifest.assets)[0], sourceHash = hashBytes(await readFile(join(file, '..', before.manifest.assets[asset].path)));
    const cancelled = await entryIntent(page); assert.deepEqual(await readFile(file), bytes); await page.click('#composition-cancel'); assert.deepEqual(await readFile(file), bytes); assert.equal(requests.length, 0);
    const intent = await entryIntent(page); assert.notEqual(intent.sceneId, cancelled.sceneId); assert.notEqual(intent.objectId, cancelled.objectId); await acceptEntry(page, intent);
    const created = await readProject(file), createdBytes = await readFile(file), scene = created.manifest.scenes.at(-1);
    assert.equal(created.manifest.history.length, before.manifest.history.length + 1); assert.deepEqual(created.manifest.scenes.slice(0, -1), before.manifest.scenes); assert.deepEqual(created.manifest.assets, before.manifest.assets);
    for (const key of ['brand', 'audio', 'video', 'operationReceipts']) assert.deepEqual(created.manifest[key], before.manifest[key]);
    assert.equal(scene.id, intent.sceneId); assert.equal(scene.durationFrames, 120); assert.equal(scene.objects.length, 1); assert.equal(scene.objects[0].id, intent.objectId); assert.equal(scene.objects[0].text, language === 'ru' ? 'Новый текст' : 'New text');
    assert.equal(requests.length, 1); assert.equal(requests[0].type, 'add-scene'); assert.equal(await page.$eval('#visual-selection-name', node => node.dataset.objectId), intent.objectId);
    assert.equal(await page.$eval('.scene-card.selected strong', node => node.textContent), language === 'ru' ? 'Композиция 2' : 'Composition 2');
    await (await page.$('#object-editor')).screenshot({ path: join(dir, 'entry-created.png') });
    const drafted = [];
    if (aspect === '16:9') for (const kind of ['text', 'rect', 'ellipse', 'image']) {
      await page.click(`#visual-add-${kind}`);
      if (kind === 'image') { await page.waitForSelector('#visual-image-dialog[open]'); await page.select('#visual-image-asset', asset); await page.click('#visual-image-add'); }
      await settledEntry(page); const caption = await page.$eval('#visual-selection-name', node => ({ id: node.dataset.objectId, text: node.textContent }));
      assert.match(caption.id, /^object-[a-f0-9-]{36}$/); assert.equal(caption.text.includes(caption.id), false); assert.match(caption.text, /Текст|Прямоугольник|Эллипс|Изображение/);
      assert.equal(await page.$eval(`[data-object-id="${caption.id}"]`, node => node.getAttribute('aria-pressed')), 'true');
      await (await page.$('#object-editor')).screenshot({ path: join(dir, `entry-draft-${kind}.png`) }); drafted.push(kind);
      await page.click('#visual-cancel'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-discard'); await settledEntry(page);
      assert.deepEqual(await readFile(file), createdBytes); assert.equal((await readProject(file)).etag, created.etag);
    }
    await page.click('#visual-add-text'); await settledEntry(page); const addedID = await page.$eval('#visual-selection-name', node => node.dataset.objectId);
    await field(page, '#visual-text', 'Editable after entry'); await previewDraft(page); await page.waitForFunction(() => !document.querySelector('#save-scene').disabled); await page.click('#save-scene');
    await page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Все изменения сохранены' || document.querySelector('#draft-status').textContent === 'All changes saved'); await settledEntry(page);
    const applied = await readProject(file); assert.equal(applied.manifest.history.length, created.manifest.history.length + 1); assert.equal(applied.manifest.scenes.at(-1).objects.find(object => object.id === addedID).text, 'Editable after entry');
    assert.deepEqual(applied.manifest.scenes.slice(0, -1), before.manifest.scenes); assert.equal(hashBytes(await readFile(join(file, '..', applied.manifest.assets[asset].path))), sourceHash);
    await (await page.$('#object-editor')).screenshot({ path: join(dir, 'entry-applied.png') });
    const revisionIndex = applied.manifest.history.findIndex(revision => revision.id === before.manifest.revision); assert.ok(revisionIndex >= 0);
    await page.click('details.history > summary'); await page.waitForSelector('details.history[open]');
    const historySelector = `#history .history-row:nth-child(${applied.manifest.history.length - revisionIndex}) button`;
    await page.$eval(historySelector, node => node.scrollIntoView({ block: 'center' }));
    await page.waitForFunction(selector => !document.querySelector(selector).disabled, {}, historySelector); await page.click(historySelector);
    await page.waitForFunction(() => document.querySelectorAll('.scene-card').length === 1).catch(async error => { await writeFile(join(dir, 'restore-failure.json'), JSON.stringify(await page.evaluate(() => ({ probe: globalThis.entryHistoryProbe, notice: document.querySelector('#notice').textContent, draft: document.querySelector('#draft-status').textContent, dialogs: [...document.querySelectorAll('dialog[open]')].map(node => node.id), cards: [...document.querySelectorAll('.scene-card')].map(node => node.dataset.sceneId), history: document.querySelector('#history').textContent })), null, 2)); throw error; }); const restored = await readProject(file); assert.deepEqual(restored.manifest.scenes, before.manifest.scenes); assert.deepEqual(restored.manifest.assets, before.manifest.assets);
    await studio.close(); studio = await openKitStudio({ cli, workspace: dir, file, report: processReport, label: 'reopen' }); await page.goto(studio.url, { waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('#object-editor', node => node.hidden), true); assert.equal((await readProject(file)).etag, restored.etag); assert.deepEqual(errors, []);
    await writeFile(join(dir, 'composition-entry.json'), JSON.stringify({ status: 'PASS', aspect, language, realCLINew: true, realCLIStudio: true, cancelledBeforePublication: true, createRevisionDelta: 1, stableSceneID: intent.sceneId, initialObjectID: intent.objectId, automaticSelectionAndNativeReady: true, newTypeDrafts: drafted, fourTypeApplyCoverage: 'Preserved accepted object authoring scenarios', addPreviewApplyRevisionDelta: 1, neighboursAndStatePreserved: true, sourceHash, readableCaptionsWithNativeDOMIDs: true, restoredAndNewSessionReopened: true, processReport, errors, humanAcceptance: 'NOT RUN' }, null, 2));
  } finally { await browser.close(); await studio.close(); }
});

test('composition entry resolves scalar and native drafts through Stay Discard Apply', { timeout: 120000 }, async () => {
  const { file, dir } = await entryFixture('16:9'), studio = await startStudio(file, 0), browser = await launchBrowser(tools.chrome), page = await browser.newPage(), posts = [];
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname !== '/api/session') posts.push(new URL(request.url()).pathname); });
  try {
    await page.setViewport({ width: 1440, height: 1200 }); await page.evaluateOnNewDocument(() => localStorage.setItem('ams-language', 'en')); await page.goto(studio.url, { waitUntil: 'networkidle0' });
    const initial = await readProject(file), initialBytes = await readFile(file);
    await field(page, '#scene-text', 'Scalar draft'); await page.click('#add-composition'); await page.waitForSelector('#composition-draft-dialog[open]'); await page.click('#composition-draft-stay');
    assert.equal(await page.$eval('#scene-text', node => node.value), 'Scalar draft'); assert.deepEqual(await readFile(file), initialBytes); assert.equal(posts.length, 0);
    await page.click('#add-composition'); await page.waitForSelector('#composition-draft-dialog[open]'); await page.click('#composition-draft-discard'); await page.waitForSelector('#composition-dialog[open]'); await page.click('#composition-cancel');
    assert.deepEqual(await readFile(file), initialBytes); assert.equal(await page.$eval('#scene-text', node => node.value), initial.manifest.scenes[0].text); assert.equal(posts.length, 0);
    await field(page, '#scene-text', 'Scalar accepted'); await page.click('#add-composition'); await page.waitForSelector('#composition-draft-dialog[open]'); await page.click('#composition-draft-apply'); await page.waitForSelector('#composition-dialog[open]'); await page.click('#composition-cancel');
    const scalar = await readProject(file); assert.equal(scalar.manifest.history.length, initial.manifest.history.length + 1); assert.equal(scalar.manifest.scenes.length, 1); assert.equal(scalar.manifest.scenes[0].text, 'Scalar accepted');
    const first = await entryIntent(page); await acceptEntry(page, first); const created = await readProject(file), createdBytes = await readFile(file);
    await page.click('#visual-add-text'); await settledEntry(page); const draftID = await page.$eval('#visual-selection-name', node => node.dataset.objectId);
    await page.click('#add-composition'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-stay');
    assert.equal(await page.$eval('#visual-selection-name', node => node.dataset.objectId), draftID); assert.deepEqual(await readFile(file), createdBytes);
    await page.click('#add-composition'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-discard'); await page.waitForSelector('#composition-dialog[open]'); await page.click('#composition-cancel');
    await settledEntry(page); assert.deepEqual(await readFile(file), createdBytes); assert.equal(await page.$(`[data-object-id="${draftID}"]`), null);
    await page.click('#visual-add-text'); await settledEntry(page); const acceptedID = await page.$eval('#visual-selection-name', node => node.dataset.objectId); await field(page, '#visual-text', 'Apply before new composition');
    await previewDraft(page); await page.waitForFunction(() => !document.querySelector('#save-scene').disabled); await page.click('#add-composition'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-apply'); await page.waitForSelector('#composition-dialog[open]');
    const visual = await readProject(file); assert.equal(visual.manifest.history.length, created.manifest.history.length + 1); assert.equal(visual.manifest.scenes.at(-1).objects.find(object => object.id === acceptedID).text, 'Apply before new composition');
    const next = await page.$eval('#composition-dialog', node => ({ sceneId: node.dataset.sceneId, objectId: node.dataset.objectId })); await acceptEntry(page, next);
    const after = await readProject(file); assert.equal(after.manifest.history.length, visual.manifest.history.length + 1); assert.deepEqual(after.manifest.scenes.slice(0, -1), visual.manifest.scenes);
    await writeFile(join(dir, 'composition-entry-context.json'), JSON.stringify({ status: 'PASS', scalar: ['Stay', 'Discard', 'Apply'], nativeDraft: ['Stay', 'Discard', 'Preview-Apply'], separateCreateRevision: true, neighbouringScenesPreserved: true, humanAcceptance: 'NOT RUN' }, null, 2));
  } finally { await browser.close(); await studio.close(); }
});

test('composition entry never resends conflict lost reply malformed history or post-commit UI and I/O failure', { timeout: 120000 }, async () => {
  const { file, dir } = await entryFixture('16:9'), studio = await startStudio(file, 0), browser = await launchBrowser(tools.chrome), page = await browser.newPage(), posts = [], errors = [], cases = [];
  const originalRename = filesystem.rename, originalReadFile = filesystem.readFile;
  let holdState, rewrite, cdp;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname !== '/api/session') posts.push({ path: new URL(request.url()).pathname, body: request.postData(), etag: request.headers()['if-match'] }); });
  try {
    await page.setViewport({ width: 1440, height: 1200 }); await page.evaluateOnNewDocument(() => localStorage.setItem('ams-language', 'en')); await page.goto(studio.url, { waitUntil: 'networkidle0' });
    await page.setRequestInterception(true); page.on('request', request => { if (holdState && new URL(request.url()).pathname === '/api/state') void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(holdState) }); else void request.continue(); });
    const conflictIntent = await entryIntent(page); holdState = await page.evaluate(async () => (await fetch('/api/state')).json());
    await cliEdit(file, { type: 'edit-scene', sceneId: 'opening', patch: { text: 'External CLI accepted' } }, dir); const external = await readProject(file), externalBytes = await readFile(file);
    const conflictReply = page.waitForResponse(response => new URL(response.url()).pathname === '/api/edit'); await page.click('#composition-confirm'); assert.equal((await conflictReply).status(), 409);
    await page.waitForFunction(() => document.querySelector('#composition-entry-status').textContent.startsWith('Project changed')); assert.deepEqual(await readFile(file), externalBytes); assert.equal(external.manifest.scenes.some(scene => scene.id === conflictIntent.sceneId), false);
    holdState = undefined; await page.click('#composition-reconcile'); await page.waitForFunction(() => !document.querySelector('#add-composition').disabled); assert.equal(posts.length, 1); cases.push({ kind: 'actual CLI conflict', posts: 1, externalPreserved: true });
    // A normal polling invalidation cannot publish the old confirmation either.
    const stale = await entryIntent(page); await cliEdit(file, { type: 'edit-scene', sceneId: 'opening', patch: { text: 'Second external accepted' } }, dir);
    await page.waitForFunction(() => document.querySelector('#composition-dialog-reload').hidden === false); assert.equal(await page.$eval('#composition-confirm', node => node.disabled), true);
    await page.evaluate(() => document.querySelector('#composition-confirm').dispatchEvent(new Event('click'))); assert.equal(posts.length, 1); await page.click('#composition-dialog-reload'); await page.waitForFunction(() => !document.querySelector('#add-composition').disabled); assert.equal((await readProject(file)).manifest.scenes.some(scene => scene.id === stale.sceneId), false);
    cdp = await page.createCDPSession(); cdp.on('Fetch.requestPaused', async event => {
      try {
        const body = await cdp.send('Fetch.getResponseBody', { requestId: event.requestId }), actual = JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString() : body.body);
        assert.ok(actual.manifest); const replacement = rewrite === 'history' ? JSON.stringify({ ...actual, manifest: { ...actual.manifest, history: [null] } }) : '{unreadable';
        await cdp.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(replacement).toString('base64') });
      } catch (error) { errors.push(error.message); }
    });
    for (const kind of ['lost-json', 'history', 'storage', 'known-io']) {
      const before = await readProject(file), intent = await entryIntent(page), count = posts.length;
      if (kind === 'lost-json' || kind === 'history') { rewrite = kind; await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/edit', requestStage: 'Response' }] }); }
      if (kind === 'storage') await page.evaluate(() => {
        const original = Storage.prototype.removeItem;
        Storage.prototype.removeItem = function(key) { if (String(key).startsWith('studio-draft:')) { Storage.prototype.removeItem = original; throw new DOMException('Controlled accepted storage failure', 'QuotaExceededError'); } return original.call(this, key); };
      });
      let published = false, failures = 0;
      if (kind === 'known-io') {
        filesystem.rename = async (from, to) => { const result = await originalRename(from, to); if (to === resolve(file)) published = true; return result; };
        filesystem.readFile = async (...args) => { if (published && args[0] === file && failures === 0) { failures++; throw Object.assign(new Error('Controlled entry final read failure'), { code: 'EIO' }); } return originalReadFile(...args); }; syncBuiltinESMExports();
      }
      const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/edit'); await page.click('#composition-confirm'); const response = await responsePromise;
      if (kind === 'known-io') {
        const reply = await response.json(); filesystem.rename = originalRename; filesystem.readFile = originalReadFile; syncBuiltinESMExports();
        assert.equal(response.status(), 400); assert.equal(reply.error.code, 'INTERNAL_ERROR'); assert.equal(reply.error.stage, 'project'); assert.equal(reply.exitCode, 4); assert.match(reply.error.message, /^Manifest was committed but reading the result failed:/); assert.equal(failures, 1);
      }
      await page.waitForFunction(() => !document.querySelector('#composition-reconcile').hidden && !document.querySelector('#composition-reconcile').disabled);
      if (kind === 'storage') assert.match(await page.$eval('#composition-entry-status', node => node.textContent), /saved.*interface|interface.*saved/i);
      if (kind === 'known-io') assert.match(await page.$eval('#composition-entry-status', node => node.textContent), /Manifest was committed but reading the result failed:/);
      const retained = await page.$eval('#composition-entry-status', node => ({ sceneId: node.dataset.sceneId, objectId: node.dataset.objectId })); assert.deepEqual(retained, intent);
      const committed = await readProject(file); assert.equal(committed.manifest.history.length, before.manifest.history.length + 1); assert.deepEqual(committed.manifest.scenes.slice(0, -1), before.manifest.scenes); assert.equal(committed.manifest.scenes.at(-1).id, intent.sceneId); assert.equal(committed.manifest.scenes.at(-1).objects[0].id, intent.objectId);
      for (const selector of ['#add-composition', '#add-title', '#export', '#save-scene', '#import', '#visual-add-text']) assert.equal(await page.$eval(selector, node => node.disabled), true, `${kind}: ${selector} blocked`);
      await page.evaluate(() => { document.querySelector('#composition-confirm').dispatchEvent(new Event('click')); document.querySelector('#add-composition').dispatchEvent(new Event('click')); document.querySelector('#add-title').dispatchEvent(new Event('click')); });
      assert.equal(posts.length, count + 1); assert.equal(JSON.parse(posts.at(-1).body).scene.id, intent.sceneId); assert.equal(posts.at(-1).etag, before.etag);
      await cdp.send('Fetch.disable'); await page.click('#composition-reconcile'); await page.waitForFunction(id => document.querySelector('.scene-card.selected')?.dataset.sceneId === id && !document.querySelector('#add-composition').disabled, {}, intent.sceneId); await settledEntry(page);
      assert.equal(await page.$eval('#visual-selection-name', node => node.dataset.objectId), intent.objectId); assert.equal(posts.length, count + 1); assert.equal((await readProject(file)).etag, committed.etag);
      cases.push({ kind, posts: 1, retained, explicitReadOriginalScene: true, revisionDelta: 1, neverResent: true });
    }
    assert.deepEqual(errors, []); await writeFile(join(dir, 'composition-entry-reconciliation.json'), JSON.stringify({ status: 'PASS', cases, pollingStaleConfirmBlocked: true, errors, humanAcceptance: 'NOT RUN' }, null, 2));
  } finally { filesystem.rename = originalRename; filesystem.readFile = originalReadFile; syncBuiltinESMExports(); if (cdp) { await cdp.send('Fetch.disable').catch(() => {}); await cdp.detach().catch(() => {}); } await browser.close(); await studio.close(); }
});

test('composition entry respects native twelve scene and eighteen hundred frame limits without shortening neighbours', { timeout: 60000 }, async () => {
  const browser = await launchBrowser(tools.chrome), page = await browser.newPage(), proofs = [];
  try {
    await page.setViewport({ width: 1440, height: 1200 }); await page.evaluateOnNewDocument(() => localStorage.setItem('ams-language', 'en'));
    for (const kind of ['scenes', 'frames']) {
      const { file, dir } = await entryFixture('16:9');
      if (kind === 'scenes') await editProject(file, { type: 'batch', actions: Array.from({ length: 10 }, (_, index) => ({ type: 'add-scene', scene: { id: `limit-${index}`, type: 'kinetic_title', durationFrames: 30, text: `Limit ${index}` } })) });
      else await editProject(file, { type: 'batch', actions: [{ type: 'edit-scene', sceneId: 'opening', patch: { durationFrames: 840 } }, { type: 'add-scene', scene: { id: 'second', type: 'kinetic_title', durationFrames: 840, text: 'Second' } }] });
      const studio = await startStudio(file, 0), posts = [];
      const observe = request => { if (request.method() === 'POST' && new URL(request.url()).pathname !== '/api/session') posts.push(new URL(request.url()).pathname); }; page.on('request', observe);
      try {
        await page.goto(studio.url, { waitUntil: 'networkidle0' }); const before = await readProject(file), intent = await entryIntent(page); await acceptEntry(page, intent);
        const after = await readProject(file), bytes = await readFile(file); assert.equal(after.manifest.history.length, before.manifest.history.length + 1); assert.deepEqual(after.manifest.scenes.slice(0, -1), before.manifest.scenes);
        const total = after.manifest.scenes.reduce((sum, scene) => sum + scene.durationFrames, 0); if (kind === 'scenes') assert.equal(after.manifest.scenes.length, 12); else assert.equal(total, 1800);
        assert.equal(await page.$eval('#add-composition', node => node.disabled), true); await page.evaluate(() => document.querySelector('#add-composition').dispatchEvent(new Event('click'))); assert.equal(posts.length, 1); assert.deepEqual(await readFile(file), bytes);
        await assert.rejects(editProject(file, { type: 'add-scene', scene: { id: 'overflow', type: 'kinetic_title', durationFrames: 120, text: 'Overflow' } }, after.etag)); assert.deepEqual(await readFile(file), bytes);
        const proof = { kind, status: 'PASS', sceneCount: after.manifest.scenes.length, totalFrames: total, blockedUIAndNativeOverflow: true, neighbourDurationsPreserved: true, posts: 1 }; proofs.push(proof); await writeFile(join(dir, 'composition-entry-limit.json'), JSON.stringify(proof, null, 2));
      } finally { page.off('request', observe); await studio.close(); }
    }
    await writeFile(join(root, 'composition-entry-limits.json'), JSON.stringify({ status: 'PASS', proofs, humanAcceptance: 'NOT RUN' }, null, 2));
  } finally { await browser.close(); }
});

for (const aspect of ['16:9', '9:16']) test(`create four native objects with stable drafts, explicit Apply and reopen ${aspect}`, { timeout: 180000 }, async () => {
  const { file, dir, asset } = await fixture(aspect), before = await readProject(file), bytes = await readFile(file);
  const sources = async () => Object.fromEntries(await Promise.all(Object.entries((await readProject(file)).manifest.assets).map(async ([id, value]) => [id, hashBytes(await readFile(join(file, '..', value.path)))])));
  const sourceBefore = await sources(), browser = await launchBrowser(tools.chrome), page = await browser.newPage(), errors = [], requests = [], createdIDs = [], deltas = [];
  let studio = await startStudio(file, 0);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const path = new URL(request.url()).pathname; if (request.method() === 'POST') requests.push({ path, intent: request.headers()['x-ams-object-intent'], selected: request.headers()['x-ams-selected-object'], etag: request.headers()['if-match'], body: request.postData() }); });
  const settled = () => page.waitForFunction(() => document.querySelector('#stage').dataset.rendered === document.querySelector('#stage').dataset.renderRequest && !document.querySelector('#visual-x').disabled);
  const selection = () => page.$eval('#visual-selection-name', node => node.dataset.objectId);
  const open = async () => { await page.goto(studio.url, { waitUntil: 'networkidle0' }); await page.click('[data-scene-id="objects"]'); await ready(page); await settled(); };
  const preview = async () => { await previewDraft(page); await page.waitForFunction(() => !document.querySelector('#save-scene').disabled); };
  try {
    await page.setViewport({ width: 1440, height: 1200 }); await page.evaluateOnNewDocument(value => localStorage.setItem('ams-language', value), aspect === '16:9' ? 'ru' : 'en'); await open();
    assert.equal(await page.$eval('#visual-add-text', node => node.textContent), aspect === '16:9' ? '+ Текст' : '+ Text');
    await page.click('#visual-add-text'); await settled(); const cancelledID = await selection(); assert.match(cancelledID, /^object-[a-f0-9-]{36}$/);
    assert.equal(await page.$eval(`[data-object-id="${cancelledID}"]`, node => node.getAttribute('aria-pressed')), 'true');
    await preview(); assert.deepEqual(await readFile(file), bytes); assert.deepEqual(await sources(), sourceBefore);
    await page.click('#visual-add-rect'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-stay'); assert.equal(await selection(), cancelledID);
    await page.click('[data-object-id="back"]'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-stay'); assert.equal(await selection(), cancelledID);
    await page.click('#visual-cancel'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-discard'); await settled();
    assert.equal(await page.$(`[data-object-id="${cancelledID}"]`), null); assert.deepEqual(await readFile(file), bytes); assert.deepEqual((await readProject(file)).manifest.history, before.manifest.history);
    for (const kind of ['text', 'rect', 'ellipse', 'image']) {
      const prior = await readProject(file), priorBytes = await readFile(file);
      await page.click(`#visual-add-${kind}`);
      if (kind === 'image') {
        await page.waitForSelector('#visual-image-dialog[open]');
        assert.deepEqual(await page.$$eval('#visual-image-asset option', nodes => nodes.map(node => node.value)), Object.entries(prior.manifest.assets).filter(([, value]) => value.type === 'image').map(([id]) => id));
        await page.select('#visual-image-asset', asset); await page.click('#visual-image-add');
      }
      await settled(); const id = await selection(); createdIDs.push(id); assert.notEqual(id, cancelledID); assert.equal(new Set(createdIDs).size, createdIDs.length);
      const defaults = await page.$$eval('#visual-x,#visual-y,#visual-width,#visual-height', nodes => nodes.map(node => Number(node.value)));
      const [x, y, w, h] = defaults, landscape = aspect === '16:9'; assert.ok(x >= 0 && y >= 0 && x + w <= (landscape ? 1920 : 1080) && y + h <= (landscape ? 1080 : 1920));
      await field(page, '#visual-x', x + 3); await page.click('#visual-layer-down');
      if (kind === 'text') { await field(page, '#visual-text', 'Created title'); await field(page, '#visual-font-size', 40); await field(page, '#visual-color', '#f4b544'); }
      else if (kind !== 'image') { await field(page, '#visual-color', '#41a992'); await field(page, '#visual-stroke', 'foreground'); if (kind === 'rect') await field(page, '#visual-radius', 18); else assert.equal(await page.$eval('#visual-radius-field', node => node.hidden), true); }
      else assert.equal(await page.$eval('#visual-style-fields', node => node.hidden), true);
      await settled(); assert.equal(await selection(), id); assert.deepEqual(await readFile(file), priorBytes);
      await preview(); assert.equal(await selection(), id); assert.deepEqual(await readFile(file), priorBytes); assert.deepEqual(await sources(), sourceBefore);
      const previewRequest = requests.findLast(item => item.path === '/api/visual/preview');
      assert.equal(previewRequest.intent, 'create'); assert.equal(previewRequest.selected, id);
      const action = JSON.parse(previewRequest.body); assert.equal(action.patch.objects.filter(object => object.id === id).length, 1);
      assert.deepEqual(action.patch.objects.filter(object => object.id !== id), prior.manifest.scenes[1].objects);
      await (await page.$('#object-editor')).screenshot({ path: join(dir, `created-${kind}-draft.png`) });
      await page.click('#save-scene'); await page.waitForFunction(() => document.querySelector('#draft-status').textContent === 'Все изменения сохранены' || document.querySelector('#draft-status').textContent === 'All changes saved'); await settled();
      const accepted = await readProject(file), applyRequest = requests.findLast(item => item.path === '/api/visual/apply');
      deltas.push(accepted.manifest.history.length - prior.manifest.history.length); assert.equal(deltas.at(-1), 1);
      assert.equal(accepted.manifest.scenes[1].objects.length, prior.manifest.scenes[1].objects.length + 1);
      assert.deepEqual(accepted.manifest.scenes[1].objects, action.patch.objects); assert.deepEqual(accepted.manifest.scenes[0], before.manifest.scenes[0]); assert.deepEqual(accepted.manifest.assets, before.manifest.assets);
      assert.deepEqual([applyRequest.intent, applyRequest.selected, applyRequest.etag], [previewRequest.intent, id, previewRequest.etag]); assert.equal(JSON.stringify(JSON.parse(applyRequest.body).action), previewRequest.body);
      assert.equal(await selection(), id); assert.equal(requests.some(item => item.path === '/api/edit' || item.path === '/api/import'), false);
    }
    const accepted = await readProject(file), renderer = await openRenderer(await loadManifest(file), tools.chrome);
    let nativeFrame;
    try { nativeFrame = { local: 0, global: 6, sha256: hashBytes(await renderer.frame(6)) }; assert.equal(await page.$eval('#stage', canvas => canvas.toDataURL()), `data:image/png;base64,${(await renderer.frame(6)).toString('base64')}`); } finally { await renderer.finish(); }
    await studio.close(); studio = await startStudio(file, 0); await open();
    for (const id of createdIDs) assert.ok(await page.$(`[data-object-id="${id}"]`)); assert.deepEqual((await readProject(file)).manifest.scenes, accepted.manifest.scenes);
    await editProject(file, { type: 'restore', revisionId: before.manifest.revision }, accepted.etag); await studio.close(); studio = await startStudio(file, 0); await open();
    assert.deepEqual((await readProject(file)).manifest.scenes, before.manifest.scenes); assert.deepEqual(await sources(), sourceBefore); for (const id of createdIDs) assert.equal(await page.$(`[data-object-id="${id}"]`), null);
    assert.deepEqual(errors, []);
    await writeFile(join(dir, 'created-objects.json'), JSON.stringify({ status: 'PASS', aspect, language: aspect === '16:9' ? 'ru' : 'en', types: ['text', 'rect', 'ellipse', 'image'], createdIDs, oneStableIdPerDraft: true, insertionAndSelectionAtomic: true, addPreviewCancelNoAcceptedMutation: true, applyRevisionDeltas: deltas, neighboursAndSourcesPreserved: true, exactIntentSelectionETagAction: true, explicitStayPreservesNewObject: true, propertiesGeometryLayerBeforeApply: true, newSessionReopenAndRestore: true, nativeFrame, sourceHashes: sourceBefore, errors, humanAcceptance: 'NOT RUN' }, null, 2));
  } finally { await browser.close(); await studio.close(); }
});

test('create intent routes reject extra objects, neighbour changes and mismatched metadata before publication', { timeout: 90000 }, async () => {
  const { file, dir, asset } = await fixture('16:9'), studio = await startStudio(file, 0), origin = new URL(studio.url).origin;
  try {
    const session = await fetch(origin + '/api/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: new URL(studio.url).hash.slice(1) }) });
    const cookie = session.headers.get('set-cookie').split(';')[0], before = await readProject(file), bytes = await readFile(file), original = before.manifest.scenes[1].objects;
    const created = { id: 'new-object', type: 'image', asset, x: 200, y: 300, width: 300, height: 200, fit: 'contain' };
    const action = () => ({ type: 'edit-scene', sceneId: 'objects', patch: { objects: [...structuredClone(original), structuredClone(created)] } });
    const headers = { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'If-Match': before.etag, 'X-AMS-Object-Intent': 'create', 'X-AMS-Selected-Object': created.id };
    const call = (route, input, changes = {}) => { const merged = { ...headers, ...changes }; for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key]; return fetch(origin + route, { method: 'POST', headers: merged, body: JSON.stringify(input) }); };
    const negatives = [
      a => a.patch.objects.push({ ...created, id: 'second-new' }), a => a.patch.objects.push({ ...created }),
      a => a.patch.objects.splice(0, 1), a => a.patch.objects[0].id = 'replacement', a => a.patch.objects[0].x++,
      a => [a.patch.objects[0], a.patch.objects[1]] = [a.patch.objects[1], a.patch.objects[0]],
      a => a.patch.objects.at(-1).asset = 'missing', a => a.patch.objects.at(-1).asset = '../private.png',
      a => a.patch.objects.at(-1).type = 'video', a => a.patch.objects.at(-1).width = 3841,
      a => a.patch.objects.at(-1).keyframes = [{ frame: 2, x: 1 }, { frame: 1, x: 2 }],
      a => a.patch.objects.at(-1).id = 'back', a => a.patch.durationFrames = 0,
      a => a.patch.objects.at(-1).path = 'private.png'
    ];
    for (const route of ['/api/visual/preview', '/api/visual/apply']) {
      for (const mutate of negatives) { const bad = action(); mutate(bad); assert.equal((await call(route, route.endsWith('apply') ? { previewId: 'missing', action: bad } : bad)).status, 400); assert.deepEqual(await readFile(file), bytes); }
      for (const value of ['', 'edit', 'CREATE', 'create, create', undefined]) assert.equal((await call(route, route.endsWith('apply') ? { previewId: 'missing', action: action() } : action(), { 'X-AMS-Object-Intent': value })).status, 400);
      for (const value of ['', 'back', 'wrong-new', undefined]) assert.equal((await call(route, route.endsWith('apply') ? { previewId: 'missing', action: action() } : action(), { 'X-AMS-Selected-Object': value })).status, 400);
      const duplicate = await new Promise((ok, bad) => { const req = httpRequest(origin + route, { method: 'POST', headers: { ...headers, 'X-AMS-Object-Intent': ['create', 'create'] } }, reply => { reply.resume(); ok(reply.statusCode); }); req.on('error', bad); req.end(JSON.stringify(route.endsWith('apply') ? { previewId: 'missing', action: action() } : action())); }); assert.equal(duplicate, 400);
    }
    assert.deepEqual(await readFile(file), bytes);
    let rendered = await (await call('/api/visual/preview', action())).json(); assert.ok(rendered.previewId);
    const mismatch = action(); mismatch.patch.objects.at(-1).x++;
    assert.equal((await call('/api/visual/apply', { previewId: rendered.previewId, action: mismatch })).status, 400); assert.deepEqual(await readFile(file), bytes);
    assert.equal((await call('/api/visual/apply', { previewId: rendered.previewId, action: action() }, { 'If-Match': '0'.repeat(64) })).status, 409);
    const originalRename = filesystem.rename; let failedPublicationAttempts = 0;
    try {
      filesystem.rename = async (from, to) => { if (to === resolve(file)) { failedPublicationAttempts++; throw Object.assign(new Error('Controlled create publication failure'), { code: 'EIO' }); } return originalRename(from, to); }; syncBuiltinESMExports();
      const failed = await call('/api/visual/apply', { previewId: rendered.previewId, action: action() }); assert.equal(failed.status, 503); assert.equal((await failed.json()).error.code, 'VISUAL_COMMIT_OUTCOME_UNKNOWN');
    } finally { filesystem.rename = originalRename; syncBuiltinESMExports(); }
    assert.equal(failedPublicationAttempts, 1); assert.deepEqual(await readFile(file), bytes);
    assert.equal((await call('/api/visual/apply', { previewId: rendered.previewId, action: action() })).status, 400, 'ticket was consumed before the failed publication attempt');
    rendered = await (await call('/api/visual/preview', action())).json(); assert.ok(rendered.previewId);
    const result = await call('/api/visual/apply', { previewId: rendered.previewId, action: action() }); assert.equal(result.status, 200);
    const accepted = await readProject(file); assert.equal(accepted.manifest.history.length, before.manifest.history.length + 1); assert.deepEqual(accepted.manifest.scenes[1].objects.filter(object => object.id !== created.id), original);
    assert.equal((await call('/api/visual/apply', { previewId: rendered.previewId, action: action() })).status, 409);
    assert.equal((await call('/api/visual/apply', { previewId: rendered.previewId, action: action() }, { 'If-Match': accepted.etag })).status, 400);
    assert.deepEqual(accepted.manifest.assets, before.manifest.assets); assert.equal(JSON.stringify(accepted.manifest).includes('X-AMS-Object-Intent'), false);
    const fullObjects = [...structuredClone(accepted.manifest.scenes[1].objects), ...Array.from({ length: 92 }, (_, index) => ({ id: `limit-${index}`, type: 'shape', shape: 'rect', x: 0, y: 0, width: 10, height: 10, color: 'accent' }))];
    const almostFull = await editProject(file, { type: 'edit-scene', sceneId: 'objects', patch: { objects: fullObjects.slice(0, 95) } }, accepted.etag);
    const browser = await launchBrowser(tools.chrome), page = await browser.newPage();
    try {
      await page.goto(studio.url, { waitUntil: 'networkidle0' }); await page.click('[data-scene-id="objects"]'); await ready(page);
      assert.equal(await page.$eval('#visual-add-rect', node => node.disabled), false); await page.click('#visual-add-rect');
      await page.waitForFunction(() => document.querySelectorAll('#visual-layers button').length === 96 && !document.querySelector('#preview-scene').disabled);
      assert.equal(await page.$eval('#visual-add-text', node => node.disabled), true); assert.equal((await readProject(file)).etag, almostFull.etag);
      await page.evaluate(() => document.querySelector('#visual-add-text').dispatchEvent(new Event('click'))); assert.equal(await page.$eval('#visual-dialog', node => node.open), false);
      await page.click('#visual-cancel'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-discard'); await ready(page);
      await editProject(file, { type: 'edit-scene', sceneId: 'objects', patch: { objects: fullObjects } }, almostFull.etag);
      await page.goto(studio.url, { waitUntil: 'networkidle0' }); await page.click('[data-scene-id="objects"]'); await ready(page); assert.equal(await page.$eval('#visual-add-text', node => node.disabled), true);
    } finally { await browser.close(); }
    const full = await readProject(file), fullBytes = await readFile(file);
    const overflow = { type: 'edit-scene', sceneId: 'objects', patch: { objects: [...fullObjects, { ...created, id: 'overflow' }] } };
    for (const route of ['/api/visual/preview', '/api/visual/apply']) assert.equal((await call(route, route.endsWith('apply') ? { previewId: 'missing', action: overflow } : overflow, { 'If-Match': full.etag, 'X-AMS-Selected-Object': 'overflow' })).status, 400);
    assert.deepEqual(await readFile(file), fullBytes);
    await writeFile(join(dir, 'create-server.json'), JSON.stringify({ status: 'PASS', negativeActions: negatives.length, bothPostRoutes: true, malformedMissingDuplicateIntent: true, missingIncorrectSelected: true, mismatchExactActionAndETag: true, ticketConsumedBeforeFailedPublication: true, failedPublicationAttempts, ticketAppliedOnce: true, actualUI95To96DraftAllowed: true, actualUI96To97Blocked: true, native96ObjectLimitRejected: true, noHiddenPublicationOnReject: true, neighboursAndAssetsPreserved: true, transientMetadataNotPersisted: true }, null, 2));
  } finally { await studio.close(); }
});

test('image import is a separate revision; picker conflict and unknown writes require read reconciliation', { timeout: 180000 }, async () => {
  const { file, dir } = await fixture('16:9'), browser = await launchBrowser(tools.chrome), page = await browser.newPage(), errors = [], requests = [];
  let studio = await startStudio(file, 0);
  const importedImage = join(dir, 'imported.png'), unknownImage = join(dir, 'unknown.png');
  await runProcess(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xf08b31:s=64x64', '-frames:v', '1', '-threads', '1', importedImage]);
  await runProcess(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xb531f0:s=64x64', '-frames:v', '1', '-threads', '1', unknownImage]);
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (request.method() === 'POST') requests.push({ path: new URL(request.url()).pathname, selected: request.headers()['x-ams-selected-object'], body: request.postData() }); });
  const settled = () => page.waitForFunction(() => document.querySelector('#stage').dataset.rendered === document.querySelector('#stage').dataset.renderRequest && !document.querySelector('#visual-x').disabled);
  const open = async () => { await page.goto(studio.url, { waitUntil: 'networkidle0' }); await page.click('[data-scene-id="objects"]'); await ready(page); await settled(); };
  const preview = async () => { await previewDraft(page); await page.waitForFunction(() => !document.querySelector('#save-scene').disabled); };
  const imageDraft = async id => { await page.click('#visual-add-image'); await page.waitForSelector('#visual-image-dialog[open]'); await page.select('#visual-image-asset', id); await page.click('#visual-image-add'); await settled(); };
  try {
    await page.setViewport({ width: 1440, height: 1200 }); await page.evaluateOnNewDocument(() => localStorage.setItem('ams-language', 'en')); await open();
    const before = await readProject(file); await (await page.$('#import')).uploadFile(importedImage);
    const importedID = `media-${hashBytes(await readFile(importedImage)).slice(0, 24)}`;
    await page.waitForFunction(id => Boolean(document.querySelector(`[data-add-asset="${id}"]`)), {}, importedID); await settled();
    const imported = await readProject(file), importedBytes = await readFile(file); assert.equal(imported.manifest.history.length, before.manifest.history.length + 1); assert.deepEqual(imported.manifest.scenes, before.manifest.scenes);
    await imageDraft(importedID); await preview(); assert.deepEqual(await readFile(file), importedBytes);
    await page.click('#visual-cancel'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-discard'); await settled();
    assert.deepEqual(await readFile(file), importedBytes); assert.equal(hashBytes(await readFile(join(file, '..', imported.manifest.assets[importedID].path))), hashBytes(await readFile(importedImage)));
    await studio.close(); studio = await startStudio(file, 0); await open();
    await page.click('#visual-add-image'); await page.waitForSelector('#visual-image-dialog[open]'); assert.equal(await page.$eval(`#visual-image-asset option[value="${importedID}"]`, node => node.value), importedID);
    const externalObjects = structuredClone(imported.manifest.scenes[1].objects); externalObjects[0].x += 8;
    await cliEdit(file, { type: 'edit-scene', sceneId: 'objects', patch: { objects: externalObjects } }, dir); const external = await readProject(file);
    await page.waitForFunction(() => document.querySelector('#visual-image-note').textContent.startsWith('Project changed'), { timeout: 10000 }); assert.equal(await page.$eval('#visual-image-add', node => node.disabled), true);
    await page.evaluate(() => document.querySelector('#visual-image-add').dispatchEvent(new Event('click'))); assert.equal((await readProject(file)).etag, external.etag);
    await page.click('#visual-image-cancel'); await page.click('#reload'); await settled();
    await page.click('#visual-add-text'); await settled(); await preview();
    const nextObjects = structuredClone(externalObjects); nextObjects[0].x += 8; await cliEdit(file, { type: 'edit-scene', sceneId: 'objects', patch: { objects: nextObjects } }, dir);
    await page.waitForFunction(() => document.querySelector('#visual-status').textContent.includes('changed externally'), { timeout: 10000 }); assert.equal(await page.$eval('#save-scene', node => node.disabled), true); assert.equal(requests.filter(item => item.path === '/api/visual/apply').length, 0);
    await page.click('#reload'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-discard'); await settled();
    await imageDraft(importedID); const createdID = await page.$eval('#visual-selection-name', node => node.dataset.objectId); await preview();
    const cdp = await page.createCDPSession(); let applyReply, importReply;
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/visual/apply', requestStage: 'Response' }] });
    cdp.on('Fetch.requestPaused', async event => { try { const body = await cdp.send('Fetch.getResponseBody', { requestId: event.requestId }); const reply = JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString() : body.body); if (new URL(event.request.url).pathname === '/api/visual/apply') applyReply = reply; else importReply = reply; await cdp.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{unreadable').toString('base64') }); } catch (error) { errors.push(error.message); } });
    const beforeApply = await readProject(file); await page.click('#save-scene'); await page.waitForFunction(() => document.querySelector('#visual-status').textContent.includes('outcome unknown'));
    const accepted = await readProject(file); assert.equal(applyReply.committed, true); assert.equal(accepted.manifest.history.length, beforeApply.manifest.history.length + 1); assert.equal(accepted.manifest.scenes[1].objects.filter(object => object.id === createdID).length, 1);
    assert.deepEqual(accepted.manifest.scenes[1].objects.filter(object => object.id !== createdID), nextObjects); assert.equal(await page.$eval('#visual-selection-name', node => node.dataset.objectId), createdID);
    for (const kind of ['text', 'rect', 'ellipse', 'image']) { assert.equal(await page.$eval(`#visual-add-${kind}`, node => node.disabled), true); await page.evaluate(id => document.querySelector(id).dispatchEvent(new Event('click')), `#visual-add-${kind}`); }
    await page.evaluate(() => document.querySelector('#save-scene').dispatchEvent(new Event('click'))); assert.equal(requests.filter(item => item.path === '/api/visual/apply').length, 1);
    await (await page.$('#object-editor')).screenshot({ path: join(dir, 'created-unknown-apply.png') });
    await cdp.send('Fetch.disable'); await page.click('#reload'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-discard'); await settled(); assert.equal((await readProject(file)).etag, accepted.etag);
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/import?*', requestStage: 'Response' }] });
    await (await page.$('#import')).uploadFile(unknownImage); await page.waitForFunction(() => document.querySelector('#visual-status').textContent.startsWith('Import outcome unknown'));
    const unknownImported = await readProject(file), unknownID = `media-${hashBytes(await readFile(unknownImage)).slice(0, 24)}`;
    assert.equal(importReply.importedId, unknownID); assert.equal(unknownImported.manifest.history.length, accepted.manifest.history.length + 1); assert.deepEqual(unknownImported.manifest.scenes, accepted.manifest.scenes);
    assert.equal(await page.$eval('#visual-add-image', node => node.disabled), true); assert.equal(requests.filter(item => item.path === '/api/import').length, 2); await (await page.$('#import')).uploadFile(unknownImage); assert.equal(requests.filter(item => item.path === '/api/import').length, 2);
    await cdp.send('Fetch.disable'); await cdp.detach(); await page.click('#reload'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-discard'); await settled();
    assert.equal((await readProject(file)).etag, unknownImported.etag); assert.ok(await page.$(`[data-add-asset="${unknownID}"]`)); assert.deepEqual(errors, []);
    await writeFile(join(dir, 'create-import-reconciliation.json'), JSON.stringify({ status: 'PASS', importRevisionDelta: 1, importCancelReopenPreservesSource: true, importPlusApplyRevisionDelta: 2, pickerExternalConflictBlocked: true, draftExternalConflictInvalidatesTicket: true, stableCreatedID: createdID, lostApplyReplyObservedCommitted: true, applyRequests: 1, unknownBlocksAllAdd: true, ordinaryApplyNeverResent: true, lostImportReplyObservedCommitted: true, importRequests: 2, unknownImportNeverResent: true, explicitReadReconciliation: true, importedSourceHash: hashBytes(await readFile(importedImage)), unknownSourceHash: hashBytes(await readFile(unknownImage)), errors, humanAcceptance: 'NOT RUN' }, null, 2));
  } finally { await browser.close(); await studio.close(); }
});

test('pending native render preserves invalid style entries and blocks writes until correction or Cancel', { timeout: 90000 }, async () => {
  const { file, dir } = await fixture('16:9'), originalBytes = await readFile(file), before = await readProject(file);
  const browser = await launchBrowser(tools.chrome), page = await browser.newPage(), studio = await startStudio(file, 0), writes = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const path = new URL(request.url()).pathname; if (['/api/visual/preview', '/api/visual/apply'].includes(path)) writes.push({ path, body: request.postData() }); });
  const rendered = () => page.waitForFunction(() => document.querySelector('#stage').dataset.rendered === document.querySelector('#stage').dataset.renderRequest);
  const blocked = async () => {
    assert.equal(await page.$eval('#preview-scene', node => node.disabled), true); assert.equal(await page.$eval('#save-scene', node => node.disabled), true);
    await page.evaluate(() => { document.querySelector('#preview-scene').dispatchEvent(new Event('click')); });
    await page.waitForFunction(() => !document.querySelector('#visual-font-size').disabled);
    await page.evaluate(() => { document.querySelector('#save-scene').dispatchEvent(new Event('click')); });
    await page.waitForFunction(() => !document.querySelector('#visual-font-size').disabled);
  };
  try {
    await page.setViewport({ width: 1440, height: 1200 }); await page.evaluateOnNewDocument(() => localStorage.setItem('ams-language', 'en'));
    await page.goto(studio.url, { waitUntil: 'networkidle0' }); await page.click('[data-scene-id="objects"]'); await ready(page); await page.click('[data-object-id="title"]'); await rendered();
    await page.evaluate(() => {
      const native = window.studio.initialize.bind(window.studio), probe = window.invalidStyleProbe = { entered: false, finished: false };
      let first = true;
      window.studio.initialize = async (...args) => { if (first) { first = false; probe.entered = true; await new Promise(resolve => { probe.release = resolve; }); } const result = await native(...args); probe.finished = true; return result; };
    });
    await field(page, '#visual-color', '#123456'); await page.waitForFunction(() => window.invalidStyleProbe.entered);
    await field(page, '#visual-font-size', 301); assert.notEqual(await page.$eval('#visual-font-size', node => node.validationMessage), ''); await blocked();
    await page.evaluate(() => window.invalidStyleProbe.release()); await page.waitForFunction(() => window.invalidStyleProbe.finished); await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await page.$eval('#visual-font-size', node => node.value), '301'); assert.notEqual(await page.$eval('#visual-font-size', node => node.validationMessage), ''); await blocked(); assert.equal(writes.length, 0);
    await page.select('#visual-weight', '700'); await field(page, '#visual-x', 170); await rendered();
    assert.equal(await page.$eval('#visual-font-size', node => node.value), '301'); assert.notEqual(await page.$eval('#visual-font-size', node => node.validationMessage), ''); await blocked(); assert.equal(writes.length, 0);
    await field(page, '#visual-color', 'red'); await field(page, '#visual-font-size', 40); await rendered();
    assert.equal(await page.$eval('#visual-color', node => node.value), 'red'); assert.notEqual(await page.$eval('#visual-color', node => node.validationMessage), ''); assert.equal(await page.$eval('#visual-font-size', node => node.validationMessage), ''); await blocked(); assert.equal(writes.length, 0);
    await field(page, '#visual-color', '#d834aa'); await rendered(); await previewDraft(page); await page.waitForFunction(() => !document.querySelector('#save-scene').disabled);
    assert.equal(writes.length, 1); const outgoing = JSON.parse(writes[0].body).patch.objects.find(object => object.id === 'title');
    assert.deepEqual([outgoing.color, outgoing.fontSize, outgoing.weight, outgoing.x], ['#d834aa', 40, 700, 170]); assert.deepEqual(await readFile(file), originalBytes);
    await field(page, '#visual-font-size', 301); await blocked(); assert.equal(writes.length, 1, 'an invalid field consumes no Apply request even after a successful preview');
    await page.click('#visual-cancel'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-discard'); await ready(page); await rendered();
    assert.equal(await page.$eval('#visual-font-size', node => node.value), '32'); assert.equal(await page.$eval('#visual-font-size', node => node.validationMessage), ''); assert.equal(await page.$eval('#visual-color', node => node.value), ''); assert.equal(await page.$eval('#preview-scene', node => node.disabled), false);
    assert.deepEqual(await readFile(file), originalBytes); assert.deepEqual((await readProject(file)).manifest.history, before.manifest.history); assert.deepEqual(errors, []);
    await (await page.$('#object-editor')).screenshot({ path: join(dir, 'invalid-style-cancel.png') });
    await writeFile(join(dir, 'invalid-style-pending.json'), JSON.stringify({ status: 'PASS', actualBrowserDeferredNativeInitialize: true, staleRenderCannotUnlock: true, programmaticPreviewApplyBlocked: true, unrelatedStyleAndGeometryPreserveInvalidEntry: true, correctingOneErrorPreservesAnother: true, explicitCorrectionPreviewMatchesFields: true, existingTicketInvalidated: true, cancelRestoresInputsAndAcceptedBytes: true, acceptedHistoryUnchanged: true, previewRequests: 1, applyRequests: 0, errors, humanAcceptance: 'NOT RUN' }, null, 2));
  } finally { await browser.close(); await studio.close(); }
});

for (const aspect of ['16:9', '9:16']) test(`selected properties and layer order use native draft/preview/apply/restore ${aspect}`, { timeout: 180000 }, async () => {
  const { file, dir } = await propertiesFixture(aspect), before = await readProject(file), originalBytes = await readFile(file), originalObjects = before.manifest.scenes[1].objects;
  const sourceHashes = async () => Object.fromEntries(await Promise.all(Object.entries((await readProject(file)).manifest.assets).map(async ([id, asset]) => [id, hashBytes(await readFile(join(file, '..', asset.path)))])));
  const sourceBefore = await sourceHashes(), browser = await launchBrowser(tools.chrome), page = await browser.newPage(), errors = [], requests = [];
  let studio = await startStudio(file, 0);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const path = new URL(request.url()).pathname; if (['/api/visual/preview', '/api/visual/apply'].includes(path)) requests.push({ path, selectedId: request.headers()['x-ams-selected-object'], etag: request.headers()['if-match'], body: request.postData() }); });
  const settled = () => page.waitForFunction(() => document.querySelector('#stage').dataset.rendered === document.querySelector('#stage').dataset.renderRequest && !document.querySelector('#preview-scene').disabled);
  const open = async () => { await page.goto(studio.url, { waitUntil: 'networkidle0' }); await page.click('[data-scene-id="objects"]'); await ready(page); await settled(); };
  const preview = async () => { await previewDraft(page); await page.waitForFunction(() => !document.querySelector('#save-scene').disabled && document.querySelector('#scene-preview').readyState >= 2, { timeout: 60000 }); };
  const apply = async () => { await preview(); const old = await readProject(file); await page.click('#save-scene'); await page.waitForFunction(() => document.querySelector('#draft-status').textContent.includes('saved')); await settled(); const next = await readProject(file); assert.equal(next.manifest.history.length, old.manifest.history.length + 1); return next; };
  const pixels = async () => hashBytes(Buffer.from((await page.$eval('#stage', node => node.toDataURL('image/png'))).split(',')[1], 'base64'));
  const preserveNeighbours = (state, prior, selected) => assert.deepEqual(state.manifest.scenes[1].objects.filter(object => object.id !== selected), prior.manifest.scenes[1].objects.filter(object => object.id !== selected));
  const textDraft = async () => {
    await field(page, '#visual-color', '#d834aa'); await field(page, '#visual-font-size', 40); await page.select('#visual-weight', '700'); await page.select('#visual-align', 'right');
    await page.select('#visual-mode', 'key'); assert.equal(await page.$eval('#visual-font-size', node => node.disabled), true); assert.equal(await page.$eval('#visual-layer-up', node => node.disabled), true);
    await page.$eval('#visual-frame', node => { node.value = '15'; node.dispatchEvent(new Event('input', { bubbles: true })); }); await field(page, '#visual-x', 202);
    await page.select('#visual-mode', 'base'); await page.click('#visual-layer-up'); await page.click('#visual-layer-up'); await settled();
  };
  try {
    await page.setViewport({ width: 1440, height: 1200 }); await page.evaluateOnNewDocument(() => { if (!localStorage.getItem('ams-language')) localStorage.setItem('ams-language', 'en'); }); await open(); await page.click('[data-object-id="title"]'); await settled();
    assert.equal(await page.$eval('#visual-color', node => node.value), ''); assert.equal(await page.$eval('#visual-align', node => node.value), '');
    const initialPixels = await pixels();
    await field(page, '#visual-color', 'red'); assert.equal(await page.$eval('#preview-scene', node => node.disabled), true); assert.equal(await page.$eval('#visual-color', node => node.disabled), false); assert.deepEqual(await readFile(file), originalBytes);
    await field(page, '#visual-font-size', '-'); assert.equal(await page.$eval('#preview-scene', node => node.disabled), true, 'an incomplete number is not an optional reset');
    await field(page, '#visual-font-size', 301); assert.equal(await page.$eval('#preview-scene', node => node.disabled), true); assert.equal(await page.$eval('#visual-font-size', node => node.disabled), false);
    await field(page, '#visual-font-size', 300); await page.waitForFunction(() => document.querySelector('#visual-status').textContent.includes('TEXT_OVERFLOW')); assert.equal(await page.$eval('#visual-font-size', node => node.disabled), false); assert.deepEqual(await readFile(file), originalBytes);
    await textDraft(); await preview(); assert.deepEqual(await readFile(file), originalBytes); assert.deepEqual(await sourceHashes(), sourceBefore);
    await page.click('#visual-cancel'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-stay'); assert.deepEqual(await readFile(file), originalBytes);
    await page.click('#visual-cancel'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-discard'); await settled();
    assert.deepEqual(await readFile(file), originalBytes); assert.equal(await page.$eval('#visual-color', node => node.value), '');
    await textDraft(); const textAccepted = await apply(), title = textAccepted.manifest.scenes[1].objects.find(object => object.id === 'title');
    assert.deepEqual(textAccepted.manifest.scenes[1].objects.map(object => object.id), ['back', 'image', 'ellipse', 'title']); preserveNeighbours(textAccepted, before, 'title');
    assert.deepEqual([title.color, title.fontSize, title.weight, title.align], ['#d834aa', 40, 700, 'right']);
    assert.equal(title.keyframes[0].x, 202); for (const key of ['opacity', 'rotation', 'reveal', 'easing', 'frame']) assert.equal(title.keyframes[0][key], originalObjects[1].keyframes[0][key]);
    assert.deepEqual(title.keyframes[1], originalObjects[1].keyframes[1]); assert.notEqual(await pixels(), initialPixels);
    const renderer = await openRenderer(await loadManifest(file), tools.chrome);
    let nativeFrame;
    try { const local = Number(await page.$eval('#visual-frame', node => node.value)); nativeFrame = { local, global: 6 + local, sha256: hashBytes(await renderer.frame(6 + local)) }; assert.equal(await pixels(), nativeFrame.sha256); } finally { await renderer.finish(); }
    await page.screenshot({ path: join(dir, 'properties-text.png') });
    await editProject(file, { type: 'restore', revisionId: before.manifest.revision }, textAccepted.etag); await studio.close(); studio = await startStudio(file, 0); await open();
    assert.deepEqual((await readProject(file)).manifest.scenes, before.manifest.scenes);
    await page.click('[data-object-id="ellipse"]'); assert.equal(await page.$eval('#visual-radius-field', node => node.hidden), true); assert.equal(await page.$eval('#visual-text-style', node => node.hidden), true);
    await page.click('[data-object-id="back"]'); const beforeShape = await readProject(file), shapePixels = await pixels();
    await field(page, '#visual-color', '#45aa77'); await field(page, '#visual-stroke', 'foreground'); await field(page, '#visual-stroke-width', 5); await field(page, '#visual-radius', 24); await page.click('#visual-layer-up');
    const shapeAccepted = await apply(), shape = shapeAccepted.manifest.scenes[1].objects.find(object => object.id === 'back'); preserveNeighbours(shapeAccepted, beforeShape, 'back');
    assert.deepEqual([shape.color, shape.stroke, shape.strokeWidth, shape.radius], ['#45aa77', 'foreground', 5, 24]); assert.deepEqual(shape.keyframes, originalObjects[0].keyframes); assert.notEqual(await pixels(), shapePixels);
    await page.screenshot({ path: join(dir, 'properties-shape.png') });
    for (const selector of ['#visual-stroke', '#visual-stroke-width', '#visual-radius']) await field(page, selector, '');
    const resetAccepted = await apply(), reset = resetAccepted.manifest.scenes[1].objects.find(object => object.id === 'back');
    for (const key of ['stroke', 'strokeWidth', 'radius']) assert.equal(key in reset, false, key + ' reset removes the field'); preserveNeighbours(resetAccepted, shapeAccepted, 'back');
    await page.click('[data-object-id="image"]'); assert.equal(await page.$eval('#visual-style-fields', node => node.hidden), true);
    const beforeImage = await readProject(file), imagePixels = await pixels(); await field(page, '#visual-x', 270); await page.click('#visual-layer-down'); await page.click('#visual-layer-down');
    const imageAccepted = await apply(); preserveNeighbours(imageAccepted, beforeImage, 'image'); assert.equal(imageAccepted.manifest.scenes[1].objects[0].id, 'image'); assert.notEqual(await pixels(), imagePixels);
    await page.$eval('#visual-stage-wrap', node => node.scrollIntoView({ block: 'center' })); const pick = await nativePoint(page, 360, 280); await page.mouse.click(pick.x, pick.y);
    assert.equal(await page.$eval('#visual-selection-name', node => node.textContent), 'back · shape', 'topmost native order also owns picking');
    await page.screenshot({ path: join(dir, 'properties-layers.png') });
    for (let index = 0; index < requests.length; index++) if (requests[index].path === '/api/visual/apply') {
      const acceptedRequest = requests[index], previewRequest = requests.slice(0, index).findLast(request => request.path === '/api/visual/preview');
      assert.equal(acceptedRequest.selectedId, previewRequest.selectedId); assert.equal(acceptedRequest.etag, previewRequest.etag); assert.equal(JSON.stringify(JSON.parse(acceptedRequest.body).action), previewRequest.body);
    }
    assert.deepEqual(await sourceHashes(), sourceBefore); assert.deepEqual(imageAccepted.manifest.scenes[0], before.manifest.scenes[0]); assert.deepEqual(imageAccepted.manifest.history.slice(0, before.manifest.history.length), before.manifest.history);
    await editProject(file, { type: 'restore', revisionId: before.manifest.revision }, imageAccepted.etag); await studio.close(); studio = await startStudio(file, 0); await open(); await page.click('[data-object-id="title"]');
    assert.deepEqual((await readProject(file)).manifest.scenes, before.manifest.scenes); assert.deepEqual(await sourceHashes(), sourceBefore); assert.equal(await page.$eval('#visual-color', node => node.value), '');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.select('#language', 'ru')]); await page.click('[data-scene-id="objects"]'); await ready(page); await settled(); await page.click('[data-object-id="title"]');
    assert.equal(await page.$eval('#visual-layer-up', node => node.textContent), 'На слой выше'); const restoredBytes = await readFile(file);
    await page.focus('#visual-layer-up'); await page.keyboard.press('Enter'); await settled(); assert.deepEqual(await readFile(file), restoredBytes);
    await page.click('#visual-cancel'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-discard'); await settled(); assert.deepEqual(await readFile(file), restoredBytes); assert.deepEqual(errors, []);
    await page.screenshot({ path: join(dir, 'properties-reopen-ru.png') });
    await writeFile(join(dir, 'properties-layers.json'), JSON.stringify({ aspect, status: 'PASS', cancelStayPreviewNoMutation: true, selectedIdBoundToExactAction: true, nativeFrame, defaultsNotMaterialized: true, optionalResetRemoves: ['stroke', 'strokeWidth', 'radius'], textShapeImage: true, ellipseRadiusHidden: true, neighbourValuesAndRelativeOrderPreserved: true, layerChangesPixelsAndPicking: true, applyRevisionDeltas: [1, 1, 1, 1], invalidColorSizeOverflowCorrectable: true, ruEnglishAndKeyboard: true, restoreNewSessionReopen: true, sourceHashes: sourceBefore, errors, humanAcceptance: 'NOT RUN' }, null, 2));
  } finally { await browser.close(); await studio.close(); }
});

test('selected visual headers reject cross-object tickets, neighbour mutation and malformed metadata before publication', { timeout: 90000 }, async () => {
  const { file, dir } = await propertiesFixture('16:9'), studio = await startStudio(file, 0), origin = new URL(studio.url).origin;
  try {
    const session = await fetch(origin + '/api/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: new URL(studio.url).hash.slice(1) }) });
    const cookie = session.headers.get('set-cookie').split(';')[0], state = await readProject(file), bytes = await readFile(file), objects = state.manifest.scenes[1].objects;
    const headers = { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'If-Match': state.etag };
    const action = () => ({ type: 'edit-scene', sceneId: 'objects', patch: { objects: structuredClone(objects) } });
    const call = (route, input, selection) => fetch(origin + route, { method: 'POST', headers: { ...headers, ...(selection === undefined ? {} : { 'X-AMS-Selected-Object': selection }) }, body: JSON.stringify(input) });
    for (const id of ['', 'unknown', 'title,title', 'title title']) for (const route of ['/api/visual/preview', '/api/visual/apply']) assert.equal((await call(route, route.endsWith('apply') ? { previewId: 'missing', action: action() } : action(), id)).status, 400);
    const duplicate = await new Promise((ok, bad) => { const req = httpRequest(origin + '/api/visual/preview', { method: 'POST', headers: { ...headers, 'X-AMS-Selected-Object': ['title', 'title'] } }, reply => { reply.resume(); ok(reply.statusCode); }); req.on('error', bad); req.end(JSON.stringify(action())); }); assert.equal(duplicate, 400);
    const negatives = [
      ['title', a => a.patch.objects[0].x++],
      ['back', a => a.patch.objects[1].color = 'accent'],
      ['title', a => [a.patch.objects[2], a.patch.objects[3]] = [a.patch.objects[3], a.patch.objects[2]]],
      ['title', a => a.patch.objects[0].strokeWidth = 2],
      ['image', a => a.patch.objects[2].color = 'accent'],
      ['back', a => a.patch.objects[0].fontSize = 32],
      ['title', a => a.patch.objects[1].radius = 2],
      ['ellipse', a => a.patch.objects[3].radius = 2],
      ['title', a => a.patch.objects[1].color = 'red'],
      ['title', a => a.patch.objects[1].fontSize = 301],
      ['title', a => a.patch.objects[1].id = 'other'],
      ['title', a => a.patch.objects[1].type = 'image'],
      ['image', a => a.patch.objects[2].asset = 'other'],
      ['title', a => a.patch.objects.pop()],
      ['title', a => a.patch.objects.push({ ...a.patch.objects[1], id: 'new' })],
      ['title', a => a.patch.objects[2].id = 'title'],
      ['title', a => a.patch.objects[1].keyframes[0].easing = 'linear'],
      ['title', a => a.patch.objects[1].keyframes[0].frame++],
      ['title', a => a.patch.objects[1].keyframes[0].opacity = 1],
      ['title', a => a.patch.objects[1].keyframes[0].rotation = 90],
      ['title', a => a.patch.objects[1].keyframes[0].reveal = .1],
      ['title', a => a.patch.objects[1].keyframes = []],
      ['title', a => a.patch.objects[1].keyframes[0].color = 'accent']
    ];
    for (const [id, mutate] of negatives) { const bad = action(); mutate(bad); for (const route of ['/api/visual/preview', '/api/visual/apply']) assert.equal((await call(route, route.endsWith('apply') ? { previewId: 'missing', action: bad } : bad, id)).status, 400); assert.deepEqual(await readFile(file), bytes); }
    const swap = action(); [swap.patch.objects[0], swap.patch.objects[1]] = [swap.patch.objects[1], swap.patch.objects[0]];
    const preview = await (await call('/api/visual/preview', swap, 'title')).json(); assert.ok(preview.previewId);
    for (const selected of ['back', undefined]) { const reply = await call('/api/visual/apply', { previewId: preview.previewId, action: swap }, selected); assert.equal(reply.status, 400); assert.deepEqual(await readFile(file), bytes); }
    const result = await call('/api/visual/apply', { previewId: preview.previewId, action: swap }, 'title'); assert.equal(result.status, 200);
    assert.equal((await readProject(file)).manifest.history.length, state.manifest.history.length + 1);
    const accepted = await readProject(file); assert.equal(JSON.stringify(accepted.manifest).includes('X-AMS-Selected-Object'), false);
    await writeFile(join(dir, 'selected-server.json'), JSON.stringify({ status: 'PASS', invalidSelectedIDs: 4, duplicateRawHeaderRejected: true, negativeActions: negatives.length, checkedBothPostRoutes: true, crossSelectionAndMissingHeaderRejected: true, sameActionAndETag: true, correctTicketAppliedOnce: true, transportMetadataNotPersisted: true }, null, 2));
  } finally { await studio.close(); }
});

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
    // Entire text/scalar/keyframe draft can be previewed and explicitly discarded.
    await page.click('[data-object-id="title"]');
    await field(page, '#visual-text', 'Cancel keyframe draft'); await field(page, '#duration', '1.1');
    await page.select('#visual-mode', 'key'); await page.focus('#visual-frame'); await page.keyboard.press('Home');
    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
    await field(page, '#visual-x', 220); await previewDraft(page);
    await page.waitForFunction(() => !document.querySelector('#save-scene').disabled, { timeout: 60000 });
    assert.deepEqual(await readFile(file), accepted);
    await page.click('#visual-cancel'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-discard'); await ready(page);
    assert.deepEqual(await readFile(file), accepted);
    assert.equal(await page.$eval('#visual-text', node => node.value), 'Original title');
    assert.equal(await page.$eval('#visual-mode', node => node.value), 'base');
    assert.equal(await page.$eval('#visual-frame', node => node.value), '0');
    assert.deepEqual((await readProject(file)).manifest.history, before.manifest.history);
    await page.$eval('#visual-stage-wrap', node => node.scrollIntoView({ block: 'center' }));
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
  await runProcess(process.execPath, [cli, 'edit', file, '--action', input, '--if-match', (await readProject(file)).etag, '--json']);
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
