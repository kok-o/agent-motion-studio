# Новый AI-дубль существующей video scene

P1 добавляет один provider: **Replicate `wan-video/wan-2.2-i2v-fast`**, image-to-video. Студия, preview, принятие, история и экспорт выполняются локально. Генерация расходует тариф пользователя; локальный inference видеомодели не реализован. Официальный внешний агент использует те же CLI/project operations, что UI. Собственный чат и billing не нужны.

Это экспериментальный contract. Controlled tests подтверждают локальное поведение приложения, а `real provider verified` и `full workflow verified` требуют отдельно разрешённого запроса и настоящего фильма. [Выбор провайдера и источники](GENERATION_PROVIDER_DECISION.md).

## Подготовка без расходов

```sh
npm run build
node dist/cli.js init coffee-ritual --dir projects/my-generated-remix
node dist/cli.js studio projects/my-generated-remix/project.json
```

Откройте приватную ссылку, которую выведет CLI, выберите существующую video scene. Для второй сцены примера сохраняется 7 секунд. Нужен отдельно импортированный PNG/JPEG ≤256 KiB: текущая полная картинка примера больше этого предела. Создайте уменьшенную **копию** разрешённого изображения и импортируйте её. Исходник не изменяйте. UI показывает reference по имени; выбранное изображение передаётся inline через официальный API после разрешения. Весь фильм или исходное видео не отправляются.

Сначала сохраните либо явно отбросьте обычный черновик сцены. Candidate trim/crop находятся в отдельной панели и не сохраняются переключением сцены, музыкой, экспортом или reload.

В «Новый AI-дубль» задайте prompt, reference и 480p/720p. Подготовка проверяет параметры и сохраняет local job без сети. Модель генерирует 121 кадр при 16 fps: 7.5625 секунд. Сцена сохраняет свою duration; более длинная сцена, полный registry (24 assets) и проект с narration/captions отклоняются до submit. Source audio не добавляется в фильм; interpolation выключен.

Датированная оценка на 6 октября 2026: **480p $0.05**, **720p $0.11** за output video без interpolation. Перед live-run проверьте цену своего аккаунта. Это оценка, не гарантированный верхний предел счёта провайдера; локальный timeout не отменяет inference. Источник и ограничения видны в подготовленном job. Не нажимайте submit без разрешения на конкретный reference, запрос и расходы.

Credentials настраиваются только в окружении процесса CLI/server: `REPLICATE_API_TOKEN`. Получите ключ официально в своём Replicate account и настройте его безопасным способом локальной ОС. Не помещайте секрет в project JSON, approval, CLI arguments, скриншоты, чат или Git. Наличие ключа не означает разрешения тратить деньги. Отсутствие ключа оставляет доступными локальную подготовку и accepted фильм; mock не включается.

## UI: один запрос, preview, Accept и restore

1. Подготовьте запрос, прочитайте prompt/reference, режим, длительности и цену. Изменение параметров отменяет прежнее UI-подтверждение.
2. Явно разрешите передачу выбранного reference и **один** generation submit, задайте USD-предел и нажмите «Отправить один запрос». Повторный клик не создаёт второе задание.
3. «Возобновить наблюдение» читает сохранённый remote job. Reload и открытие скопированного проекта не запускают автоматически submit, polling, upload или download.
4. Когда результат готов, скачайте его. Повреждённый/истёкший download повторяется для прежнего job. Candidate становится доступным только после probe, полного decode и SHA-256. Исходный candidate хранится отдельно от `project.json`.
5. Смотрите raw candidate, задайте trim (по умолчанию 0), fit/focal и соберите «Предпросмотр применения кандидата». Общий preview/export encoder сохраняет timing. Preview не меняет bytes/ETag/registry/history принятого проекта.
6. Посмотрите именно этот preview, подтвердите просмотр и нажмите «Принять дубль». Смена trim/crop требует нового preview и server fingerprint. Accept одной project operation регистрирует immutable source, заменяет video scene и сохраняет полную прежнюю сцену.
7. Экспортируйте MP4 обычной кнопкой. «Вернуть предыдущий вариант» восстанавливает scene из accepted history, включая source, trim, duration и crop; снова экспортируйте для просмотра восстановленного фильма.

