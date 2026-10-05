# Choose a scene

`kinetic_title`: required `text`; optional `highlight` must occur inside that text. Use a short hook or a single clear feature statement. Optional `fontSize` is 48–160; fit may reduce the chosen size for readability.

`product_zoom`: required image `asset` and `caption`; optional `fit` is `contain` or `cover`, and `focalPoint` is `{x, y}` with each coordinate from 0 to 1. Use contain for screenshots that must be readable in full. Use cover for photos when cropping is intentional, and inspect the actual crop.

`cta`: required `text` and `label`. End with one action. A URL in `label` is ordinary displayed text, not a remote asset or a network request.

All scenes are computed from frame indices. Studio scenes have an entrance, hold, and exit. Kinetic scenes retain their final composition; the next scene reveals over it in the first sixteen frames (short scenes use less). Scene intervals do not overlap or add runtime. Keep IDs when changing text, materials, duration, theme, format, or audio. Choose an appropriate aspect ratio before arranging the sequence; each format has its own layout.

For a restrained fifteen-second presentation, 90/240/120 is one possible budget. For `video.style: "kinetic"`, prefer several 45–90-frame shots, one idea per shot; fifteen frames is one beat of the procedural 120 BPM groove. Headlines use bundled Oswald (Latin/Cyrillic), with larger default sizes and explicit `\n` line breaks. Avoid forcing a small `fontSize` on a poster heading. Kinetic `contain` preserves the full image; `cover` crops and moves toward the supplied focal point, marked by corner brackets. A crop is a camera move, not simulated product behavior. The CTA uses the accent as its ground. Inspect settled, final, and transition frames. A valid contact sheet does not guarantee a pleasant pace or readable details.
