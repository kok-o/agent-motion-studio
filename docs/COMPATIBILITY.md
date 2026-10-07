# Compatibility and verification scope

Version 0.1.0 is an experimental developer preview. The earlier release candidate ran on Windows x64 with Node 22.14.0; the 2026-10-07 follow-up ran on Windows x64 with Node 24.19.0, Chrome 154.0.8037.98 and installed FFmpeg/ffprobe. Local edits, scene preview, full export, source preservation, conflicts and installation outside the checkout have behavioral tests. The latest independent uncached fastgrep exports match all 540 frames, audio and MP4 in that environment; Edge passed doctor/Canvas checks only. See [dated results](STATUS.md).

| Surface | Scope |
| --- | --- |
| Windows x64 | Main local verification environment; system tools already installed |
| Linux | Hosted offline media and installed-package checks passed for `84bc838`; see [dated status and CI evidence](STATUS.md). Interactive desktop use and clean user installation remain separate checks |
| macOS arm64 | External agent technical trial of main `2d45a83` reported SSH install, studio, preview/edit/export/restore/reopen. Updated browser diagnostics and shutdown/export fixes have not been run on macOS here; independent human use remains unverified |
| Clean OS setup | No bundled Chrome/FFmpeg installer; dependency setup needs separate user testing |
| v1/v2 projects | v1 remains readable; accepted editor changes migrate to v2 with history |
| Generated-take receipts | Optional v2 metadata; new code reads previous projects, while older strict-schema binaries may reject files with `operationReceipts` |
| Replicate Wan I2V | One production adapter with offline contract tests; live account, billing, output and full generated film are unverified |
| 16:9 / 9:16 | 1920×1080 / 1080×1920, 30 fps, H.264 yuv420p; supported by tests |
| Sources | MP4, PNG/JPEG and supported audio files; SDR workflow, no HDR color management |
| Agent clients | Codex desktop film/edits/restore and historical real API-agent demonstrated; fresh official Codex CLI model session passed creation, three corrections and reopen with developer transport assistance. Claude Code and a live run of the new API actions remain unrun. See [scope](AGENT_VALIDATION.md) |
| Optional Edge speech | Separate Python addon and online service, outside default offline CI and studio preview |

Run `npm run doctor` for environment discovery, `npm run check` for source/unit checks and `npm run test:integration` for browser/media behavior. See [release verification](RELEASING.md) for packaged-consumer checks. Review private paths and metadata before sharing logs.

Pixel comparisons are meaningful within the tested environment. Different browser/font/codec versions may rasterize differently. Full decode, frame counts and source hashes establish technical integrity; continuous human viewing and listening are still needed to judge the film.

Use Chrome/Chromium/Edge for the renderer. Doctor and every renderer page check exact Canvas/PNG readback; known Brave executables and Brave's identity API produce `BROWSER_UNSUPPORTED`. The external macOS report observed session-dependent Canvas pixels in default Brave; raw files for all its follow-up controls were not provided, so those controls remain reported evidence. Actual Brave execution of the new diagnosis is pending. The studio UI may use your usual browser while `CHROME_PATH` selects the separate renderer. Personal profiles/privacy settings and the Chromium sandbox are preserved.

Independent-run repeatability means separate CLI/browser processes with `--no-cache`, identical project/tool/environment versions and full decoded frame/audio comparison. A cache hit or same-session PNG comparison is insufficient. [Commands and local-process requirements](GETTING_STARTED.md).

Generation uses 121 source frames at 16 fps, 480p or 720p. The local scene encoder keeps its existing 1080p/30-fps output and ignores source-video audio. Candidate preview currently excludes projects with narration/captions. Saved jobs use explicit resume; hard process termination may require verified manual removal of the private runner lock. See [generation and recovery](GENERATION_RU.md) and [the provider contract](GENERATION_PROVIDER_DECISION.md).