Если внешний агент изменил project после preview, Accept открывает сравнение контекста. Подтвердите новый preview текущей версии. Ещё одна правка до подтверждения обновляет диалог и требует нового выбора; server повторно проверяет ETag при commit. Candidate остаётся сохранённым. Простой P1 требует повторного preview после любого изменения ETag, включая другую сцену.

«Остановить отслеживание» — локальное действие. У этого adapter нет remote cancel; остановка UI и deadline не обещают отмену расходов или refund. После неизвестного исхода submit blind retry запрещён: сверяйте prediction в Replicate account. Прежний job сохранён; новая generation требует отдельного осознанного поручения.

Если ответ submit потерян и remote ID не сохранён, штатное продолжение — проверить задания/расходы в том же аккаунте провайдера и явно подтвердить оба пункта в «Зафиксировать проверку аккаунта». Приложение сохраняет неизменяемое решение пользователя, оставляя старый `submission_unknown`, первоначальные request/approval, `submissions: 1` и ошибку. Это не доказательство отмены или отсутствия счёта. Stop/reload/server restart не заменяют эту проверку. После неё Prepare создаёт **новый** intent; отправить его можно только с новым разрешением на показанный запрос/reference/расходы. Старый POST не повторяется и не меняется на successful/failed.

## CLI и возобновление

Команды выдают JSON в stdout; ошибка имеет ненулевой exit code. Подготовленный job ещё не является видео. В установленном runtime замените `node dist/cli.js` на `agent-motion-studio`.

```sh
node dist/cli.js generation capabilities --json
node dist/cli.js state projects/my-generated-remix/project.json --json
node dist/cli.js import projects/my-generated-remix/project.json --file reference-small.jpg --if-match ETAG --json
node dist/cli.js generation prepare projects/my-generated-remix/project.json --request request.json --json
node dist/cli.js generation list projects/my-generated-remix/project.json --json
node dist/cli.js generation status projects/my-generated-remix/project.json --job LOCAL_JOB_ID --json
```

`request.json` использует настоящий scene ID и ID импортированного reference:

```json
{
  "intentId": "unique-request-intent",
  "sceneId": "first-pour",
  "prompt": "Slow close-up of the supplied espresso cup. Preserve the cup and warm lighting.",
  "referenceAssetId": "IMPORTED_IMAGE_ID",
  "durationSeconds": 7.5625,
  "resolution": "480p"
}
```

Сохраняйте intent ID для повтора **того же** запроса. Другие параметры с этим ID отклоняются. Для новой разрешённой попытки нужен новый intent, бюджет и reference consent.

После конкретного разрешения создайте `approval.json`; `requestHash` возьмите из подготовленного job. Это не credentials и не глобальное право агента тратить деньги:

```json
{
  "requestHash": "HASH_FROM_PREPARE",
  "maxSubmissions": 1,
  "maxCostUsd": 0.05,
  "uploadReference": true
}
```

```sh
node dist/cli.js generation submit projects/my-generated-remix/project.json --job LOCAL_JOB_ID --approval approval.json --json
node dist/cli.js generation resume projects/my-generated-remix/project.json --job LOCAL_JOB_ID --json
node dist/cli.js generation download projects/my-generated-remix/project.json --job LOCAL_JOB_ID --json
node dist/cli.js state projects/my-generated-remix/project.json --json
node dist/cli.js generation preview projects/my-generated-remix/project.json --job LOCAL_JOB_ID --draft candidate-draft.json --if-match CURRENT_ETAG --out projects/my-generated-remix/candidate-preview --json
```

Одна команда `resume` выполняет ограниченное чтение status. Уважайте сохранённый `nextPollAt`; сервис не делает blind generation retry.

Для unknown без сохранённого remote ID после проверки аккаунта создайте отдельный `resolution.json`:

```json
{"requestHash":"HASH_FROM_UNKNOWN_JOB","accountChecked":true,"acknowledgePossibleCharge":true}
```

```sh
node dist/cli.js generation resolve-unknown projects/my-generated-remix/project.json --job UNKNOWN_LOCAL_JOB_ID --resolution resolution.json --json
node dist/cli.js generation status projects/my-generated-remix/project.json --job UNKNOWN_LOCAL_JOB_ID --json
```

Операция ничего не отправляет провайдеру и не даёт права повторить старый запрос. Публичный job сохраняет `status: submission_unknown`, число первоначальных отправок и `unknownResolution` с подтверждением пользователя. Повтор той же операции возвращает прежнюю запись. Новая попытка начинается отдельным `prepare` с новым `intentId` и требует нового requestHash/approval; первоначальный неизвестный job остаётся для сверки возможных расходов.

Candidate draft независим от ordinary scene patch:

```json
{
  "trimStartSeconds": 0,
  "fit": "cover",
  "focalPoint": { "x": 0.5, "y": 0.5 }
}
```

Посмотрите `candidate-preview/output.mp4`. После явного выбора используйте `previewId` и `projectHash` **этого** preview; повторяйте тот же operation ID только для reconciliation того же принятия:

```sh
node dist/cli.js generation accept projects/my-generated-remix/project.json --job LOCAL_JOB_ID --draft candidate-draft.json --preview PREVIEW_ID --if-match PREVIEW_PROJECT_HASH --operation-id unique-accept-operation --json
node dist/cli.js render projects/my-generated-remix/project.json --out projects/my-generated-remix/changed --no-cache --json
node dist/cli.js state projects/my-generated-remix/project.json --json
node dist/cli.js edit projects/my-generated-remix/project.json --action restore-scene.json --if-match CURRENT_ETAG --json
node dist/cli.js render projects/my-generated-remix/project.json --out projects/my-generated-remix/restored --no-cache --json
```

`restore-scene.json`: `{"type":"restore-scene","sceneId":"first-pour","revisionId":"REVISION_WITH_PREVIOUS_SCENE"}`. Сохраните revision ID до принятия; `state` показывает только недавнюю inline history, более старые retained snapshots находятся в `.history/`. Для переноса и retention см. [контракт проекта](MANIFEST.md). Для reject/stop используйте `generation reject|stop PROJECT --job ID --json`. Accepted take восстанавливается через project history; reject не отменяет accepted commit.

Atomic `operationReceipts` в manifest позволяют распознать уже принятый operation после сбоя между project commit и job ack, включая последующие edit/restore. Receipt не содержит prompt, credentials или URLs. Если исход принятия доказать нельзя, service возвращает diagnostic вместо автоматического повторного применения. Новая версия читает прежние v1/v2; старый бинарник со строгой schema может не читать новое optional receipt поле.

Если manifest уже опубликован, но финальное чтение результата не удалось, возвращается `INTERNAL_ERROR`, stage `project`, exit 4. Это не `PROJECT_NOT_FOUND/input/2` и не доказательство отказа до commit: источник, предыдущий snapshot и receipt могут уже быть сохранены. Сверьте свежий state и исходный intent, затем используйте тот же Accept для acknowledgement по процедуре ниже. Receipts сохраняются при edit/restore независимо от окна history; отсутствие старого receipt не доказывает, что операция не выполнялась. Не создавайте новый operation ID и не редактируйте receipt вручную.

Если candidate исчез или повредился до нового Accept и сервис доказал отказ **до commit**, он очищает только этот новый acceptance intent и инвалидирует его preview. Accepted bytes/история не меняются. Скачайте результат прежнего remote job, соберите новый точный preview и явно примите его; новая generation не требуется.

Для сохранённого до обновления или аварии acceptance intent действует более осторожное восстановление. Если accepted receipt отсутствует, `generation download` может вернуть потерянный candidate только после полного decode и совпадения SHA-256 с **первоначально просмотренным** candidate из сохранённого intent. Старые operation ID, hash, draft и preview сохраняются. Разные bytes возвращают `GENERATION_ACCEPT_CONFLICT`; старый intent не заменяется. После успешного восстановления повторите **тот же Accept**, передав первоначальные draft/preview/project hash/operation ID:

