# Executable authoring styles

These packages compile a selected composition into ordinary native project actions. They do not set `video.style`, change the global palette/music, invent copy or impose a shot sequence. The same exact copy and materials can use different layouts and rhythms.

| Package | Layout choices | Typography | Motion at 30 fps |
| --- | --- | --- | --- |
| `calm-product` v1 | Separate image/text regions; landscape side-by-side or portrait stack; proof band or quiet copy | Headline/proof 700, body 400; readable sizes fitted to the supplied material | Soft position/opacity arrival, early settlement, minimum 45-frame hold |
| `kinetic-poster` v1 | Typographic pair, portrait stack, separate media or proof region | Headline/proof 700, body 400; larger initial sizes, fixed glyph scale | Staggered position/opacity; short reveal only for an explicit proof of at most 22 characters; minimum 30-frame hold |
| `editorial` v1 | Asymmetric image/text or text columns | Headline/body 400, proof 700 | Sequential attention through native position/opacity; minimum 36-frame hold |

Sizes may decrease to 36px after measurement with the **actual bundled StudioSans** and native Canvas wrapping. A longer text also receives a larger share of a stacked layout. Box width/height reflow text; they never scale glyphs. Reduced motion uses a brief opacity arrival without position/reveal motion. Reading-hold requirements grow with exact copy length; the compiler does not extend duration or rewrite copy to pass them.

## Studio

Use **+ Styled composition / + Композиция со стилем** for a new four-second composition containing neutral editable text. The existing **+ Composition** route keeps its original behavior. For an existing object composition select **Selected composition style / Стиль выбранной композиции**. Choose a package, explicitly allow layout/typography/motion groups, map each object to headline/body/proof/media/accent, and protect entire objects or fields. Groups are unchecked for restyle. Existing tracks are kept by default; replacing them requires the separate checkbox. Protected fields override replacement permission.

Click **Preview style**, watch and listen, then **Apply style** to save exactly one native revision. Cancel leaves accepted bytes unchanged. Changing any option invalidates Apply. External changes require rereading and a new explicit preview. An unknown outcome or a failed acknowledgement after commit blocks further writes until explicit read reconciliation; the original Apply is never resent. Normal object edits, history restore and a fresh `studio` session remain available after acceptance.

**Captions boundary:** restyle of a composition with existing captions returns `STYLE_CAPABILITY` without changing them. Ordinary object editing and the E2 scene preview remain available. File narration **without captions**, music and neighboring source-video audio do not trigger this refusal. The usual Edge-narration scene-preview restriction still applies.

## Installed CLI, outside a checkout

Run these from the workspace created by your kit's `START_HERE_RU.md`. No source import or TypeScript build is required:

```sh
npx --no-install agent-motion-studio styles --json
npx --no-install agent-motion-studio state film/project.json --json
npx --no-install agent-motion-studio style-compile film/project.json --request style-request.json --if-match ETAG --out compiled-action.json --json
npx --no-install agent-motion-studio style-preview film/project.json --request style-request.json --if-match ETAG --out style-preview-1 --json
```

Replace `ETAG` with the freshly read state's hash. Outputs must be new paths. `style-compile` writes a proposed action, audit and parameters in its JSON reply and the action alone to the requested file; it saves no accepted project. `style-preview` returns `actionFile`, `projectHash`, `stale`, audit and a real MP4. Inspect that MP4. Only with `stale:false`, accept its **exact** `actionFile` through the ordinary writer:

```sh
npx --no-install agent-motion-studio edit film/project.json --action style-preview-1/action.json --if-match PREVIEW_PROJECT_HASH --json
```

After a conflict, read fresh context and explicitly compile/preview again. After an uncertain ordinary commit, read fresh state/history before deciding another operation; do not blindly resend the action. CLI `edit` remains the accepted writer. The Studio uses a separate narrow style ticket bound to scene/style/version/roles/groups/locks/motion/action/base ETag; existing single-object visual guards are unchanged.

Example request for existing IDs (replace them with IDs returned by `state`):

```json
{
  "styleId": "editorial", "version": 1,
  "mode": "restyle", "sceneId": "selected",
  "groups": ["layout", "typography", "motion"],
  "roles": {"headline":"headline", "proof":"proof", "body":"body"},
  "protected": {"headline":["color"]},
  "replaceTracks": false,
  "motion": "standard"
}
```

Creation uses `mode:"create"`, fresh `sceneId`/`objectId`, `text:"New text"` or `"Новый текст"`, all three groups, and one headline role for that object. It has no restyle locks or replacement flag. The CLI compiler preserves the selected composition's IDs, types, exact text, image asset/fit/focal point, storage order, duration, captions/narration and all neighboring state. It returns only an `add-scene` or `edit-scene` objects action.

## Audit and limits

This bounded slice supports 1–5 text objects, at most one existing image and two existing shape accents; at most one headline and one proof. No new fonts, masks, groups, animated colors, springs or upstream renderer are added. Requests with unknown fields/versions/capabilities are rejected. Every selected object needs an explicit compatible role. Text uses bundled Latin/Cyrillic coverage; unsupported glyphs are refused without downloading a font.

Allowed field groups: layout → x/y/width/height; typography → fontSize/weight/align/color; motion → opacity/y/reveal/keyframes. An object or individual x/y/width/height/fontSize/weight/align/color/opacity/reveal/rotation/keyframes field can be protected. Rotation is preserved. Existing tracks are preserved unless replacement is explicit. Changing a tracked base channel can change frame0 even when keys survive; the compiler reports `STYLE_LOCK_CONFLICT` and requires revised locks or explicit replacement. It never silently removes protected animated channels.

The audit uses native wrapping and the smallest base/keyframe box, safe bounds over integer frames, stable readable holds and computable color contrast (minimum 4.5). Text overlap or a later image/filled shape covering text is refused. Shape paint bounds include half the stroke width and rotation. A later stroke whose conservative painted bounds intersect text is refused, including stroke-only shapes; the audit does not infer an empty hollow interior. Contrast over an earlier image, stroke or partial/rounded backdrop is `UNKNOWN`, with `PASS_WITH_WARNINGS` and a request to inspect the preview. Safe-area and box checks are conservative. The reading-time formula is an explicit heuristic, not a perceptual or accessibility certification. Overflow, short holds, low contrast and lock conflicts preserve copy/duration and return actionable errors.

Machine checks and technical examples never constitute artistic acceptance: **human/artistic evaluation NOT RUN**. Before accepting a real film, inspect framing, complete copy, pacing, sound and cuts. Begin from the user's supplied material and purpose; maintain source/brand constraints, distinguish supplied facts from desired emphasis, and record a human review separately. This small review checklist is adapted from the pinned product-film authoring reference; no mandatory story sequence is imported.

See [reproducible example inputs](../examples/authoring-styles/README.md), the distributed [native packages](../styles), and [source/provenance notices](../THIRD_PARTY_NOTICES.md). Source IDs and substitutions are recorded in [Cinetic provenance](../third-party/cinetic/PROVENANCE.json) and [product-film provenance](../third-party/product-film-skill/PROVENANCE.json).
