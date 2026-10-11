import { sampleObject } from '../src/composition.ts';
import { resolveCenterResizeSize, adjustNumericToken, containsPoint, geometryKey, formatNumericValue } from './object-editor-geometry.js';
import { t } from './i18n.js';

const $ = id => document.getElementById(id);
const geometry = ['x', 'y', 'width', 'height'];
const clone = value => structuredClone(value);
const svgNS = 'http://www.w3.org/2000/svg';
let rendererLoading;
function loadRenderer() {
  return rendererLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = '/visual/entry.js';
    script.onload = () => window.studio ? resolve() : reject(new Error('Native renderer unavailable'));
    script.onerror = () => reject(new Error('Native renderer unavailable')); document.head.append(script);
  });
}

/** One memory draft; native rendering and accepted edits stay behind their existing APIs. */
export function initObjectEditor(host) {
  let model, preferredId, epoch = 0, renderQueue = Promise.resolve(), gesture, choosing = false;
  const active = () => model && host.getScene()?.id === model.sceneId && host.getScene()?.type === 'composition';
  const selected = () => model?.objects.find(object => object.id === model.selectedId);
  const blocked = () => !active() || host.isBusy() || model.unknown;
  const status = message => { $('visual-status').textContent = t(message); };
  function invalidate() {
    if (!model) return;
    model.ticket = undefined;
    $('scene-preview').pause(); $('scene-preview').hidden = true;
    constraints();
  }
  function markDirty() {
    host.changed(); invalidate();
    status(model.stale ? 'Проект изменён извне. Черновик сохранён; явно перечитайте проект.' : 'Черновик в памяти. Preview, затем явный Apply.');
  }
  function externalChanged(etag) {
    if (!active() || etag === model.etag) return;
    // A pointerdown owns this old base even before its first movement. Never
    // let a clean-looking held gesture acquire another model's fresh ETag.
    if (gesture?.model === model) host.setDirty(true);
    model.stale = true; invalidate();
    status(model.unknown ? model.reconciliationMessage : 'Проект изменён извне. Черновик сохранён; явно перечитайте проект.');
  }
  function constraints() {
    if (!active()) return;
    const unavailable = host.isBusy() || !model.loaded || model.unknown || Boolean(gesture);
    for (const node of $('object-editor').querySelectorAll('input,textarea,select,button')) node.disabled = unavailable;
    $('save-scene').disabled = unavailable || !model.ready || model.stale || !model.ticket || !host.isDirty();
    $('preview-scene').disabled = unavailable || !model.ready || model.stale;
    $('visual-cancel').disabled = host.isBusy();
    $('visual-text-field').hidden = selected()?.type !== 'text';
    $('visual-key-note').hidden = $('visual-mode').value !== 'key';
    $('visual-stage-wrap').setAttribute('aria-busy', String(unavailable));
    $('duration').disabled = host.isBusy() || model.unknown || Boolean(gesture);
    if (model.unknown) {
      // A generic unlock/poll cannot reenable mutations after an unreadable commit reply.
      document.querySelectorAll('button,input,textarea,select').forEach(node => { node.disabled = true; });
      $('reload').disabled = host.isBusy(); $('visual-cancel').disabled = host.isBusy();
      if (choosing && $('visual-dialog').open && !host.isBusy()) { $('visual-dialog-discard').disabled = false; $('visual-dialog-stay').disabled = false; }
    }
  }
  function layout() {
    if (!active() || !model.spec) return;
    const { width, height } = model.spec, available = $('visual-stage-space').clientWidth;
    const scale = Math.min(available / width, 540 / height);
    const wrap = $('visual-stage-wrap'); wrap.style.width = `${width * scale}px`; wrap.style.height = `${height * scale}px`;
    overlay();
  }
  new ResizeObserver(layout).observe($('visual-stage-space'));
  function overlay() {
    const svg = $('visual-overlay'); svg.replaceChildren();
    if (!active() || !model.spec) return;
    svg.setAttribute('viewBox', `0 0 ${model.spec.width} ${model.spec.height}`);
    const object = selected(); if (!object) return;
    const s = sampleObject(object, model.frame), group = document.createElementNS(svgNS, 'g');
    group.setAttribute('transform', `rotate(${s.rotation} ${s.x + s.width / 2} ${s.y + s.height / 2})`);
    const rect = document.createElementNS(svgNS, 'rect');
    for (const key of geometry) rect.setAttribute(key, String(s[key]));
    rect.classList.add('visual-selection'); group.append(rect);
    const scale = $('visual-stage-wrap').getBoundingClientRect().width / model.spec.width;
    for (const [index, [x, y]] of [[s.x, s.y], [s.x + s.width, s.y], [s.x + s.width, s.y + s.height], [s.x, s.y + s.height]].entries()) {
      const handle = document.createElementNS(svgNS, 'circle');
      handle.setAttribute('cx', x); handle.setAttribute('cy', y); handle.setAttribute('r', 6 / Math.max(scale, 0.01));
      handle.dataset.resize = String(index); handle.classList.add('visual-handle'); group.append(handle);
    }
    svg.append(group);
  }
  function fields() {
    const object = selected(); if (!object) return;
    const state = $('visual-mode').value === 'key' ? sampleObject(object, model.frame) : object;
    for (const key of geometry) $(`visual-${key}`).value = formatNumericValue(state[key]);
    $('visual-text').value = object.text ?? '';
    $('visual-selection-name').textContent = `${object.id} · ${object.type}`;
    const duration = host.getPatch().durationFrames;
    $('visual-frame').max = Number.isFinite(duration) ? Math.max(0, duration - 1) : 0;
    $('visual-frame').value = model.frame;
    $('visual-frame-label').textContent = `${model.frame} / ${$('visual-frame').max}`;
    document.querySelectorAll('[data-object-id]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.objectId === model.selectedId)));
    constraints(); overlay();
  }
  function render() {
    if (!active() || !model.spec) return;
    const generation = ++epoch, identity = model;
    model.ready = false; constraints();
    $('stage').dataset.renderRequest = String(generation);
    // initialize and frame share mutable renderer state: serialize, skip obsolete requests.
    renderQueue = renderQueue.catch(() => {}).then(async () => {
      if (model !== identity || generation !== epoch) return;
      const spec = clone(model.spec), scene = spec.scenes.find(item => item.id === model.sceneId);
      const duration = host.getPatch().durationFrames;
      if (!Number.isInteger(duration) || duration < 1 || duration > 1800) { model.ready = false; constraints(); return; }
      scene.objects = clone(model.objects); scene.durationFrames = duration;
      let offset = 0;
      for (const item of spec.scenes) { item.startFrame = offset; offset += item.durationFrames; item.endFrame = offset; }
      spec.totalFrames = offset;
      await loadRenderer();
      if (model !== identity || generation !== epoch) return;
      model.loaded = true;
      await window.studio.initialize(spec);
      if (model !== identity || generation !== epoch) return;
      window.studio.renderFrame(scene.startFrame + model.frame);
      $('stage').dataset.rendered = String(generation);
      $('stage').dataset.localFrame = String(model.frame);
      $('stage').dataset.globalFrame = String(scene.startFrame + model.frame);
      model.ready = true; constraints();
    }).catch(error => { if (model === identity && generation === epoch) { model.ready = false; status(error.message); constraints(); } });
  }
  function layers() {
    $('visual-layers').replaceChildren(...[...model.objects].reverse().map(object => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.objectId = object.id;
      button.textContent = `${object.id} · ${object.type}`; button.onclick = () => void chooseObject(object.id); return button;
    }));
  }
  function sync(scene, state) {
    $('object-editor').hidden = scene.type !== 'composition';
    $('save-scene').textContent = t(scene.type === 'composition' ? 'Применить просмотренную правку' : 'Сохранить сцену');
    if (scene.type !== 'composition') { epoch++; model = undefined; $('save-scene').disabled = host.isBusy(); $('preview-scene').disabled = host.isBusy(); return; }
    if (active() && model.etag === state.etag && host.isDirty()) { fields(); return; }
    const priorId = model?.selectedId ?? preferredId;
    model = { sceneId: scene.id, etag: state.etag, objects: clone(scene.objects), selectedId: scene.objects.some(o => o.id === priorId) ? priorId : scene.objects.at(-1)?.id, frame: 0, ready: false, loaded: false, stale: false, unknown: false };
    const identity = model; epoch++; $('visual-mode').value = 'base'; layers(); fields();
    status('Выберите объект. Base меняет основу, keyframe — геометрию на кадре.');
    void host.api(`/api/visual/state?scene=${encodeURIComponent(scene.id)}`, { headers: { 'If-Match': model.etag } }).then(result => {
      if (model !== identity) return;
      if (result.etag !== model.etag) throw new Error('Stale renderer context');
      model.spec = result.spec; layout(); render();
    }).catch(error => { if (model === identity) { if (error.code === 'PROJECT_CONFLICT') externalChanged('changed'); else status(error.message); } });
  }
  function mutate(patch) {
    if (blocked() || !selected()) return;
    const object = selected();
    const revised = $('visual-mode').value === 'key' ? geometryKey(object, model.frame, patch) : { ...object, ...patch };
    model.objects = model.objects.map(item => item.id === object.id ? revised : item);
    markDirty(); fields(); render();
  }
  for (const key of geometry) {
    const input = $(`visual-${key}`);
    input.onchange = () => {
      const value = Number(input.value);
      if (!input.value || !Number.isFinite(value) || (['width', 'height'].includes(key) && value < 1)) { fields(); return; }
      mutate({ [key]: value });
    };
    input.onkeydown = event => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); const value = adjustNumericToken(input.value, event.key === 'ArrowUp' ? 1 : -1, event);
      if (value !== null) { input.value = value; input.onchange(); }
    };
  }
  $('visual-text').oninput = () => {
    if (blocked() || selected()?.type !== 'text') return;
    const id = model.selectedId;
    model.objects = model.objects.map(object => object.id === id ? { ...object, text: $('visual-text').value } : object);
    markDirty(); render();
  };
  $('visual-frame').oninput = () => {
    if (blocked()) return;
    model.frame = Math.max(0, Math.min(Number($('visual-frame').max), Math.round(Number($('visual-frame').value))));
    invalidate(); fields(); render();
  };
  $('visual-mode').onchange = () => { if (!blocked()) { invalidate(); fields(); render(); } };
  const point = event => {
    const rect = $('visual-stage-wrap').getBoundingClientRect();
    return { x: (event.clientX - rect.left) * model.spec.width / rect.width, y: (event.clientY - rect.top) * model.spec.height / rect.height };
  };
  async function chooseObject(id) {
    if (blocked() || model.selectedId === id) return;
    if (host.isDirty() && !await resolveContext()) return;
    if (!active() || !model.objects.some(item => item.id === id)) return;
    model.selectedId = id; invalidate(); fields();
  }
  $('visual-overlay').onpointerdown = event => {
    if (blocked() || !model.ready || event.button !== 0) return;
    const p = point(event), resizing = event.target.dataset.resize !== undefined;
    const hit = resizing ? selected() : [...model.objects].reverse().find(object => { const s = sampleObject(object, model.frame); return s.opacity > 0 && (object.type !== 'text' || s.reveal > 0) && containsPoint(s, p); });
    if (!hit) return;
    if (model.selectedId !== hit.id) {
      if (host.isDirty()) { void chooseObject(hit.id); return; }
      model.selectedId = hit.id; invalidate(); fields();
    }
    // Base geometry gestures are defined at frame zero; animated-position gestures use key mode.
    if ($('visual-mode').value === 'base' && (model.frame !== 0 || hit.keyframes?.some(key => key.frame === 0 && geometry.some(name => key[name] !== undefined)))) { status('Для жеста на этом кадре выберите keyframe или вернитесь на кадр 0.'); return; }
    const s = sampleObject(hit, model.frame);
    gesture = { model, etag: model.etag, objectId: hit.id, frame: model.frame, mode: $('visual-mode').value, pointerId: event.pointerId, start: p, state: s, objects: clone(model.objects), dirty: host.isDirty(), scalarJSON: JSON.stringify(host.getPatch()), resizing };
    invalidate(); event.preventDefault(); $('visual-overlay').setPointerCapture(event.pointerId);
  };
  $('visual-overlay').onpointermove = event => {
    if (!gesture || blocked()) return;
    if (gesture.model !== model || gesture.etag !== model.etag || gesture.objectId !== model.selectedId || gesture.frame !== model.frame || gesture.mode !== $('visual-mode').value) { endGesture(true); return; }
    const p = point(event), g = gesture, s = g.state;
    if (g.resizing) {
      const center = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
      const size = resolveCenterResizeSize({ baseWidth: s.width, baseHeight: s.height, pointer: p, pointerStart: g.start, centerStart: center });
      mutate({ x: center.x - size.width / 2, y: center.y - size.height / 2, ...size });
    } else mutate({ x: s.x + p.x - g.start.x, y: s.y + p.y - g.start.y });
  };
  function endGesture(cancel) {
    if (!gesture) return;
    const priorGesture = gesture, pointerId = gesture.pointerId; gesture = undefined;
    if (cancel && model === priorGesture.model && model.etag === priorGesture.etag) { model.objects = priorGesture.objects; host.setDirty(priorGesture.dirty || model.stale || priorGesture.scalarJSON !== JSON.stringify(host.getPatch())); invalidate(); fields(); render(); }
    if ($('visual-overlay').hasPointerCapture(pointerId)) $('visual-overlay').releasePointerCapture(pointerId);
    constraints();
  }
  $('visual-overlay').onpointerup = () => endGesture(false);
  $('visual-overlay').onpointercancel = () => endGesture(true);
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && gesture) { event.preventDefault(); endGesture(true); } });
  function scalarChanged() {
    if (!active()) return;
    const duration = host.getPatch().durationFrames;
    invalidate(); model.frame = Number.isFinite(duration) ? Math.min(model.frame, Math.max(0, duration - 1)) : 0; fields(); render();
  }
  async function preview() {
    if (!active() || gesture || model.stale || model.unknown) return;
    invalidate();
    const identity = model, frozen = { baseETag: model.etag, action: { type: 'edit-scene', sceneId: model.sceneId, patch: { ...host.validatePatch(), objects: clone(model.objects) } } };
    const actionJSON = JSON.stringify(frozen.action);
    try {
      const result = await host.api('/api/visual/preview', { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': frozen.baseETag }, body: actionJSON });
      if (model !== identity) return;
      if (result.stale || !result.previewId || result.projectHash !== model.etag) { externalChanged('changed'); return; }
      model.ticket = { actionJSON, baseETag: frozen.baseETag, previewId: result.previewId };
      $('scene-preview').src = result.url; $('scene-preview').hidden = false;
      $('preview-status').textContent = t('Preview готов. Посмотрите его и явно примените эту правку.');
      status('Preview готов. Посмотрите его и явно примените эту правку.');
    } catch (error) { if (error.code === 'PROJECT_CONFLICT') externalChanged('changed'); else host.notice(error.message, true); }
  }
  async function apply() {
    if (!active() || gesture || model.stale || model.unknown || !model.ticket || !host.isDirty()) return false;
    const ticket = model.ticket; model.ticket = undefined;
    try {
      const result = await host.api('/api/visual/apply', { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': ticket.baseETag }, body: JSON.stringify({ previewId: ticket.previewId, action: JSON.parse(ticket.actionJSON) }) });
      const before = host.getManifest(), action = JSON.parse(ticket.actionJSON), expectedScenes = before.scenes.map(scene => scene.id === action.sceneId ? { ...scene, ...action.patch } : scene);
      if (result?.committed !== true || !/^[a-f0-9]{64}$/.test(result.etag ?? '') || result.etag === ticket.baseETag || typeof result.manifest?.revision !== 'string' || result.manifest.revision === before.revision || !Array.isArray(result.manifest.history)) throw new Error('Unreadable commit response');
      if (JSON.stringify(result.manifest.scenes) !== JSON.stringify(expectedScenes) || ['id', 'seed', 'schemaVersion', 'video', 'brand', 'audio', 'assets', 'operationReceipts'].some(key => JSON.stringify(result.manifest[key]) !== JSON.stringify(before[key]))) throw new Error('Commit response does not match the previewed edit');
      host.accepted(result); host.notice(t('Просмотренная правка принята. История и исходники сохранены.')); return true;
    } catch (error) {
      if (error.code === 'PROJECT_CONFLICT') externalChanged('changed');
      else if (error.committed === true && error.code === 'INTERNAL_ERROR' && error.details?.stage === 'project') {
        model.unknown = true;
        model.reconciliationMessage = `${t('Правка принята, но чтение результата не удалось. Не повторяйте её; явно перечитайте проект.')} ${error.message}`;
        status(model.reconciliationMessage);
      } else if (!error.code || error.code === 'VISUAL_COMMIT_OUTCOME_UNKNOWN') {
        model.unknown = true; model.reconciliationMessage = t('Исход Apply неизвестен. Не повторяйте правку; явно перечитайте проект.'); status(model.reconciliationMessage);
      } else host.notice(error.message, true);
      constraints(); return false;
    }
  }
  function choice(reopen = false) {
    if (choosing) return Promise.resolve('stay');
    choosing = true;
    const dialog = $('visual-dialog');
    $('visual-dialog-note').textContent = t(reopen ? 'Перечитать принятую версию с диска и отбросить этот черновик?' : 'Есть черновик. Примените просмотренную правку, отмените черновик или останьтесь.');
    $('visual-dialog-apply').hidden = reopen;
    $('visual-dialog-apply').disabled = !model?.ticket || model.stale || model.unknown;
    $('visual-dialog-discard').disabled = false; $('visual-dialog-stay').disabled = false;
    dialog.showModal();
    return new Promise(resolve => {
      const finish = value => { choosing = false; dialog.close(); resolve(value); };
      $('visual-dialog-apply').onclick = () => finish('apply'); $('visual-dialog-discard').onclick = () => finish('discard'); $('visual-dialog-stay').onclick = () => finish('stay');
      dialog.oncancel = event => { event.preventDefault(); finish('stay'); };
    });
  }
  async function resolveContext() {
    if (gesture) endGesture(true);
    if (!active() || (!host.isDirty() && !model.unknown && !model.stale)) return true;
    const answer = await choice(model.stale || model.unknown);
    if (answer === 'apply') { await host.task(apply); return !host.isDirty(); }
    if (answer === 'discard') {
      if (model.stale || model.unknown) { await host.task(host.reopen); return !host.isDirty(); }
      host.discard(); return true;
    }
    return false;
  }
  async function reopen() {
    if (!active()) return false;
    if (!host.isDirty() && !model.unknown) { await host.task(host.reopen); return true; }
    if (await choice(true) === 'discard') await host.task(host.reopen);
    return true;
  }
  $('visual-cancel').onclick = () => void reopen();
  return { active, sync, constraints, externalChanged, scalarChanged, preview, apply, resolveContext, reopen, invalidate, hasGesture: () => Boolean(gesture), reset: () => { endGesture(false); epoch++; preferredId = model?.selectedId; model = undefined; }, isUnknown: () => active() && model.unknown };
}
