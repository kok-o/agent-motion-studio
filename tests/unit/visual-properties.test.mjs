import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVisualAction, visualSelectedObject, VisualTickets } from '../../dist/visual-editor.js';

const text = { id: 'A', type: 'text', text: 'Title', x: 40, y: 60, width: 600, height: 180, rotation: 7, opacity: .8, reveal: .9, keyframes: [{ frame: 12, x: 50, rotation: 11, opacity: .6, reveal: 1, easing: 'outCubic' }] };
const objects = [text, { id: 'B', type: 'shape', shape: 'rect', x: 80, y: 100, width: 200, height: 200, color: 'accent' }, { id: 'C', type: 'shape', shape: 'ellipse', x: 90, y: 100, width: 200, height: 200, color: 'foreground' }, { id: 'D', type: 'image', asset: 'image', x: 100, y: 100, width: 200, height: 200 }];
const manifest = { schemaVersion: 2, id: 'comp', seed: 7, video: { aspectRatio: '16:9', fps: 30 }, brand: { theme: 'dark', background: '#10171C', foreground: '#F4F1E9', accent: '#D9EE86', font: 'builtin-sans' }, assets: { image: { type: 'image', path: './synthetic.png' } }, audio: { narration: { provider: 'none' }, music: { provider: 'none' } }, scenes: [{ id: 'shot', type: 'composition', durationFrames: 30, objects }] };
const action = () => ({ type: 'edit-scene', sceneId: 'shot', patch: { objects: structuredClone(objects) } });

test('selected native properties and arbitrary movement preserve neighbours, defaults and independent keys', () => {
  const a = action(), selected = a.patch.objects.shift();
  Object.assign(selected, { color: '#123456', fontSize: 40, weight: 400, align: 'right', x: 80 });
  selected.keyframes[0].x = 85; a.patch.objects.push(selected);
  assert.deepEqual(validateVisualAction(manifest, a, 'A'), a);
  assert.deepEqual(a.patch.objects.slice(0, -1), objects.slice(1));
  assert.equal('weight' in objects[0], false);
  const b = action(); Object.assign(b.patch.objects[1], { color: 'background', stroke: '#123456', strokeWidth: 3, radius: 12 });
  assert.deepEqual(validateVisualAction(manifest, b, 'B'), b);
  const c = action(); Object.assign(c.patch.objects[2], { stroke: 'accent', strokeWidth: 2 });
  assert.deepEqual(validateVisualAction(manifest, c, 'C'), c);
  const d = action(); d.patch.objects.unshift(d.patch.objects.pop()); d.patch.objects[0].x = 250;
  assert.deepEqual(validateVisualAction(manifest, d, 'D'), d);
  const prior = structuredClone(manifest); Object.assign(prior.scenes[0].objects[0], { color: 'accent', fontSize: 48, weight: 700, align: 'left' });
  const reset = action(); assert.deepEqual(validateVisualAction(prior, reset, 'A'), reset);
  assert.equal('fontSize' in reset.patch.objects[0], false);
});

