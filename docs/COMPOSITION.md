# Editable object composition

`composition` is an additive **v2** scene type. Existing v1/v2 scenes keep their rendering behavior. It has a flat, ordered `objects` array (back to front), optional `background`, and ordinary `durationFrames`. There is no automatic decoration, entrance or exit. Author the action in the project. These are local deterministic Canvas drawings, not generated footage.

```json
{"id":"search","type":"composition","durationFrames":120,"background":"background","objects":[
  {"id":"panel","type":"shape","shape":"rect","x":90,"y":600,"width":900,"height":240,"radius":16,"color":"accent"},
  {"id":"query","type":"text","text":"fastgrep timeout src/","x":130,"y":675,"width":820,"height":90,"fontSize":48,"weight":400,"color":"background","reveal":0,"keyframes":[{"frame":12,"reveal":0},{"frame":57,"reveal":1}]}
]}
```

Positions and sizes are output pixels: 1080×1920 for 9:16, 1920×1080 for 16:9. `x/y` are the top left; rotation in degrees is around the object's centre. Changing aspect does not automatically rearrange objects. `opacity` and text `reveal` range 0–1, default 1; rotation defaults 0. `width/height` are positive. Array order is layer order. IDs are stable authoring identifiers, unique within a scene.

Each object may have up to 64 keyframes. `frame` is a local integer frame index, starting at zero, strictly increasing. A keyframe changes any of `x`, `y`, `width`, `height`, `opacity`, `rotation`, `reveal`. Each property has an independent track: its base value is at frame zero, keys that omit it have no effect, and its last value holds. A frame-zero key overrides the base. Easing is on the destination key: `linear` (default), `outCubic`, `inOutCubic`, or `step` (hold until that key). There is no hidden state; seeking and out-of-order frames produce the same pixels. Keys after a shortened scene remain stored and are simply clipped; extending it reveals them again.

| Object | Fields |
| --- | --- |
| `text` | Required `text`; optional `fontSize` 18–300 (default 48), `weight` 400/700, `align` left/center/right, `color`, `reveal` |
| `shape` | Required `shape`: rect/ellipse; fill `color` and/or `stroke`; optional `strokeWidth`, rect `radius` |
| `image` | Required imported image `asset`; optional contain/cover `fit`, 0–1 `focalPoint`; same immutable sources as other scenes |

Paints are six-digit hex or `background`/`foreground`/`accent` from brand. Text supports bundled Latin/Cyrillic, explicit line breaks and word wrapping at a fixed font size. Layout rejects overflow rather than silently shrinking; inspect small details at delivery size. Each line occupies 1.25×fontSize. Character reveal keeps final line wrapping. For aligned table/code columns use separate text objects, not runs of spaces.

## Ordinary project actions

Create through `new`, immutable `import`, then `add-scene` (or initial `batch`). Read `state` and edit an existing object by copying its scene's array, changing the selected ID, and sending **the complete array** as `edit-scene.patch.objects`. ETag guards the complete scene against external edits. No special renderer or object action is needed. Keep action files outside accepted JSON.

```json
{"type":"edit-scene","sceneId":"search","patch":{"durationFrames":90}}
```

For a text/motion correction, write the copied objects array to an action file. Run the exact action through `preview`, inspect its video, then accept using `preview.projectHash`:

```sh
agent-motion-studio state film/project.json --json
agent-motion-studio preview film/project.json --action edit.json --if-match ETAG --out preview-1 --json
agent-motion-studio edit film/project.json --action edit.json --if-match PREVIEW_PROJECT_HASH --json
agent-motion-studio render film/project.json --out export-1 --json
```

Preview remains silent, does not save a draft and shares export encoding. `restore-scene` returns objects/timing/background from a saved revision at the current brand; whole-film `restore` also restores brand/audio/video. Both preserve accepted sources. Copy the complete project folder including assets/history/credits. New binaries read old projects; old strict binaries cannot read composition scenes.

The browser can open/export/preview/shorten/restore these scenes; object authoring currently uses the agent/API/CLI. Limits: 96 flat objects per scene, 12 scenes, 60 seconds, fixed fps/aspects/fonts. No groups, masks, arbitrary paths, video objects, keyframed font/color, cross-scene transitions, expressions, JS, remote assets or realtime timeline. JSON contains data only.

On a memory-constrained host set `AMS_LOW_MEMORY=1` in the process environment. The service browser disables GPU and limits renderer processes; its sandbox remains enabled. Render/export one project at a time. This cannot recover memory consumed by other applications or increase the OS commit limit.
