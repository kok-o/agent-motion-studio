import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVisualAction, visualObjectIntent, VisualTickets } from '../../dist/visual-editor.js';

const neighbour = { id: 'original', type: 'text', text: 'Keep exactly', x: 20, y: 30, width: 400, height: 100, opacity: .8, keyframes: [{ frame: 20, rotation: 10 }] };
const manifest = { schemaVersion: 2, id: 'create-test', seed: 1, video: { aspectRatio: '16:9', fps: 30 }, brand: { theme: 'dark', background: '#102030', foreground: '#ffffff', accent: '#ff9933', font: 'builtin-sans' }, assets: { image: { type: 'image', path: 'assets/image.png' }, sound: { type: 'audio', path: 'assets/sound.wav' } }, audio: { narration: { provider: 'none' }, music: { provider: 'none' } }, scenes: [{ id: 'objects', type: 'composition', durationFrames: 30, objects: [neighbour, { ...neighbour, id: 'other' }] }] };
const created = { id: 'new-object', type: 'shape', shape: 'rect', x: 200, y: 220, width: 300, height: 160, color: 'accent' };
const action = (object = created) => ({ type: 'edit-scene', sceneId: 'objects', patch: { objects: [structuredClone(neighbour), structuredClone(object), structuredClone(manifest.scenes[0].objects[1])] } });

test('explicit create adds one native object anywhere while preserving all existing neighbours', () => {
  for (const object of [created, { ...created, shape: 'ellipse' }, { id: created.id, type: 'text', text: 'Новый текст', x: 40, y: 50, width: 600, height: 120, fontSize: 48 }, { id: created.id, type: 'image', asset: 'image', x: 40, y: 50, width: 400, height: 400, fit: 'contain' }]) {
    const input = action(object), original = structuredClone(manifest);
    assert.deepEqual(validateVisualAction(manifest, input, object.id, 'create'), input);
    assert.deepEqual(manifest, original);
    assert.throws(() => validateVisualAction(manifest, input, object.id), /create intent/);
  }
  for (const mutate of [
    a => a.patch.objects.push({ ...created, id: 'second-new' }),
    a => a.patch.objects.push({ ...created }),
    a => a.patch.objects.splice(0, 1),
    a => a.patch.objects[0].text = 'Mutated neighbour',
    a => a.patch.objects[0].id = 'replacement',
    a => a.patch.objects.reverse(),
    a => a.patch.objects[1].type = 'video',
    a => { a.patch.objects[1] = { id: created.id, type: 'image', asset: 'sound', x: 0, y: 0, width: 10, height: 10 }; },
    a => { a.patch.objects[1] = { id: created.id, type: 'image', asset: '../private', x: 0, y: 0, width: 10, height: 10 }; },
    a => a.patch.objects[1].width = 3841,
    a => a.patch.objects[1].keyframes = [{ frame: 2, x: 2 }, { frame: 1, x: 3 }],
    a => a.patch.durationFrames = 0
  ]) { const bad = action(); mutate(bad); assert.throws(() => validateVisualAction(manifest, bad, created.id, 'create')); }
  for (const selected of [null, '', 'original', 'missing']) assert.throws(() => validateVisualAction(manifest, action(), selected, 'create'));
  const full = structuredClone(manifest); full.scenes[0].objects = Array.from({ length: 96 }, (_, index) => ({ ...neighbour, id: `old-${index}` }));
  const almostFull = structuredClone(full); almostFull.scenes[0].objects.pop();
  const lastAllowed = { type: 'edit-scene', sceneId: 'objects', patch: { objects: [...structuredClone(almostFull.scenes[0].objects), created] } };
  assert.deepEqual(validateVisualAction(almostFull, lastAllowed, created.id, 'create'), lastAllowed);
  const overflow = { type: 'edit-scene', sceneId: 'objects', patch: { objects: [...structuredClone(full.scenes[0].objects), created] } };
  assert.throws(() => validateVisualAction(full, overflow, created.id, 'create'));
});

test('intent metadata rejects malformed and raw duplicates while absence preserves edit semantics', () => {
  assert.equal(visualObjectIntent(undefined), null); assert.equal(visualObjectIntent('create'), 'create');
  for (const value of ['', 'edit', 'CREATE', ' create', 'create, create', ['create'], null, 1]) assert.throws(() => visualObjectIntent(value));
  assert.throws(() => visualObjectIntent('create', ['X-AMS-Object-Intent', 'create', 'x-ams-object-intent', 'create']));
  const edit = { type: 'edit-scene', sceneId: 'objects', patch: { objects: structuredClone(manifest.scenes[0].objects) } };
  edit.patch.objects[0].text = 'An existing edit';
  assert.deepEqual(validateVisualAction(manifest, edit, 'original'), edit);
  assert.throws(() => validateVisualAction(manifest, edit, 'original', 'create'));
});

test('create tickets bind intent, stable selection, exact action and base then consume before publication', () => {
  const tickets = new VisualTickets(), input = action(), tag = 'a'.repeat(64);
  tickets.add('preview', tag, input, created.id, 'create');
  for (const args of [ ['preview', tag, input, created.id, null], ['preview', tag, input, 'other-new', 'create'], ['preview', 'b'.repeat(64), input, created.id, 'create'], ['preview', tag, { ...input, patch: { ...input.patch, durationFrames: 31 } }, created.id, 'create'] ]) assert.throws(() => tickets.consume(...args));
  tickets.consume('preview', tag, input, created.id, 'create');
  assert.throws(() => tickets.consume('preview', tag, input, created.id, 'create'));
});
