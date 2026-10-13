import type { Manifest, Scene } from '../src/types.js';
import type { ProjectState } from './object-editor-types.js';
import type { StyleAction, StyleAudit, StyleField, StyleGroup, StyleID, StylePackage, StyleRequest, StyleRole } from '../src/style-types.js';
import { t } from './i18n.js';

type Phase = 'idle' | 'editing' | 'previewing' | 'ready' | 'applying' | 'stale' | 'unknown';
interface Host {
  getState(): ProjectState;
  getScene(): Scene;
  isBusy(): boolean;
  isDirty(): boolean;
  isVisual(): boolean;
  hasBlockedEdit(): boolean;
  resolveVisual(): Promise<boolean>;
  reread(sceneId?: string): Promise<void>;
  accepted(result: ProjectState, sceneId: string): void;
  api(path: string, options?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<unknown>;
  task(operation: () => Promise<void>): Promise<void>;
  styleTask(operation: () => Promise<void>): Promise<void>;
  notice(message: string, error?: boolean): void;
  updateControls(): void;
}
interface Intent {
  mode: 'create' | 'restyle'; sceneId: string; objectId?: string;
  before: Manifest; etag: string; submitted: boolean; generation: number;
  request?: StyleRequest; action?: StyleAction; previewId?: string;
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function node<T extends HTMLElement>(id: string, constructor: {new(): T}): T {
  const value = document.getElementById(id);
  if (!(value instanceof constructor)) throw new Error(`Missing style element: ${id}`);
  return value;
}
function matchesReply(value: unknown, intent: Intent): value is ProjectState {
  if (!record(value) || value.committed !== true || typeof value.etag !== 'string' || !/^[a-f0-9]{64}$/.test(value.etag) || value.etag === intent.etag || !record(value.manifest) || !intent.action) return false;
  const manifest = value.manifest, before = intent.before;
  if (!Array.isArray(manifest.history) || !manifest.history.length || manifest.history.length > (before.history?.length ?? 0) + 1) return false;
  const last = manifest.history.at(-1), priorCount = manifest.history.length - 1;
  if (!record(last) || typeof last.id !== 'string' || !last.id || (before.revision && last.id !== before.revision) || last.label !== intent.action.type || typeof last.createdAt !== 'string' || !Number.isFinite(Date.parse(last.createdAt))) return false;
  if (!(['scenes','video','audio','brand'] as const).every(key => JSON.stringify(last[key]) === JSON.stringify(before[key]))) return false;
  if (JSON.stringify(manifest.history.slice(0,-1)) !== JSON.stringify(priorCount ? (before.history ?? []).slice(-priorCount) : [])) return false;
  const scenes = structuredClone(before.scenes), action = intent.action;
  if (action.type === 'add-scene') scenes.push(action.scene);
  else { const index = scenes.findIndex(scene => scene.id === action.sceneId); if (index < 0) return false; scenes[index] = {...scenes[index], ...action.patch} as Scene; }
  return manifest.schemaVersion === 2 && typeof manifest.revision === 'string' && manifest.revision !== before.revision
    && JSON.stringify(manifest.scenes) === JSON.stringify(scenes)
    && (['id','seed','video','brand','audio','assets','operationReceipts'] as const).every(key => JSON.stringify(manifest[key]) === JSON.stringify(before[key]));
}

/** Styles compile to ordinary native actions; preview tickets never publish a draft. */
export function initStyleUI(host: Host) {
  const createButton = node('style-create', HTMLButtonElement), restyleButton = node('style-restyle', HTMLButtonElement);
  const dialog = node('style-dialog', HTMLDialogElement), select = node('style-choice', HTMLSelectElement);
  const previewButton = node('style-preview', HTMLButtonElement), applyButton = node('style-apply', HTMLButtonElement);
  const cancelButton = node('style-cancel', HTMLButtonElement), readButton = node('style-read', HTMLButtonElement);
  const reconcileButton = node('style-reconcile', HTMLButtonElement), note = node('style-status', HTMLElement);
  const dialogNote = node('style-dialog-note', HTMLElement), rolesNode = node('style-roles', HTMLElement);
  const player = node('style-player', HTMLVideoElement), auditNode = node('style-audit', HTMLElement);
  const replace = node('style-replace-tracks', HTMLInputElement), motion = node('style-motion', HTMLSelectElement);
  let phase: Phase = 'idle', intent: Intent | undefined, opening = false;
  let packages: StylePackage[] = [];
  const blocksWrites = () => phase !== 'idle';
  const captionLimit = 'Restyle пока недоступен для композиций с captions. Обычные правки объектов и предпросмотр сцены доступны. Озвучка без captions и музыка поддерживаются.';
  function constraints() {
    const busy = host.isBusy(), scene = host.getState() && host.getScene();
    if (blocksWrites()) document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>('button,input,textarea,select').forEach(control => { control.disabled = true; });
    const manifest = host.getState()?.manifest;
    const limit = manifest && (manifest.scenes.length >= 12 || manifest.scenes.reduce((sum,scene) => sum+scene.durationFrames,0)+120 > 1800);
    createButton.disabled = busy || opening || blocksWrites() || host.hasBlockedEdit() || Boolean(limit);
    restyleButton.disabled = busy || opening || blocksWrites() || host.hasBlockedEdit() || scene?.type !== 'composition' || Boolean(scene.captions?.length);
    restyleButton.title = scene?.captions?.length ? t(captionLimit) : t('Изменить разрешённые группы выбранной композиции');
    const editable = !busy && (phase === 'editing' || phase === 'ready');
    dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach(control => { control.disabled = !editable; });
    previewButton.disabled = !editable;
    applyButton.disabled = busy || phase !== 'ready' || !intent?.previewId || intent.submitted;
    cancelButton.disabled = busy || !editable || Boolean(intent?.submitted);
    readButton.hidden = phase !== 'stale' && phase !== 'unknown'; readButton.disabled = busy || readButton.hidden;
    reconcileButton.hidden = readButton.hidden; reconcileButton.disabled = busy || readButton.hidden;
    if (!readButton.hidden) node('reload', HTMLButtonElement).disabled = busy;
  }
  function update() { host.updateControls(); constraints(); }
  function message(text: string, error = false) { dialogNote.textContent = text; note.textContent = text; host.notice(text,error); update(); }
  function clearPreview() {
    if (intent) { intent.generation++; intent.previewId = undefined; intent.action = undefined; intent.request = undefined; }
    player.pause(); player.hidden = true; player.removeAttribute('src'); auditNode.replaceChildren();
  }
  function changed() { if (phase !== 'editing' && phase !== 'ready') return; clearPreview(); phase = 'editing'; message(t('Параметры изменены. Соберите новый preview перед применением.')); }
  function close() { if (dialog.open) dialog.close(); }
  function cancel() {
    if (host.isBusy() || !intent || intent.submitted || (phase !== 'editing' && phase !== 'ready')) return;
    clearPreview(); intent = undefined; phase = 'idle'; close(); message(t('Предпросмотр стиля отменён. Проект не изменён.'));
  }
  function inputRequest(original: Intent): StyleRequest {
    const groups = original.mode === 'create' ? ['layout','typography','motion'] as StyleGroup[] : [...dialog.querySelectorAll<HTMLInputElement>('[data-style-group]:checked')].map(control => control.value as StyleGroup);
    const roles: Record<string,StyleRole> = {}, protectedFields: Record<string,(StyleField|'*')[]> = {};
    if (original.mode === 'create') roles[original.objectId!] = 'headline';
    else for (const row of rolesNode.querySelectorAll<HTMLElement>('[data-style-object]')) {
      const id = row.dataset.styleObject!;
      const role = row.querySelector<HTMLSelectElement>('[data-style-role]')!.value;
      if (!role) throw new Error(t('Укажите роль каждого объекта.'));
      roles[id] = role as StyleRole;
      const locks = [...row.querySelector<HTMLSelectElement>('[data-style-locks]')!.selectedOptions].map(option => option.value as StyleField|'*');
      if (locks.length) protectedFields[id] = locks;
    }
    if (!groups.length) throw new Error(t('Явно разрешите хотя бы одну группу изменений.'));
    return {styleId:select.value as StyleID, version:1, mode:original.mode, sceneId:original.sceneId, groups, roles,
      ...(original.mode === 'create' ? {objectId:original.objectId!,text:t('Новый текст') as 'Новый текст'|'New text'} : {protected:protectedFields,replaceTracks:replace.checked}),
      motion:motion.value as 'standard'|'reduced'};
  }
  function roleRows(scene: Scene) {
    rolesNode.replaceChildren();
    for (const object of scene.objects!) {
      const row = document.createElement('fieldset'); row.dataset.styleObject = object.id;
      const legend = document.createElement('legend'); legend.textContent = object.type === 'text' ? object.text!.slice(0,70) : host.getState().manifest.assets[object.asset ?? '']?.name ?? t(object.type === 'image' ? 'Изображение' : 'Фигура');
      const roleLabel = document.createElement('label'); roleLabel.textContent = t('Роль объекта');
      const roleSelect = document.createElement('select'); roleSelect.dataset.styleRole = '';
      const roles: [string,string][] = object.type === 'text' ? [['headline','Заголовок'],['body','Основной текст'],['proof','Факт / число']] : object.type === 'image' ? [['media','Материал']] : [['accent','Акцент']];
      for (const [value,label] of [['','Выберите роль'],...roles]) { const option = document.createElement('option'); option.value = value; option.textContent = t(label); roleSelect.append(option); }
      roleLabel.append(roleSelect);
      const locksLabel = document.createElement('label'); locksLabel.textContent = t('Защитить поля (Ctrl / ⌘ для нескольких)');
      const locks = document.createElement('select'); locks.multiple = true; locks.size = 4; locks.dataset.styleLocks = '';
      const fields = [['*','Весь объект'],['x','Позиция X'],['y','Позиция Y'],['width','Ширина'],['height','Высота'],['fontSize','Размер шрифта'],['weight','Начертание'],['align','Выравнивание'],['color','Цвет'],['opacity','Непрозрачность'],['reveal','Раскрытие'],['rotation','Поворот'],['keyframes','Дорожки движения']];
      for (const [value,label] of fields) { const option = document.createElement('option'); option.value = value; option.textContent = t(label); locks.append(option); }
      locksLabel.append(locks); row.append(legend,roleLabel,locksLabel); rolesNode.append(row);
    }
  }
  async function begin(mode: 'create'|'restyle') {
    if (host.isBusy() || opening || blocksWrites() || host.hasBlockedEdit() || !host.getState()) return;
    if (mode === 'restyle' && (host.getScene().type !== 'composition' || host.getScene().captions?.length)) { message(t(captionLimit),true); return; }
    opening = true; constraints();
    try {
      if (host.isVisual() && !await host.resolveVisual()) return;
      if (host.isDirty()) { message(t('Сначала сохраните текущие поля сцены или явно отбросьте черновик.'),true); return; }
      let fresh = false;
      await host.task(async () => {
        await host.reread();
        const catalog = await host.api('/api/styles');
        if (!record(catalog) || !Array.isArray(catalog.packages)) throw new Error(t('Каталог стилей недоступен.'));
        packages = catalog.packages as StylePackage[]; fresh = true;
      });
      if (!fresh) return;
      const state = host.getState(), scene = host.getScene();
      if (mode === 'restyle' && (scene.type !== 'composition' || scene.captions?.length)) { message(t(captionLimit),true); return; }
      if (mode === 'create' && (state.manifest.scenes.length >= 12 || state.manifest.scenes.reduce((sum,scene) => sum+scene.durationFrames,0)+120 > 1800)) { message(t('Для новой композиции нужны 4 секунды в пределах лимита 60 секунд и 12 сцен.'),true); return; }
      intent = {mode,sceneId:mode === 'create' ? `composition-${crypto.randomUUID()}` : scene.id,
        ...(mode === 'create' ? {objectId:`object-${crypto.randomUUID()}`} : {}),before:structuredClone(state.manifest),etag:state.etag,submitted:false,generation:0};
      select.replaceChildren(...packages.map(pack => { const option = document.createElement('option'); option.value = pack.id; option.textContent = pack.label; return option; }));
      for (const control of dialog.querySelectorAll<HTMLInputElement>('[data-style-group]')) control.checked = mode === 'create';
      node('style-restyle-options',HTMLElement).hidden = mode === 'create';
      node('style-dialog-title',HTMLElement).textContent = t(mode === 'create' ? 'Создать композицию со стилем' : 'Стиль выбранной композиции');
      replace.checked = false; motion.value = 'standard';
      rolesNode.replaceChildren(); if (mode === 'restyle') roleRows(scene);
      clearPreview(); phase = 'editing'; dialog.dataset.sceneId = intent.sceneId; dialog.dataset.objectId = intent.objectId ?? '';
      dialog.showModal(); message(t('Сначала preview. Apply сохранит одну ревизию; текст, факты, материалы, звук и длительности сохраняются. Художественная оценка не проводилась.'));
    } finally { opening = false; constraints(); }
  }
  function auditSummary(audit: StyleAudit) {
    auditNode.replaceChildren();
    const summary = document.createElement('p'); summary.textContent = `${audit.status} · ${audit.layoutFamily} · ${audit.checkedFrames} ${t('кадров проверено')}`; auditNode.append(summary);
    for (const item of audit.text) { const line = document.createElement('p'); line.textContent = `${item.fontSize}px · ${t('строк')}: ${item.lines.length} · ${t('чтение')}: ${item.holdFrames}/${item.requiredHoldFrames} · ${t('контраст')}: ${item.contrast}`; auditNode.append(line); }
    for (const warning of audit.warnings) { const line = document.createElement('p'); line.textContent = warning; auditNode.append(line); }
    const human = document.createElement('p'); human.textContent = t('Художественная оценка: NOT RUN. UNKNOWN требует проверки человеком.'); auditNode.append(human);
  }
  async function preview() {
    if (host.isBusy() || !intent || (phase !== 'editing' && phase !== 'ready')) return;
    const original = intent;
    let request: StyleRequest;
    try { request = inputRequest(original); } catch (error) { message(error instanceof Error ? error.message : String(error),true); return; }
    clearPreview(); const generation = original.generation; phase = 'previewing'; update();
    await host.styleTask(async () => {
      try {
        const value = await host.api('/api/styles/preview',{method:'POST',headers:{'Content-Type':'application/json','If-Match':original.etag},body:JSON.stringify({request})});
        if (intent !== original || original.generation !== generation || phase === 'stale') return;
        if (!record(value) || value.stale || typeof value.previewId !== 'string' || typeof value.url !== 'string' || !value.url.startsWith('/previews/') || JSON.stringify(value.request) !== JSON.stringify(request) || !record(value.action) || !record(value.audit)) throw Object.assign(new Error(t('Preview устарел или его ответ не удалось проверить. Перечитайте проект.')),{code:'PROJECT_CONFLICT'});
        original.request = structuredClone(request); original.action = value.action as unknown as StyleAction; original.previewId = value.previewId;
        player.src = value.url; player.muted = false; player.hidden = false; auditSummary(value.audit as unknown as StyleAudit);
        phase = 'ready'; message(t('Preview готов без сохранения. Посмотрите и прослушайте его, затем примените или отмените.'));
      } catch (cause) {
        const error = cause as Error & {code?: string};
        if (intent !== original || phase === 'stale') return;
        phase = error.code === 'PROJECT_CONFLICT' ? 'stale' : 'editing'; message(error.message,true);
      }
    });
    constraints();
  }
  async function apply() {
    if (host.isBusy() || phase !== 'ready' || !intent?.request || !intent.action || !intent.previewId || intent.submitted) return;
    const original = intent, body = JSON.stringify({previewId:original.previewId,request:original.request,action:original.action});
    original.submitted = true; phase = 'applying'; update();
    await host.styleTask(async () => {
      let acceptedReply = false;
      try {
        const result = await host.api('/api/styles/apply',{method:'POST',headers:{'Content-Type':'application/json','If-Match':original.etag},body});
        if (!matchesReply(result,original)) throw new Error(t('Ответ применения не удалось проверить.'));
        acceptedReply = true; host.accepted(result,original.sceneId);
        close(); phase = 'idle'; message(t('Стиль применён одной ревизией. Объекты доступны для обычных правок и возврата через историю.')); intent = undefined;
      } catch (cause) {
        const error = cause as Error & {code?: string;committed?: boolean}; intent = original;
        if (error.code === 'PROJECT_CONFLICT') phase = 'stale';
        else if (acceptedReply || !error.code || error.code === 'INTERNAL_ERROR' || error.code === 'STYLE_COMMIT_OUTCOME_UNKNOWN' || error.committed) phase = 'unknown';
        else { original.submitted = false; clearPreview(); phase = 'editing'; }
        message(phase === 'unknown' ? `${t('Исход применения неизвестен или интерфейс не обновился. Не повторяйте Apply; явно перечитайте проект.')} ${error.message}` : phase === 'stale' ? t('Проект изменён извне. Применение не повторяется; явно перечитайте проект.') : error.message,true);
      }
    });
    constraints();
  }
  async function reconcile() {
    if (host.isBusy() || (phase !== 'stale' && phase !== 'unknown')) return false;
    await host.styleTask(async () => {
      const original = intent, priorPhase = phase;
      try { await host.reread(original?.sceneId); clearPreview(); close(); phase = 'idle'; message(t('Проект перечитан с диска. Прежний запрос стиля не отправляется повторно.')); intent = undefined; }
      catch (error) { intent = original; phase = priorPhase; constraints(); throw error; }
    });
    constraints(); return true;
  }
  function externalChanged(etag: string) {
    if (!intent || etag === intent.etag || !['editing','ready','previewing'].includes(phase)) return;
    clearPreview(); phase = 'stale'; message(t('Проект изменён извне. Прежний preview больше не разрешает Apply; явно перечитайте проект.'),true);
  }
  createButton.onclick = () => { void begin('create'); }; restyleButton.onclick = () => { void begin('restyle'); };
  previewButton.onclick = () => { void preview(); }; applyButton.onclick = () => { void apply(); };
  cancelButton.onclick = cancel; dialog.oncancel = event => { event.preventDefault(); cancel(); };
  readButton.onclick = () => { void reconcile(); }; reconcileButton.onclick = () => { void reconcile(); };
  dialog.oninput = changed; dialog.onchange = changed;
  return {blocksWrites,constraints,externalChanged,reconcile};
}