test('selection whitelist rejects neighbour edits/order, identity/type/asset changes and forbidden type properties', () => {
  const cases = [
    ['second object', 'A', a => a.patch.objects[1].x++],
    ['different selected object', 'B', a => a.patch.objects[0].x++],
    ['neighbour order', 'A', a => [a.patch.objects[2], a.patch.objects[3]] = [a.patch.objects[3], a.patch.objects[2]]],
    ['neighbour default', 'A', a => a.patch.objects[1].strokeWidth = 2],
    ['unknown selection', 'unknown', () => {}],
    ['replacement ID', 'A', a => a.patch.objects[0].id = 'replacement'],
    ['replacement type', 'A', a => a.patch.objects[0].type = 'shape'],
    ['replacement asset', 'D', a => a.patch.objects[3].asset = 'other'],
    ['replacement shape', 'B', a => a.patch.objects[1].shape = 'ellipse'],
    ['add', 'A', a => a.patch.objects.push({ ...text, id: 'new' })],
    ['remove', 'A', a => a.patch.objects.pop()],
    ['duplicate', 'A', a => a.patch.objects[1].id = 'A'],
    ['image color', 'D', a => a.patch.objects[3].color = 'accent'],
    ['shape fontSize', 'B', a => a.patch.objects[1].fontSize = 48],
    ['text radius', 'A', a => a.patch.objects[0].radius = 4],
    ['ellipse radius', 'C', a => a.patch.objects[2].radius = 4],
    ['bad color', 'A', a => a.patch.objects[0].color = 'red'],
    ['bad size', 'A', a => a.patch.objects[0].fontSize = 301],
    ['fractional fontSize', 'A', a => a.patch.objects[0].fontSize = 24.5],
    ['bad weight', 'A', a => a.patch.objects[0].weight = 500],
    ['bad align', 'A', a => a.patch.objects[0].align = 'justify'],
    ['bad strokeWidth', 'B', a => a.patch.objects[1].strokeWidth = 0],
    ['bad radius', 'B', a => a.patch.objects[1].radius = -1],
    ['opacity', 'A', a => a.patch.objects[0].opacity = 1],
    ['rotation', 'A', a => a.patch.objects[0].rotation = 90],
    ['reveal', 'A', a => a.patch.objects[0].reveal = .5],
    ['key easing', 'A', a => a.patch.objects[0].keyframes[0].easing = 'linear'],
    ['key frame', 'A', a => a.patch.objects[0].keyframes[0].frame = 13],
    ['key opacity', 'A', a => a.patch.objects[0].keyframes[0].opacity = 1],
    ['key rotation', 'A', a => a.patch.objects[0].keyframes[0].rotation = 90],
    ['key reveal', 'A', a => a.patch.objects[0].keyframes[0].reveal = .1],
    ['key deletion', 'A', a => a.patch.objects[0].keyframes = []],
    ['key style', 'A', a => a.patch.objects[0].keyframes[0].color = 'accent'],
    ['new key style', 'A', a => a.patch.objects[0].keyframes.push({ frame: 20, x: 10, fontSize: 30 })]
  ];
  for (const [label, id, mutate] of cases) { const bad = action(); mutate(bad); assert.throws(() => validateVisualAction(manifest, bad, id), undefined, label); }
});

test('headerless legacy contract and strict optional selected object header remain compatible', () => {
  assert.equal(visualSelectedObject(undefined), null); assert.equal(visualSelectedObject('A'), 'A');
  for (const input of ['', ' A', 'A,B', 'A B', '_A', 'A'.repeat(65), ['A', 'A'], null]) assert.throws(() => visualSelectedObject(input));
  assert.throws(() => visualSelectedObject('A', ['X-AMS-Selected-Object', 'A', 'x-ams-selected-object', 'A']));
  const legacy = action(); legacy.patch.objects[0].x++;
  assert.deepEqual(validateVisualAction(manifest, legacy), legacy);
  legacy.patch.objects[0].fontSize = 40; assert.throws(() => validateVisualAction(manifest, legacy));
  const reorder = action(); reorder.patch.objects.reverse(); assert.throws(() => validateVisualAction(manifest, reorder));
});

test('exact same swap action and ETag cannot cross selected IDs or headerless tickets', () => {
  const a = action(); [a.patch.objects[0], a.patch.objects[1]] = [a.patch.objects[1], a.patch.objects[0]];
  assert.deepEqual(validateVisualAction(manifest, a, 'A'), a); assert.deepEqual(validateVisualAction(manifest, a, 'B'), a);
  const tag = 'a'.repeat(64), tickets = new VisualTickets(); tickets.add('preview', tag, a, 'A');
  assert.throws(() => tickets.consume('preview', tag, a, 'B'), { code: 'VISUAL_PREVIEW_REQUIRED' });
  assert.throws(() => tickets.consume('preview', tag, a), { code: 'VISUAL_PREVIEW_REQUIRED' });
  tickets.consume('preview', tag, a, 'A'); assert.throws(() => tickets.consume('preview', tag, a, 'A'));
});
