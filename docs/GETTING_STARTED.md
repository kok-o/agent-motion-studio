# Local studio and agent workflow

Use Node ≥22.12, Chrome/Chromium, FFmpeg with libx264/AAC and ffprobe. The CLI's `doctor --json` reports discovery. These system tools are not installed by this package. Override paths with `CHROME_PATH`, `FFMPEG_PATH`, `FFPROBE_PATH`. No Python or model key is required for local editing.

After installing the `.tgz` with `npm install --ignore-scripts --omit=dev <archive>`:

```powershell
npx --no-install agent-motion-studio init coffee-ritual --dir film
npx --no-install agent-motion-studio studio film/project.json
```

Open the full session link. Stop with Ctrl+C. Another port: append `--port 4174`. Start a blank project with `new --dir my-film`. Import through **Импорт файлов**, add a source with **В сцену**, choose file music and save. The main player displays completed exports; the inspector's upper player is the source without edits.

Choose scene 2, change the source to `first-drops.mp4`, trim start to 1 s and duration to 7 s. **Предпросмотр сцены** renders the selected scene from the draft at output resolution, without audio or saving. The displayed interval has an exclusive end; duration is rounded to 30 fps. Changing fields invalidates the preview. Save with **Сохранить сцену**, then **Экспорт MP4**. Restore with **Вернуть предыдущий вариант** and export again. Scene previews are session-local temporary files; accepted exports live under `exports/`.

## Working alongside an agent

The agent and UI share `project.json`:

```powershell
npx --no-install agent-motion-studio import film/project.json --file "C:\clips\shot.mp4" --json
npx --no-install agent-motion-studio edit film/project.json --action change.json --json
npx --no-install agent-motion-studio validate film/project.json --json
npx --no-install agent-motion-studio render film/project.json --out film/export-cli --no-cache --json
npx --no-install agent-motion-studio verify film/export-cli/output.mp4 --json
```

`import` returns the new asset ID. A `change.json` example:

```json
{
  "type": "edit-scene",
  "sceneId": "first-pour",
  "patch": { "durationFrames": 180, "trimStartSeconds": 2, "fit": "contain" }
}
```

An edit creates a history snapshot and validates the complete project before atomically replacing it. It never prunes accepted assets. Patch `null` removes an optional field. Scene ID/type stay fixed; unknown fields are rejected. Other operations: `add-scene`, `remove-scene`, `move-scene`, `composition`, `music`, `restore` and `restore-scene`. See the Russian guide for action arguments.

If an agent changes the file while your form is dirty, **Перечитать проект** compares the two versions without saving. **Применить мои изменённые поля** explicitly applies your changed fields on top of the fresh version; other agent edits remain, and its prior composition is stored in history. **Принять внешнюю, отбросить черновик** discards your draft only after this explicit choice. **Вернуться к черновику** changes neither version. A second agent edit reopens the decision. Invalid form input can still be kept or discarded. Drafts are retained in this tab's session storage when available; do not rely on this as a cross-device backup.

## Transfer and limitations

Share `project.json`, `assets/`, `CREDITS.md`, `provenance.json`, `LICENSE.md` and the example README. Retain footage attribution next to public MP4s. The five example sources are relative and self-contained. Do not include `.cache`, session URLs, temporary files or development reports. `init` omits cached renders and exports.

v1 remains readable and renders unchanged; first accepted studio edit upgrades to v2 and records prior composition. v2 uses hard cuts and a uniform SDR BT.709 output; HDR/color-managed workflows are unsupported. Preview reuses the same visual engine and current frame timing but omits sound; projects with narration/captions need full export. No realtime compositor, cloud generation or multitrack timeline is included. Video source audio stays muted.

1080p/30 fps, 16:9/9:16, 12 scenes, 24 assets, 1–60 s, 1 MiB JSON, 100 snapshots. Imports read files into RAM: MP4 ≤512 MiB, images ≤20 MiB, audio ≤100 MiB; visual sources ≤4096 per side. Keep heavy renders sequential. Failed exports preserve prior accepted results.

After a hard kill, inspect the PID in `<project>.edit-lock` or `<output>/.render.lock`; only remove that stale lock when its process is no longer running. The server is for one loopback session, not a public network service. Export/image metadata may contain local paths in diagnostic reports; share the editable source package and chosen MP4, not internal reports.
