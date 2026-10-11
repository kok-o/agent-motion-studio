import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { validateManifest } from '../../dist/spec.js';

function manifest(aspect = '16:9') {
  return { schemaVersion: 2, id: 'entry', seed: 7, revision: 'old-revision', history: [], video: { aspectRatio: aspect, fps: 30 }, brand: { theme: 'dark', background: '#10171C', foreground: '#F4F1E9', accent: '#D9EE86', font: 'builtin-sans' }, assets: {}, audio: { narration: { provider: 'none' }, music: { provider: 'none' } }, scenes: [{ id: 'opening', type: 'kinetic_title', text: 'Keep original', durationFrames: 120 }] };
}
function source(file, exportsName) {
  const original = readFileSync(resolve(file), 'utf8');
  assert.equal(original.split('import { t } from "./i18n.js";').length, 2);
  return original.replace('import { t } from "./i18n.js";', 'const t = value => value;').replace(/export \{([^}]+)\};/g, (_, names) => `globalThis.${exportsName} = {${names}};`);
}
function controller(version = 2) {
  const nodes = new Map();
  class Element { constructor() { this.disabled = false; this.hidden = false; this.dataset = {}; this.textContent = ''; } showModal() { this.open = true; } close() { this.open = false; } }
  class Button extends Element {} class Dialog extends Element {} class Input extends Element {} class Select extends Element {} class Textarea extends Element {}
  const get = id => { if (!nodes.has(id)) nodes.set(id, new (id.endsWith('-dialog') ? Dialog : ['composition-entry-status', 'composition-dialog-note'].includes(id) ? Element : Button)()); return nodes.get(id); };
  const context = { structuredClone, crypto: webcrypto, Promise, Error, Date, Number, String, Boolean, Array, Object, JSON, Math, HTMLElement: Element, HTMLDialogElement: Dialog, HTMLButtonElement: Button, HTMLInputElement: Input, HTMLSelectElement: Select, HTMLTextAreaElement: Textarea, document: { getElementById: get, querySelectorAll: () => [...nodes.values()] } };
  vm.createContext(context); vm.runInContext(source('dist/studio/composition-entry.js', 'exports'), context);
  let state = { manifest: manifest(), etag: 'a'.repeat(64) }, disk = state, selected, acceptFailure, failRead = false, accepted = 0, release;
  if (version === 1) { state.manifest.schemaVersion = 1; delete state.manifest.revision; delete state.manifest.history; validateManifest(state.manifest); }
  const requests = [], reads = [], host = {
    getState: () => state, isBusy: () => false, hasBlockedEdit: () => false, isDirty: () => false, isVisual: () => false, resolveVisual: async () => true, saveScalar: async () => {},
    async reread(id) { reads.push(id); if (failRead) { failRead = false; throw new Error('Controlled read failure'); } state = disk; selected = id; },
    accepted(result, id) { accepted++; state = result; if (acceptFailure) throw acceptFailure; selected = id; },
    api(path, options) { requests.push({ path, options }); return new Promise(resolve => { release = resolve; }); },
    task: async fn => { await fn(); }, entryTask: async fn => { try { await fn(); } catch { /* app reports read errors; controller must remain blocked */ } }, notice() {},
    updateControls() { for (const node of nodes.values()) node.disabled = false; }
  };
  const entry = context.exports.initCompositionEntry(host);
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const committed = action => ({ etag: 'b'.repeat(64), manifest: { ...structuredClone(state.manifest), schemaVersion: 2, revision: 'new-revision', scenes: [...structuredClone(state.manifest.scenes), action.scene], history: [{ id: state.manifest.revision ?? 'legacy-snapshot', label: 'add-scene', createdAt: new Date().toISOString(), scenes: structuredClone(state.manifest.scenes), video: structuredClone(state.manifest.video), audio: structuredClone(state.manifest.audio), brand: structuredClone(state.manifest.brand) }] } });
  return { entry, get, requests, reads, flush, committed, get selected() { return selected; }, get accepted() { return accepted; }, failAccepted(error) { acceptFailure = error; }, failNextRead() { failRead = true; }, setDisk(value) { disk = value; }, release(value) { release(value); }, pure: context.exports };
}

test('composition entry defaults and limits agree with native validation without changing neighbours', () => {
  const { pure } = controller();
  for (const aspect of ['16:9', '9:16']) {
    const before = manifest(aspect), bytes = JSON.stringify(before), scene = pure.compositionScene(before, 'new-scene', 'new-object', 'Editable text');
    validateManifest({ ...before, scenes: [...before.scenes, scene] });
    assert.equal(JSON.stringify(before), bytes); assert.equal(scene.durationFrames, 120); assert.equal(scene.objects.length, 1);
    const object = scene.objects[0], [w, h] = aspect === '16:9' ? [1920, 1080] : [1080, 1920];
    assert.ok(object.x >= 0 && object.y >= 0 && object.x + object.width <= w && object.y + object.height <= h);
    const almost = { ...before, scenes: Array.from({ length: 11 }, (_, i) => ({ ...before.scenes[0], id: `old-${i}` })) };
    assert.equal(pure.compositionLimit(almost), undefined); validateManifest({ ...almost, scenes: [...almost.scenes, scene] });
    const full = { ...almost, scenes: [...almost.scenes, scene] };
    assert.match(pure.compositionLimit(full), /12/); assert.throws(() => validateManifest({ ...full, scenes: [...full.scenes, { ...scene, id: 'overflow' }] }));
    const time = { ...before, scenes: [{ ...before.scenes[0], durationFrames: 840 }, { ...before.scenes[0], id: 'other', durationFrames: 840 }] };
    assert.equal(pure.compositionLimit(time), undefined); validateManifest({ ...time, scenes: [...time.scenes, scene] });
    time.scenes[1].durationFrames++; assert.match(pure.compositionLimit(time), /60/); assert.throws(() => validateManifest({ ...time, scenes: [...time.scenes, scene] }));
  }
});

