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

For a complete 5-second image-motion example with poses, a final hold and exact decoded scene-preview frames, see the bundled [motion proof recipe](../skills/agent-motion-studio/references/motion-proof.md). It includes an initial setup action and an offline extraction helper, without changing the renderer.

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

The browser edits existing objects through the native Canvas and a layer list: stable-ID selection, move, proportional corner resize, text and numeric x/y/width/height. Selection alone never reorders storage. Base mode also edits text color/fontSize/weight (400 or 700)/align, shape color/stroke/strokeWidth and rect radius. Image objects keep geometry and layer controls. Optional fields display their existing value or a placeholder; clearing them removes the field instead of storing a default. Colors accept six-digit hex or brand roles. Layer up/down moves only the selected ID; neighbours retain their values and relative order. The list, picking and native drawing share that order.

Keyframe mode changes geometry at an integer local scene frame, preserving other keys, easing, opacity, rotation and reveal. New style/layer controls are disabled in keyframe mode; style remains static. Rotated selection bounds/picking use the object centre. Base gestures are disabled away from frame zero or when a frame-zero geometry key overrides the base; select keyframe mode instead. Creating objects still uses the agent/API/CLI. Limits: 96 flat objects per scene, 12 scenes, 60 seconds, fixed fps/aspects/fonts. No groups, masks, arbitrary paths, video objects, keyframed font/color, cross-scene transitions, expressions, JS, remote assets or realtime timeline. JSON contains data only.

## Studio visual edit contract

Studio keeps one composition draft in memory, including scene duration. Preview and Cancel never save accepted bytes/history. Scene/aspect/export transitions offer explicit Apply, discard or stay; language reload requires Apply/Cancel first. Unlike legacy scalar scene drafts, composition object drafts are not recovered from sessionStorage. Keep the tab open until resolved.

The new session-protected routes are separate from legacy edits:

- GET /api/visual/state?scene=ID requires a nonempty exact If-Match ETag and returns path-free native render data after a second ETag check.
- POST /api/visual/preview takes an existing-object edit-scene action and mandatory If-Match. It renders through native scene encoding and issues a session-local previewId only for a non-stale result.
- POST /api/visual/apply takes {previewId, action} and mandatory If-Match. The server checks the exact previewed action hash, ETag and selection before the native project API. Tickets are consumed before publication; no ordinary-edit replay is promised.

Both POST routes accept optional `X-AMS-Selected-Object` transport metadata: one nonempty native ID known in the target scene. Empty, malformed, duplicate and unknown IDs are rejected. With this header, the selected object may change supported properties/geometry/geometry keys and move within the array. Length and unique ID set stay identical, type/asset/shape identity is immutable, and every other object must remain deeply equal in its previous relative order. Native schema and renderer layout checks remain mandatory. Without the header, the legacy geometry/text whitelist and fixed array order remain unchanged. Neither the native action body nor accepted JSON/history gains metadata fields.

The ticket binds the selected ID (or null for a headerless request), ETag and exact action. Studio freezes the ID with its preview and sends that ticket ID on Apply. Previewing a swap with A cannot authorize applying the identical swap with B or without the header.

Changing draft, selection, frame or mode invalidates the client preview. External edits preserve the local draft and block stale full-array Apply: explicitly reread/discard or keep the draft. There is no array rebase/resubmit. Lost, malformed or unknown commit responses block mutations until explicit reconciliation by rereading the accepted project; do not retry ordinary edits. The native known post-commit INTERNAL_ERROR/project/4 retains its explicit committed message and returns committed:true/reconcileRequired:true; Studio says the edit was committed and still blocks retry until rereading. A lost transport reply remains unknown. A new server/session reopens accepted state. Generated receipts/replay keep their existing contract. Legacy /api/edit and CLI edits do not require these visual tickets.

The fixed native renderer script, allowlisted bundled fonts and imported-image asset alias are session-protected and retain global frame-ancestors 'none', Host/Origin and realpath containment checks. Canvas rendering uses the same native renderer/sampleObject and global scene offset as export; SVG is only a selection/gesture overlay. Pure HF resize/numeric helpers are attributed in [third-party notices](../THIRD_PARTY_NOTICES.md). No iframe, React or second film source is introduced.

On a memory-constrained host set `AMS_LOW_MEMORY=1` in the process environment. The service browser disables GPU and limits renderer processes; its sandbox remains enabled. Render/export one project at a time. This cannot recover memory consumed by other applications or increase the OS commit limit.
