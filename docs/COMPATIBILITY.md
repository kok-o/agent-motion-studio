# Compatibility and verification scope

Version 0.1.0 is an experimental developer preview. The release candidate has been exercised on Windows x64 with Node 22.14.0, Chrome 154 and installed FFmpeg/ffprobe. Local edits, scene preview, full export, source preservation, conflicts and installation outside the checkout have behavioral tests.

| Surface | Scope |
| --- | --- |
| Windows x64 | Main local verification environment; system tools already installed |
| Linux | CI exercises the offline media suite; configuration alone does not prove a completed hosted run |
| macOS | Not verified for this release |
| Clean OS setup | No bundled Chrome/FFmpeg installer; dependency setup needs separate user testing |
| v1/v2 projects | v1 remains readable; accepted editor changes migrate to v2 with history |
| 16:9 / 9:16 | 1920×1080 / 1080×1920, 30 fps, H.264 yuv420p; supported by tests |
| Sources | MP4, PNG/JPEG and supported audio files; SDR workflow, no HDR color management |
| Agent clients | CLI and portable skill provided; native discovery in each agent is not certified |
| Optional Edge speech | Separate Python addon and online service, outside default offline CI and studio preview |

Run `npm run doctor` for environment discovery, `npm run check` for source/unit checks and `npm run test:integration` for browser/media behavior. See [release verification](RELEASING.md) for packaged-consumer checks. Review private paths and metadata before sharing logs.

Pixel comparisons are meaningful within the tested environment. Different browser/font/codec versions may rasterize differently. Full decode, frame counts and source hashes establish technical integrity; continuous human viewing and listening are still needed to judge the film.
