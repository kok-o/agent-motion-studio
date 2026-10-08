# Provenance and third-party notices

The TypeScript engine, Canvas scenes, procedural score, sample copy, and synthetic demo images were written for this project. Production code does not import reference clones. Distributed third-party material consists of the fonts and attributed coffee footage derivatives described below; reference-project demo media and voice models are not included.

## Application code

Copyright (c) 2026 Agent Motion Studio contributors.

The application code and documentation are distributed under the Apache License, Version 2.0; see [LICENSE](LICENSE). Original demo media retain MIT, coffee derivatives retain CC BY-SA 2.0, and fonts retain SIL OFL.

### Earlier MIT code notice

Code incorporated from the earlier MIT distribution retains the following copyright and permission notice. This notice also applies to original demo media that remain MIT. Previously distributed MIT versions remain available under their original terms.

MIT License

Copyright (c) 2026 Agent Motion Studio contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Design and implementation references

- [opus-video-skills](https://github.com/tuzhechen2005/opus-video-skills), commit `59744a69c7b916cfbe4c4ec84006b0c2f5e2fde1`: frame-index/time-controlled browser rendering, FFmpeg orchestration, contact-sheet workflow, and procedural score concepts. The implementation here is original; no source blocks were copied. Its MIT attribution is retained below as an acknowledgment, including John Heibel for the upstream renderer lineage.
- [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft), commit `5ddbf521038b0a7accfb6dc1e0a9eb29c67277ab`: title pacing and product composition ideas. No code, shot-card text, or media were transferred. Upstream code is Apache-2.0.
- [claude-remotion-skill](https://github.com/haidrrrry/claude-remotion-skill), commit `1dcbe5e3fc6cf970bd10d3cc05f0a8a5d19d0383`: typography, held poses, and render/inspect/fix principles. No Remotion runtime or TSX components were transferred.
- `remotion-video-skill`, `claude-code-video-toolkit`, `MoneyPrinterTurbo`, and `cinematic-video-prompt-skill` were read for optional speech, asset organization, subtitle failure handling, and composition guidance. No code or media from these clones is included in the package.

Research clones are not distributed in the source or runtime archives.

## Distributed fonts

Six unmodified Noto Sans WOFF2 subsets (Latin, Cyrillic, Cyrillic Extended; weights 400 and 700) come from `@fontsource/noto-sans@5.2.6`. The full SIL Open Font License is distributed as `assets/fonts/OFL.txt`. The build copies the font files from the pinned development dependency; rendering reads only these local files. Fontsource package version and hashes, rather than a remote font URL, define the bundled font fixture.

Three unmodified Oswald WOFF2 subsets (Latin, Cyrillic, Cyrillic Extended; weight 700) come from `@fontsource/oswald@5.3.0` for the kinetic style. Its SIL Open Font License and copyright are distributed as `assets/fonts/OFL-Oswald.txt`. The renderer and score are original implementations informed by kinetic-reel typography, continuity, and shared timeline guidance; no upstream source blocks or demo media were copied. All font requests remain local.

## Demo materials

`examples/product-ad/assets/planner-alternative.png` is an original fictional planner drawing created locally by `scripts/create-planner-variant.mjs` for scene-replacement validation (MIT). No media API or external source was used.

`examples/repo-promo/assets/studio.png`, `examples/product-ad/assets/planner.png`, and `examples/feature-explainer/assets/timeline.png` are original synthetic drawings created by `scripts/create-demo-assets.mjs`. They depict fictional demo content, not a screenshot of an implemented visual editor. They retain their separate [MIT license](examples/orbit-demo/LICENSE).

`examples/feature-explainer/assets/voice.wav` is locally synthesized output of the original text “Измените текст в JSON. Движок соберёт новый ролик.” using the installed Windows SAPI Microsoft Irina Desktop voice, with FFmpeg loudness normalization targeting -16 LUFS / -2 dBTP. It is a test fixture, not a recorded person or a cloned voice. The generation script is `scripts/create-demo-voice.ps1`; Windows speech engine binaries are not distributed. Sentence captions are approximate supplied timings. Edge output is a separately generated verification artifact and is excluded from the package.

Procedural music is an original deterministic PCM chord bed or kinetic groove in `src/audio.ts`; no music samples are used. `examples/kinetic-promo/assets/studio.png` is a byte-identical copy of the original studio demo drawing above.

## Runtime dependencies and external tools

Runtime JavaScript dependencies are pinned in `package-lock.json`: Ajv (MIT), image-size (MIT), and puppeteer-core (Apache-2.0), plus their transitive packages and upstream license files. They are installed by npm rather than vendored here. Fonts are shipped with their OFL notice. FFmpeg and Chrome/Chromium are user-installed prerequisites with separate upstream licensing; neither binary is redistributed. FFmpeg licensing depends on the user's selected build.

The optional Python edge-tts addon is external to the core package; its project is LGPL-3.0. The adapter invokes its CLI as a separate process. Microsoft provides the online service, and a successful smoke test does not guarantee ongoing availability. See [the addon source](https://github.com/rany2/edge-tts) and `docs/AUDIO.md`.

## Upstream MIT acknowledgment

MIT License

Copyright (c) 2026 tuzhechen2005

Portions (skills/painted-animation/template/, and skills/kinetic-reel/template/render.mjs, which is derived from it)
Copyright (c) 2026 John Heibel, see skills/painted-animation/template/LICENSE

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
# ORBIT prototype materials

The ORBIT footage, image and WAV in `examples/orbit-sources` and imported copies in `examples/orbit-demo/assets` are original procedural synthetic fixtures created for this repository. See `scripts/create-orbit-sources.mjs`, `src/audio.ts` and `examples/orbit-demo/PROVENANCE.md`. These assets retain their separate [MIT license](examples/orbit-demo/LICENSE). No external footage, music, image-generation API or video-generation API was used for this prototype demo. Bundled fonts retain the separate licenses documented below.

## DAILY RITUAL real footage

The coffee-ritual video excerpts and still are adapted from Scott Schiller's Morning Espresso Routine, under CC BY-SA 2.0. See examples/coffee-ritual/CREDITS.md and provenance.json for the original Flickr URL, Commons copy, license URL, transformations and hashes. Keep this attribution when redistributing assets or films. These filmed sources are not covered by the code Apache License 2.0; the procedural score remains original MIT material.
