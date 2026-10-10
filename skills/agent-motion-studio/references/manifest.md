# Accepted v2 project and separate drafts

v2 also accepts the additive `composition` scene with `objects` and optional `background`. Use [object composition](composition.md) for text/shapes/images and data-only keyframes. `edit-scene.patch.objects` replaces the complete array under the same ETag/preview/history contract. Old project rendering stays unchanged; old binaries cannot read this new type.

`new --dir film --aspect 9:16 --title "Frontend Night"` sets format and opening text, preserving ID `my-film`. JSON input files accept UTF-8 with optional BOM; malformed input returns INVALID_JSON/exit 2 without its contents.

`brand` patches theme/background/foreground/accent (six-digit hex; font preserved). Supplying theme resets its palette before explicit colors override it: dark #10171C/#F4F1E9/#D9EE86, light #F4F1E9/#10171C/#285A36. Colors without theme preserve other settings. Full restore restores brand; restore-scene preserves current brand/video.

`batch` accepts 1–32 ordinary actions, optional single-line label ≤80 characters, one ETag/lock/commit and +1 history snapshot. Each child's fields/IDs are checked; an error identifies action[index] and leaves accepted state unchanged. Nested batch and restore/restore-scene are forbidden. Imports are separate operations. API initial creation permits batch only before first render; existing-film preview mode rejects it. Use separate exact preview/edit instead. See [edit catalog](edits.md).

The distributed schemas/manifest.schema.json is authoritative; unknown fields fail. Existing v1 motion projects remain readable. Accepted editor/CLI changes migrate them to v2 with history. Old binaries may reject optional operationReceipts; new-app backward reading does not promise old-app forward compatibility.

Required fields are schemaVersion, ASCII id, integer seed, video, brand, assets, audio and scenes. v2 additionally permits revision, bounded history and operationReceipts. Use new or a copied init example; never rewrite an accepted manifest directly.

- video: aspectRatio 9:16 or 16:9; fps 30; optional safeArea 0.04-0.16 and studio/kinetic style.
- brand: dark/light theme, six-digit hex background/foreground/accent and builtin-sans font.
- assets: stable IDs with image/audio/video type and relative local path inside the project. Accepted import copies bytes into content-addressed assets and adds sha256/name. Keep old sources. Cap 24; MP4 <=512 MiB, PNG/JPEG <=20 MiB, supported audio <=100 MiB.
- audio: narration/music require provider; none/file, or explicit procedural music. Optional gain -60 to 0 dB. Source-video audio is muted.
- scenes: 1-12 stable IDs, positive integer durationFrames; film 30-1800 frames. v2 hard cuts; 210 frames at 30 fps are seven seconds.
- history: recent inline cache of at most 15 snapshots, target 200 KiB (newest kept even if larger). Complete scenes/video/audio/brand snapshots also live in `.history/<revisionId>.json`; normal post-commit pruning retains the latest 100 by createdAt, with filename tie-breaker. Pruning failure can leave extra files. The manifest still has a 1 MiB read limit. Older inline-only projects are readable and archived on accepted edits. Restore keeps sources. Optional acceptance receipts contain operation ID, normalized intent hash and revision ID, with separate finite retention.

Read before editing:

```sh
agent-motion-studio state film/project.json --json
agent-motion-studio import film/project.json --file local-clip.mp4 --if-match ETAG --json
agent-motion-studio edit film/project.json --action scene-edit.json --if-match CURRENT_ETAG --json
```

Separate scene-edit.json:

```json
{"type":"edit-scene","sceneId":"existing-shot","patch":{"trimStartSeconds":0,"fit":"contain","focalPoint":{"x":0.5,"y":0.5}}}
```

Do not patch ID/type; null removes optional fields. Other actions: add-scene, remove-scene, move-scene (zero-based index), music, composition, restore and restore-scene. Pass current ETag; stale operations fail without overwriting other work.

Gain-only music preserves provider/asset; disable explicitly with provider none, never combine asset/provider. Aspect-only composition preserves omitted style/safeArea/fps. Batch children see preceding working state.

Record revision IDs before edits. State returns inline history, not all external revision IDs. Restore reads either location and validates the result; missing/pruned revisions fail without committing. Intact inline copies heal missing/altered external copies before eviction; external-only history is not independently authenticated. Keep the entire hidden `.history/` folder when transferring a project; never manually replace accepted JSON to restore.

Missing project returns PROJECT_NOT_FOUND/input/2; missing action/media/verify input FILE_NOT_FOUND/input/2; malformed CLI options/required arguments INVALID_COMMAND/input/2. Internal I/O is not globally remapped to input errors. Final read failure after publication returns INTERNAL_ERROR/project/4 and means the operation may already be committed. Save original action/ETag/revision, then read state/history/sources before deciding whether any retry is needed. Ordinary edit/import is not idempotent; do not blindly repeat with a fresh ETag. Generated Accept alone uses the saved original operation ID and receipt recovery in [generation](generation.md).

Ordinary browser draft preview does not commit. Generated candidate has another draft/preview contract in [generation](generation.md); do not import a candidate merely to preview. Atomic generation accept records immutable source, patch, prior snapshot and receipt in one commit.

Narration/captions are checked against measured audio; exact scene/candidate preview currently requires no narration/captions. Code, shell commands and remote asset URLs are invalid. Unsupported text, impossible layout, out-of-range trim and missing sources fail.

Diagnostic resolved-manifest.json records local paths, intervals, hashes, layout and tools; it is not portable input. Transfer manifest, all assets, `.history/` and previous exports. Private .studio jobs/credentials are excluded from public delivery; preserve them locally for unresolved generation recovery. Offline accepted export needs no provider account.
