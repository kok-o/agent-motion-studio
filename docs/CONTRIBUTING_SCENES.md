# Adding a scene

Scene code lives in `renderer/entry.ts`; browser coordination is in `src/browser.ts`. The v0.1 library uses a small dispatch over three types rather than dynamic plugins. Add a scene only when its behavior can be expressed by bounded parameters.

Update `src/types.ts`, the authoritative `schemas/manifest.schema.json`, semantic checks in `src/spec.ts`, layout preparation, and drawing together. Keep examples and scene documentation consistent. Increment the scene version in `src/spec.ts` when rendered behavior changes, so cached frames cannot hide a code edit. The job fingerprint also incorporates built runtime bytes.

Drawing must be a function of resolved spec and frame index. Clear canvas each frame, isolate context with save/restore, preload assets and fonts, and compute randomness from the manifest seed. Do not use wall-clock time or previous frames. Reject unsupported content or impossible layouts during preparation, before exporting frames.

Run `npm run build`, `npm test`, and `node --test tests/integration/*.test.mjs`. Produce a fresh render in each supported format and inspect entrance, settled, and exit frames. Test the same frame in different orders; text and material edits must change actual pixels. Add a regression check for a demonstrated failure rather than a test that only searches source text.

Do not import the local `references` clones at runtime. When porting substantial upstream code or assets, record the source commit, license, and exact transferred portion in `THIRD_PARTY_NOTICES.md`. Original fixtures can be regenerated with `scripts/create-demo-assets.mjs`; do not include third-party screenshots or music without established redistribution rights.
