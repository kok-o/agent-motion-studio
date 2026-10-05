# Agent Motion Studio

This is a local Node.js/TypeScript video editor. Read README.md and CONTRIBUTING.md before changing it. Keep work scoped to the issue; preserve unrelated edits and user projects.

- `src/project.ts` owns accepted edits, history and immutable source imports. Use these APIs instead of bypassing validation or writing accepted projects directly.
- `src/preview.ts` and `src/pipeline.ts` share scene encoding. Preview must not save a draft. Preserve frame timing, trim, crop and v1/v2 compatibility.
- `studio/` is plain HTML/CSS/JavaScript. Do not add a UI framework for incidental changes.
- The server stays on loopback. Preserve session, Origin/Host and asset-path checks. Never expose credentials or session URLs in reports.
- Keep source files and accepted takes when replacing or restoring a scene. Test external-edit conflicts through the real UI when changing this behavior.
- Run `npm run check` for normal changes; `npm run test:integration` for renderer, project, server or studio changes. Run media tests sequentially. Optional online speech and Windows console tests are separate.
- Report actual commands, results and limits. A passing render does not prove artistic quality or user demand. No paid calls, uploads or publication unless authorized by the user.

Build outputs, personal projects, caches and local agent settings are ignored. Public docs must use portable paths and link only to distributed material.
