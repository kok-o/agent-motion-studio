# Agent Motion Studio

**Make a short film locally. Replace one scene. Keep the takes you already like.**

An open-source video editor for people and their AI agents. Import clips, images and music, assemble a storyboard, preview a scene and export a real MP4. The browser editor and CLI use the same portable JSON project.

**0.1.0 · Experimental developer preview** · [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md) · [Release notes](docs/releases/v0.1.0.md)

![DAILY RITUAL: real espresso footage and motion typography](docs/media/coffee-contact.jpg)

[Watch the 20-second original](docs/media/coffee-original.mp4) · [Watch the second-scene remix](docs/media/coffee-changed.mp4) · [Editable example](examples/coffee-ritual/project.json)

Footage by **Scott Schiller**, [Morning Espresso Routine](https://www.flickr.com/photos/schill/14588642105/). Excerpts, crop, titles and procedural music added with Agent Motion Studio. Film remix: **[CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/)**. [Full credits](examples/coffee-ritual/CREDITS.md). This is real filming of one setup; no AI video model was used for the example.

## Try your first remix

Install **Node.js ≥22.12**, **Chrome/Chromium**, **FFmpeg with libx264/AAC**, and **ffprobe**. Keep FFmpeg/ffprobe on PATH. The app can also use `CHROME_PATH`, `FFMPEG_PATH` and `FFPROBE_PATH`. Windows has been tested with these tools installed; see [compatibility](docs/COMPATIBILITY.md).

Clone or download this repository, open a terminal in its folder, then:

```sh
npm ci --ignore-scripts
npm run build
npm run doctor
node dist/cli.js init coffee-ritual --dir projects/my-first-remix
node dist/cli.js studio projects/my-first-remix/project.json
```

Open the **complete session URL** printed by the CLI. Keep it private. The editor currently uses Russian labels:

1. Select scene 2, `first-pour`.
2. Change **Выбранный исходник / дубль** (source/take) to `first-drops.mp4`; use trim start `1` second and duration `7` seconds.
3. Click **Предпросмотр сцены** (preview scene). Watch the trimmed/cropped result before saving.
4. Click **Сохранить сцену** (save scene), then **Экспорт MP4**. The full film appears in the main player.
5. Click **Вернуть предыдущий вариант** (restore previous take) and export again. The original sources remain available.

Your copy lives under `projects/`, which Git ignores. To reopen it, repeat only the `studio` command. Stop the server with Ctrl+C. If the port is busy, add `--port 4174`. [Detailed guide](docs/GETTING_STARTED.md) · [Инструкция на русском](docs/STUDIO_RU.md).

## Use the built runtime

The release preparation produces `agent-motion-studio-0.1.0.tgz`. With that file downloaded, install it in an empty folder:

```sh
npm init -y
npm install --ignore-scripts --omit=dev /path/to/agent-motion-studio-0.1.0.tgz
npx --no-install agent-motion-studio doctor --json
npx --no-install agent-motion-studio init coffee-ritual --dir film
npx --no-install agent-motion-studio studio film/project.json
```

Replace the archive path with its location on your computer; quote paths containing spaces. This needs the same system tools but no TypeScript build or source checkout. npm downloads dependencies unless they are cached. There is no npm-registry installation promised for 0.1; `private: true` intentionally prevents accidental registry publication.

## What works in 0.1

- Import video, images and music as copied, content-addressed sources.
- Arrange scenes with titles, images, trim, cover/contain and focal points.
- Preview an unsaved scene using the export renderer at 1080p/30 fps.
- Compare local and external-agent edits and explicitly resolve conflicts.
- Restore previous takes, reopen projects and export H.264/AAC MP4.
- Edit through the CLI with the same validation and history as the browser.

Agents can use `import`, `edit --action action.json`, `validate` and `render`. [Agent skill](skills/agent-motion-studio/SKILL.md) · [Project format](docs/MANIFEST.md). Cloud generation is a [next step](ROADMAP.md); 0.1 needs no model key for local editing.

## Current limits

- Preview is silent and generated on demand. Viewing the entire film requires export.
- Source-video audio is muted; use a file music track. Narration/captions require full export.
- 1080p/30 fps, 16:9 or 9:16, SDR BT.709, hard cuts in v2. No HDR, realtime timeline or multitrack editor.
- 12 scenes, 24 assets, 1–60 seconds; the intended workflow is 3–4 scenes / 15–30 seconds.
- Imports read files into RAM: video ≤512 MiB, images ≤20 MiB, audio ≤100 MiB. Keep renders sequential.
- History retains 100 snapshots. Sources/exports are not automatically pruned. Draft recovery belongs to the current browser tab; it is not a backup.
- The server is local and intended for one user. No built-in chat, cloud accounts or video-generation provider.

The code is free under MIT. External generation services, if added, have their own costs and terms. Tests establish technical behavior; they do not establish artistic quality or demand.

## Build with us

One issue, one branch, one reviewable outcome. See [CONTRIBUTING](CONTRIBUTING.md) for setup, working as a pair, the code map and pull requests.

```sh
npm run check
npm run test:integration
npm run release:prepare
```

`check` needs a Git checkout. Integration tests use real Chrome and FFmpeg and make no video-generation requests. `release:prepare` builds local source/runtime archives and checks their contents; it does not upload anything. Maintainers should follow the [release guide](docs/RELEASING.md), including installation verification.

Code and separate original procedural music: [MIT](LICENSE). Fonts: SIL OFL. Coffee footage derivatives, still and finished remix: CC BY-SA 2.0. Keep the [media credits](examples/coffee-ritual/CREDITS.md) when sharing an adaptation. [Third-party notices](THIRD_PARTY_NOTICES.md) · [Security](SECURITY.md).