```sh
node dist/cli.js generation download projects/my-generated-remix/project.json --job LOCAL_JOB_ID --json
node dist/cli.js generation accept projects/my-generated-remix/project.json --job LOCAL_JOB_ID --draft ORIGINAL_CANDIDATE_DRAFT.json --preview ORIGINAL_PREVIEW_ID --if-match ORIGINAL_PREVIEW_PROJECT_HASH --operation-id ORIGINAL_ACCEPT_OPERATION_ID --json
```

Если receipt уже записан, повтор исходного Accept восстанавливает acknowledgement без скачивания и повторного применения. Если после неопределённого принятия изменился проект и receipt отсутствует, нужен разбор manifest/history; нельзя считать старую операцию неисполненной и автоматически применять candidate заново. Не удаляйте acceptance вручную и не придумывайте новый operation ID для обхода проверки. Истёкший remote output или отличающийся результат не разрешают незаметную перегенерацию.

## Локальные файлы и проверка

Accepted manifest/assets/history сохраняются через project API. `.studio/generation/` содержит private jobs, candidates, staging и runner locks; он не входит в source/runtime archives. Не публикуйте `.studio`, prompts или approval records. Для offline переноса accepted фильма сохраняйте весь `project.json` и `assets/`, включая источники history; ключ и `.studio` не нужны.

Для generation действует контракт **один manifest на каталог проекта**. Новый пустой store автоматически привязывается к имени canonical manifest через `.studio/generation/owner.json`. Другой manifest в той же папке получает `GENERATION_PROJECT_MISMATCH`, не видит прежние jobs и не может переиспользовать их: разместите второй проект в отдельном каталоге. Ключи/полные пути в owner metadata не записываются.

Старый непустой store без owner metadata не присваивается автоматически: получите `GENERATION_STORE_UNBOUND`. Сначала вручную проверьте, что все старые jobs относятся именно к выбранному manifest, затем выполните явную локальную привязку:

```sh
node dist/cli.js generation bind-store projects/my-generated-remix/project.json --json
```

Команда записывает только ownership; она не меняет accepted проект, jobs, расходы, candidates или runner lock, не запускает сеть и не разрешает повторные submissions. Не привязывайте неопознанные чужие jobs. Действующий чужой owner не заменяется этой командой.

После hard kill может остаться `runner.lock`; остановка внутри accepted operation также может оставить существующий `project.json.edit-lock`. Сначала проверьте, что локальный владелец действительно остановлен; удалите **только** подтверждённый stale lock, оставив jobs/candidates и project. Автоматическая очистка stale locks не реализована. Corrupt job не перезаписывается и не разрешает новый submit. Копия проекта с чужим job не даёт разрешения работать с прежним аккаунтом.

```sh
npm run check
npm run test:integration
npm run test:generation
npm run release:prepare
npm run verify:package
```

Media suite последовательна. `test:generation` — выбранные offline contracts и UI/media cases; она не является live evidence. `release:prepare` выполняется перед `verify:package`; это локальная упаковка, без publication. Fresh consumer проверяет installed capabilities/prepare/status/list без submit.

Только после разрешения на показанный job/reference/бюджет существует отдельный явный запуск:

```sh
npm run test:generation:live -- --project projects/my-generated-remix/project.json --job LOCAL_JOB_ID --approval approval.json --out artifacts/live-generation
```

Он использует production adapter, отправляет prepared job один раз либо наблюдает уже отправленный, ограничивает ожидание и скачивает готовый candidate. Он **не принимает** дубль автоматически. Его отчёт отделяет оценку от неизвестной фактической стоимости. Завершите preview → явный Accept → export → restore и сравнение decoded frames отдельно. Без такого запуска: **real provider NOT RUN; full workflow NOT RUN**. Художественное качество и независимый пользовательский опыт оцениваются после технической проверки, отдельной попыткой по README.
