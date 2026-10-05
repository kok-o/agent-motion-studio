import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, copyFile, cp, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { createProject } from '../dist/project.js';
import { startStudio } from '../dist/server.js';
import { launchBrowser, findTools, runProcess } from '../dist/runtime.js';
import { render } from '../dist/engine.js';

const root = resolve('artifacts/prototype'), runDir = join(root, 'runs', String(Date.now()));
const projectDir = join(runDir, 'editable-project'); await mkdir(runDir, { recursive: true });
const file = (await createProject(projectDir)).project;
const manifest = JSON.parse(await readFile(file, 'utf8')); manifest.id = 'orbit-synthetic-study'; await writeFile(file, JSON.stringify(manifest, null, 2));
const sources = resolve('examples/orbit-sources'), tools = findTools();
let studio = await startStudio(file, 0), browser, inspectionPage;
const evidence = { runDir, project: file, startedAt: new Date().toISOString(), observations: [], checks: {}, consoleErrors: [] };
const record = async (name, data = true) => { evidence.checks[name] = data; console.log(`PASS ${name}`); await writeFile(join(runDir, 'acceptance.json'), JSON.stringify(evidence, null, 2)); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const disk = async () => JSON.parse(await readFile(file, 'utf8'));
const hashes = async () => Object.fromEntries(await Promise.all(Object.entries((await disk()).assets).map(async ([id, asset]) => [id, hash(await readFile(join(projectDir, asset.path)))])));
const origin = () => new URL(studio.url).origin;
try {
  // The actual server, including denied routes; no mocked handlers.
  assert.equal((await fetch(`${origin()}/api/state`)).status, 401);
  assert.equal((await fetch(`${origin()}/api/session`, { method: 'POST', headers: { Origin: 'http://evil.example' }, body: '{}' })).status, 403);
  const badHost = await new Promise((ok, bad) => { const req = request(`${origin()}/api/state`, { headers: { Host: 'evil.example' } }, response => { response.resume(); ok(response.statusCode); }); req.on('error', bad); req.end(); });
  assert.equal(badHost, 403);
  await record('loopback_session_origin_host');
  browser = await launchBrowser(tools.chrome); const page = await browser.newPage(); inspectionPage = page;
  await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  page.on('pageerror', error => evidence.consoleErrors.push(error.message));
  await page.goto(studio.url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('Проект открыт'));
  const idle = () => page.waitForFunction(() => !document.querySelector('#export').disabled, { timeout: 30000 });
  const fill = async (id, value) => { await page.$eval(`#${id}`, (node, text) => { node.value = text; node.dispatchEvent(new Event('input', { bubbles: true })); }, String(value)); };
  const save = async () => { await page.click('#save-scene'); await page.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('Сохранено') || document.querySelector('#notice').classList.contains('error')); await idle(); assert.equal(await page.$eval('#notice', node => node.classList.contains('error')), false, await page.$eval('#notice', node => node.textContent)); };
  const selectScene = async id => { await page.click(`[data-scene-id="${id}"]`); await idle(); };
  const upload = await page.$('#import');
  await upload.uploadFile(...['jade.mp4', 'amber.mp4', 'field.mp4', 'orbit.png', 'orbit-score.wav'].map(name => join(sources, name)));
  await page.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('Материалы импортированы'), { timeout: 60000 });
  await idle(); const imported = await disk(); assert.equal(Object.keys(imported.assets).length, 5);
  const assetId = name => Object.entries(imported.assets).find(([, asset]) => asset.name === name)[0];
  await record('browser_import_video_image_music', Object.fromEntries(Object.entries(imported.assets).map(([id, asset]) => [asset.name, id])));
  await fill('scene-text', 'ORBIT\nLIGHT STUDY'); await fill('duration', 3); await save();
  for (const name of ['jade.mp4', 'field.mp4', 'orbit.png']) {
    await page.click(`[data-add-asset="${assetId(name)}"]`); await idle();
    const scene = (await disk()).scenes.at(-1); await selectScene(scene.id);
    await fill('duration', name === 'jade.mp4' ? 7 : name === 'field.mp4' ? 6 : 4);
    if (name === 'orbit.png') await fill('scene-caption', 'Свет\nобретает форму');
    else { await fill('trim', name === 'jade.mp4' ? 1 : 0.5); if (name === 'field.mp4') { await fill('focal-x', 0.45); await fill('focal-y', 0.42); } }
    await save();
  }
  await page.select('#music', assetId('orbit-score.wav')); await fill('gain', -8); await page.click('#save-music'); await idle();
  const initialManifest = await disk(); assert.equal(initialManifest.scenes.reduce((n, scene) => n + scene.durationFrames, 0), 600); assert.equal(initialManifest.scenes.length, 4);
  const scene2 = initialManifest.scenes[1].id; await selectScene(scene2);
  const beforeHashes = await hashes(); await writeFile(join(runDir, 'initial-project.json'), JSON.stringify(initialManifest, null, 2));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => [...document.querySelectorAll('.scene-card video')].every(video => video.readyState >= 2 && !video.seeking));
  await page.screenshot({ path: join(runDir, '01-storyboard-before.png') });
  evidence.observations.push('Imported 3 MP4 sources, PNG and WAV with the file chooser; assembled four scene cards and edited 3/7/6/4-second durations, trims, square-source focal point and music using visible controls.');
  async function exportUI(label) {
    await page.click('#export');
    await page.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('MP4 готов') || document.querySelector('#notice').classList.contains('error'), { timeout: 300000 });
    const notice = await page.$eval('#notice', node => node.textContent); assert.match(notice, /^MP4 готов/);
    const id = await page.$eval('#exports', node => node.value), out = join(projectDir, 'exports', id);
    const report = JSON.parse(await readFile(join(out, 'render-report.json'), 'utf8'));
    assert.equal(report.verification.totalFrames, 600); assert.equal(report.verification.decode.exitCode, 0); assert.equal(report.verification.audio.codec, 'aac');
    await copyFile(join(out, 'output.mp4'), join(runDir, `${label}.mp4`));
    await copyFile(join(out, 'contact-sheet.jpg'), join(runDir, `${label}-contact-sheet.jpg`));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.$eval('#player', video => { video.currentTime = 6; });
    await page.waitForFunction(() => document.querySelector('#player').readyState >= 2 && !document.querySelector('#player').seeking);
    await page.screenshot({ path: join(runDir, `${label}-studio.png`) });
    await record(`export_${label}`, { id, output: join(runDir, `${label}.mp4`), verification: report.verification, elapsedSeconds: report.elapsedSeconds });
    return out;
  }
  const original = await exportUI('original');
  // Play the actual MP4 in Chromium, rather than inferring playability from a file.
  await page.$eval('#player', async video => { video.muted = true; video.currentTime = 4; await video.play(); });
  await page.waitForFunction(() => document.querySelector('#player').currentTime > 4.4);
  await page.$eval('#player', video => video.pause()); await record('browser_mp4_playback');
  await page.select('#scene-asset', assetId('amber.mp4')); await save();
  assert.equal((await disk()).scenes[1].asset, assetId('amber.mp4'));
  const changed = await exportUI('changed'); assert.deepEqual(await hashes(), beforeHashes);
  await record('all_accepted_sources_unchanged_after_scene2_edit', beforeHashes);
  // Restart both server and page; the changed choice and previous take must survive.
  await page.close(); await studio.close(); studio = await startStudio(file, 0);
  const reopened = await browser.newPage(); inspectionPage = reopened; await reopened.setViewport({ width: 1440, height: 1100 });
  await reopened.goto(studio.url, { waitUntil: 'networkidle0' });
  await reopened.waitForFunction(() => document.querySelector('#notice').textContent.includes('Проект открыт'));
  await reopened.click(`[data-scene-id="${scene2}"]`);
  await reopened.waitForFunction(() => !document.querySelector('#export').disabled);
  assert.equal(await reopened.$eval('#scene-asset', node => node.value), assetId('amber.mp4'));
  await record('restart_preserves_editable_project');
  await reopened.click('#restore-scene');
  await reopened.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('Сохранено'));
  await reopened.waitForFunction(() => !document.querySelector('#export').disabled);
  assert.equal((await disk()).scenes[1].asset, assetId('jade.mp4'));
  await reopened.click('#export');
  await reopened.waitForFunction(() => document.querySelector('#notice').textContent.startsWith('MP4 готов') || document.querySelector('#notice').classList.contains('error'), { timeout: 300000 });
  assert.match(await reopened.$eval('#notice', node => node.textContent), /^MP4 готов/);
  const restoredId = await reopened.$eval('#exports', node => node.value), restored = join(projectDir, 'exports', restoredId);
  await copyFile(join(restored, 'output.mp4'), join(runDir, 'restored.mp4')); await copyFile(join(restored, 'contact-sheet.jpg'), join(runDir, 'restored-contact-sheet.jpg'));
  await reopened.evaluate(() => window.scrollTo(0, 0));
  await reopened.$eval('#player', video => { video.currentTime = 6; });
  await reopened.waitForFunction(() => document.querySelector('#player').readyState >= 2 && !document.querySelector('#player').seeking);
  await reopened.screenshot({ path: join(runDir, '03-restored-studio.png') });
  assert.deepEqual(await hashes(), beforeHashes); await record('browser_restore_and_export', { exportId: restoredId, asset: assetId('jade.mp4') });
  // Decode the complete videos to small RGB frames. Compare actual images, including cuts.
  async function rgb(directory) {
    const path = join(runDir, `pixels-${directory === original ? 'original' : directory === changed ? 'changed' : 'restored'}.rgb`);
    await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-threads', '1', '-filter_threads', '1', '-i', join(directory, 'output.mp4'), '-vf', 'scale=96:54', '-an', '-pix_fmt', 'rgb24', '-f', 'rawvideo', path]);
    return readFile(path);
  }
  const [a, b, c] = await Promise.all([rgb(original), rgb(changed), rgb(restored)]);
  const bytesPerFrame = 96 * 54 * 3;
  assert.equal(a.length, 600 * bytesPerFrame); assert.equal(b.length, a.length); assert.ok(c.equals(a), 'restoration must reproduce decoded pixels');
  assert.ok(a.subarray(0, 90 * bytesPerFrame).equals(b.subarray(0, 90 * bytesPerFrame)), 'scene 1 pixels must stay');
  assert.ok(!a.subarray(90 * bytesPerFrame, 300 * bytesPerFrame).equals(b.subarray(90 * bytesPerFrame, 300 * bytesPerFrame)), 'scene 2 must visibly change');
  assert.ok(a.subarray(300 * bytesPerFrame).equals(b.subarray(300 * bytesPerFrame)), 'scenes 3/4 pixels must stay');
  await record('decoded_pixels_scope_and_restore', { comparedFrames: 600, dimensions: '96x54 RGB', scene2Changed: true, otherScenesEqual: true, restoredEqualsOriginal: true });
  const frameHashes = [];
  for (const [label, directory] of [['original', original], ['changed', changed], ['restored', restored]]) {
    const path = join(runDir, `${label}.framemd5`);
    await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-threads', '1', '-i', join(directory, 'output.mp4'), '-map', '0:v:0', '-f', 'framemd5', path]);
    frameHashes.push((await readFile(path, 'utf8')).split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim()));
  }
  assert.equal(frameHashes[0].length, 600); assert.deepEqual(frameHashes[0], frameHashes[2]);
  assert.deepEqual(frameHashes[0].slice(0, 90), frameHashes[1].slice(0, 90));
  assert.deepEqual(frameHashes[0].slice(300), frameHashes[1].slice(300));
  assert.ok(frameHashes[0].slice(90, 300).every((value, index) => value !== frameHashes[1][90 + index]));
  await record('full_resolution_decoded_frame_hashes', { width: 1920, height: 1080, format: 'yuv420p', frames: 600, scene2ChangedFrames: 210, otherScenesUnchangedFrames: 390, restoredIdenticalFrames: 600 });
  // A real failing FFmpeg invocation must preserve the previously accepted output and reports.
  const outputHash = hash(await readFile(join(restored, 'output.mp4'))), reportHash = hash(await readFile(join(restored, 'render-report.json')));
  const oldFfmpeg = process.env.FFMPEG_PATH; process.env.FFMPEG_PATH = tools.ffprobe;
  try { await assert.rejects(render(file, restored, { overwrite: true, noCache: true }), /exited/); }
  finally { if (oldFfmpeg === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = oldFfmpeg; }
  assert.equal(hash(await readFile(join(restored, 'output.mp4'))), outputHash); assert.equal(hash(await readFile(join(restored, 'render-report.json'))), reportHash);
  assert.deepEqual(await hashes(), beforeHashes); await assert.rejects(stat(join(restored, '.render.lock')), /ENOENT/);
  await record('failed_encoder_preserves_accepted_export_report_and_sources', { outputHash, reportHash });
  assert.deepEqual(evidence.consoleErrors, []); await record('browser_no_uncaught_errors');
  // Portability is a separate CLI-style export, after closing the editing session.
  await browser.close(); browser = undefined; await studio.close();
  // Portable folder: relative assets and history only, no browser token/cache/output dependency.
  const portable = join(runDir, 'portable-project'); await mkdir(portable);
  await cp(join(projectDir, 'assets'), join(portable, 'assets'), { recursive: true }); await copyFile(file, join(portable, 'project.json'));
  await copyFile(join(sources, 'PROVENANCE.md'), join(portable, 'PROVENANCE.md'));
  await copyFile(resolve('LICENSE'), join(portable, 'LICENSE'));
  const portableResult = await render(join(portable, 'project.json'), join(runDir, 'portable-export'), { noCache: true, progress: console.error });
  assert.equal(portableResult.verification.totalFrames, 600);
  await record('copied_project_renders', { project: join(portable, 'project.json'), report: join(runDir, 'portable-export/render-report.json') });
  evidence.status = 'passed'; evidence.finishedAt = new Date().toISOString(); evidence.observations.push('MP4 playback advances in Chromium. Scene 2 was changed to amber, the server/page were restarted, then the previous jade take was restored and exported using the UI. Source previews are explicitly labelled; the main player shows the accepted export and marks older revisions.');
  await writeFile(join(runDir, 'acceptance.json'), JSON.stringify(evidence, null, 2));
  await writeFile(join(root, 'latest-run.json'), JSON.stringify({ runDir, project: file, portableProject: join(portable, 'project.json'), status: 'passed' }, null, 2));
  console.log(`ACCEPTANCE PASSED: ${runDir}`);
} catch (error) {
  if (inspectionPage && !inspectionPage.isClosed()) {
    evidence.failureUi = await inspectionPage.$eval('#notice', node => node.textContent).catch(() => 'unavailable');
    await inspectionPage.screenshot({ path: join(runDir, 'failure-ui.png') }).catch(() => {});
  }
  evidence.status = 'failed'; evidence.failure = error.stack; await writeFile(join(runDir, 'acceptance.json'), JSON.stringify(evidence, null, 2)); throw error;
} finally { await browser?.close(); await studio.close(); }
