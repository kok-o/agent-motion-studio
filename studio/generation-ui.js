import { t } from './i18n.js';
const $ = id => document.getElementById(id);
const phaseNames = { prepared: t('Подготовлено · отправки ещё не было'), uploading: t('Передаётся разрешённый reference'), uploaded: t('Reference передан'), submitting: t('Отправляется запрос'), submission_unknown: t('Исход первой отправки неизвестен · этот запрос повторять нельзя'), queued: t('В очереди провайдера'), running: t('Генерируется'), output_ready: t('Результат готов к загрузке'), downloading: t('Загрузка и проверка'), ready: t('Кандидат проверен'), failed: t('Ошибка задания'), paused: t('Отслеживание приостановлено'), stopped: t('Отслеживание остановлено'), cancelled: t('Отменено') };
const draftIds = ['candidate-trim', 'candidate-fit', 'candidate-x', 'candidate-y'];
const node = (tag, text) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const choice = (select, entries, value) => { select.replaceChildren(...entries.map(([id, title]) => { const option = node('option', title); option.value = id; return option; })); select.value = value ?? ''; };

export function initGeneration(context) {
  let capabilities, jobs = [], selectedJobId, localBusy = false, shownCandidate, preview, previewContext, conflict, preparedScene;
  const storageKey = suffix => `studio-generation:${context.getState().projectPath}:${suffix}`;
  const readLocal = suffix => { try { return JSON.parse(sessionStorage.getItem(storageKey(suffix)) ?? 'null'); } catch { return null; } };
  const writeLocal = (suffix, value) => { try { sessionStorage.setItem(storageKey(suffix), JSON.stringify(value)); } catch { /* Persisted server jobs remain available. */ } };
  const job = () => jobs.find(item => item.id === selectedJobId && item.sceneId === context.getScene()?.id);
  const unresolvedUnknown = () => jobs.find(item => ['submission_unknown', 'submitting'].includes(item.status) && !item.unknownResolution);
  const draft = () => ({ trimStartSeconds: Number($('candidate-trim').value), fit: $('candidate-fit').value, focalPoint: { x: Number($('candidate-x').value), y: Number($('candidate-y').value) } });
  const sceneContext = state => { const scene = state.manifest.scenes.find(item => item.id === (job()?.sceneId ?? context.getScene()?.id)); return { scene, aspectRatio: state.manifest.video.aspectRatio, etag: state.etag }; };
  function saveDraft() { if (job()) writeLocal(`draft:${job().id}`, { draft: draft(), operationId: job().acceptance?.operationId ?? readLocal(`draft:${job().id}`)?.operationId ?? crypto.randomUUID() }); }
  function invalidatePreview(message = t('Нужен новый точный preview текущего trim/crop. Проект не меняется.')) {
    preview = undefined; $('generation-viewed').checked = false; $('generation-preview-player').pause(); $('generation-preview-player').hidden = true; $('generation-preview-status').textContent = message; updateControls();
  }
  const requestValues = () => ({ sceneId: context.getScene().id, prompt: $('generation-prompt').value, referenceAssetId: $('generation-reference').value, durationSeconds: Number($('generation-duration').value), resolution: $('generation-resolution').value });
  const matchesRequest = selected => selected && same(requestValues(), { sceneId: selected.sceneId, prompt: selected.prompt, referenceAssetId: selected.referenceAssetId, durationSeconds: selected.durationSeconds, resolution: selected.resolution });
  function updateControls() {
    if (!context.getState()) return;
    const selected = job(), blocked = localBusy || context.isBusy(), dirty = context.isDirty(), video = context.getScene()?.type === 'video';
    $('generation-prepare').disabled = blocked || dirty || !video || !$('generation-reference').value || Boolean(unresolvedUnknown());
    $('generation-discard-draft').disabled = blocked; $('generation-dirty').hidden = !dirty; $('generation-discard-draft').hidden = !dirty;
    $('generation-refresh').disabled = blocked; $('generation-jobs').disabled = blocked;
    for (const id of ['generation-prompt', 'generation-reference', 'generation-resolution', 'generation-consent', 'generation-budget', ...draftIds, 'generation-viewed', 'generation-account-checked', 'generation-possible-charge']) $(id).disabled = blocked;
    for (const id of ['generation-account-checked', 'generation-possible-charge']) $(id).disabled = blocked || Boolean(selected?.unknownResolution);
    $('generation-resolve-unknown').disabled = blocked || !selected || !['submission_unknown', 'submitting'].includes(selected.status) || Boolean(selected.unknownResolution) || !$('generation-account-checked').checked || !$('generation-possible-charge').checked;
    $('generation-submit').disabled = blocked || dirty || selected?.status !== 'prepared' || !matchesRequest(selected) || !capabilities?.configured || !$('generation-consent').checked || !Number.isFinite(Number($('generation-budget').value)) || Number($('generation-budget').value) < (selected?.estimate?.usd ?? Infinity);
    $('generation-resume').disabled = blocked || !selected || ['prepared', 'ready', 'submitting', 'uploading', 'downloading', 'cancelled'].includes(selected.status) || selected.decision !== 'pending';
    $('generation-download').disabled = blocked || !selected || !['output_ready', 'ready', 'failed', 'paused'].includes(selected.status) || selected.decision !== 'pending';
    $('generation-stop').disabled = blocked || !selected || ['ready', 'failed', 'cancelled'].includes(selected.status) || selected.decision !== 'pending';
    $('generation-preview').disabled = blocked || dirty || !selected?.candidate || selected.decision !== 'pending';
    $('generation-accept').disabled = blocked || dirty || !selected?.candidate || selected.decision !== 'pending' || !preview || preview.stale || !same(preview.draft, draft()) || !$('generation-viewed').checked;
    $('generation-reject').disabled = blocked || !selected?.candidate || selected.decision !== 'pending';
    $('generation-conflict-preview').disabled = blocked || !conflict?.fresh.manifest.scenes.some(item => item.id === selected?.sceneId && item.type === 'video');
  }
  function paintSelection() {
    const state = context.getState(), scene = context.getScene(); if (!state || !scene) return;
    if (preview && preview.projectHash !== state.etag) invalidatePreview(t('Принятый проект изменён. Нужен новый preview актуального контекста перед Accept.'));
    $('generation-panel').hidden = scene.type !== 'video';
    $('generation-context').textContent = t`Сцена ${scene.id} · сохраняется ${scene.durationFrames / 30} с · текущий исходник ${state.manifest.assets[scene.asset]?.name ?? scene.asset ?? ''}`;
    $('generation-capabilities').textContent = capabilities ? t`${capabilities.provider} / ${capabilities.model} · image-to-video · ${capabilities.configured ? t('credentials настроены на сервере') : t('для отправки настройте REPLICATE_API_TOKEN на сервере')} · reference ≤256 KiB · без звука` : t('Проверяем локальную конфигурацию провайдера…');
    const previous = $('generation-reference').value;
    choice($('generation-reference'), [['', t('Выберите разрешённое изображение ≤256 KiB')], ...Object.entries(state.manifest.assets).filter(([, asset]) => asset.type === 'image').map(([id, asset]) => [id, asset.name ?? id])], previous);
    $('generation-duration').value = capabilities?.durationSeconds ?? 7.5625;
    const remembered = readLocal(`selected:${scene.id}`), available = jobs.filter(item => item.sceneId === scene.id);
    if (!available.some(item => item.id === selectedJobId)) selectedJobId = available.find(item => item.id === remembered)?.id ?? available[0]?.id;
    choice($('generation-jobs'), [['', t('Нет выбранного задания')], ...available.map(item => [item.id, `${phaseNames[item.status] ?? item.status} · ${item.resolution} · ${item.decision}`])], selectedJobId);
    paintJob(); updateControls();
  }
  function paintJob() {
    const selected = job();
    if (preview && preview.previewId !== selected?.preview?.previewId) invalidatePreview(t('Сохранённый preview больше не подтверждает принятие. Скачайте прежний результат при необходимости и соберите новый точный preview.'));
    const unknown = unresolvedUnknown();
    $('generation-unknown-block').hidden = !unknown;
    $('generation-unknown-block').textContent = unknown ? t`Новая подготовка приостановлена: неизвестный исход отправки для сцены ${unknown.sceneId}. Выберите это задание, проверьте аккаунт и явно зафиксируйте решение.` : '';
    $('generation-unknown').hidden = !selected || !['submission_unknown', 'submitting'].includes(selected.status);
    $('generation-request').hidden = !selected;
    $('generation-candidate').hidden = !selected?.candidate;
    if (!selected) { $('generation-status').textContent = t('Подготовка локальна: reference и prompt ещё никуда не отправляются.'); $('generation-diagnostics').textContent = ''; return; }
    $('generation-status').textContent = `${phaseNames[selected.status] ?? selected.status}${selected.stopped ? t(' · отслеживание остановлено') : ''}${selected.decision === 'accepted' ? t(' · дубль принят') : selected.decision === 'rejected' ? t(' · дубль отклонён') : ''}${selected.error ? ` · ${selected.error.message}` : ''}`;
    $('generation-request-summary').textContent = t`${selected.provider} / ${selected.model} · ${selected.resolution} · оплачивается ${selected.durationSeconds} с · сцена сохраняет ${selected.sceneDurationSeconds} с`;
    $('generation-cost').textContent = t`Оценка: $${selected.estimate?.usd ?? '?'} USD. ${selected.estimate?.note ?? ''}`;
    $('generation-data').textContent = t`Будут переданы prompt: «${selected.prompt}» и только reference ${context.getState().manifest.assets[selected.referenceAssetId]?.name ?? selected.referenceAssetId}. Источник цены: ${selected.estimate?.source ?? t('неизвестен')}, ${selected.estimate?.date ?? ''}. Локальное ограничение не гарантирует прекращение провайдерных расходов.`;
    $('generation-diagnostics').textContent = JSON.stringify(selected, null, 2);
    $('generation-resolution-status').textContent = selected.unknownResolution ? t('Проверка аккаунта зафиксирована. Старый исход и возможные расходы сохранены. Новая подготовка создаст отдельный запрос с новым разрешением.') : t('Остановка отслеживания и перезапуск не снимают неопределённость. Подтверждение не означает отмену или возврат денег.');
    if (shownCandidate !== selected.id) {
      $('generation-prompt').value = selected.prompt; $('generation-reference').value = selected.referenceAssetId; $('generation-duration').value = selected.durationSeconds; $('generation-resolution').value = selected.resolution;
      shownCandidate = selected.id; const remembered = readLocal(`draft:${selected.id}`), scene = context.getScene(), value = remembered?.draft ?? selected.preview?.draft ?? { trimStartSeconds: 0, fit: scene.fit ?? 'cover', focalPoint: scene.focalPoint ?? { x: .5, y: .5 } };
      $('generation-account-checked').checked = Boolean(selected.unknownResolution?.accountChecked); $('generation-possible-charge').checked = Boolean(selected.unknownResolution?.acknowledgePossibleCharge);
      $('candidate-trim').value = value.trimStartSeconds; $('candidate-fit').value = value.fit; $('candidate-x').value = value.focalPoint.x; $('candidate-y').value = value.focalPoint.y;
      preparedScene = readLocal(`context:${selected.id}`); invalidatePreview(); $('generation-consent').checked = false; $('generation-budget').value = selected.estimate?.usd ?? '';
    }
    if (selected.candidate) {
      const url = `/api/generation/${encodeURIComponent(selected.id)}/candidate`;
      if ($('generation-raw').getAttribute('src') !== url) $('generation-raw').src = url;
      $('generation-source').textContent = t`Исходный candidate: ${selected.candidate.width}×${selected.candidate.height} · ${selected.candidate.sourceFps} fps · ${selected.candidate.durationSeconds} с. Фильм: 1080p/30 fps; duration сцены сохраняется, source audio выключен.`;
    }
    updateControls();
  }
  async function refreshLocal() {
    try {
      if (!capabilities) capabilities = await context.api('/api/generation/capabilities');
      const response = await context.api('/api/generation/jobs'); jobs = Array.isArray(response) ? response : response.jobs;
      paintSelection();
    } catch (error) { $('generation-capabilities').textContent = error.message; }
  }
  async function operation(fn) {
    if (localBusy || context.isBusy()) return;
    localBusy = true; updateControls();
    try { await fn(); }
    catch (error) {
      await refreshLocal();
      if (error.code === 'PROJECT_CONFLICT' || error.code === 'GENERATION_PREVIEW_STALE') await showConflict(await context.api('/api/state'));
      else context.notice(error.message, true);
    } finally { localBusy = false; updateControls(); }
  }
  async function action(name, body = {}) { const result = await context.post(`/api/generation/${encodeURIComponent(job().id)}/${name}`, body); await refreshLocal(); return result; }
  async function makePreview(etag = context.getState().etag) {
    if (context.isDirty()) throw new Error(t('Сначала сохраните или отбросьте обычный черновик сцены.'));
    saveDraft(); const value = draft(), selected = job(); context.notice(t('Собирается preview применения кандидата. Принятый проект не записывается…'));
    const result = await context.api(`/api/generation/${encodeURIComponent(selected.id)}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': etag }, body: JSON.stringify({ draft: value }) });
    await refreshLocal(); preview = { ...result, draft: value }; previewContext = sceneContext(context.getState());
    $('generation-preview-player').src = result.url; $('generation-preview-player').hidden = false; $('generation-viewed').checked = false;
    $('generation-preview-status').textContent = result.stale ? t('Проект изменён во время preview. Требуется перечитать контекст и посмотреть новый preview.') : t`${result.durationSeconds} с · 1080p/30 fps · проект, принятые исходники и история не изменены. Посмотрите preview перед принятием.`;
    context.notice(result.stale ? t('Preview устарел: проект изменён извне.') : t('Preview готов. Посмотрите его и явно подтвердите принятие дубля.')); updateControls();
  }
  async function showConflict(fresh) {
    conflict = { fresh }; const prior = previewContext ?? preparedScene, next = sceneContext(fresh), table = node('table'), head = node('tr');
    for (const title of [t('Контекст'), t('До просмотра'), t('На диске')]) head.append(node('th', title)); table.append(head);
    for (const [title, before, after] of [[t('Сцена'), prior?.scene?.id ?? job().sceneId, next.scene?.id ?? t('Удалена')], [t('Исходник'), prior?.scene?.asset ?? t('Прежняя версия preview'), next.scene?.asset ?? t('Нет')], [t('Длительность, с'), prior?.scene ? prior.scene.durationFrames / 30 : job().sceneDurationSeconds, next.scene ? next.scene.durationFrames / 30 : t('Нет')], ['Trim / crop', prior?.scene ? JSON.stringify({ trim: prior.scene.trimStartSeconds, fit: prior.scene.fit, focal: prior.scene.focalPoint }) : t('См. параметры кандидата'), next.scene ? JSON.stringify({ trim: next.scene.trimStartSeconds, fit: next.scene.fit, focal: next.scene.focalPoint }) : t('Нет')], [t('Формат'), prior?.aspectRatio ?? t('Прежний контекст'), next.aspectRatio]]) { const row = node('tr'); row.append(node('td', title), node('td', String(before)), node('td', String(after))); table.append(row); }
    $('generation-conflict-details').replaceChildren(table); $('generation-conflict-note').textContent = next.scene?.type === 'video' ? t('Внешние изменения сохранятся. После подтверждения потребуется новый preview; Accept ещё раз проверит версию проекта.') : t('Целевая video scene отсутствует. Автоматическое принятие недоступно; candidate остаётся сохранённым.');
    invalidatePreview(t('Контекст изменён: старый preview не разрешает принятие.'));
    if (!$('generation-conflict-dialog').open) $('generation-conflict-dialog').showModal(); context.notice(t('Проект изменён извне. Сравните контекст кандидата.'), true);
  }
  $('generation-form').onsubmit = event => { event.preventDefault(); void operation(async () => {
    if (context.isDirty()) throw new Error(t('Сначала сохраните или отбросьте обычный черновик сцены.'));
    if (!$('generation-form').reportValidity()) return;
    const request = requestValues(), remembered = readLocal(`intent:${request.sceneId}`), prior = jobs.find(item => item.id === remembered?.jobId), etag = context.getState().etag, providerContext = { provider: capabilities?.provider, model: capabilities?.model, estimate: capabilities?.estimate, estimateByResolution: capabilities?.estimateByResolution };
    const reuse = remembered && same(remembered.request, request) && remembered.etag === etag && same(remembered.providerContext, providerContext) && (!remembered.jobId || (prior?.decision === 'pending' && !prior.unknownResolution && !['failed', 'cancelled'].includes(prior.status)));
    const intent = reuse ? remembered : { request, etag, providerContext, intentId: crypto.randomUUID() }; writeLocal(`intent:${request.sceneId}`, intent);
    const result = await context.post('/api/generation/prepare', { ...request, intentId: intent.intentId }); selectedJobId = result.id; shownCandidate = undefined;
    writeLocal(`intent:${request.sceneId}`, { ...intent, jobId: selectedJobId });
    writeLocal(`selected:${request.sceneId}`, selectedJobId); writeLocal(`context:${selectedJobId}`, sceneContext(context.getState())); await refreshLocal(); context.notice(t('Запрос подготовлен локально. Проверьте данные и стоимость; upload и generation ещё не выполнялись.'));
  }); };
  $('generation-form').oninput = () => { $('generation-consent').checked = false; updateControls(); };
  $('generation-jobs').onchange = () => { selectedJobId = $('generation-jobs').value; shownCandidate = undefined; const selected = job(); if (selected) { $('generation-prompt').value = selected.prompt; $('generation-reference').value = selected.referenceAssetId; $('generation-duration').value = selected.durationSeconds; $('generation-resolution').value = selected.resolution; writeLocal(`selected:${selected.sceneId}`, selected.id); } paintJob(); };
  $('generation-refresh').onclick = () => operation(refreshLocal);
  $('generation-discard-draft').onclick = () => { context.discardDraft(); context.notice(t('Обычный черновик отброшен. Candidate и принятый проект сохранены.')); };
  for (const id of ['generation-consent', 'generation-budget', 'generation-viewed', 'generation-account-checked', 'generation-possible-charge']) $(id).oninput = updateControls;
  $('generation-submit').onclick = () => operation(async () => { if (!matchesRequest(job()) || !$('generation-consent').checked) throw new Error(t('Подтвердите точный подготовленный запрос.')); await action('submit', { requestHash: job().requestHash, maxSubmissions: 1, maxCostUsd: Number($('generation-budget').value), uploadReference: true }); context.notice(t('Единственный submit сохранён. Возобновление наблюдения относится к этому заданию.')); });
  $('generation-resume').onclick = () => operation(async () => { await action('resume'); context.notice(t('Состояние прежнего задания обновлено. Новая генерация не запускалась.')); });
  $('generation-download').onclick = () => operation(async () => { await action('download'); context.notice(t('Результат прежнего задания скачан и проверен. Теперь доступен отдельный preview.')); });
  $('generation-stop').onclick = () => operation(async () => { await action('stop'); context.notice(t('Отслеживание остановлено локально. Это не отмена провайдерного задания и не обещание возврата расходов.')); });
  $('generation-resolve-unknown').onclick = () => operation(async () => {
    const selected = job();
    if (!selected || !$('generation-account-checked').checked || !$('generation-possible-charge').checked) throw new Error(t('Проверьте аккаунт и явно подтвердите возможные расходы первой отправки.'));
    await action('resolve-unknown', { resolution: { requestHash: selected.requestHash, accountChecked: true, acknowledgePossibleCharge: true } });
    context.notice(t('Решение сохранено. Первая отправка остаётся неизвестной и не повторяется. Новую попытку подготовьте отдельно и заново разрешите её расходы.'));
  });
  for (const id of draftIds) $(id).oninput = () => { saveDraft(); invalidatePreview(); };
  $('generation-preview').onclick = () => operation(() => makePreview());
  $('generation-accept').onclick = () => operation(async () => {
    if (!preview || !same(preview.draft, draft()) || !$('generation-viewed').checked) throw new Error(t('Нужен просмотр актуального candidate preview.'));
    const selected = job(), value = draft(); saveDraft();
    await context.api(`/api/generation/${encodeURIComponent(selected.id)}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': preview.projectHash }, body: JSON.stringify({ draft: value, previewId: preview.previewId, operationId: readLocal(`draft:${selected.id}`).operationId }) });
    invalidatePreview(t('Дубль принят одной операцией. Предыдущий source доступен через восстановление сцены.')); await context.refresh(); context.notice(t('Принят новый дубль. Duration сцены сохранена. Экспортируйте фильм; предыдущий дубль можно восстановить.'));
  });
  $('generation-reject').onclick = () => operation(async () => { await action('reject'); invalidatePreview(t('Дубль отклонён. Принятые источники и история сохранены.')); context.notice(t('Кандидат отклонён. Фильм не изменён.')); });
  $('generation-conflict-preview').onclick = () => operation(async () => {
    const fresh = await context.api('/api/state'); if (fresh.etag !== conflict.fresh.etag) { await showConflict(fresh); context.notice(t('Проект снова изменён извне. Проверьте обновлённый контекст.'), true); return; }
    const expected = fresh.etag; await context.refresh(); await makePreview(expected); conflict = undefined; $('generation-conflict-dialog').close();
  });
  $('generation-conflict-cancel').onclick = () => { conflict = undefined; $('generation-conflict-dialog').close(); context.notice(t('Кандидат сохранён. Принятый проект не изменён.')); };
  $('generation-conflict-dialog').oncancel = () => { conflict = undefined; };
  return { refreshLocal, paintSelection, updateControls };
}
