# Manifest v1

Use the installed package's `schemas/manifest.schema.json` as the authoritative schema. The CLI rejects unknown fields. Always validate before rendering.

Required top-level fields are `schemaVersion: 1`, an ASCII identifier `id`, integer `seed`, `video`, `brand`, `assets`, `audio`, and `scenes`.

- `video`: `aspectRatio` is `9:16` or `16:9`; `fps` is 30. Optional `safeArea` is a fraction from 0.04 to 0.16. Optional `style` is `studio` (default) or `kinetic` (display headlines, image reveals, camera crops, continuity transitions).
- `brand`: `theme` is `dark` or `light`; `background`, `foreground`, and `accent` are six-digit hex colors; `font` is `builtin-sans`.
- `assets`: map stable IDs to `{ "type": "image" | "audio", "path": "./assets/file.png" }`. Paths are relative to the manifest, inside its directory. Images are PNG/JPEG, at most 20 MiB and 4096×4096. Audio is WAV/MP3/M4A/AAC/OGG/FLAC, at most 100 MiB.
- `audio`: requires `narration` and `music` objects, each with `provider`. Narration is `none`, `file`, or explicit optional `edge`; music is `none`, `file`, or `procedural`. Optional `gainDb` is -60 to 0. File music requires `asset`.
- `scenes`: one to twelve scenes with unique stable IDs. Each has a supported `type` and positive integer `durationFrames`. Total length is 30–1800 frames (one to sixty seconds).

For file speech, add `narration: { "asset": "voice" }` to its scene. For Edge add `narration: { "text": "Speak this" }`; common `voice`, `rate`, and `pitch` options belong in `audio.narration`. Each speech interval needs measured duration plus 0.15 seconds before and after it.

Scene `captions` contain `{startMs, endMs, text}`, relative to its voice file. Cues are ordered, non-overlapping, and contained by speech and scene. They are supplied timings, not automatic transcription.

Text supports the bundled Latin/Cyrillic character range. Emoji and unverified scripts cause a useful error. Markup is rendered literally. Avoid long headings: the engine fits a limited number of lines, then asks for shorter text instead of cropping it.

The resolved manifest records frame intervals, asset content hashes, layouts, audio timing, and rendering environment. Inspect it when a revision changes scene duration or captions.
