import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, cp, copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { startStudio } from '../../dist/server.js';
import { editProject, readProject } from '../../dist/project.js';
import { findTools, launchBrowser } from '../../dist/runtime.js';

test('dirty UI and agent edits resolve explicitly, survive reload, and recheck a second race', { timeout: 120000 }, async () => {
  const root = resolve('artifacts/iteration-2/conflict', String(Date.now())); await mkdir(root, { recursive: true });
  const file = join(root, 'project.json'); await copyFile('examples/orbit-demo/project.json', file); await cp('examples/orbit-demo/assets', join(root, 'assets'), { recursive: true });
  const studio = await startStudio(file, 0), browser = await launchBrowser(findTools().chrome), page = await browser.newPage();
  const observations = [], errors = []; page.on('pageerror', error => errors.push(error.message));
  const disk = async () => (await readProject(file)).manifest;
  const sceneId = (await disk()).scenes[1].id;
  const agent = patch => editProject(file, { type: 'edit-scene', sceneId, patch });
  const fill = value => page.$eval('#duration', (node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  const idle = () => page.waitForFunction(() => !document.querySelector('#reload').disabled);
  const dialog = () => page.waitForFunction(() => document.querySelector('#conflict-dialog').open);
  try {
    await page.setViewport({ width: 1440, height: 1100 });
    await page.goto(studio.url, { waitUntil: 'networkidle0' }); await page.click(`[data-scene-id="${sceneId}"]`); await idle();
    await fill('6'); await editProject(file, { type: 'edit-scene', sceneId: 'opening', patch: { text: 'AGENT OPENING' } });
    const before = await readFile(file);
    await page.click('#reload'); await dialog(); await idle(); assert.ok((await readFile(file)).equals(before));
    assert.equal(await page.$eval('#duration', n => n.value), '6');
    await page.screenshot({ path: join(root, 'conflict.png') });
    await page.click('#conflict-cancel'); await page.click('#reload'); await dialog(); await idle();
    await page.click('#conflict-local'); await page.waitForFunction(() => !document.querySelector('#conflict-dialog').open); await idle();
    assert.equal((await disk()).scenes[1].durationFrames, 180); assert.equal((await disk()).scenes[0].text, 'AGENT OPENING');
    assert.equal((await disk()).history.at(-1).scenes[1].durationFrames, 210); observations.push('reload does not write; local field applied; unrelated agent edit and prior accepted scene retained');
    await fill('4'); await agent({ durationFrames: 150 }); await page.click('#reload'); await dialog(); await idle();
    await agent({ durationFrames: 90 }); await page.click('#conflict-local'); await idle();
    assert.equal((await disk()).scenes[1].durationFrames, 90); assert.equal(await page.$eval('#conflict-dialog', n => n.open), true);
    assert.match(await page.$eval('#notice', n => n.textContent), /снова изменён/);
    await page.click('#conflict-local'); await page.waitForFunction(() => !document.querySelector('#conflict-dialog').open); await idle();
    assert.equal((await disk()).scenes[1].durationFrames, 120); assert.equal((await disk()).history.at(-1).scenes[1].durationFrames, 90); observations.push('second racing edit requires a fresh explicit choice');
    await fill(''); await agent({ durationFrames: 60 }); await page.click('#reload'); await dialog(); await idle();
    await page.click('#conflict-cancel'); assert.equal(await page.$eval('#duration', n => n.value), '');
    await page.click('#reload'); await dialog(); await idle(); await page.click('#conflict-external'); await page.waitForFunction(() => !document.querySelector('#conflict-dialog').open); await idle();
    assert.equal((await disk()).scenes[1].durationFrames, 60); assert.equal(await page.$eval('#duration', n => n.value), '2'); observations.push('invalid raw draft survives reload and cancel; explicit external choice never saves it');
    await fill('6'); await agent({ durationFrames: 150 });
    // Media range requests may stay open: wait for the actual conflict UI, not network silence.
    page.on('dialog', dialog => dialog.accept()); await page.reload({ waitUntil: 'domcontentloaded' }); await dialog(); await idle();
    assert.equal(await page.$eval('#duration', n => n.value), '6'); await page.click('#conflict-local'); await page.waitForFunction(() => !document.querySelector('#conflict-dialog').open); await idle();
    assert.equal((await disk()).scenes[1].durationFrames, 180); observations.push('raw draft survives a full tab reload and can be applied');
    await fill('5'); await agent({ durationFrames: 120 }); await page.click('#save-scene'); await dialog(); await idle();
    assert.equal((await disk()).scenes[1].durationFrames, 120); await page.click('#conflict-external'); await page.waitForFunction(() => !document.querySelector('#conflict-dialog').open); await idle(); observations.push('stale Save opens the same conflict chooser');
    await page.$eval('#focal-x', n => { n.value='0.7';n.dispatchEvent(new Event('input',{bubbles:true})); }); await agent({focalPoint:{x:.5,y:.9}});await page.click('#reload');await dialog();await idle();await page.click('#conflict-local');await page.waitForFunction(()=>!document.querySelector('#conflict-dialog').open);await idle();
    assert.deepEqual((await disk()).scenes[1].focalPoint,{x:.7,y:.9});observations.push('local focal X keeps externally changed focal Y');
    await fill('3'); await editProject(file, { type: 'remove-scene', sceneId }); await page.click('#reload'); await dialog(); await idle();
    assert.equal(await page.$eval('#conflict-local', n => n.disabled), true); await page.click('#conflict-external'); await page.waitForFunction(() => !document.querySelector('#conflict-dialog').open); await idle();
    assert.equal((await disk()).scenes.some(s => s.id === sceneId), false); observations.push('deleted external scene cannot be recreated silently');
    assert.deepEqual(errors, []); await writeFile(join(root, 'verification.json'), JSON.stringify({ passed: true, observations, errors }, null, 2));
  } finally { await browser.close(); await studio.close(); }
});
