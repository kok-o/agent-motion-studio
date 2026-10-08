# Recorded launch demonstration

[Watch the MP4](media/agent-motion-studio-demo.mp4) · [Real editor still](media/studio.png) · [Social preview](media/social-preview.png)

The 37-second film records the real local CLI/Studio workflow: create an original three-scene project, import a procedural poster, export, change one scene in the editor, preview the unsaved correction, accept it, export a new version, restore the scene, export again and reload the project. It is not a model conversation or an independent user test.

The editor recording is accelerated from 86.7 seconds into a 31-second segment, with branded opening/closing cards and recording captions. The address bar is not captured; the private project path is visually redacted before paint. The editor's session/Origin/Host checks, CSP and browser sandbox remain enabled. No mock interface, fabricated API response or neural-video output is used.

## Technical evidence

- Final MP4: 1920×1080, 30 fps, 37 seconds, 1,110 H.264 frames and stereo AAC; full decode exit 0.
- The underlying film is 360 frames. Its preview did not change accepted project bytes. Three real exports, restore/reopen, the imported source hash and four history snapshots were checked.
- Source PNG SHA-256: `0f291c99e12852941d0befe7d8d59b4162f8e82feccb03f018c09a7f108b24b2`.
- Human listening, independent usability, clean-OS setup and a live model session in this recording: **NOT RUN**. Decode/frame checks do not establish artistic quality or product demand.

Initial authoring failures are retained in private local evidence: inline recording styles were refused by the application's CSP; Puppeteer's `overwrite:false` rejected an existing recording directory; streamed WebM lacked a container duration. The recording helper uses allowed DOM style properties, a fresh UUID directory and the actual frame count/rate. Those were recording-tool issues, not a repair of the historical installed-kit navigation timeout. The working UI capture was reused for finishing rather than rerendering it for a prettier report.

## Reproduce locally

From a configured development checkout:

```sh
npm ci --ignore-scripts
npm run build
node scripts/create-launch-demo.mjs
```

The script writes a new ignored directory under `artifacts/launch-demo/`, uses normal CLI/UI project operations, and prints its actual result. It does not overwrite user projects or publish files. The editable demonstration project is supplied separately as `launch-demo-project.zip` in the [pre-release assets](https://github.com/kok-o/agent-motion-studio/releases/tag/v0.1.0); preserve its sources and history when reopening it.

## Credits and license

The poster, recording cards and captions are original procedural materials for this project. The soundtrack comes from the project's original deterministic `kineticGrooveWav` implementation. The recording depicts the project's own editor. Code, original graphics/music and this demo are MIT; bundled Noto/Oswald fonts retain their SIL OFL notices. No coffee footage, personal media, external image/music service or paid model call was used for this film. Existing coffee examples remain separately CC BY-SA 2.0 with their credits.
