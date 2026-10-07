# Первый запуск: распространяемый coffee-проект

Основной маршрут — локальный комплект `agent-motion-studio-first-user-0.1.0-<SHA>.zip`, подготовленный организатором из конкретного checkout. Git SHA, dirty flag, версия и хеш runtime записаны в `KIT_MANIFEST.json`; `SHA256SUMS.txt` проверяет все выдаваемые файлы и manifest. Внутри `START_HERE_RU.md` находится эта же инструкция с подставленным SHA и переносимыми ссылками. Исходный checkout и личные файлы разработчика для запуска не нужны.

Это developer preview 0.1.0, без registry publication. `SELF_RUN.json`, если присутствует, подтверждает только техническую проверку комплекта на указанной среде. Он не является результатом нового человека или живой модельной сессии. Независимый пользователь заполняет [пустой протокол](USER_TRIAL_RESULTS_RU.md) после собственных действий; поля просмотра, слуха и удобства агент не заполняет.

## Что получит участник

Распакуйте ZIP в новую папку и откройте его единственный корневой каталог. Имена могут содержать SHA и суффикс `-dirty`; dirty-комплект предназначен только для подготовки и не должен выдаваться как проверенный коммит.

| Файл | Назначение |
| --- | --- |
| `START_HERE_RU.md` | Эта стартовая инструкция |
| `agent-motion-studio-0.1.0.tgz` | Локальный runtime с bundled skill и coffee-примером |
| `coffee-original.mp4` | Разрешённый исходный 20-секундный remix для просмотра |
| `CREDITS.md`, `MEDIA_LICENSE.md` | Scott Schiller; remix CC BY-SA 2.0, отдельная музыка MIT |
| `LICENSE`, `FONTS_OFL.txt` | Лицензии приложения и шрифтов |
| `RESULTS_BLANK_RU.md` | Пустой протокол человека; не заменять отчётом smoke |
| `KIT_MANIFEST.json`, `SHA256SUMS.txt` | SHA исходников, версия, состав, хеши и область проверки |
| `SELF_RUN.json` (после smoke) | Обезличенные команды, exit codes, среда и технические результаты |

Полный редактируемый проект с assets/credits/provenance создаётся штатным `init` из этого runtime. Дополнительный ZIP проекта и исходники не нужны. Сохраните исходный комплект отдельно от рабочей копии. До установки посмотрите и прослушайте `coffee-original.mp4` обычным плеером; запись оценки делает человек. Не передавайте приватные session URLs.

Контроль суммы на Windows: `Get-FileHash -Algorithm SHA256 .\agent-motion-studio-0.1.0.tgz`; на macOS: `shasum -a 256 agent-motion-studio-0.1.0.tgz`; на Linux весь список: `sha256sum -c SHA256SUMS.txt`. Сравните с manifest/checksum list. Организатор проверяет SHA самого ZIP по внешнему release-candidate отчёту; ZIP не содержит собственного хеша.

## Установить инструменты и runtime

Нужны Node.js ≥22.12, Chrome/Chromium/Edge для рендера, FFmpeg с libx264/AAC и ffprobe на PATH. Установка этих системных инструментов описана в [GETTING_STARTED](GETTING_STARTED.md); source-инструкцию клонирования/сборки для этого комплекта пропускайте. На macOS настройте там `CHROME_PATH` в том же Terminal, где будет работать CLI/агент. Brave может показывать UI, но не используется как renderer. Новая macOS-проверка комплекта отдельно NOT RUN, пока нет соответствующего отчёта. Исправления и установка на чистую ОС не выводятся из Windows self-run.

Из корневой папки распакованного комплекта, PowerShell:

```powershell
New-Item -ItemType Directory workspace
Set-Location workspace
npm.cmd init -y
npm.cmd install --ignore-scripts --omit=dev --no-audit --no-fund ../agent-motion-studio-0.1.0.tgz
node node_modules/agent-motion-studio/dist/cli.js doctor --json
```

macOS/Linux, из той же корневой папки:

```sh
mkdir workspace
cd workspace
npm init -y
npm install --ignore-scripts --omit=dev --no-audit --no-fund ../agent-motion-studio-0.1.0.tgz
node node_modules/agent-motion-studio/dist/cli.js doctor --json
```

Продолжайте при `ready:true`, exit 0. При exit 3 исправьте указанную зависимость и повторите doctor. `npm.cmd` на Windows обходит блокировку npm.ps1 без изменения execution policy. npm скачивает зависимости, если они не закэшированы; комплект не обещает offline clean-machine setup. TypeScript, Git checkout и сборка пользователю не нужны. Пути с пробелами заключайте в кавычки. Если используете `AMS_LOW_MEMORY=1`, задайте его до doctor/агента/CLI и запишите в протоколе; рендеры запускайте последовательно.

## Подключить свой официальный агент

Из `workspace`, выберите один клиент:

```sh
node node_modules/agent-motion-studio/scripts/install-agent-skill.mjs --client codex --scope project
```

Для Claude Code замените только `codex` на `claude`. Установщик сохраняет login/config и существующие изменённые skills. Codex получает `.agents/skills/agent-motion-studio`, Claude Code — `.claude/skills/agent-motion-studio`. Bundled skill — инструкция для агента, а не сам редактор. При конфликте сохраните свою копию за пределами skills перед обновлением.

