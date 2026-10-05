const $ = id => document.getElementById(id);
let state, selected, busy = false, dirty = false, jobTimer, formBase, conflict;
const formIds = ['duration', 'scene-text', 'scene-label', 'scene-caption', 'scene-highlight', 'scene-asset', 'trim', 'fit', 'focal-x', 'focal-y'];
const formValues = () => Object.fromEntries(formIds.map(id => [id, $(id).value]));
const draftKey = () => `studio-draft:${state.projectPath}`;
const captureDraft = () => ({ sceneId: selected, etag: state.etag, base: formBase, values: formValues(), scene: current() });
function rememberDraft() { try { sessionStorage.setItem(draftKey(), JSON.stringify(captureDraft())); } catch { notice('Черновик остаётся в памяти. Не закрывайте вкладку: хранилище браузера недоступно.', true); } }
function forgetDraft() { sessionStorage.removeItem(draftKey()); dirty = false; }
const types = { video: 'Видео', kinetic_title: 'Motion-титр', product_zoom: 'Изображение', cta: 'Финальный титр' };
const fmt = number => Number(number.toFixed(3)).toString();
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
function notice(text, error = false) { $('notice').textContent = text; $('notice').classList.toggle('error', error); }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(state ? { 'If-Match': state.etag } : {}), ...options.headers } });
  const result = await response.json();
  if (!response.ok) { const error = new Error(typeof result.error === 'string' ? result.error : result.error?.message ?? JSON.stringify(result)); error.code = result.error?.code; throw error; }
  return result;
}
const post = (path, data) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
function lock(value) { busy = value; document.querySelectorAll('button,input,textarea,select').forEach(node => { node.disabled = value; }); }
async function task(fn) {
  if (busy) return;
  lock(true);
  try { await fn(); } catch (error) { if (error.code === 'PROJECT_CONFLICT' && dirty) { try { await showConflict(captureDraft(), await api('/api/state')); } catch (readError) { notice(readError.message, true); } } else notice(error.message, true); }
  finally { lock(false); if (state) setSceneConstraints(); }
}
const current = () => state.manifest.scenes.find(scene => scene.id === selected);
function previousScene() {
  const scene = current();
  return [...(state.manifest.history ?? [])].reverse().find(revision => {
    const prior = revision.scenes.find(item => item.id === selected);
    return prior && JSON.stringify(prior) !== JSON.stringify(scene);
  });
}
function setSceneConstraints() {
  $('restore-scene').disabled = !previousScene();
  $('remove-scene').disabled = state.manifest.scenes.length <= 1;
  const index = state.manifest.scenes.findIndex(scene => scene.id === selected);
  $('move-left').disabled = index === 0; $('move-right').disabled = index === state.manifest.scenes.length - 1;
  if (conflict) $('conflict-local').disabled = !conflict.fresh.manifest.scenes.some(scene => scene.id === conflict.draft.sceneId && scene.type === conflict.draft.scene.type);
}
async function refresh() { state = await api('/api/state'); selected = state.manifest.scenes.some(scene => scene.id === selected) ? selected : state.manifest.scenes[0].id; paint(); }
async function edit(action) { await post('/api/edit', action); forgetDraft(); await refresh(); notice('Сохранено в project.json. Исходные материалы сохранены.'); }
function mediaNode(scene, controls = false) {
  const asset = state.manifest.assets[scene.asset];
  if (!asset) return el('div', scene.text ?? scene.caption ?? '', 'text-source');
  const node = el(asset.type === 'video' ? 'video' : 'img');
  node.src = `/media/${encodeURIComponent(scene.asset)}`;
  if (asset.type === 'video') { node.muted = true; node.controls = controls; node.preload = 'metadata'; node.playsInline = true; node.addEventListener('loadedmetadata', () => { node.currentTime = scene.trimStartSeconds ?? 0; }, { once: true }); }
  else node.alt = asset.name ?? scene.id;
  return node;
}
function fillSelect(node, entries, value) { node.replaceChildren(...entries.map(([id, name]) => { const option = el('option', name); option.value = id; return option; })); node.value = value ?? ''; }
function paint() {
  const m = state.manifest, total = m.scenes.reduce((sum, scene) => sum + scene.durationFrames, 0);
  $('project-title').textContent = m.id;
  $('project-path').textContent = state.projectPath;
  $('stats').textContent = `${m.scenes.length} сцены · ${fmt(total / 30)} с · ${m.video.aspectRatio} · 30 fps`;
  $('aspect').value = m.video.aspectRatio;
  let frame = 0;
  $('storyboard').replaceChildren(...m.scenes.map((scene, index) => {
    const start = frame / 30; frame += scene.durationFrames;
    const card = el('button', undefined, `scene-card${scene.id === selected ? ' selected' : ''}`); card.dataset.sceneId = scene.id;
    card.setAttribute('aria-label', `Сцена ${index + 1}: ${scene.id}`); card.setAttribute('aria-pressed', String(scene.id === selected));
    const thumb = el('div', undefined, 'thumb');
    if (scene.asset) thumb.append(mediaNode(scene)); else thumb.append(el('div', scene.text, 'title-thumb'));
    thumb.append(el('span', String(index + 1).padStart(2, '0'), 'scene-number'));
    const info = el('div', undefined, 'card-info'); info.append(el('strong', scene.id), el('small', `${types[scene.type]} · ${fmt(scene.durationFrames / 30)} с`)); card.append(thumb, info);
    card.onclick = () => task(async () => { if (dirty) await saveScene(); selected = scene.id; paintScene(); document.querySelectorAll('.scene-card').forEach(node => { node.classList.toggle('selected', node.dataset.sceneId === selected); node.setAttribute('aria-pressed', String(node.dataset.sceneId === selected)); }); if ($('player').src) $('player').currentTime = start; });
    return card;
  }));
  paintScene(); paintExports();
  const assets = Object.entries(m.assets);
  $('library').replaceChildren(...assets.map(([id, asset]) => {
    const row = el('div', undefined, 'asset-row'), text = el('div'), meta = state.metadata[id];
    text.append(el('strong', asset.name ?? asset.path), el('small', `${asset.type.toUpperCase()} · ${(meta.bytes / 1024 / 1024).toFixed(1)} MB${meta.durationSeconds ? ` · ${fmt(meta.durationSeconds)} с` : ''}${meta.sourceFps ? ` · ${fmt(meta.sourceFps)} fps` : ''}`)); row.append(text);
    if (asset.type !== 'audio') { const add = el('button', 'В сцену +'); add.dataset.addAsset = id; add.onclick = () => task(async () => { if (dirty) await saveScene(); const scene = { id: `shot-${crypto.randomUUID().slice(0, 8)}`, type: asset.type === 'video' ? 'video' : 'product_zoom', asset: id, durationFrames: asset.type === 'video' ? Math.min(150, Math.floor(meta.durationSeconds * 30)) : 150, fit: 'cover', ...(asset.type === 'image' ? { caption: 'Новый кадр' } : { trimStartSeconds: 0 }) }; await edit({ type: 'add-scene', scene }); selected = scene.id; paint(); }); row.append(add); }
    return row;
  }));
  fillSelect($('music'), [['', 'Без музыки'], ['__procedural', 'Процедурная музыка'], ...assets.filter(([, asset]) => asset.type === 'audio').map(([id, asset]) => [id, asset.name ?? id])], m.audio.music.provider === 'procedural' ? '__procedural' : m.audio.music.asset);
  $('gain').value = m.audio.music.gainDb ?? -12;
  $('history').replaceChildren(...[...(m.history ?? [])].reverse().map(revision => {
    const row = el('div', undefined, 'history-row'); row.append(el('span', `${revision.label} · ${new Date(revision.createdAt).toLocaleTimeString()}`));
    const button = el('button', 'Вернуть монтаж'); button.onclick = () => task(async () => { if (dirty) await saveScene(); await edit({ type: 'restore', revisionId: revision.id }); }); row.append(button); return row;
  }));
}
function paintScene() {
  const scene = current(); dirty = false;
  $('selection-title').textContent = `${state.manifest.scenes.indexOf(scene) + 1}. ${types[scene.type]}`;
  $('source-preview').replaceChildren(mediaNode(scene, true));
  $('duration').value = fmt(scene.durationFrames / 30);
  const isAsset = scene.type === 'video' || scene.type === 'product_zoom';
  $('text-fields').hidden = isAsset; $('asset-fields').hidden = !isAsset;
  $('label-field').hidden = scene.type !== 'cta'; $('highlight-field').hidden = scene.type !== 'kinetic_title'; $('caption-field').hidden = scene.type !== 'product_zoom'; $('trim-field').hidden = scene.type !== 'video';
  $('scene-text').value = scene.text ?? ''; $('scene-label').value = scene.label ?? ''; $('scene-caption').value = scene.caption ?? '';
  $('scene-highlight').value = scene.highlight ?? '';
  fillSelect($('scene-asset'), Object.entries(state.manifest.assets).filter(([, asset]) => asset.type === (scene.type === 'video' ? 'video' : 'image')).map(([id, asset]) => [id, asset.name ?? id]), scene.asset);
  $('trim').value = scene.trimStartSeconds ?? 0; $('fit').value = scene.fit ?? 'cover'; $('focal-x').value = scene.focalPoint?.x ?? 0.5; $('focal-y').value = scene.focalPoint?.y ?? 0.5;
  formBase = formValues(); $('draft-status').textContent = 'Все изменения сохранены'; setSceneConstraints();
  invalidatePreview();
}
function paintExports() {
  const selectedExport = $('exports').value;
  fillSelect($('exports'), state.exports.map((item, index) => [item.id, `${index === 0 ? 'Последний · ' : ''}${new Date(Number(item.id.split('-')[0])).toLocaleTimeString()} · ${item.duration} с`]), state.exports.some(item => item.id === selectedExport) ? selectedExport : state.exports[0]?.id);
  showExport();
}
function showExport() {
  const item = state.exports.find(value => value.id === $('exports').value);
  $('empty-player').hidden = Boolean(item); $('player').style.display = item ? 'block' : 'none'; $('download').hidden = !item;
  if (item) {
    if ($('player').getAttribute('src') !== item.url) $('player').src = item.url;
    $('download').href = item.url;
    $('export-state').textContent = item.projectHash === state.etag ? 'Текущая версия' : 'Предыдущая версия · нужен экспорт';
  } else { $('player').removeAttribute('src'); $('export-state').textContent = 'Нет экспорта'; }
}
function scenePatch() {
  if (!$('scene-form').reportValidity()) throw new Error('Проверьте поля сцены.');
  const scene = current(), patch = { durationFrames: Math.round(Number($('duration').value) * 30) };
  if (scene.type === 'video' || scene.type === 'product_zoom') {
    Object.assign(patch, { asset: $('scene-asset').value, fit: $('fit').value, focalPoint: { x: Number($('focal-x').value), y: Number($('focal-y').value) } });
    if (scene.type === 'video') patch.trimStartSeconds = Number($('trim').value); else patch.caption = $('scene-caption').value;
  } else { patch.text = $('scene-text').value; if (scene.type === 'cta') patch.label = $('scene-label').value; else patch.highlight = $('scene-highlight').value || null; }
  return patch;
}
function changedPatch(draft, patch) {
  const fields = { durationFrames: ['duration'], text: ['scene-text'], label: ['scene-label'], caption: ['scene-caption'], highlight: ['scene-highlight'], asset: ['scene-asset'], trimStartSeconds: ['trim'], fit: ['fit'], focalPoint: ['focal-x', 'focal-y'] };
  return Object.fromEntries(Object.entries(patch).filter(([key]) => fields[key].some(id => draft.base[id] !== draft.values[id])));
}
async function saveScene() { await edit({ type: 'edit-scene', sceneId: selected, patch: changedPatch(captureDraft(), scenePatch()) }); }
function applyDraft(draft) {
  for (const id of formIds) $(id).value = draft.values[id];
  formBase = draft.base; dirty = true; $('draft-status').textContent = 'Есть несохранённые изменения';
  if (state.manifest.assets[$('scene-asset').value]) $('source-preview').replaceChildren(mediaNode({ ...current(), asset: $('scene-asset').value }, true));
  invalidatePreview();
}
async function showConflict(draft, fresh) {
  conflict = { draft, fresh }; rememberDraft();
  const external = fresh.manifest.scenes.find(scene => scene.id === draft.sceneId);
  const names = { duration: 'Длительность, с', 'scene-text': 'Текст', 'scene-label': 'Подпись', 'scene-caption': 'Титр', 'scene-highlight': 'Выделение', 'scene-asset': 'Исходник', trim: 'Начало, с', fit: 'Кадрирование', 'focal-x': 'Фокус X', 'focal-y': 'Фокус Y' };
  const externalValues = external ? { duration: fmt(external.durationFrames / 30), 'scene-text': external.text ?? '', 'scene-label': external.label ?? '', 'scene-caption': external.caption ?? '', 'scene-highlight': external.highlight ?? '', 'scene-asset': external.asset ?? '', trim: String(external.trimStartSeconds ?? 0), fit: external.fit ?? 'cover', 'focal-x': String(external.focalPoint?.x ?? .5), 'focal-y': String(external.focalPoint?.y ?? .5) } : {};
  const table = el('table'), head = el('tr'); for (const title of ['Поле', 'Ваш черновик', 'На диске']) head.append(el('th', title)); table.append(head);
  for (const id of formIds.filter(id => draft.base[id] !== draft.values[id])) { const row = el('tr'); const display = value => id === 'scene-asset' ? fresh.manifest.assets[value]?.name ?? value : value; row.append(el('td', names[id]), el('td', display(draft.values[id])), el('td', external ? display(externalValues[id]) : 'Сцена удалена')); table.append(row); }
  $('conflict-details').replaceChildren(table);
  $('conflict-note').textContent = external?.type === draft.scene.type ? 'Применятся только поля, изменённые вами. Остальные внешние изменения останутся; версия с диска попадёт в историю.' : 'Сцена удалена или её тип изменён. Автоматически применить черновик нельзя. Его можно оставить в редакторе или явно отбросить.';
  if (!$('conflict-dialog').open) $('conflict-dialog').showModal(); notice('Выберите способ разрешения конфликта. Черновик и версия на диске сохранены.');
}
async function resolveConflict(useLocal) {
  const { draft, fresh } = conflict, latest = await api('/api/state');
  if (latest.etag !== fresh.etag) { await showConflict(draft, latest); notice('Проект снова изменён извне. Проверьте обновлённое сравнение.', true); return; }
  if (useLocal) {
    const patch = changedPatch(draft, scenePatch());
    if (patch.focalPoint) {
      const external = fresh.manifest.scenes.find(scene => scene.id === draft.sceneId).focalPoint ?? { x: .5, y: .5 };
      for (const axis of ['x', 'y']) if (draft.base[`focal-${axis}`] === draft.values[`focal-${axis}`]) patch.focalPoint[axis] = external[axis];
    }
    await api('/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': fresh.etag }, body: JSON.stringify({ type: 'edit-scene', sceneId: draft.sceneId, patch }) });
  }
  forgetDraft(); conflict = undefined; $('conflict-dialog').close(); await refresh(); notice(useLocal ? 'Черновик применён. Внешняя версия сохранена в истории.' : 'Принята внешняя версия. Черновик отброшен по вашему выбору.');
}
$('conflict-local').onclick = () => task(() => resolveConflict(true));
$('conflict-external').onclick = () => task(() => resolveConflict(false));
$('conflict-cancel').onclick = () => { conflict = undefined; $('conflict-dialog').close(); notice('Черновик остаётся в редакторе. Проект на диске не изменён.'); };
$('conflict-dialog').oncancel = () => { conflict = undefined; };
function invalidatePreview() {
  $('scene-preview').pause(); $('scene-preview').hidden = true;
  $('preview-status').textContent = 'Соберите предпросмотр выбранной сцены: 1080p/30 fps, без звука, без сохранения проекта. Не realtime; проекты с озвучкой/субтитрами пока требуют полного экспорта.';
  const frames = Math.round(Number($('duration').value) * 30), start = current().type === 'video' ? Number($('trim').value) : 0;
  $('preview-bounds').textContent = Number.isFinite(frames) && Number.isFinite(start) ? `${frames} кадров · ${fmt(frames / 30)} с${current().type === 'video' ? ` · источник ${fmt(start)}–${fmt(start + frames / 30)} с (правая граница исключена)` : ''}` : 'Проверьте длительность и начало.';
}
$('preview-scene').onclick = () => task(async () => {
  const patch = scenePatch(); notice('Собирается только выбранная сцена из текущих полей…');
  const result = await post('/api/preview', { type: 'edit-scene', sceneId: selected, patch });
  $('scene-preview').src = result.url; $('scene-preview').hidden = false;
  $('preview-status').textContent = result.stale ? 'Проект изменён извне во время рендера. Это предпросмотр прежней версии; перечитайте проект.' : `Предпросмотр готов · ${result.totalFrames} кадров · ${fmt(result.durationSeconds)} с · без звука. Черновик не сохранён.`;
  notice(result.stale ? 'Предпросмотр готов, но проект изменился извне. Перечитайте проект.' : 'Предпросмотр готов. Посмотрите отрезок, затем сохраните сцену или продолжите правку.');
});
$('scene-form').oninput = () => { dirty = true; rememberDraft(); invalidatePreview(); $('draft-status').textContent = 'Есть несохранённые изменения'; };
$('scene-form').onsubmit = event => { event.preventDefault(); void task(saveScene); };
$('scene-asset').onchange = () => { const scene = { ...current(), asset: $('scene-asset').value }; $('source-preview').replaceChildren(mediaNode(scene, true)); };
$('reload').onclick = () => task(async () => { if (dirty) { const fresh = await api('/api/state'); if (fresh.etag !== state.etag) await showConflict(captureDraft(), fresh); else notice('На диске нет новых изменений. Ваш черновик остаётся в редакторе.'); } else { await refresh(); notice('Проект перечитан с диска.'); } });
$('restore-scene').onclick = () => task(async () => { if (dirty) await saveScene(); const prior = previousScene(); if (prior) await edit({ type: 'restore-scene', sceneId: selected, revisionId: prior.id }); });
$('remove-scene').onclick = () => task(async () => { if (dirty) await saveScene(); await edit({ type: 'remove-scene', sceneId: selected }); });
for (const [id, offset] of [['move-left', -1], ['move-right', 1]]) $(id).onclick = () => task(async () => { if (dirty) await saveScene(); await edit({ type: 'move-scene', sceneId: selected, index: state.manifest.scenes.findIndex(scene => scene.id === selected) + offset }); });
$('aspect').onchange = () => task(async () => { const aspectRatio = $('aspect').value; if (dirty) await saveScene(); await edit({ type: 'composition', video: { ...state.manifest.video, aspectRatio } }); });
$('add-title').onclick = () => task(async () => { if (dirty) await saveScene(); const scene = { id: `title-${crypto.randomUUID().slice(0, 8)}`, type: 'kinetic_title', durationFrames: 120, text: 'Новый титр' }; await edit({ type: 'add-scene', scene }); selected = scene.id; paint(); });
$('save-music').onclick = () => task(async () => { const choice = $('music').value, gainDb = Number($('gain').value); if (dirty) await saveScene(); await edit({ type: 'music', ...(choice === '__procedural' ? { provider: 'procedural' } : { asset: choice || undefined }), gainDb }); });
$('import').onchange = () => task(async () => {
  if (dirty) await saveScene();
  for (const file of Array.from($('import').files)) {
    notice(`Импорт: ${file.name}`);
    await api(`/api/import?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }); await refresh();
  }
  $('import').value = ''; notice('Материалы импортированы. Добавьте их в сцены или выберите музыкальную дорожку.');
});
$('exports').onchange = showExport;
async function pollJob() {
  clearTimeout(jobTimer);
  try {
    const job = await api('/api/job');
    if (job.status === 'running') { lock(true); notice(`Экспорт выполняется · ${job.progress}`); jobTimer = setTimeout(pollJob, 1000); }
    else { lock(false); await refresh(); if (job.status === 'complete') { $('exports').value = job.exportId; showExport(); notice('MP4 готов: параметры и полное декодирование проверены.'); } else if (job.status === 'failed') notice(`Экспорт не выполнен. ${job.error?.error?.message ?? 'Ошибка рендера'}. Прежние экспорты сохранены.`, true); }
  } catch (error) { lock(false); notice(`Связь с локальной студией прервана: ${error.message}. Перезапустите CLI и откройте новую ссылку сессии.`, true); }
}
$('export').onclick = () => task(async () => { if (dirty) await saveScene(); await post('/api/export', {}); notice('Начался экспорт. Можно просматривать предыдущий MP4.'); jobTimer = setTimeout(pollJob, 100); });
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
try {
  if (location.hash.length > 1) { await post('/api/session', { token: location.hash.slice(1) }); history.replaceState(null, '', '/'); }
  await refresh(); notice('Проект открыт. Изменения сохраняются локально.');
  const stored = sessionStorage.getItem(draftKey());
  if (stored) { const draft = JSON.parse(stored); if (state.manifest.scenes.some(scene => scene.id === draft.sceneId)) { selected = draft.sceneId; paint(); applyDraft(draft); if (draft.etag !== state.etag) await showConflict(draft, state); else notice('Восстановлен несохранённый черновик этой вкладки.'); } else { selected = draft.sceneId; state.manifest.scenes.push(draft.scene); paint(); applyDraft(draft); await showConflict(draft, await api('/api/state')); } }
  if (state.job.status === 'running') void pollJob();
} catch (error) { notice(error.message, true); }
