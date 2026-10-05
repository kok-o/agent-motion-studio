import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProject, importMedia, editProject, readProject, withProjectLock } from '../../dist/project.js';
import { loadManifest, validateManifest, hashBytes } from '../../dist/spec.js';
import { runProcess, findTools } from '../../dist/runtime.js';
import { render } from '../../dist/engine.js';

const tools = findTools(), root = resolve('artifacts/prototype/technical-tests', randomUUID());
await mkdir(root, { recursive: true });

test('trim and 24-to-30 fps normalization use the correct boundary frames', { timeout: 120000 }, async () => {
  const dir = join(root, 'trim'), file = (await createProject(dir)).project, source = join(dir, 'colors.mp4');
  await runProcess(tools.ffmpeg, ['-y', '-v', 'error', ...['red', 'green', 'blue'].flatMap(color => ['-f', 'lavfi', '-i', `color=c=${color}:s=160x90:r=24:d=1`]), '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', source]);
  const media = await importMedia(file, 'colors.mp4', await readFile(source));
  await editProject(file, { type: 'add-scene', scene: { id: 'clip', type: 'video', asset: media.importedId, durationFrames: 60, trimStartSeconds: 1 } });
  await editProject(file, { type: 'remove-scene', sceneId: 'opening' });
  const out = join(dir, 'export'), report = await render(file, out, { noCache: true });
  assert.equal(report.verification.totalFrames, 60);
  const pixels = join(dir, 'decoded.rgb');
  await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-i', join(out, 'output.mp4'), '-vf', 'scale=1:1', '-an', '-pix_fmt', 'rgb24', '-f', 'rawvideo', pixels]);
  const data = await readFile(pixels); assert.equal(data.length, 60 * 3);
  for (let frame = 0; frame < 60; frame++) {
    const [r, g, b] = data.subarray(frame * 3, frame * 3 + 3);
    if (frame < 30) assert.ok(g > 110 && r < 15 && b < 15, `frame ${frame}: ${r},${g},${b} should be green`);
    else assert.ok(b > 235 && r < 15 && g < 15, `frame ${frame}: ${r},${g},${b} should be blue`);
  }
});

test('portrait cover follows focal point; contain retains the full source with padding', { timeout: 120000 }, async () => {
  const dir = join(root, 'crop'), file = (await createProject(dir)).project, source = join(dir, 'split.mp4');
  await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=200x100:r=25:d=1,drawbox=x=100:y=0:w=100:h=100:color=blue:t=fill', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', source]);
  const media = await importMedia(file, 'split.mp4', await readFile(source));
  for (const [id, x, fit] of [['left', 0, 'cover'], ['right', 1, 'cover'], ['whole', 0.5, 'contain']]) await editProject(file, { type: 'add-scene', scene: { id, type: 'video', asset: media.importedId, durationFrames: 30, fit, focalPoint: { x, y: 0.5 } } });
  await editProject(file, { type: 'remove-scene', sceneId: 'opening' });
  await editProject(file, { type: 'composition', video: { aspectRatio: '9:16', fps: 30, style: 'kinetic' } });
  const out = join(dir, 'export'), report = await render(file, out, { noCache: true }); assert.equal(report.verification.width, 1080);
  const pixels = join(dir, 'decoded.rgb');
  await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-i', join(out, 'output.mp4'), '-vf', 'scale=18:32', '-an', '-pix_fmt', 'rgb24', '-f', 'rawvideo', pixels]);
  const data = await readFile(pixels), pixel = (frame, x, y) => [...data.subarray((frame * 18 * 32 + y * 18 + x) * 3, (frame * 18 * 32 + y * 18 + x) * 3 + 3)];
  assert.ok(pixel(15, 8, 16)[0] > 235); assert.ok(pixel(45, 8, 16)[2] > 235);
  assert.ok(pixel(75, 8, 1).every(n => n < 5)); assert.ok(pixel(75, 8, 30).every(n => n < 5));
  assert.ok(pixel(75, 3, 16)[0] > 230); assert.ok(pixel(75, 14, 16)[2] > 230);
});

test('failed/stale/concurrent edits, semantic history and source tampering are rejected without changing the project', async () => {
  const dir = join(root, 'transactions'), file = (await createProject(dir)).project;
  const before = await readFile(file);
  await assert.rejects(render(file, dir, { overwrite: true }), /separate output folder/);
  await assert.rejects(importMedia(file, 'broken.mp4', Buffer.from('not a video')), /exited|stream/);
  assert.deepEqual(await readFile(file), before);
  const first = await readProject(file);
  await editProject(file, { type: 'edit-scene', sceneId: 'opening', patch: { text: 'Accepted title' } }, first.etag);
  const accepted = await readFile(file);
  await assert.rejects(editProject(file, { type: 'edit-scene', sceneId: 'opening', patch: { text: 'Stale' } }, first.etag), /changed elsewhere/);
  await assert.rejects(editProject(file, { type: 'edit-scene', sceneId: 'opening', patch: { command: 'execute' } }), /additional properties/);
  await assert.rejects(editProject(file, { type: 'edit-scene', sceneId: 'opening', patch: { command: null } }), /additional properties/);
  await assert.rejects(editProject(file, { type: 'edit-scene', sceneId: 'opening', patch: { trimStartSeconds: 1 } }), /only applies/);
  await withProjectLock(file, async () => { await assert.rejects(editProject(file, { type: 'music' }), /Another edit/); });
  assert.deepEqual(await readFile(file), accepted);
  const changed = (await readProject(file)).manifest;
  await editProject(file, { type: 'restore-scene', sceneId: 'opening', revisionId: changed.history[0].id });
  assert.equal((await readProject(file)).manifest.scenes[0].text, 'Новый фильм');
  const bad = structuredClone(changed); bad.history[0].scenes.push(structuredClone(bad.history[0].scenes[0])); assert.throws(() => validateManifest(bad), /duplicate/);
  const v1 = JSON.parse(await readFile('examples/smoke/manifest.json', 'utf8')); v1.assets.clip = { type: 'video', path: 'x.mp4' }; assert.throws(() => validateManifest(v1), /allowed values/);
  const imported = await importMedia(file, 'image.png', await readFile('examples/orbit-sources/orbit.png'));
  const path = join(dir, imported.manifest.assets[imported.importedId].path), source = await readFile(path);
  await writeFile(path, Buffer.concat([source, Buffer.from('tampered')])); await assert.rejects(loadManifest(file), /accepted source hash/); await writeFile(path, source);
  assert.equal((await loadManifest(file)).assets[imported.importedId].hash, hashBytes(source));
});

test.after(async () => { await writeFile(join(root, 'location.txt'), 'Behavioral artifacts for node --test tests/integration/studio.test.mjs\n'); console.log(`Studio technical evidence: ${root}`); });
