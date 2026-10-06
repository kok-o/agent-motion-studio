# Install, open and revise a film

Local editing needs Node.js ≥22.12, Chrome/Chromium and FFmpeg/ffprobe with libx264/AAC. No Python, model key or media-provider account is needed. Your external agent uses its own official authentication and quota/billing. The editor supports RU/EN; choose RU for the labels below. The language choice is saved in your browser.

## Install from source

Install [Node.js](https://nodejs.org/en/download), [Chrome](https://www.google.com/chrome/) and an FFmpeg build from the [FFmpeg download page](https://ffmpeg.org/download.html). On Windows, extract the build and add the folder containing `ffmpeg.exe` and `ffprobe.exe` to PATH. Reopen the terminal after installation.

Clone the repository, or download its source ZIP and open a terminal in the extracted folder:

```sh
git clone https://github.com/kok-o/agent-motion-studio.git
cd agent-motion-studio
npm ci --ignore-scripts
npm run build
node dist/cli.js doctor --json
```

Use `npm.cmd` on PowerShell if script policy blocks `npm.ps1`; no execution-policy change is required. Source ZIP users skip clone/cd. Normal use does not require `git init` or maintainer tests.

Doctor must return `ready:true`, exit 0. It checks Node, a real browser launch, FFmpeg's libx264/AAC encoders and ffprobe. Exit 3 reports each failing dependency and recovery hint, even when the browser is missing. Fix the indicated tools and rerun before rendering. It does not install tools or certify a clean machine.

| Failure | Fix |
| --- | --- |
| `node`/`npm` unknown | Install Node ≥22.12 and reopen the terminal |
| `dist/cli.js` missing | Run `npm ci --ignore-scripts`, then `npm run build` in the repository root |
| Browser missing/unable to launch | Install Chrome/Chromium or set `CHROME_PATH` to its executable |
| FFmpeg/ffprobe missing | Add their bin folder to PATH or set executable paths below |
| libx264/AAC missing | Use an FFmpeg build with both encoders |
| Port busy | Stop the previous server with Ctrl+C or add `--port 4174` |

For nonstandard Windows locations, adapt these example paths in the terminal that launches the studio:

```powershell
$env:CHROME_PATH = 'C:\Tools\Chromium\chrome.exe'
$env:FFMPEG_PATH = 'C:\Tools\ffmpeg\bin\ffmpeg.exe'
$env:FFPROBE_PATH = 'C:\Tools\ffmpeg\bin\ffprobe.exe'
node dist/cli.js doctor --json
```

## Install a provided runtime archive

Use this route if you already have `agent-motion-studio-0.1.0.tgz`. No npm-registry package or published release archive is promised. In an empty workspace, replace the archive path with its actual location:

```sh
npm init -y
npm install --ignore-scripts --omit=dev "../downloads/agent-motion-studio-0.1.0.tgz"
npx --no-install agent-motion-studio doctor --json
node node_modules/agent-motion-studio/scripts/install-agent-skill.mjs --client codex --scope project
npx --no-install agent-motion-studio init coffee-ritual --dir film
npx --no-install agent-motion-studio studio film/project.json
```

The runtime needs the same tools; it skips the TypeScript build. Use `npx.cmd` on PowerShell if policy blocks `npx.ps1`. In later examples substitute `npx --no-install agent-motion-studio` for `node dist/cli.js` in this workspace.

## Connect your official agent

From the built source workspace:

```sh
node scripts/install-agent-skill.mjs --client codex --scope project
```

Use `--client claude` for Claude Code, or `both`. The offline installer preserves edited skills; if it reports a conflict, move a backup outside the skills directory before updating. Login/settings stay intact. Launch your agent in this same workspace; the copied skill folder is guidance, not the executable. Codex discovers `.agents/skills`, Claude Code `.claude/skills`. Use `$agent-motion-studio` or `/agent-motion-studio`. Restart the client if discovery does not refresh. [Official Codex locations](https://learn.chatgpt.com/docs/build-skills) · [Claude Code skills](https://code.claude.com/docs/en/skills).

## Open once, then reopen

For a first remix create your personal copy once:

```sh
node dist/cli.js init coffee-ritual --dir projects/my-first-remix
node dist/cli.js studio projects/my-first-remix/project.json
```

For an existing film, use only `studio PATH_TO_PROJECT/project.json`. Extract a supplied project ZIP with its assets first. Keep sources/history; do not run `new`/`init` over an accepted film. A genuinely new film uses `new --dir projects/my-film`.

Open the complete session URL printed by the terminal. Keep it private and leave the server running; Ctrl+C stops it. To reopen later, repeat only `studio` and use the newly printed URL. Restart creates a new session URL. The main player shows completed exports; the inspector's source player shows unedited media.

## Edit, preview, accept and export

1. Select scene 2, `first-pour`. Choose **Выбранный исходник / дубль** (source/take) → `first-drops.mp4`, trim start 1 s, duration 7 s.
2. Click **Предпросмотр сцены** (preview scene). It renders the unsaved draft silently at output resolution. Watch trim/crop; project/history stay unchanged. Changing fields makes that preview stale.
3. Click **Сохранить сцену** (save scene), then **Экспорт MP4** (export MP4). Wait for verified output in the main player/export list. UI exports live in the project's `exports/` folder.
4. Click **Вернуть предыдущий вариант** (restore previous take), export again, close the page and reopen. Original sources remain.
5. For your own material use **Импорт файлов** (import files), then **В сцену** (add to scene). Imports copy immutable sources. Music uses a separate track; source-video audio is muted.

To ask your agent to continue the same film:

```text
Use agent-motion-studio. Continue projects/my-first-remix/project.json.
Read state first. Change only the second scene; preserve other scenes,
sources and history. Preview before acceptance, export to a new folder.
Use local tools only; no paid calls or uploads. Do not create a new film.
```

[Russian continuation and exact CLI steps](AGENT_WORKFLOW_RU.md) · [Project operations](MANIFEST.md).

## Conflicts, transfer and limits

If an agent edits while your form is dirty, **Перечитать проект** (reload) compares both versions. **Применить мои изменённые поля** applies only your changed fields to the fresh version. **Принять внешнюю, отбросить черновик** discards your draft after your explicit choice. A second edit requires another decision; never blindly retry a stale save.

Transfer `project.json`, all accepted `assets/` including history sources, and credits/licenses. Exclude caches, `.studio` jobs, session URLs and private reports. Do not use `resolved-manifest.json` as editable input. Public example derivatives require their credits. [Compatibility](COMPATIBILITY.md) · [Independent user trial](USER_TRIAL_RU.md).

1080p/30 fps, 16:9/9:16, 12 scenes, 24 assets, 1–60 seconds, 100 snapshots. Preview is silent/on demand; narration/captions need full export. v1 remains readable; accepted edits migrate to v2 with history. No HDR, realtime multitrack timeline or local neural-video inference. Keep renders sequential. Failed exports preserve previous results.

After a hard kill, inspect the PID in `<project>.edit-lock` or `<output>/.render.lock`; remove a stale lock only after verifying that process stopped. The server is loopback-only for one user. Keep diagnostic paths and personal media out of public reports.
