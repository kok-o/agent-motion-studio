# From a new brief to an editable film

Work from the studio checkout or installed package workspace. The copied skill directory contains guidance, not the executable. In the examples below replace `agent-motion-studio` with `node dist/cli.js` in a built checkout, or `npx --no-install agent-motion-studio` in an installed workspace.

Record the user's brief and a short shot plan outside the accepted project: audience, one message, aspect ratio, exact text, duration in frames, permitted materials and authorized external calls. Choose supported scenes; ordinary film work must not require renderer changes. For a 20-second film, 120/210/150/120 frames gives four shots at 30 fps. These are an example, not a required template.

Create a fresh v2 project and read its state:

```sh
agent-motion-studio new --dir projects/film --json
agent-motion-studio state projects/film/project.json --json
```

The new project starts with one `opening` title. Use `edit-scene` to replace its text and timing. Import permitted local media with `import --file FILE --if-match ETAG`, then use the returned `importedId` in an `add-scene` action. Refresh state after every accepted operation. `composition` sets aspect ratio/style; `music` can select local `procedural` music. Keep narration provider `none` unless the user requests a supported speech path. A new motion film needs no media-provider key.

Write action JSON to a separate file, then call `edit PROJECT --action ACTION --if-match ETAG --json`. For example:

```json
{"type":"add-scene","scene":{"id":"closing","type":"cta","text":"TRY IT ON YOUR PROJECT","label":"Your one next step","durationFrames":120}}
```

Validate and export into a fresh directory:

```sh
agent-motion-studio validate projects/film/project.json --json
agent-motion-studio render projects/film/project.json --out artifacts/film/original --json
```

Save the baseline revision ID from `state`. Inspect the contact sheet, settled frames and continuous playback where available. The contact sheet includes cuts; inspect additional frames during holds when cuts are intentionally empty. Record actual framing/readability/pacing observations separately from decode success.

For a correction, write an `edit-scene` action, read current state, and preview exactly that action:

```sh
agent-motion-studio preview projects/film/project.json --action correction.json --if-match ETAG --out artifacts/film/preview-1 --json
```

Preview must return `stale:false`. Inspect its MP4 and verify accepted bytes/ETag/history did not change. Apply the same action with `edit --if-match PREVIEW_PROJECT_HASH`, then export to a fresh `changed-1` directory. For the next correction repeat with fresh context. Conflicts require rereading and another preview; never silently retry a stale action.

Restore one scene with `{"type":"restore-scene","sceneId":"SCENE","revisionId":"BASELINE_REVISION"}`, or the whole film with `{"type":"restore","revisionId":"BASELINE_REVISION"}`, through `edit` and the current ETag. Sources stay registered. Export restored output separately; reopen with `state` or `studio`. Compare decoded frame hashes for unaffected intervals and restoration, along with source hashes and scene IDs. Preserve the preferred edited version through another accepted restore if that is what the user wants delivered.

Deliver the preferred MP4, editable project and assets, original/changed/restored versions, contact sheet and verification results. Label agent/client/API sessions by what actually ran. A scripted fixture or installed skill alone is not a real client session. Do not publish private reports or user media without authorization.
