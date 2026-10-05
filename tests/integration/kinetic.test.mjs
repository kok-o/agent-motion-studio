import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { loadManifest, validateManifest } from '../../dist/spec.js';
import { openRenderer } from '../../dist/browser.js';
import { findTools } from '../../dist/runtime.js';

test('kinetic transition boundaries retain pixels; both formats render independently of order', async () => {
  const project = path.resolve('.cache', 'tests', randomUUID());
  await mkdir(project, { recursive: true });
  await copyFile('examples/kinetic-promo/assets/studio.png', path.join(project, 'image.png'));
  const original = JSON.parse(await readFile('examples/kinetic-promo/manifest.json', 'utf8'));
  original.assets.product.path = './image.png';
  const file = path.join(project, 'manifest.json');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  let renderer;
  try {
    for (const aspectRatio of ['9:16', '16:9']) {
      const manifest = structuredClone(original); manifest.video.aspectRatio = aspectRatio;
      await writeFile(file, JSON.stringify(manifest));
      renderer = await openRenderer(await loadManifest(file), findTools().chrome);
      const frames = [0, 37, 74, 75, 83, 112, 149, 150, 218, 255, 299, 300, 308, 345, 389];
      const expected = new Map();
      for (const frame of frames) expected.set(frame, hash(await renderer.frame(frame)));
      for (const frame of frames.toReversed()) assert.equal(hash(await renderer.frame(frame)), expected.get(frame));
      for (const scene of renderer.spec.scenes.slice(1)) {
        assert.equal(hash(await renderer.frame(scene.startFrame)), hash(await renderer.frame(scene.startFrame - 1)), 'a cut must retain the outgoing image, not fade to empty');
        assert.notEqual(hash(await renderer.frame(scene.startFrame + 8)), hash(await renderer.frame(scene.startFrame)), 'transition must reveal a new composition');
      }
      assert.notEqual(expected.get(255), expected.get(299), 'camera must move toward its target inside a settled product shot');
      assert.equal(renderer.spec.scenes[0].layout.lines.length, 3, 'explicit poster line count must stay unchanged without orphan words');
      assert.equal(renderer.spec.scenes[2].layout.lines.length, 3);
      for (const scene of renderer.spec.scenes) {
        const layout = scene.layout || scene.captionLayout;
        assert(layout.x >= 0 && layout.y >= 0 && layout.x + layout.width <= renderer.spec.width && layout.y + layout.height <= renderer.spec.height);
      }
      await assert.rejects(renderer.frame(390), /FRAME_OUT_OF_RANGE/);
      await renderer.finish(); renderer = undefined;
    }
    const invalid = structuredClone(original); invalid.video.style = 'arbitrary-code';
    assert.throws(() => validateManifest(invalid), /allowed values/);
  } finally {
    await renderer?.finish();
    await rm(project, { recursive: true, force: true });
  }
});

test('kinetic short scenes and captions have no renderer exceptions', async () => {
  const project = path.resolve('.cache', 'tests', randomUUID()); await mkdir(project, { recursive: true });
  const manifest = JSON.parse(await readFile('examples/kinetic-promo/manifest.json', 'utf8'));
  manifest.assets = {}; manifest.scenes = [
    { id: 'a', type: 'kinetic_title', durationFrames: 1, text: 'Один' },
    { id: 'b', type: 'kinetic_title', durationFrames: 14, text: 'Два' },
    { id: 'c', type: 'cta', durationFrames: 15, text: 'Три', label: 'Готово' },
  ];
  const file = path.join(project, 'manifest.json'); await writeFile(file, JSON.stringify(manifest));
  const spec = await loadManifest(file);
  spec.scenes[2].resolvedCaptions = [{ startFrame: 20, endFrame: 28, text: 'Проверка субтитров' }];
  let renderer;
  try {
    renderer = await openRenderer(spec, findTools().chrome);
    for (const index of [0, 1, 14, 15, 20, 27, 29]) assert((await renderer.frame(index)).length > 1000);
    const caption = renderer.captionLayouts[0][1];
    assert(caption.y + caption.height + 14 < spec.height * 0.91, 'caption pill must end above the progress HUD');
    assert(spec.scenes[2].labelLayout.y + spec.scenes[2].labelLayout.height + 20 < caption.y - 14, 'CTA label and captions must have distinct reserved regions');
    // v1 frame 15 is the outgoing shot: the CTA transition has zero radius.
    // Compare the label when that transition is complete, and separately keep
    // an unchanged-boundary control so raster noise cannot masquerade as text.
    const boundary = createHash('sha256').update(await renderer.frame(15)).digest('hex');
    const before = createHash('sha256').update(await renderer.frame(19)).digest('hex');
    await renderer.finish(); renderer = undefined;
    spec.scenes[2].label = 'Другая кнопка';
    renderer = await openRenderer(spec, findTools().chrome);
    assert.equal(createHash('sha256').update(await renderer.frame(15)).digest('hex'), boundary, 'the fully masked incoming label cannot change the outgoing frame');
    const after = createHash('sha256').update(await renderer.frame(19)).digest('hex');
    assert.notEqual(before, after, 'short CTA label must be visible when its transition completes');
  } finally { await renderer?.finish(); await rm(project, { recursive: true, force: true }); }
});

test('a one-frame cover honors the declared focal point', async () => {
  const project = path.resolve('.cache', 'tests', randomUUID()); await mkdir(project, { recursive: true });
  await copyFile('examples/kinetic-promo/assets/studio.png', path.join(project, 'image.png'));
  const manifest = JSON.parse(await readFile('examples/kinetic-promo/manifest.json', 'utf8'));
  manifest.assets.product.path = './image.png';
  manifest.scenes = [
    { id: 'detail', type: 'product_zoom', durationFrames: 1, asset: 'product', caption: 'Деталь', fit: 'cover', focalPoint: { x: 0, y: 0.5 } },
    { id: 'end', type: 'cta', durationFrames: 29, text: 'Готово', label: 'Сохранить' },
  ];
  const file = path.join(project, 'manifest.json'); let renderer;
  try {
    await writeFile(file, JSON.stringify(manifest)); renderer = await openRenderer(await loadManifest(file), findTools().chrome);
    const left = createHash('sha256').update(await renderer.frame(0)).digest('hex');
    await renderer.finish(); renderer = undefined;
    manifest.scenes[0].focalPoint.x = 1;
    await writeFile(file, JSON.stringify(manifest)); renderer = await openRenderer(await loadManifest(file), findTools().chrome);
    const right = createHash('sha256').update(await renderer.frame(0)).digest('hex');
    assert.notEqual(left, right, 'a short cover must render the selected image detail instead of ignoring focalPoint');
  } finally { await renderer?.finish(); await rm(project, { recursive: true, force: true }); }
});