test('post-response host failure retains the original submitted IDs and survives a failed reconciliation read', async () => {
  const c = controller(); c.get('add-composition').onclick(); await c.flush();
  const sceneId = c.get('composition-dialog').dataset.sceneId, objectId = c.get('composition-dialog').dataset.objectId;
  c.get('composition-confirm').onclick(); c.get('composition-confirm').onclick(); await c.flush();
  assert.equal(c.requests.length, 1); const action = JSON.parse(c.requests[0].options.body);
  assert.equal(action.scene.id, sceneId); assert.equal(action.scene.objects[0].id, objectId); assert.equal(c.requests[0].options.headers['If-Match'], 'a'.repeat(64));
  const disk = c.committed(action); c.setDisk(disk); c.failAccepted(Object.assign(new Error('Controlled storage failure after commit'), { code: 22 })); c.release(disk); await c.flush();
  assert.equal(c.accepted, 1); assert.equal(c.entry.blocksWrites(), true); assert.equal(c.get('add-composition').disabled, true);
  assert.equal(c.get('composition-entry-status').dataset.sceneId, sceneId); assert.match(c.get('composition-entry-status').textContent, /интерфейс/);
  c.get('add-composition').onclick(); c.get('composition-confirm').onclick(); await c.flush(); assert.equal(c.requests.length, 1);
  c.failNextRead(); await c.entry.reconcile(); assert.equal(c.entry.blocksWrites(), true); assert.equal(c.requests.length, 1);
  await c.entry.reconcile(); assert.equal(c.entry.blocksWrites(), false); assert.equal(c.selected, sceneId); assert.equal(c.requests.length, 1);
  assert.equal(c.reads.at(-1), sceneId); assert.equal(c.get('composition-entry-status').dataset.objectId, objectId);
});

test('malformed committed history is unreadable and never handed to the UI or resent', async () => {
  const c = controller(); c.get('add-composition').onclick(); await c.flush(); c.get('composition-confirm').onclick(); await c.flush();
  const action = JSON.parse(c.requests[0].options.body), disk = c.committed(action); c.setDisk(disk);
  c.release({ ...disk, manifest: { ...disk.manifest, history: [null] } }); await c.flush();
  assert.equal(c.accepted, 0); assert.equal(c.entry.blocksWrites(), true); assert.match(c.get('composition-entry-status').textContent, /неизвестен/);
  c.get('composition-confirm').onclick(); c.get('add-composition').onclick(); await c.flush(); assert.equal(c.requests.length, 1);
  await c.entry.reconcile(); assert.equal(c.selected, action.scene.id); assert.equal(c.requests.length, 1); assert.equal(c.entry.blocksWrites(), false);
});

test('v1 entry accepts the existing native v2 upgrade and preserves original scenes', async () => {
  const c = controller(1); c.get('add-composition').onclick(); await c.flush(); c.get('composition-confirm').onclick(); await c.flush();
  const action = JSON.parse(c.requests[0].options.body), reply = c.committed(action); validateManifest(reply.manifest); c.release(reply); await c.flush();
  assert.equal(c.accepted, 1); assert.equal(c.entry.blocksWrites(), false); assert.equal(c.selected, action.scene.id); assert.equal(c.requests.length, 1);
  assert.equal(reply.manifest.schemaVersion, 2); assert.equal(reply.manifest.scenes[0].text, 'Keep original');
});

test('captions hide only autogenerated UUIDs and preserve native user IDs and data', () => {
  const context = { Array, Object, String }; vm.createContext(context);
  vm.runInContext(source('dist/studio/object-editor.js', 'editor') + '\nglobalThis.caption = objectCaption;', context);
  const id = 'object-12345678-1234-1234-1234-123456789abc', text = { id, type: 'text', text: '  Neutral\n editable text ' }, original = JSON.stringify(text);
  assert.equal(context.caption(text, {}), 'Текст · Neutral editable text'); assert.equal(JSON.stringify(text), original);
  assert.equal(context.caption({ id, type: 'shape', shape: 'rect' }, {}), 'Прямоугольник');
  assert.equal(context.caption({ id, type: 'shape', shape: 'ellipse' }, {}), 'Эллипс');
  assert.equal(context.caption({ id, type: 'image', asset: 'photo' }, { photo: { name: 'Own image.png' } }), 'Изображение · Own image.png');
  assert.equal(context.caption({ ...text, id: 'authored-id' }, {}), 'authored-id · text');
});
