import type { Manifest, Scene } from '../src/types.js';
import type { ProjectAction } from '../src/project.js';
import type { ProjectState } from './object-editor-types.js';
import { t } from './i18n.js';

type CreateAction = Extract<ProjectAction, { type: 'add-scene' }>;
type Phase = 'idle' | 'confirming' | 'submitting' | 'stale' | 'unknown';
interface EntryHost {
  getState(): ProjectState;
  isBusy(): boolean;
  hasBlockedEdit(): boolean;
  isDirty(): boolean;
  isVisual(): boolean;
  resolveVisual(): Promise<boolean>;
  saveScalar(): Promise<void>;
  reread(preferredScene?: string): Promise<void>;
  accepted(result: ProjectState, sceneId: string): void;
  api(path: '/api/edit', options: { method: 'POST'; headers: { 'Content-Type': 'application/json'; 'If-Match': string }; body: string }): Promise<unknown>;
  task(operation: () => Promise<void>): Promise<void>;
  entryTask(operation: () => Promise<void>): Promise<void>;
  notice(message: string, error?: boolean): void;
  updateControls(): void;
}
interface Intent { scene: Scene; before: Manifest; etag: string; actionJSON: string; submitted: boolean }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';
const info = (cause: unknown): Error & { code?: unknown; details?: unknown; committed?: unknown } => cause instanceof Error ? cause : new Error(String(cause));
const uncertain = (error: ReturnType<typeof info>) => !error.code || error.code === 'INTERNAL_ERROR' || error.committed === true;
function node<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
  const value = document.getElementById(id); if (!(value instanceof constructor)) throw new Error(`Missing composition element: ${id}`); return value;
}

/** An ordinary add-scene intent, never an automatic retry or receipt-backed operation. */
export function compositionScene(manifest: Manifest, sceneId: string, objectId: string, text: string): Scene {
  const landscape = manifest.video.aspectRatio === '16:9', width = landscape ? 1920 : 1080, height = landscape ? 1080 : 1920;
  const objectWidth = Math.round(width * .4), objectHeight = Math.round(height * .15);
  return { id: sceneId, type: 'composition', durationFrames: 120, objects: [{ id: objectId, type: 'text', text, color: 'foreground', fontSize: 48, x: Math.round((width - objectWidth) / 2), y: Math.round((height - objectHeight) / 2), width: objectWidth, height: objectHeight }] };
}
export function compositionLimit(manifest: Manifest): string | undefined {
  if (manifest.scenes.length >= 12) return 'Достигнут лимит 12 сцен. Новая композиция не создана.';
  if (manifest.scenes.reduce((sum, scene) => sum + scene.durationFrames, 0) + 120 > 1800) return 'Для новой композиции нужны 4 секунды в пределах лимита 60 секунд. Длительности существующих сцен не меняются.';
  return undefined;
}
export function compositionSceneCaption(scene: Scene, index: number): string {
  return /^composition-[a-f0-9-]{36}$/i.test(scene.id) ? `${t('Композиция')} ${index + 1}` : scene.id;
}
function matchesReply(value: unknown, intent: Intent): value is ProjectState {
  if (!record(value) || typeof value.etag !== 'string' || !/^[a-f0-9]{64}$/.test(value.etag) || value.etag === intent.etag || !record(value.manifest)) return false;
  const manifest = value.manifest;
  if (!Array.isArray(manifest.history) || !manifest.history.length || manifest.history.length > (intent.before.history?.length ?? 0) + 1) return false;
  const priorCount = manifest.history.length - 1, last = manifest.history.at(-1);
  if (!record(last) || typeof last.id !== 'string' || !last.id || (intent.before.revision && last.id !== intent.before.revision) || last.label !== 'add-scene' || typeof last.createdAt !== 'string' || !Number.isFinite(Date.parse(last.createdAt))) return false;
  if (!(['scenes', 'video', 'audio', 'brand'] as const).every(key => JSON.stringify(last[key]) === JSON.stringify(intent.before[key]))) return false;
  if (JSON.stringify(manifest.history.slice(0, -1)) !== JSON.stringify(priorCount ? (intent.before.history ?? []).slice(-priorCount) : [])) return false;
  return manifest.schemaVersion === 2 && typeof manifest.revision === 'string' && manifest.revision !== intent.before.revision
    && JSON.stringify(manifest.scenes) === JSON.stringify([...intent.before.scenes, intent.scene])
    && (['id', 'seed', 'video', 'brand', 'audio', 'assets', 'operationReceipts'] as const).every(key => JSON.stringify(manifest[key]) === JSON.stringify(intent.before[key]));
}

