# Manifest

v2 includes a general [editable object composition](COMPOSITION.md): text, simple shapes and imported images with independent keyframes. Old scenes and v1 rendering remain compatible. Object edits use ordinary `edit-scene` with the same preview/ETag/history contract.

v2 title scenes permit optional `label` supporting copy. Headings preserve authored casing (so `npm i -g fastgrep` remains a valid displayed command). v2 scene HUD uses scene ID and local progress, so changing another scene's duration/order cannot change this scene's pixels at the same local time. v1 keeps its existing text/HUD/transition recipe. Visual recipe is 4; this invalidates earlier cached compositions.

Create with `new --dir film [--aspect 9:16|16:9] [--title TEXT]`. Title supplies opening text; ID stays `my-film`. Action/request/approval/draft/resolution files accept UTF-8 with or without a leading BOM. Malformed JSON returns `INVALID_JSON`, exit 2, with the input filename and no input contents. Other PowerShell encodings are not supported.

`brand` patches `theme`, `background`, `foreground`, and `accent`; colors are six-digit hex. Supplying theme starts from its readable palette, then explicit colors win. Dark defaults: `#10171C/#F4F1E9/#D9EE86`; light: `#F4F1E9/#10171C/#285A36` (background/foreground/accent). Color-only patches preserve other values. Font is preserved. Full `restore` restores brand; `restore-scene` preserves current brand/format.

```json
{"type":"brand","patch":{"theme":"dark","background":"#101820","foreground":"#FFFFFF","accent":"#FEE715"}}
```

`batch` accepts 1–32 ordinary actions and an optional 1–80 character single-line label. It applies to a copy under one lock/ETag and commits one snapshot after final validation. Each child validates shape, fields and IDs. Errors name the zero-based child index; no child is committed on failure. Nested batch, restore and restore-scene are forbidden. Imports remain separate: new source import plus edit adds two snapshots.

```json
{"type":"batch","label":"Opening and closing","actions":[{"type":"edit-scene","sceneId":"opening","patch":{"text":"Start here","durationFrames":90}},{"type":"add-scene","scene":{"id":"closing","type":"cta","text":"Try it","label":"One next step","durationFrames":90}}]}
```

API-agent initial creation permits batch until its first render. When scene preview is required, batch is rejected; use separate exact preview/edit operations. Global brand/format changes require a full export. Ordinary scene preview does not represent a global change.

The schema accepts v1 and v2. v1 retains its original motion rendering behavior. v2 adds `video` assets, `video` scenes with `trimStartSeconds`, optional accepted-source `sha256`/`name`, `revision` and bounded composition `history`. Generated-take acceptance can also write up to 100 `operationReceipts`, each containing `operationId`, `requestHash` and `revisionId`, in the same project commit as the scene/source change. See [the studio format and CLI actions](STUDIO_RU.md) and [generation workflow](GENERATION_RU.md). Imported v2 source files must not be edited in place: import a replacement and select its new asset ID instead. v2 scene boundaries are hard cuts; v1 kinetic transitions remain unchanged.

Receipts survive restore and ordinary edits. Their revision may have left the bounded scene history; this does not invalidate proof of an earlier accepted operation. Receipt metadata does not change the render fingerprint. Receipt retention is finite: an absent old receipt does not prove an operation never ran. New code reads older v1/v2 files, but an older binary with a strict schema may reject projects containing the new optional field. Private generation jobs, prompts and credentials do not belong in the accepted manifest.

`schemas/manifest.schema.json` is the single source of input rules. See the compact [field guide](../skills/agent-motion-studio/references/manifest.md) and [scene guide](SCENES.md). All examples in `examples` are validated against that schema.

An example starts with a complete theme, explicit assets, audio providers, and stable scene IDs. Local paths are relative to the manifest file, including when the CLI runs in a different directory. Unknown fields, remote assets, unsupported image formats or characters, duplicate scene IDs, impossible layouts, and invalid captions are errors.

For an unaccepted draft, scene text, asset references and durations describe the intended composition. Once accepted, use `edit --action` and `import` with the current ETag from `state`; do not write accepted JSON or source bytes directly. The project API preserves validation, complete previous scenes and history. Changing `durationFrames` recalculates following intervals; the composition action changes aspect ratio. Scene IDs and types remain stable during an ordinary scene patch. Generated replacement preserves the current duration and requires a preview of the exact candidate trim/crop and project context before acceptance.

Narration is associated with its scene. Music spans the full timeline. Voice duration and caption timing are checked against measured audio before frame export. See [audio options](AUDIO.md).

`resolved-manifest.json` adds output dimensions, total frames, half-open scene intervals, asset hashes and dimensions, fitted text boxes, caption intervals, and rendering environment information. Machine-local absolute paths in this diagnostic artifact are not portable project inputs. Deliver the original manifest and assets for reproduction.

The renderer rejects a final output overwrite unless `--overwrite` is supplied. Encodes are staged and media is verified before the MP4 becomes the final result. A job cache uses content hashes and environment/runtime fingerprints; a cache hit still requires media verification. `visualReview` remains unapproved until a person or agent actually inspects the result.
