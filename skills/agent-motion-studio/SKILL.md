---
name: agent-motion-studio
description: Create and edit animated product, promo, and explainer MP4 videos from local images, text, and audio using Agent Motion Studio scene manifests.
---

Use the local Agent Motion Studio CLI to turn the user's materials and brief into a declarative manifest and a rendered MP4. Edit content and timing in JSON; keep renderer code unchanged for ordinary video requests.

Find the CLI in the source checkout (`node dist/cli.js`) or an installed package (`agent-motion-studio`). Run `doctor --json` when the rendering environment is unknown. Follow [the manifest reference](references/manifest.md) for the contract and [scene guidance](references/scenes.md) when choosing layouts.

Start from the user's brief and supplied files. Ask only for missing information that affects the result, such as an essential product image or the intended spoken text. If aspect ratio is unspecified, choose 9:16 for a short mobile promo and state the choice. Use `init repo-promo`, `init product-ad`, or `init feature-explainer` to obtain a complete example, then replace its sample content with the user's materials. Keep assets inside the manifest's project directory.

Write a short sequence with a clear hook, a product or feature demonstration, and a concrete call to action. Each scene has a stable `id` and integer `durationFrames`. At 30 fps, four seconds is 120 frames and fifteen seconds is 450 frames. Use the three library scenes: `kinetic_title`, `product_zoom`, and `cta`. Use a supplied voice file when available; enable online Edge speech only when requested. A procedural music bed can accompany an otherwise silent brief.

For a bold motion reel, use `init kinetic-promo` and `video.style: "kinetic"`. Before rendering, write a compact storyboard with each shot's message, visible change, focal subject, and duration. Prefer several 45–90-frame shots over an eight-second static screenshot. The procedural groove is 120 BPM: fifteen frames per beat. Use explicit `\n` breaks for deliberate headline lines. First show the full image with `contain`; a separate `cover` shot and `focalPoint` can emphasize a supplied detail. Inspect the crop. A camera move is not a demonstrated product interaction, and these scene recipes cannot depict arbitrary mechanisms from JSON. The default `studio` style is a restrained presentation.

Run `validate <manifest> --json`, then `render <manifest> --out <new-output-directory> --json`. Inspect the generated contact sheet for every scene and view the MP4 when a player is available. Verify readable text, image framing, scene boundaries, and captions. Listen to audio when the environment permits it. A passing media check does not imply visual or voice approval: record what you actually inspected and any unavailable review.

Also inspect a full-resolution image of the densest shot and frames before, at, and during each cut. If text collides, a focal detail is unreadable, or a shot has no useful change, revise composition or timing and render again. Decorative dots and a progress line alone do not explain the product. Preserve the user's meaning; do not invent numbers or claims to make a frame look busy.

For a revision, preserve scene IDs and change the requested fields in the same manifest. Rerender to a separate output directory or use `--overwrite` when replacement was requested. Check the affected frame or scene, and verify the new media. Changing the contents of an image at the same path must invalidate cached frames; changing a duration must shift following scenes. Do not edit cache metadata to force a hit.

Deliver links to the MP4, contact sheet, manifest, and render report, with a brief account of the requested changes and verification. Describe the result as programmed animation of supplied materials. Claims of photorealistic video generation, universal native client compatibility, or an inspected voice require separate evidence.

Do not put JavaScript, shell commands, remote URLs, executable content, or unsupported scene fields in the manifest. Do not replace missing assets with unrelated content. The CLI must report input, layout, timing, encoding, and provider errors; fix the cause and rerun within the authorized task.
