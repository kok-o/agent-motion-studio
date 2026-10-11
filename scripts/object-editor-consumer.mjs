import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

/** Run only installed code in a fresh consumer. No source checkout imports or model calls. */
export async function verifyInstalledObjectEditor(app, consumer, evidence) {
  await mkdir(evidence, { recursive: true });
  const installed = name => import(pathToFileURL(join(app, 'dist', name)));
  const { createProject, readProject, editProject, importMedia } = await installed('project.js');
  const { startStudio } = await installed('server.js');
  const { launchBrowser, findTools, runProcess } = await installed('runtime.js');
  const { loadManifest } = await installed('spec.js');
  const { openRenderer } = await installed('browser.js');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex'), tools = findTools();
  const outputs = ['dist/visual-editor.js', 'dist/studio/object-editor.js', 'dist/studio/native-fonts.css', 'third-party/hyperframes/LICENSE', 'third-party/hyperframes/PROVENANCE.json'];
  const installedHashes = Object.fromEntries(await Promise.all(outputs.map(async name => [name, hash(await readFile(join(app, name)))])));
  const image = join(consumer, 'object-synthetic.png');
  await runProcess(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x2c8899:s=64x64', '-frames:v', '1', '-threads', '1', image]);
  const file = (await createProject(join(consumer, 'object-film'), { aspect: '16:9', title: 'Installed object fixture' })).project;
  const imported = await importMedia(file, 'synthetic.png', await readFile(image)), asset = imported.importedId;
  await editProject(file, { type: 'edit-scene', sceneId: 'opening', patch: { durationFrames: 30 } });
  await editProject(file, { type: 'add-scene', scene: { id: 'objects', type: 'composition', durationFrames: 30, objects: [
    { id: 'image', type: 'image', asset, x: 700, y: 100, width: 200, height: 200 },
    { id: 'text', type: 'text', text: 'Installed text', x: 120, y: 120, width: 500, height: 150, fontSize: 32, rotation: 10 }
  ] } });
  const before = await readProject(file), beforeBytes = await readFile(file), sourceHash = hash(await readFile(join(consumer, 'object-film', before.manifest.assets[asset].path)));
  let studio, browser, page, primaryError; const errors = [];
  const ready = () => page.waitForFunction(() => !document.querySelector('#object-editor').hidden && !document.querySelector('#visual-x').disabled && document.querySelector('#stage').dataset.rendered === document.querySelector('#stage').dataset.renderRequest);
  try {
    studio = await startStudio(file, 0); browser = await launchBrowser(tools.chrome); page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1440, height: 1100 }); await page.evaluateOnNewDocument(() => localStorage.setItem('ams-language', 'en'));
    await page.goto(studio.url, { waitUntil: 'networkidle0' }); await page.click('[data-scene-id="objects"]'); await ready();
    await page.click('#visual-text'); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.type('Cancel this draft'); await page.keyboard.press('Tab');
    await page.waitForFunction(() => !document.querySelector('#preview-scene').disabled); await page.click('#preview-scene');
    await page.waitForFunction(() => !document.querySelector('#save-scene').disabled && document.querySelector('#scene-preview').readyState >= 2, { timeout: 60000 });
    assert.deepEqual(await readFile(file), beforeBytes);
    await page.click('#visual-cancel'); await page.waitForSelector('#visual-dialog[open]'); await page.click('#visual-dialog-discard'); await ready();
    assert.equal(await page.$eval('#visual-text', node => node.value), 'Installed text'); assert.deepEqual(await readFile(file), beforeBytes);
    await page.$eval('#visual-stage-wrap', node => node.scrollIntoView({ block: 'center' }));
    const p = await page.$eval('#stage', node => { const r = node.getBoundingClientRect(); return { x: r.left + 250 * r.width / node.width, y: r.top + 200 * r.height / node.height, scale: r.width / node.width }; });
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 30 * p.scale, p.y + 20 * p.scale, { steps: 5 }); await page.mouse.up();
    assert.equal(Number(await page.$eval('#visual-x', node => node.value)), 150);
    await page.click('#visual-text'); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.type('Проверенный editor'); await page.keyboard.press('Tab');
    await page.waitForFunction(() => !document.querySelector('#preview-scene').disabled); await page.click('#preview-scene'); await page.waitForFunction(() => !document.querySelector('#save-scene').disabled && document.querySelector('#scene-preview').readyState >= 2, { timeout: 60000 });
    assert.deepEqual(await readFile(file), beforeBytes);
    await (await page.$('#object-editor')).screenshot({ path: join(evidence, 'installed-editor.png') });
    await page.click('#save-scene'); await page.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('Previewed edit accepted')); await ready();
    const after = await readProject(file);
    assert.equal(after.manifest.history.length, before.manifest.history.length + 1);
    assert.deepEqual(after.manifest.history.slice(0, before.manifest.history.length), before.manifest.history);
    assert.deepEqual(after.manifest.history.at(-1).scenes, before.manifest.scenes);
    const selected = after.manifest.scenes[1].objects[1];
    assert.ok(Math.abs(selected.x - 150) < 1e-6); assert.ok(Math.abs(selected.y - 140) < 1e-6);
    const expected = structuredClone(before.manifest.scenes);
    expected[1].objects[1] = { ...expected[1].objects[1], text: 'Проверенный editor', x: selected.x, y: selected.y };
    assert.deepEqual(after.manifest.scenes, expected); assert.deepEqual(after.manifest.assets, before.manifest.assets);
    assert.equal(await page.evaluate(() => document.fonts.check('700 120px StudioSans', 'Русский')), true);
    const livePNG = Buffer.from((await page.$eval('#stage', node => node.toDataURL('image/png'))).split(',')[1], 'base64');
    const renderer = await openRenderer(await loadManifest(file), tools.chrome); let nativeHash;
    try { nativeHash = hash(await renderer.frame(30)); assert.equal(hash(livePNG), nativeHash); } finally { await renderer.finish(); }
    await editProject(file, { type: 'restore', revisionId: before.manifest.revision }, after.etag);
    await studio.close(); studio = await startStudio(file, 0);
    await page.goto(studio.url, { waitUntil: 'networkidle0' }); await page.click('[data-scene-id="objects"]'); await ready();
    assert.equal(await page.$eval('#visual-text', node => node.value), 'Installed text');
    assert.deepEqual((await readProject(file)).manifest.scenes, before.manifest.scenes);
    assert.equal(hash(await readFile(join(consumer, 'object-film', before.manifest.assets[asset].path))), sourceHash);
    assert.deepEqual(errors, []);
    const proof = { status: 'PASS', installedHashes, sourceCheckoutImports: 0, nativeFonts: true, nativeImageAlias: true, previewNoMutation: true, explicitCancelNoMutation: true, acceptedRevisions: 1, sourcePreserved: true, nativeFrame: { local: 0, global: 30, sha256: nativeHash }, newServerSessionRestoreReopen: true, modelCalls: 0, humanAcceptance: 'NOT RUN' };
    await writeFile(join(evidence, 'proof.json'), JSON.stringify(proof, null, 2) + '\n'); return proof;
  } catch (error) { primaryError = error; throw error; }
  finally {
    const cleanup = await Promise.allSettled([Promise.resolve().then(() => browser?.close()), Promise.resolve().then(() => studio?.close())]);
    const failed = cleanup.find(result => result.status === 'rejected');
    if (!primaryError && failed) throw failed.reason;
  }
}
