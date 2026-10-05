# Scenes

The engine renders 1080×1920 portrait or 1920×1080 landscape at 30 fps. Positions and text boxes are adapted to the selected format. A scene occupies `[startFrame, endFrame)` and computes its visual state directly from the frame index.

| Type | Required content | Optional controls | Intended use |
| --- | --- | --- | --- |
| `kinetic_title` | `text` | `highlight`, `fontSize` | A short hook or feature statement |
| `product_zoom` | image `asset`, `caption` | `fit`, `focalPoint`, `fontSize` | An image or screenshot with a restrained zoom |
| `cta` | `text`, `label` | `fontSize` | A clear closing action |

All scenes require stable `id` and positive integer `durationFrames`. Up to twelve scenes are allowed; the total must be one to sixty seconds. Optional `video.style` selects `studio` (original default) or `kinetic`. Studio has entrances/exits and cuts. Kinetic uses larger Oswald headings, letter reveals, animated dot fields, image reveals, focal-point camera crops, staggered wipes, and an accent iris into the CTA. The outgoing frame remains visible through a cut, and the final composition stays readable. These original Canvas recipes do not include the upstream WebGL engine.

Start with `init kinetic-promo` for a thirteen-second, five-shot reel. Prefer 45–90-frame shots; fifteen frames is one beat of the procedural groove. Explicit `\n` breaks retain a deliberate poster line count. Optional `fontSize` remains a 48–160 override; kinetic defaults are larger. Transitions use the beginning of the incoming scene (up to sixteen frames) and add no runtime. Short scenes use bounded or disabled transitions. Contain never crops a supplied image; cover intentionally crops and moves the camera toward `focalPoint`.

`highlight` must be a substring of a title. Keep one emphasized phrase. `fit: "contain"` preserves the full image; `cover` fills the image box and crops. `focalPoint: { "x": 0.5, "y": 0.5 }` selects a normalized framing point; inspect an off-center crop after changing it.

The bundled Noto Sans supports the renderer's tested Latin/Cyrillic range. Text is wrapped and reduced within limits; impossible layouts cause an error recommending shorter copy. URLs in CTA labels and markup in text are displayed as ordinary text. Supported fields are defined by the single schema in `schemas/manifest.schema.json`.

Narration and captions are shared capabilities of all scenes; see [AUDIO.md](AUDIO.md). The contact sheet includes entrance, settled, and exit frames from every scene. Motion, narration quality, and image readability still require review of the actual result.
