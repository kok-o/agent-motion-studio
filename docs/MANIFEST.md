# Manifest

The schema now accepts v1 and v2. v1 retains its original motion rendering behavior. v2 adds `video` assets, `video` scenes with `trimStartSeconds`, optional accepted-source `sha256`/`name`, `revision` and bounded composition `history`. See [the studio format and CLI actions](STUDIO_RU.md). Imported v2 source files must not be edited in place: import a replacement and select its new asset ID instead. v2 scene boundaries are hard cuts; v1 kinetic transitions remain unchanged.

`schemas/manifest.schema.json` is the single source of input rules. See the compact [field guide](../skills/agent-motion-studio/references/manifest.md) and [scene guide](SCENES.md). All examples in `examples` are validated against that schema.

An example starts with a complete theme, explicit assets, audio providers, and stable scene IDs. Local paths are relative to the manifest file, including when the CLI runs in a different directory. Unknown fields, remote assets, unsupported image formats or characters, duplicate scene IDs, impossible layouts, and invalid captions are errors.

Change `scenes[0].text` to revise a title, `scenes[1].asset` to select another image, or the actual image bytes at its path to replace material. Content hashes prevent reuse of old frames. Change `scenes[1].durationFrames` to revise timing; following intervals are recalculated from the sum of previous durations. Change `video.aspectRatio` to use the other layout. Scene IDs should remain unchanged during normal edits.

Narration is associated with its scene. Music spans the full timeline. Voice duration and caption timing are checked against measured audio before frame export. See [audio options](AUDIO.md).

`resolved-manifest.json` adds output dimensions, total frames, half-open scene intervals, asset hashes and dimensions, fitted text boxes, caption intervals, and rendering environment information. Machine-local absolute paths in this diagnostic artifact are not portable project inputs. Deliver the original manifest and assets for reproduction.

The renderer rejects a final output overwrite unless `--overwrite` is supplied. Encodes are staged and media is verified before the MP4 becomes the final result. A job cache uses content hashes and environment/runtime fingerprints; a cache hit still requires media verification. `visualReview` remains unapproved until a person or agent actually inspects the result.
