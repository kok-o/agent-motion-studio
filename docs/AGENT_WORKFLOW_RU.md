# Фильм через своего агента

Основной workflow: brief → поддерживаемые сцены → локальный preview → правки → MP4 и редактируемый проект. Для анимации, титров и монтажа локальных материалов ключ видеогенератора не нужен. Модель агента работает через ваш официальный клиент или отдельный API-доступ.

## Установка skill в checkout

После установки зависимостей и `npm run build`:

```sh
node scripts/install-agent-skill.mjs --client codex --scope project --dry-run
node scripts/install-agent-skill.mjs --client codex --scope project
node dist/cli.js doctor --json
```

Для Claude Code замените `codex` на `claude`; `both` копирует skill для обоих клиентов. `--dir` выбирает существующую рабочую папку; `--scope user` устанавливает skill в домашнюю папку. Установщик работает offline, не запускает клиентов и не меняет их login/settings. Отличающийся существующий skill сохраняется: для обновления сначала переместите его резервную копию за пределы каталога skills.

В установленном runtime команда установки:

```sh
node node_modules/agent-motion-studio/scripts/install-agent-skill.mjs --client codex --scope project
npx --no-install agent-motion-studio doctor --json
```

Codex обнаруживает `.agents/skills/agent-motion-studio/SKILL.md`, Claude Code — `.claude/skills/agent-motion-studio/SKILL.md`. Запустите клиент в рабочей папке студии; при необходимости перезапустите его. В Codex используйте `$agent-motion-studio`, в Claude Code — `/agent-motion-studio`. Проверьте, что клиент прочитал этот skill и действительно вызывает CLI. [Официальная документация Codex](https://learn.chatgpt.com/docs/build-skills) и [Claude Code](https://code.claude.com/docs/en/skills), проверены 2026-10-06.

## Первое поручение и правки

Создание ContextOS-фильма через Codex, две демонстрационные правки, restore/reopen и реальный API-agent уже выполнены 2026-10-06. [Границы проверки](AGENT_VALIDATION.md). Не повторяйте этот фильм для проверки нового клиента: продолжайте готовый проект. Ниже первое поручение относится только к новому brief.

```text
Используй agent-motion-studio. Сделай рекламный ролик на 20 секунд
для моего проекта: [описание и разрешённые материалы]. Формат 16:9.
Создай новый проект через new и штатные edit/import, придумай 3–4 сцены,
анимацию, короткие титры и локальную музыку. Экспортируй MP4 и contact sheet.
Покажи результат и сохрани проект для правок. Внешние вызовы — только в
разрешённом режиме. Ключ видеогенератора для этого задания не нужен.
```

Следующие сообщения могут быть короткими: «Измени композицию второй сцены», «Сделай первый титр крупнее». Агент читает актуальное состояние, делает preview без записи и применяет правку через project API с ETag. История позволяет вернуть отдельную сцену или целый фильм. [Подробный контракт](../skills/agent-motion-studio/references/brief-to-film.md).

## Продолжение существующего фильма

В новом официальном клиенте начните из рабочей папки, где установлен runtime или построен checkout. Подключите skill; передайте путь к существующему `project.json`. Не используйте `new`/`init` для продолжения. Для готового ContextOS на машине автора путь — `projects/contextos-ad-2026-10-06/project.json`; получатель ZIP использует путь внутри распакованной копии с assets/history.

```text
Используй agent-motion-studio. Продолжи существующий проект
[путь к project.json]. Прочитай state и историю, не создавай фильм заново.
Измени только [сцена и правка]. Сделай preview без сохранения, затем
прими разрешённую правку с актуальным ETag и экспортируй в новую папку.
Сохрани остальные сцены, исходники и историю. Только локальные операции,
без платных вызовов, uploads и публикации.
```

Сам Codex/Claude Code расходует лимиты или API-бюджет клиента. При запрете платных вызовов и API-режиме не выполняйте новый модельный запрос и не меняйте login автоматически. Доступный здесь Codex CLI использует API-key auth; свежий процесс подтвердил native discovery без `turn/start`. Claude Code отсутствует. Это ограничения проверки, а не доказанная несовместимость.

Ручная CLI-правка в PowerShell из checkout, с отдельным action-файлом и новой папкой preview:

```powershell
$film = 'projects/my-first-remix/project.json'
$before = node dist/cli.js state $film --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Read state failed' }
$action = @{ type='edit-scene'; sceneId='first-pour'; patch=@{ fit='contain' } }
[IO.File]::WriteAllText((Join-Path (Get-Location) 'change.json'), ($action | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
$preview = node dist/cli.js preview $film --action change.json --if-match $before.etag --out artifacts/my-preview-1 --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $preview.stale) { throw 'Preview failed or stale; read state again' }
```

Посмотрите `artifacts/my-preview-1/output.mp4`; preview не пишет принятый проект. Для принятия этой правки после просмотра, в том же терминале:

```powershell
node dist/cli.js edit $film --action change.json --if-match $preview.projectHash --json
if ($LASTEXITCODE -ne 0) { throw 'Conflict or invalid edit; reread and preview again' }
node dist/cli.js render $film --out artifacts/my-export-1 --json
node dist/cli.js studio $film
```

Для следующих проверок выбирайте новые output-папки. Restore выполняется штатным `restore-scene`/`restore` с текущим ETag; не копируйте старый JSON поверх новой работы. [Ручной workflow](GETTING_STARTED.md).

## API-ключ модели агента

В официальном Codex CLI поддерживается API-режим: ключ передаётся через stdin в `codex login --with-api-key`. Это меняет login клиента, поэтому настройку выполняет пользователь; она не нужна для уже авторизованного подписочного клиента. На PowerShell с ключом в environment:

```powershell
$env:OPENAI_API_KEY | codex login --with-api-key
codex
```

API-доступ тарифицируется отдельно от подписки. [Официальная авторизация Codex](https://learn.chatgpt.com/docs/auth). У Claude Code также есть официальный API-режим; следуйте [его документации](https://code.claude.com/docs/en/authentication). Студия не читает consumer-токены клиентов и не проксирует их подписочные credentials.

В checkout и runtime есть небольшой отдельный OpenAI Responses runner для тех же локальных операций. Он не выполняет shell-код модели, не вызывает media provider и не меняет login Codex. Создайте файл `brief.txt`; разрешённые изображения/видео/музыку можно явно указать повторяемым `--asset`:

```sh
node scripts/api-agent.mjs --brief brief.txt --out artifacts/api-film --dry-run
node scripts/api-agent.mjs --brief brief.txt --out artifacts/api-film --env-file .env --budget-usd 2 --allow-api
```

Для runtime используйте `node node_modules/agent-motion-studio/scripts/api-agent.mjs` с теми же параметрами. Ключ `OPENAI_API_KEY` берётся из environment либо из явно указанного `.env`, который не отправляется модели. Укажите разрешённый бюджет: наличие ключа не означает разрешения на расходы. Brief и текстовое состояние проекта отправляются в OpenAI; байты локальных материалов не отправляются.

Runner фиксирует модель `gpt-5.4-mini`, стандартный тариф, число запросов и выходных токенов. Перед каждым запросом сохраняет консервативный резерв на полное окно модели; при неизвестном исходе резерв остаётся расходом и автоматического повтора нет. Отчёт показывает оценку по API usage и сохранённой цене, а не банковский счёт. Бюджет действует на одну новую папку запуска; несколько запусков суммируются отдельно. Проверьте актуальную [цену модели](https://developers.openai.com/api/docs/models/gpt-5.4-mini) перед новым использованием. Если ключа/бюджета нет, используйте текущую сессию официального клиента и локальный CLI.

Для существующего проекта передайте `--project projects/film/project.json`: это разрешает агенту менять только этот проект через общие операции и требует preview перед правками сцен. Предыдущие экспорты и accepted sources не перезаписываются. Отчёт сохраняется в новой `--out` папке. Preview не предоставляет модели визуальную оценку: итоговые кадры и звук следует просмотреть.

## Граница проверки

Отдельно фиксируйте локальный renderer, текущую сессию Codex, независимую Claude Code сессию, API-agent, восстановление и визуальную/звуковую проверку. Offline tests не заменяют реальные подключения. Возможность установить skill не означает, что каждый клиент уже проверен. Replicate и новые нейросетевые клипы остаются отдельным optional workflow.
