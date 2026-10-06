> Историческая справка, архивирована 6 октября 2026. Это не поручение и не текущий статус. Единственный рабочий план — [PLAN_V0.2_RU.md](../../PLAN_V0.2_RU.md); актуальное состояние — [STATUS.md](../../STATUS.md). Старые даты, условия сервисов и команды ниже требуют проверки. Исходный текст сохранён; относительные ссылки перенесены вместе с документом.

# Windows quickstart

Install Node.js 22.12 or later, Chrome/Chromium, and FFmpeg/ffprobe with libx264 and AAC support. This version searches installed tools; it does not download binaries or change your global PATH. A browser and encoder are prerequisites, so the following is not a verified one-command installer for clean Windows.

In the source checkout:

```powershell
npm ci --ignore-scripts
npm run build
node dist/cli.js doctor --json
node dist/cli.js render examples/smoke/manifest.json --out artifacts/my-first-video --json
```

The smoke example is four seconds: 120 frames at 1080×1920 and 30 fps. Open its `output.mp4` and `contact-sheet.jpg`, and inspect `render-report.json` for the actual media checks.

Create a new project:

```powershell
node dist/cli.js init product-ad --dir "projects/Мой продукт"
node dist/cli.js validate "projects/Мой продукт/manifest.json" --json
node dist/cli.js render "projects/Мой продукт/manifest.json" --out "out/Мой продукт" --json
```

Replace sample images and copy inside the manifest's own project directory. Change `video.aspectRatio` to `16:9` for landscape. Modify text or scene duration in the same manifest, then render to a new output directory. To replace an earlier result, use explicit `--overwrite`. Use `--no-cache` for a fresh render when diagnosing a problem.

The three main templates now use `video.style: "kinetic"`, with deliberate headline breaks, full-image reveals, focal crops, continuity transitions and procedural groove. `init kinetic-promo` provides a shorter thirteen-second reel. Omitting style still selects the original `studio` renderer. See [visual quality and its limits](../../VISUAL_QUALITY.md).

For a locally packed installation, run `npm pack --pack-destination artifacts`, create an empty consumer directory, and install the resulting `.tgz` with `npm install --ignore-scripts <absolute-tarball-path>`. Then use `npx --no-install agent-motion-studio` in that consumer. Production files resolve relative to the installed package; assets resolve relative to your manifest. The package does not require the source checkout or its `references` folder.

To load the skill, provide your agent the path to the installed package's `skills/agent-motion-studio/SKILL.md`. See [project setup for Codex, Claude Code, Cursor, Gemini CLI and Antigravity](AGENT_SETUP.md) for documented locations, invocation and an explicit-read fallback. This project leaves existing user skills and global agent configuration untouched. Native loading must be verified in that client before claiming compatibility.

Optional online speech setup is documented in [AUDIO.md](../../AUDIO.md). Local rendering and file speech do not need Python.

## Troubleshooting

- Missing tool: set `CHROME_PATH`, `FFMPEG_PATH`, or `FFPROBE_PATH` to its executable, then rerun `doctor --json`.
- Text overflow: shorten the field reported by the error. Do not crop it or replace the font silently.
- Invalid path: copy the material inside the manifest's project directory and use a relative path.
- Voice too long: increase that scene's `durationFrames` or supply a shorter voice file. The engine does not trim words.
- Existing output: choose a new output directory or use `--overwrite` for an intended replacement.
- Damaged cache: the renderer checks content hashes and media; it rerenders after an integrity miss. Do not modify integrity metadata to bypass verification.
- Encoder failure: read the structured CLI error. A nonzero exit code is failure, even if an output directory or old MP4 exists.

With `--json`, stdout is a single result document and progress is on stderr. Exit codes: 0 success, 2 input/layout/timing, 3 missing environment/tool, 4 render/encoding/media failure, 5 online speech provider failure, and 130 cancellation.
