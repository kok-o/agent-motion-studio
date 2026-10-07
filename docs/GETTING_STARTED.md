# Install, open and revise a film

Local editing needs Node.js ≥22.12, Chrome/Chromium/Edge for rendering and FFmpeg/ffprobe with libx264/AAC. No Python, model key or media-provider account is needed. Your external agent uses its own official authentication and quota/billing. The editor supports RU/EN; choose RU for the labels below. The language choice is saved in your browser.

## Install from source

Install [Node.js](https://nodejs.org/en/download), [Chrome](https://www.google.com/chrome/) and an FFmpeg build from the [FFmpeg download page](https://ffmpeg.org/download.html). On Windows, extract the build and add the folder containing `ffmpeg.exe` and `ffprobe.exe` to PATH. Reopen the terminal after installation.

### macOS tools (Terminal, zsh/bash)

If you use [Homebrew](https://brew.sh/), install missing tools and set paths in the terminal that will run the CLI:

```sh
brew install node@24 ffmpeg
brew install --cask google-chrome
export PATH="$(brew --prefix node@24)/bin:$PATH"
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
export FFMPEG_PATH="$(brew --prefix ffmpeg)/bin/ffmpeg"
export FFPROBE_PATH="$(brew --prefix ffmpeg)/bin/ffprobe"
node --version
git --version
```

Skip installation of tools you already have; an existing Node ≥22.12 is sufficient. These exports affect this terminal and its child processes. Set them in the agent's CLI environment too, or launch that agent from this terminal. They do not edit shell profiles or browser settings. Homebrew's current [Node 24 formula](https://formulae.brew.sh/formula/node@24), [FFmpeg formula](https://formulae.brew.sh/formula/ffmpeg) and [Chrome cask](https://formulae.brew.sh/cask/google-chrome) document their installation requirements. Without Homebrew, use the installers linked above and actual executable paths. The updated macOS sequence has not been executed by the maintainer; the external trial used macOS arm64 with existing Git/Node and Homebrew FFmpeg.

### Get the source: choose one route

HTTPS, using your existing GitHub authentication if the repository is private:

```sh
git clone --branch main --single-branch https://github.com/kok-o/agent-motion-studio.git
cd agent-motion-studio
```

SSH, when your GitHub SSH access is already configured:

```sh
git clone --branch main --single-branch git@github.com:kok-o/agent-motion-studio.git
cd agent-motion-studio
```

Or extract a supplied source ZIP and open a terminal in its repository root, the folder containing `package.json`. The supplied trial ZIP names it `agent-motion-studio`; GitHub ZIPs may use a suffix such as `-main`. Continue from that root:

```sh
npm ci --ignore-scripts
npm run build
node dist/cli.js doctor --json
```

Use `npm.cmd` on PowerShell if script policy blocks `npm.ps1`; no execution-policy change is required. Normal use does not require `git init` or maintainer tests. HTTPS and SSH authenticate separately. `could not read Username` in a noninteractive terminal, or an anonymous 404, does not determine whether your SSH account has access. Choose the route already configured for you, or use the supplied ZIP. For SSH diagnostics use `git ls-remote --heads git@github.com:kok-o/agent-motion-studio.git main`; [GitHub documents SSH connection checks](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/testing-your-ssh-connection) and [HTTPS/SSH authentication](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github#authenticating-with-the-command-line). Keep credentials in your usual credential helper/SSH agent; keep them out of clone URLs and shared logs.

Doctor must return `ready:true`, exit 0. It checks Node, a real browser launch, exact Canvas/PNG readback of a known pixel pattern, FFmpeg's libx264/AAC encoders and ffprobe. Exit 3 reports each failing dependency and recovery hint, even when the browser is missing. The renderer repeats its browser check on the actual loopback page before using cached output. Fix the indicated tools and rerun before rendering. Doctor does not install tools or certify a clean machine or every browser/platform combination.

| Failure | Fix |
| --- | --- |
| `node`/`npm` unknown | Install Node ≥22.12 and reopen the terminal |
| `dist/cli.js` missing | Run `npm ci --ignore-scripts`, then `npm run build` in the repository root |
| Browser missing/unable to launch | Install Chrome/Chromium/Edge or set `CHROME_PATH` to its executable |
| `BROWSER_UNSUPPORTED` | Use Chrome/Chromium/Edge as the renderer; keep privacy settings and sandbox enabled |
| FFmpeg/ffprobe missing | Add their bin folder to PATH or set executable paths below |
| libx264/AAC missing | Use an FFmpeg build with both encoders |
| Port busy | Stop the previous server with Ctrl+C or add `--port 4174` |
| `LOOPBACK_UNAVAILABLE`, `EPERM listen` | Run the CLI in a local terminal or permit these local CLI commands in your agent environment; they need to listen on `127.0.0.1` |

For nonstandard Windows locations, adapt these example paths in the terminal that launches the studio:

```powershell
$env:CHROME_PATH = 'C:\Tools\Chromium\chrome.exe'
$env:FFMPEG_PATH = 'C:\Tools\ffmpeg\bin\ffmpeg.exe'
$env:FFPROBE_PATH = 'C:\Tools\ffmpeg\bin\ffprobe.exe'
node dist/cli.js doctor --json
```

Brave may report a Chrome version while altering Canvas readback between sessions. [Brave describes this session-based randomization](https://brave.com/privacy-updates/4-fingerprinting-defenses-2.0/); the external technical trial observed it in separate default Brave sessions. Known Brave executables and Brave's identity API are rejected for rendering, with `BROWSER_UNSUPPORTED`. You can view the studio UI in Brave while `CHROME_PATH` selects Chrome/Chromium/Edge for the isolated renderer. No fingerprinting-disable flags or personal browser profile are used. Actual Brave/macOS verification of this fix remains pending; controlled diagnostics and repeatability checks run on Windows.

To compare fresh renders in one environment, run two separate CLI processes sequentially with fresh output folders:

```sh
node dist/cli.js render film/project.json --out artifacts/repeat-a --no-cache --json
node dist/cli.js render film/project.json --out artifacts/repeat-b --no-cache --json
```

Both reports must say `cache.status: "disabled"`. Compare full decoded frames and audio as well as MP4 hashes. Keep the project, OS, browser/tool versions and `AMS_LOW_MEMORY` setting identical; a cache hit or repeated frames in one browser session does not establish independent-run repeatability.

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

The header and browser tab use the opened project's folder name (`project.json`/`manifest.json`), or the filename for a named JSON file. The manifest ID stays unchanged. An idle Ctrl+C reports `Local studio stopped.`, exit 0. If a preview/export is active, shutdown cancels it, waits for cleanup and reports the cancellation; earlier exports remain. The page reports loss of the local server and retains its unsaved draft in that tab.

### Local processes and loopback

Keep `studio` running in one terminal; use your agent or a second terminal for CLI edits/exports. The studio is a Node HTTP server bound to `127.0.0.1`. Validation, preview and render also start a short-lived loopback server for bundled fonts/assets, an isolated headless browser with a temporary profile, and local FFmpeg/ffprobe processes. The private session URL works on the same machine and changes at restart. HTTPS/SSH above concern downloading source; they do not change the local studio address.

An agent environment must allow the specific CLI commands to spawn local tools, listen on loopback and write the project/output folders. `state` can work in a read-only environment while `validate` fails at `listen`; this is an environment permission failure. Use the official client's permission workflow for those commands or run them in a normal local terminal. Keep Chromium's sandbox enabled. Rendering does not require a hosted server, video-provider account or upload.

## Edit, preview, accept and export

1. Select scene 2, `first-pour`. Choose **Выбранный исходник / дубль** (source/take) → `first-drops.mp4`, trim start 1 s, duration 7 s.
2. Click **Предпросмотр сцены** (preview scene). It renders the unsaved draft silently at output resolution. Watch trim/crop; project/history stay unchanged. Changing fields makes that preview stale.
3. Click **Сохранить сцену** (save scene), then **Экспорт MP4** (export MP4). Wait for verified output in the main player/export list. UI exports live in the project's `exports/` folder.
4. Click **Вернуть предыдущий вариант** (restore previous take), export again, close the page and reopen. Original sources remain.
5. For your own material use **Импорт файлов** (import files), then **В сцену** (add to scene). Imports copy immutable sources. Music uses a separate track; source-video audio is muted.

A normal CLI/API `render ... --out NEW_DIRECTORY` keeps that output and saves a separate MP4/manifest snapshot in the project's `exports/` library. Frames/cache are not duplicated. Its result includes `studioExport`; if the library cannot be written safely, the verified `--out` remains and a warning explains why the studio copy is unavailable. Completed exports appear in an open visible studio tab within about two seconds; **Перечитать проект** also refreshes the list. Unsaved form fields and earlier exports are preserved. An already selected older export stays selected; a paused latest export follows new output. Scene previews remain separate and do not enter this full-export library. Reopen the root project JSON with its assets/history; an export's manifest snapshot identifies that video version and uses the project-root assets.

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
