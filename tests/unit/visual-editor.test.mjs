import test from 'node:test';
import assert from 'node:assert/strict';
import { VisualTickets, visualETag, validateVisualAction, visualSpec } from '../../dist/visual-editor.js';
import { build } from 'esbuild';
const compiled = await build({ entryPoints: ['studio/object-editor-geometry.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { geometryKey, containsPoint, resolveCenterResizeSize, adjustNumericToken } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

const object = { id: 'title', type: 'text', text: 'Title', x: 10, y: 20, width: 300, height: 80, rotation: 17, opacity: 0.7, reveal: 0.9, keyframes: [{ frame: 12, x: 70, opacity: 0.4, rotation: 22, reveal: 1, easing: 'outCubic' }] };
const manifest = { schemaVersion: 2, id: 'comp', seed: 7, video: { aspectRatio: '16:9', fps: 30 }, brand: { theme: 'dark', background: '#10171C', foreground: '#F4F1E9', accent: '#D9EE86', font: 'builtin-sans' }, assets: {}, audio: { narration: { provider: 'none' }, music: { provider: 'none' } }, scenes: [{ id: 'shot', type: 'composition', durationFrames: 30, objects: [object, { ...object, id: 'neighbour' }] }] };
const action = () => ({ type: 'edit-scene', sceneId: 'shot', patch: { objects: [geometryKey(object, 12, { x: 99 }), structuredClone(manifest.scenes[0].objects[1])] } });
test('visual edit permits selected text/geometry and preserves independent tracks, neighbours and identity', () => {
  const good = action(); good.patch.objects[0].text = 'Revised';
  assert.deepEqual(validateVisualAction(manifest, good), good);
  for (const mutate of [
    a => a.patch.objects.reverse(),
    a => a.patch.objects.pop(),
    a => a.patch.objects[1].x++,
    a => a.patch.objects[0].opacity = 1,
    a => a.patch.objects[0].fontSize = 90,
    a => a.patch.objects[0].keyframes[0].easing = 'linear',
    a => a.patch.objects[0].keyframes[0].rotation = 90,
    a => a.patch.objects[0].keyframes = [],
    a => a.patch.background = '#000000'
  ]) { const bad = action(); mutate(bad); assert.throws(() => validateVisualAction(manifest, bad)); }
  assert.deepEqual(manifest.scenes[0].objects[0], object);
});
test('visual tickets require mandatory ETag, exact action and are consumed once', () => {
  const tag = 'a'.repeat(64), tickets = new VisualTickets(), a = action();
  for (const input of [undefined, '', '*', '"' + tag + '"', 'b'.repeat(63)]) assert.throws(() => visualETag(input));
  assert.equal(visualETag(tag), tag); tickets.add('one', tag, a);
  assert.throws(() => tickets.consume('one', 'b'.repeat(64), a));
  const changed = structuredClone(a); changed.patch.objects[0].x++;
  assert.throws(() => tickets.consume('one', tag, changed));
  tickets.consume('one', tag, a); assert.throws(() => tickets.consume('one', tag, a));
});
test('geometry keys retain non-geometry properties and pure rotated/center-resize math', () => {
  const revised = geometryKey(object, 12, { x: 100, width: 320 });
  assert.equal(revised.keyframes[0].opacity, 0.4); assert.equal(revised.keyframes[0].rotation, 22); assert.equal(revised.keyframes[0].easing, 'outCubic');
  assert.equal(object.keyframes[0].x, 70);
  const state = { x: 100, y: 200, width: 200, height: 40, rotation: 90 };
  assert.equal(containsPoint(state, { x: 200, y: 300 }), true);
  assert.equal(containsPoint(state, { x: 120, y: 220 }), false);
  assert.deepEqual(resolveCenterResizeSize({ baseWidth: 100, baseHeight: 40, pointerStart: { x: 3, y: 4 }, centerStart: { x: 0, y: 0 }, pointer: { x: 6, y: 8 } }), { width: 200, height: 80 });
  assert.equal(adjustNumericToken('12.5', 1, { altKey: true }), '12.6'); assert.equal(adjustNumericToken('12px', -1, { shiftKey: true }), '2px');
});
test('renderer snapshot strips local paths, history and receipts while retaining native object/timing data', () => {
  const safe = visualSpec({ ...manifest, width: 1920, height: 1080, projectDir: 'private', history: [], operationReceipts: [], assets: { image: { type: 'image', path: 'private.png', absolutePath: 'private/path', width: 20, height: 30 } } });
  assert.deepEqual(safe.assets.image, { type: 'image', width: 20, height: 30 });
  for (const key of ['projectDir', 'history', 'operationReceipts']) assert.equal(key in safe, false);
  assert.deepEqual(safe.scenes, manifest.scenes);
});
