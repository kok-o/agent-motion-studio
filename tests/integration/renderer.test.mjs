import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { loadManifest } from '../../dist/spec.js';
import { findTools } from '../../dist/runtime.js';
import { openRenderer } from '../../dist/browser.js';

test('frame state is independent of rendering order; edited text changes actual pixels', async () => {
  const project = path.resolve('.cache', 'tests', randomUUID());
  await mkdir(project, { recursive: true });
  const manifest = {
    schemaVersion: 1, id: 'determinism', seed: 7,
    video: { aspectRatio: '9:16', fps: 30 },
    brand: { theme: 'dark', background: '#0B1020', foreground: '#F4F7FB', accent: '#8878FF', font: 'builtin-sans' },
    assets: {}, audio: { narration: { provider: 'none' }, music: { provider: 'none' } },
    scenes: [{ id: 'hook', type: 'kinetic_title', durationFrames: 120, text: 'Продукт в движении', highlight: 'движении' }],
  };
  const file = path.join(project, 'manifest.json');
  const hash = image => createHash('sha256').update(image).digest('hex');
  let renderer;
  try {
    await writeFile(file, JSON.stringify(manifest));
    renderer = await openRenderer(await loadManifest(file), findTools().chrome);
    const sequential = new Map();
    for (const index of [0, 40, 80]) sequential.set(index, hash(await renderer.frame(index)));
    for (const index of [80, 0, 40]) assert.equal(hash(await renderer.frame(index)), sequential.get(index));
    assert.notEqual(sequential.get(0), sequential.get(40), 'entrance must change the rendered frame');
    await assert.rejects(renderer.frame(120), /FRAME_OUT_OF_RANGE/);
    await renderer.finish(); renderer = undefined;
    manifest.scenes[0].text = 'Текст после правки'; delete manifest.scenes[0].highlight;
    await writeFile(file, JSON.stringify(manifest));
    renderer = await openRenderer(await loadManifest(file), findTools().chrome);
    assert.notEqual(hash(await renderer.frame(40)), sequential.get(40), 'text revision must change pixels, not just manifest hash');
  } finally {
    await renderer?.finish();
    await rm(project, { recursive: true, force: true });
  }
});
