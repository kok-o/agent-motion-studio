# Natural-language edit catalog

Read state before each operation, identify scenes by stable ID and keep the revision **before the particular scene edit**. Use current ETag. Never patch accepted project JSON. These examples use existing scene IDs; substitute IDs and measured frames from state, not guesses. The behavioral source examples are tests/briefs/edits.json in a development checkout.

| ID | Request | Action example | Check |
| --- | --- | --- | --- |
| E1 | Replace the headline | `{"type":"edit-scene","sceneId":"opening","patch":{"text":"Начни с главного"}}` | Preview exact action, then edit; only that scene changes. |
| E2 | Shorten the second scene by one second | `{"type":"edit-scene","sceneId":"when","patch":{"durationFrames":90}}` | Example starts at 120 frames; subtract 30 from measured current length. Preserve revision before E2. Check following scene IDs/content at local time. |
| E3 | Use these colors / switch to light | `{"type":"brand","patch":{"theme":"light","background":"#FFF8E1","foreground":"#101820","accent":"#8A4900"}}` | Export full film; check palette/contrast. Theme-only selects documented defaults; explicit colors win. Full restore returns brand. |
| E4 | Swap second and third scenes | `{"type":"move-scene","sceneId":"detail","index":1}` | Index is zero-based; moving former third to 1 swaps adjacent shots. IDs/content/sources stay. Export. |
| E5 | Enlarge the opening headline | `{"type":"edit-scene","sceneId":"opening","patch":{"fontSize":130}}` | Example assumes a smaller prior font. Read resolved layout too: fontSize is a maximum, fit can shrink it. Compare actual size; failed overflow preview must not commit. |
| E6 | Replace this picture | `{"type":"edit-scene","sceneId":"planner","patch":{"asset":"RETURNED_IMPORTED_ID"}}` | CLI import new permitted image first with ETag, then state, exact preview/edit. Old source stays. New import + edit gives +2 snapshots. API runner needs pre-imported approved materials; it has no import/shell tool. |
| E7 | Restore the previous second scene | `{"type":"restore-scene","sceneId":"when","revisionId":"REVISION_BEFORE_E2"}` | Preserve current global brand/video. In E2→E3→E7, restore duration while keeping E3 colors. Export; full restore is a separate operation. |
| E8 | Make a vertical version | `{"type":"composition","video":{"aspectRatio":"9:16","fps":30,"style":"kinetic"}}` | Start with horizontal film; export at 1080×1920, check layout/crop/source registry and full restore to horizontal. |

For E1/E2/E5/E6 ordinary scene corrections: `preview PROJECT --action ACTION --if-match ETAG --out FRESH_DIRECTORY --json`, inspect and check stale:false, then `edit` the exact same action with preview projectHash. API tools additionally require the returned previewToken. Preview is silent and does not save a draft. Brand/composition/move/restore require full exports, not a scene-preview claim.

New assembly: `{"type":"batch","label":"Create film","actions":[{"type":"edit-scene","sceneId":"opening","patch":{"text":"Start","durationFrames":90}},{"type":"add-scene","scene":{"id":"closing","type":"cta","text":"Try it","label":"One next step","durationFrames":90}}]}`. Batch allows 1–32 ordinary actions, ≤80-character label, one ETag/snapshot. Imports remain separate; nested batch and restore actions are forbidden. Batch is rejected by API tools when preview is required. Initial API creation is an explicit mode before first render; the model cannot reset it.

Additional supported edits: `{"type":"remove-scene","sceneId":"closing"}` (keep at least one scene and 30 total frames); `add-scene` as above; `{"type":"music","provider":"procedural","gainDb":-18}` or `{"type":"music","asset":"IMPORTED_AUDIO_ID","gainDb":-12}`. Music action replaces the music selection: preserve provider/asset explicitly when changing gain. For full restore use `{"type":"restore","revisionId":"BASELINE_REVISION"}`.

API tool operations: state/edit/preview/validate/render only. Imports and new project are prepared by its CLI adapter. action is a JSON string of at most 65536 characters. Output labels are fresh lowercase alphanumeric/hyphen names (≤41 characters). Current context, exact preview binding, and local errors remain authoritative; do not ask for unavailable shell tools.
