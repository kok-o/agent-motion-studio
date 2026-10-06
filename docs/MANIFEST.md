# Manifest

The schema accepts v1 and v2. v1 retains its original motion rendering behavior. v2 adds `video` assets, `video` scenes with `trimStartSeconds`, optional accepted-source `sha256`/`name`, `revision` and bounded composition `history`. Generated-take acceptance can also write up to 100 `operationReceipts`, each containing `operationId`, `requestHash` and `revisionId`, in the same project commit as the scene/source change. See [the studio format and CLI actions](STUDIO_RU.md) and [generation workflow](GENERATION_RU.md). Imported v2 source files must not be edited in place: import a replacement and select its new asset ID instead. v2 scene boundaries are hard cuts; v1 kinetic transitions remain unchanged.

Receipts survive restore and ordinary edits. Their revision may have left the bounded scene history; this does not invalidate proof of an earlier accepted operation. Receipt metadata does not change the render fingerprint. Receipt retention is finite: an absent old receipt does not prove an operation never ran. New code reads older v1/v2 files, but an older binary with a strict schema may reject projects containing the new optional field. Private generation jobs, prompts and credentials do not belong in the accepted manifest.

`schemas/manifest.schema.json` is the single source of input rules. See the compact [field guide](../skills/agent-motion-studio/references/manifest.md) and [scene guide](SCENES.md). All examples in `examples` are validated against that schema.

An example starts with a complete theme, explicit assets, audio providers, and stable scene IDs. Local paths are relative to the manifest file, including when the CLI runs in a different directory. Unknown fields, remote assets, unsupported image formats or characters, duplicate scene IDs, impossible layouts, and invalid captions are errors.

For an unaccepted draft, scene text, asset references and durations describe the intended composition. Once accepted, use `edit --action` and `import` with the current ETag from `state`; do not write accepted JSON or source bytes directly. The project API preserves validation, complete previous scenes and history. Changing `durationFrames` recalculates following intervals; the composition action changes aspect ratio. Scene IDs and types remain stable during an ordinary scene patch. Generated replacement preserves the current duration and requires a preview of the exact candidate trim/crop and project context before acceptance.

Narration is associated with its scene. Music spans the full timeline. Voice duration and caption timing are checked against measured audio before frame export. See [audio options](AUDIO.md).

`resolved-manifest.json` adds output dimensions, total frames, half-open scene intervals, asset hashes and dimensions, fitted text boxes, caption intervals, and rendering environment information. Machine-local absolute paths in this diagnostic artifact are not portable project inputs. Deliver the original manifest and assets for reproduction.

The renderer rejects a final output overwrite unless `--overwrite` is supplied. Encodes are staged and media is verified before the MP4 becomes the final result. A job cache uses content hashes and environment/runtime fingerprints; a cache hit still requires media verification. `visualReview` remains unapproved until a person or agent actually inspects the result.
