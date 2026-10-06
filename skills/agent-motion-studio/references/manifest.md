# Accepted v2 project and separate drafts

The distributed schemas/manifest.schema.json is authoritative; unknown fields fail. Existing v1 motion projects remain readable. Accepted editor/CLI changes migrate them to v2 with history. Old binaries may reject optional operationReceipts; new-app backward reading does not promise old-app forward compatibility.

Required fields are schemaVersion, ASCII id, integer seed, video, brand, assets, audio and scenes. v2 additionally permits revision, bounded history and operationReceipts. Use new or a copied init example; never rewrite an accepted manifest directly.

- video: aspectRatio 9:16 or 16:9; fps 30; optional safeArea 0.04-0.16 and studio/kinetic style.
- brand: dark/light theme, six-digit hex background/foreground/accent and builtin-sans font.
- assets: stable IDs with image/audio/video type and relative local path inside the project. Accepted import copies bytes into content-addressed assets and adds sha256/name. Keep old sources. Cap 24; MP4 <=512 MiB, PNG/JPEG <=20 MiB, supported audio <=100 MiB.
- audio: narration/music require provider; none/file, or explicit procedural music. Optional gain -60 to 0 dB. Source-video audio is muted.
- scenes: 1-12 stable IDs, positive integer durationFrames; film 30-1800 frames. v2 hard cuts; 210 frames at 30 fps are seven seconds.
- history: up to 100 complete scenes/video/audio/brand snapshots. Restore keeps sources. Optional acceptance receipts contain operation ID, normalized intent hash and revision ID, with finite retention.

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

Ordinary browser draft preview does not commit. Generated candidate has another draft/preview contract in [generation](generation.md); do not import a candidate merely to preview. Atomic generation accept records immutable source, patch, prior snapshot and receipt in one commit.

Narration/captions are checked against measured audio; exact scene/candidate preview currently requires no narration/captions. Code, shell commands and remote asset URLs are invalid. Unsupported text, impossible layout, out-of-range trim and missing sources fail.

Diagnostic resolved-manifest.json records local paths, intervals, hashes, layout and tools; it is not portable input. Transfer manifest and all assets including history sources. Private .studio jobs/credentials are excluded; offline accepted export needs no provider account.