export function initCompositionEntry(host: EntryHost) {
  const button = node('add-composition', HTMLButtonElement), dialog = node('composition-dialog', HTMLDialogElement);
  const confirm = node('composition-confirm', HTMLButtonElement), cancel = node('composition-cancel', HTMLButtonElement);
  const modalRead = node('composition-dialog-reload', HTMLButtonElement), reconcileButton = node('composition-reconcile', HTMLButtonElement);
  const note = node('composition-entry-status', HTMLElement), dialogNote = node('composition-dialog-note', HTMLElement);
  const draftDialog = node('composition-draft-dialog', HTMLDialogElement);
  let phase: Phase = 'idle', intent: Intent | undefined, opening = false, message = '';
  const blocksWrites = () => phase !== 'idle';
  function constraints() {
    const busy = host.isBusy(), limit = host.getState() ? compositionLimit(host.getState().manifest) : undefined;
    if (blocksWrites()) document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>('button,input,textarea,select').forEach(control => { control.disabled = true; });
    button.disabled = busy || opening || blocksWrites() || host.hasBlockedEdit() || Boolean(limit);
    confirm.disabled = busy || phase !== 'confirming' || !intent || intent.submitted;
    cancel.disabled = busy || !intent || intent.submitted;
    modalRead.hidden = phase !== 'stale'; modalRead.disabled = busy || phase !== 'stale';
    reconcileButton.hidden = phase !== 'unknown' && phase !== 'stale'; reconcileButton.disabled = busy || (phase !== 'unknown' && phase !== 'stale');
    if (phase === 'unknown' || phase === 'stale') node('reload', HTMLButtonElement).disabled = busy;
    note.textContent = message || t(limit ?? 'Новая композиция сохраняется отдельной ревизией. Объекты затем редактируются через Preview → Apply.');
    if (phase === 'stale') dialogNote.textContent = message;
  }
  function update() { host.updateControls(); constraints(); }
  function setMessage(value: string, error = false) { message = value; host.notice(value, error); update(); }
  function close() { if (dialog.open) dialog.close(); }
  function cancelIntent() {
    if (host.isBusy() || !intent || intent.submitted) return;
    intent = undefined; phase = 'idle'; close(); message = ''; update();
  }
  function scalarChoice(): Promise<'apply' | 'discard' | 'stay'> {
    draftDialog.showModal();
    return new Promise(resolve => {
      const finish = (value: 'apply' | 'discard' | 'stay') => { draftDialog.close(); resolve(value); };
      node('composition-draft-apply', HTMLButtonElement).onclick = () => finish('apply');
      node('composition-draft-discard', HTMLButtonElement).onclick = () => finish('discard');
      node('composition-draft-stay', HTMLButtonElement).onclick = () => finish('stay');
      draftDialog.oncancel = event => { event.preventDefault(); finish('stay'); };
    });
  }
  async function resolveDraft() {
    if (host.isVisual()) return host.resolveVisual();
    if (!host.isDirty()) return true;
    const choice = await scalarChoice();
    if (choice === 'stay') return false;
    await host.task(async () => {
      if (choice === 'discard') { await host.reread(); return; }
      try { await host.saveScalar(); }
      catch (cause) {
        if (!uncertain(info(cause))) throw cause;
        phase = 'unknown'; setMessage(t('Исход сохранения текущей сцены неизвестен. Не повторяйте правку; явно перечитайте проект.'), true);
      }
    });
    return !host.isDirty() && phase !== 'unknown';
  }
  async function begin() {
    if (host.isBusy() || host.hasBlockedEdit() || !host.getState() || opening || blocksWrites() || compositionLimit(host.getState().manifest)) return;
    opening = true; constraints();
    try {
      if (!await resolveDraft()) return;
      let fresh = false;
      await host.task(async () => { await host.reread(); fresh = true; });
      if (!fresh || host.isDirty()) return;
      const state = host.getState(), limit = compositionLimit(state.manifest);
      if (limit) { setMessage(t(limit), true); return; }
      let sceneId: string;
      do { sceneId = `composition-${crypto.randomUUID()}`; } while (state.manifest.scenes.some(scene => scene.id === sceneId));
      const objectId = `object-${crypto.randomUUID()}`, scene = compositionScene(state.manifest, sceneId, objectId, t('Новый текст'));
      const action: CreateAction = { type: 'add-scene', scene };
      intent = { scene, before: structuredClone(state.manifest), etag: state.etag, actionJSON: JSON.stringify(action), submitted: false };
      phase = 'confirming'; message = '';
      dialog.dataset.sceneId = sceneId; dialog.dataset.objectId = objectId;
      note.dataset.sceneId = sceneId; note.dataset.objectId = objectId;
      dialogNote.textContent = t('Создать композицию длительностью 4 секунды с редактируемым текстом? Это сразу сохранит одну новую ревизию. Существующие сцены и материалы сохранятся.');
      dialog.showModal(); update();
    } finally { opening = false; constraints(); }
  }
  async function create() {
    if (host.isBusy() || phase !== 'confirming' || !intent || intent.submitted) return;
    const original = intent; original.submitted = true; phase = 'submitting'; update();
    await host.entryTask(async () => {
      let acceptedReply = false;
      try {
        const reply = await host.api('/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': original.etag }, body: original.actionJSON });
        if (!matchesReply(reply, original)) throw new Error('Unreadable composition commit response');
        acceptedReply = true;
        // Keep the exact submitted intent across storage/paint failures after
        // publication. Only a completely successful UI handoff releases it.
        host.accepted(reply, original.scene.id); close(); phase = 'idle';
        setMessage(t('Композиция создана и сохранена одной ревизией. Добавляйте объекты, затем Preview → Apply.'));
        intent = undefined;
      } catch (cause) {
        const error = info(cause); close();
        if (error.code === 'PROJECT_CONFLICT') {
          phase = 'stale'; setMessage(t('Проект изменён извне. Создание не повторяется; явно перечитайте проект.'), true);
        } else if (acceptedReply || uncertain(error)) {
          phase = 'unknown'; intent = original;
          const known = error.code === 'INTERNAL_ERROR' && record(error.details) && error.details.stage === 'project' && error.message.startsWith('Manifest was committed but reading the result failed:');
          setMessage(acceptedReply ? `${t('Композиция сохранена, но интерфейс не обновился. Не повторяйте создание; явно перечитайте проект.')} ${error.message}` : known ? `${t('Композиция сохранена, но чтение результата не удалось. Не повторяйте создание; явно перечитайте проект.')} ${error.message}` : t('Исход создания композиции неизвестен. Не повторяйте создание; явно перечитайте проект.'), true);
        } else { phase = 'idle'; intent = undefined; setMessage(error.message, true); }
      }
    });
    constraints();
  }
  async function reconcile() {
    if (host.isBusy() || (phase !== 'unknown' && phase !== 'stale')) return false;
    await host.entryTask(async () => {
      const original = intent, priorPhase = phase;
      try {
        await host.reread(original?.scene.id);
        const found = original && host.getState().manifest.scenes.some(scene => scene.id === original.scene.id);
        phase = 'idle'; close();
        setMessage(t(found ? 'Принятая композиция найдена по исходному ID и открыта. Повторного создания не было.' : 'Проект перечитан с диска. Прежняя просьба о создании не отправляется повторно.'));
        intent = undefined;
      } catch (cause) { phase = priorPhase; intent = original; constraints(); throw cause; }
    });
    constraints(); return true;
  }
  function externalChanged(etag: string) {
    if (!intent || etag === intent.etag || phase !== 'confirming') return;
    phase = 'stale'; setMessage(t('Проект изменён извне. Создание не повторяется; явно перечитайте проект.'), true);
  }
  button.onclick = () => { void begin(); }; confirm.onclick = () => { void create(); };
  cancel.onclick = cancelIntent; dialog.oncancel = event => { event.preventDefault(); cancelIntent(); };
  modalRead.onclick = () => { void reconcile(); }; reconcileButton.onclick = () => { void reconcile(); };
  return { blocksWrites, constraints, externalChanged, reconcile };
}
