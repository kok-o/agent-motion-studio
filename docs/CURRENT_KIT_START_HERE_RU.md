# Начните здесь: выданный комплект Agent Motion Studio

Это единственный стартовый маршрут **этого** комплекта. Сохраните исходный ZIP отдельно и распакуйте рабочую копию в новую папку. Версия приложения остаётся experimental developer preview; наличие комплекта не означает новый стабильный релиз или выполненную человеческую приёмку.

{{KIT_IDENTITY}}

{{DIRTY_NOTICE}}
Сверьте эту таблицу с `KIT_MANIFEST.json` и runtime-строкой в `SHA256SUMS.txt`. Список проверяет все выдаваемые файлы и сам manifest. SHA-256 внешнего ZIP выдаётся отдельно: архив не может содержать собственный хеш. Не подставляйте checksum другого комплекта с той же версией приложения.

Проверка runtime на Windows: `Get-FileHash -Algorithm SHA256 .\{{RUNTIME_FILE}}`; на macOS: `shasum -a 256 {{RUNTIME_FILE}}`; на Linux: `sha256sum -c SHA256SUMS.txt`. Проверка содержимого не подтверждает происхождение сама по себе: внешний ZIP checksum и source SHA должны быть получены вместе с комплектом от его отправителя.

Статус технической проверки смотрите в `KIT_MANIFEST.json` → `verification`. `SELF_RUN.json`, если вложен, описывает только фактический технический self-run и его среду. Независимая установка, модельная сессия, просмотр/прослушивание и удобство человека учитываются отдельно; подготовка комплекта их не выполняет. [Пустой протокол человека](USER_TRIAL_RESULTS_RU.md) заполняет сам участник после своих действий.

## Инструменты и локальная установка

Нужны **Node.js ≥22.12**, Chrome/Chromium/Edge для рендера, FFmpeg с libx264/AAC и ffprobe. Комплект не устанавливает их молча. [Установка инструментов и диагностика](GETTING_STARTED.md) доступны внутри ZIP до npm install; source checkout и TypeScript build для этого пути не нужны. Brave может показывать Studio, но не подходит как renderer.

Откройте терминал в распакованной папке, где находятся этот файл и runtime. Создайте новую рабочую папку; существующий принятый фильм не перезаписывайте:

```sh
mkdir workspace
cd workspace
npm init -y
npm install --ignore-scripts --omit=dev "../{{RUNTIME_FILE}}"
npx --no-install agent-motion-studio doctor --json
```

npm может скачать зависимости, если их нет в cache. На Windows используйте `npm.cmd` и `npx.cmd`, если PowerShell блокирует `.ps1`; менять execution policy не требуется. Продолжайте, когда doctor вернёт `ready:true`, exit 0. Exit 3 перечисляет отсутствующие инструменты и подсказки. Doctor не доказывает clean-OS установку или весь workflow.

## Открыть фильм и продолжить

Из той же папки `workspace` выполните:

```sh
node node_modules/agent-motion-studio/scripts/install-agent-skill.mjs --client codex --scope project
npx --no-install agent-motion-studio init coffee-ritual --dir film
npx --no-install agent-motion-studio studio film/project.json
```

Skill необязательна для ручного редактирования. Для Claude Code замените `--client codex` на `--client claude`. Installer сохраняет отличающуюся установленную skill и не меняет login/settings. Запустите официальный клиент в `workspace`: Codex использует `$agent-motion-studio`, Claude Code — `/agent-motion-studio`. Discovery skill не является выполненной модельной сессией; подписка/API клиента и его лимиты учитываются отдельно.

Откройте полный session URL из терминала только локально, не публикуйте его; оставьте сервер работающим. Посмотрите и прослушайте `coffee-original.mp4`. Измените выбранную сцену, соберите Preview, нажмите Play и явно сохраните принятую правку. Экспортируйте в новый output, затем восстановите предыдущий вариант через историю. [Пошаговое руководство](GETTING_STARTED.md), [работа с агентом](AGENT_WORKFLOW_RU.md), [composition](COMPOSITION.md) описывают поддержанные действия и ограничения. [STATUS](STATUS.md) — snapshot этой сборки, не свидетельство будущей проверки или человеческой оценки.

Для повторного открытия запустите **только** `npx --no-install agent-motion-studio studio film/project.json`. Не повторяйте `new`/`init` для существующего фильма. Ctrl+C останавливает ваш сервер; при следующем старте будет новый session URL.

В Studio доступны «+ Композиция со стилем» и «Стиль выбранной композиции»: calm product, kinetic poster, editorial. Явно выберите роли/разрешённые группы и защиту ручных полей, затем Preview → Apply или Cancel. Обычные объекты остаются редактируемыми. [Installed compile/preview, ограничения и примеры запросов](AUTHORING_STYLES.md). Restyle с captions пока недоступен; обычная правка и scene preview сохраняются. Озвучка без captions и музыка поддерживаются. Звук видео включается отдельно для каждой сцены, по умолчанию Off.

## Сохранить и перенести результат

Сохраните **всю папку `film`** с исходным JSON, всеми assets и их credits/licenses/provenance, скрытой `.history/` и принятыми `exports/`. Сохраняйте относительную структуру: одного `project.json` недостаточно для старых retained revisions. При передаче исключайте только caches, приватные `.studio` jobs и временные session artifacts; исходную приватную копию сохраните для восстановления неопределённых generated operations. Accepted JSON меняется штатным project API, а `resolved-manifest.json` не является редактируемым проектом.

`CREDITS.md` и `MEDIA_LICENSE.md` рядом с этой инструкцией относятся к разрешённому coffee remix; сохраняйте их при передаче адаптации. Локальный editor не требует media-provider key. Этот маршрут не разрешает paid calls, загрузку материалов, новый пилот или публикацию.