Откройте официальный клиент в `workspace` со своим обычным подключением. Codex: `$agent-motion-studio`; Claude Code: `/agent-motion-studio`. При необходимости перезапустите клиент для discovery. Запишите discovery, чтение skill и реальные CLI-вызовы; установка папки этого не доказывает. Не меняйте login/config ради smoke. Если у вас нет разрешённого доступа/бюджета для модельной сессии, отметьте её NOT RUN; ручной путь ниже проверяет редактор отдельно. Ключ или подписка сами по себе не разрешают платные calls/uploads. Видеопровайдеры здесь не используются.

## Открыть проект один раз

Из `workspace`:

```sh
node node_modules/agent-motion-studio/dist/cli.js init coffee-ritual --dir film
node node_modules/agent-motion-studio/dist/cli.js state film/project.json --json
node node_modules/agent-motion-studio/dist/cli.js studio film/project.json
```

Запишите `manifest.revision` из state как исходную ревизию этого теста. `init` нужен один раз; не повторяйте его поверх существующего `film`. Сохраните `film` целиком с assets, history, credits и provenance. Откройте новую полную session URL, напечатанную CLI; держите терминал открытым. Студия на `127.0.0.1`; агенту/второму терминалу нужны локальные процессы, loopback и запись workspace. При `EPERM listen` используйте штатное разрешение конкретных CLI-команд или обычный терминал, сохраняя sandbox браузера.

Выберите RU. Главный player пока может говорить «Нет экспорта»: исходный MP4 лежит отдельно в комплекте. Агент может сначала выполнить полный `render film/project.json --out baseline --no-cache --json`; обычный экспорт появится в открытой студии. Источники и принятый проект при render сохраняются.

## Своя правка → preview → edit → export

Человек самостоятельно выбирает обычную правку второй сцены `first-pour` и сообщает её агенту, например изменение длительности. Не используйте искусственный пример как будто это выбор участника:

```text
Продолжи film/project.json через установленный agent-motion-studio.
Прочитай state и запиши исходную manifest.revision этого теста.
Во второй сцене измени: [моя правка].
Сначала preview без записи, покажи его мне. После моего принятия
примени ту же правку штатным edit с актуальным ETag и экспортируй
полный MP4 в новую папку. Сохрани источники, историю и другие сцены.
Без media-provider calls, uploads, публикации или изменения моего login.
```

Preview без звука и не сохраняет accepted JSON/history. Агент использует `state → preview --action ACTION --if-match ETAG → edit` той же action с preview.projectHash → отдельный `render --out changed --no-cache`; [подробный workflow](AGENT_WORKFLOW_RU.md). Если проект изменился извне, нужна новая проверка/явное разрешение конфликта. Посмотрите preview до принятия; полный MP4 с музыкой оценивайте отдельно.

Ручной fallback: выберите вторую сцену, измените поле, нажмите «Предпросмотр сцены», после просмотра «Сохранить сцену», затем «Экспорт MP4». Это не подтверждение работы модели. Старый полный экспорт остаётся в списке; новый появляется автоматически. В результате CLI проверяйте `studioExport`; при `unavailable` исходный MP4 сохранён, но студийная копия недоступна.

## Restore исходной ревизии и reopen

Попросите агента восстановить **записанную исходную ревизию этого теста** через action `{"type":"restore","revisionId":"INITIAL_REVISION"}`, актуальный state/ETag и обычный edit. Не копируйте старый JSON поверх проекта. Затем экспортируйте в новую папку `restored`, сохранив baseline/changed и library. История восстановления получает новую revision; сравниваются сцены/источники с исходным состоянием, а не весь JSON с новыми snapshots.

Остановите studio с Ctrl+C и снова откройте из `workspace`:

```sh
node node_modules/agent-motion-studio/dist/cli.js studio film/project.json
```

Откройте **новую** напечатанную session URL. Проверьте имя `film`, предыдущие экспорты, восстановленные сцены, assets/credits/history. `new`, `init`, переустановка и повторная распаковка для продолжения не нужны. Непрерывно посмотрите и прослушайте исходный, изменённый и восстановленный MP4. Запишите собственные замечания, помощь и время в пустом протоколе; не приписывайте техническому render оценку удобства, качества или спроса.

## Для организатора: подготовка и границы

Из текущего checkout: `npm run release:prepare`, затем `npm run verify:package`, строго последовательно. Последняя команда также выполняет short kit self-run вне checkout, в пути с пробелом/кириллицей. Самостоятельно повторить только комплект: `npm run verify:user-kit`. `artifacts/release/latest.json` указывает ZIP/папку комплекта; после smoke он содержит обезличенный `SELF_RUN.json`, проверенную среду и обновлённые суммы. Сначала проверьте source.dirty=false и соответствие Git SHA нужному head; dirty-кандидат не проходит этот smoke.

Source ZIP остаётся отдельным дополнительным архивом с корнем `agent-motion-studio-0.1.0-source`. Его не требуется распаковывать для описанного маршрута. Хеш внешнего kit ZIP находится в candidate.json/SHA256SUMS родительского release-каталога; содержимое не пытается ссылаться на собственный хеш.

Организатор вручную передаёт проверенный комплект и отдельно собирает протокол. Никакой автоматической рассылки, registry/release publication или изменения доступа нет. Исторический комплект main `2d45a83` с лично принятым fastgrep остаётся дополнительным вручную выдаваемым вариантом; его приёмка Enter/timeout/звука сохранена, но он не является обязательным входом или текущей сборкой для нового пользователя. [Факты и ограничения](STATUS.md).
