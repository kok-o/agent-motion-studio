# Installed-kit reopen evidence — issue #16

Base: `92b0a4fe466e757b9912887d45d04e3a0d6ed5d8`. Original failure cause: **UNKNOWN**. The change repairs missing failure evidence; it does not claim to fix the historical timeout. The existing `networkidle0` gate, 30000ms navigation deadline, title/export/current-version assertions, earlier-output preservation and 600-frame decode comparison remain in the full verifier.

## Immutable CI comparison

Read the complete archived child/caller scripts, parent reports and kit manifests from [failed PR run 37747206651](https://github.com/kok-o/agent-motion-studio/actions/runs/37747206651/job/113211403804) and [same-author-head push run 37747131000](https://github.com/kok-o/agent-motion-studio/actions/runs/37747131000). Neither run was repeated or resealed.

| Observation | Required PR RED | Same-head push GREEN |
| --- | --- | --- |
| Source stamp | synthetic merge `b96c6d085511bd3e1126812b75d17945e4172135` | author `dea937992e2b5f86fa94b9078e88c077e1d84c1c` |
| Outer artifact SHA-256 | `dd6c512784dc1464c39e2d168412612ad73b69997d9aedb08edb043c1e75672b` | `027375bbdb68a60d34847969f3d6b5572e5078cc89afeb6ceb3ab3ccc7696248` |
| Parent / firstUserKit field | failed / absent | passed / self-run-passed |
| Child SELF_RUN / kit verification | absent / not-run | present / self-run-passed |
| Reopen | Navigation timeout of 30000 ms exceeded, child line 103 | completed |

All 213 archived source files have identical contents. Both runtime TGZ files are 31,034,001 bytes, SHA-256 `da7119ffe05f1156a4e4f9812e8101bcd2ad8d08cbee5ea107fbf976549d6e4b`. Archived child SHA-256: `24723660ae35bde0fb35d119e78927cb406cd4f79163b609a6091f4e7d1fc1c9`; caller: `4dce7282d867a29b9a814576eda114fc01a9f4ab11e06b20497371acab7f0648`. Both environments report Linux x64, Node 22.14.0, Chrome 155.0.8059.39, FFmpeg/ffprobe 6.1.1.

The RED parent proves earlier package checks passed; child execution reached the second navigation by code order, but its individual commands/checks were not persisted. Reopened title, exports=3/current version, earlier MP4/library preservation, restored decoded-frame equality and final page-error/blank-protocol checks did not complete. There is no original timeout-time document/session/API status, DOM/media snapshot, pending-request trace or process/browser health. The GREEN does not supply those missing RED observations.

## New controls and one natural probe

The observer is attached before navigation. Reports retain bounded lifecycle/request classes/status/failure codes, DOM comparison booleans/export count/media states and process/health observations. The first failure snapshot is immutable even if cleanup observes a recovered or unavailable page. Reports exclude raw URLs, bodies, headers, session tokens, console messages, titles and personal paths. Partial failed child evidence is saved before cleanup and included by the caller; cleanup/persistence failures are separate, and failed verification/cleanup cannot reach kit sealing. Existing packaging finalization remains after successful technical verification; a later packaging error fails the parent without relabeling the completed technical smoke. This change does not add transactional packaging rollback.

Unit controls cover original Error identity, simultaneous cleanup/storage failures, bounded/unavailable/stale DOM snapshots, failed API/session, request accounting/redaction and prevention of success-only sealing. A real isolated browser control times out with ready title/exports/current version and a deliberately unfinished media-class fetch; another reaches network idle with a complete HTML document and failed state API but false UI postconditions. These synthetic controls validate observations, not the original CI cause.

One natural installed probe on macOS 26.3.1 arm64 / Node 25.8.1 / Edge 154.0.4258.62 / FFmpeg/ffprobe 9.0.1: **NOT REPRODUCED**, exit 0. A fresh consumer outside checkout with spaces/Cyrillic installs the exact TGZ above. The existing sealed coffee MP4 (`cb728ecb2fec8976607e215a07746e53b4b24164bc3eff4e7d3dcb380cda2fb8`) is checked by installed `verifyVideo` (1920×1080, 30fps, 600 frames, 20s, AAC, full decode exit 0) and registered through the ordinary installed `registerExport` API. This simplifies the fixture to one real existing export; no new render or fresh-render provenance is claimed, and no accepted JSON/history or export report is written by hand.

First open and one reopen passed the unchanged gate and actual title=`film`, exports=1, current-version assertions. Both document/session/state responses were 200; snapshots had zero pending requests, player readyState=4/networkState=1/no media error, no page errors/crash/disconnect. Console error counts were 2/1 and request-failure counts 4/3; these observations are not assigned a cause. Accepted project, sources, credits, original output and library copy hashes were preserved; both controlled idle SIGINT exits were 0, cleanup errors empty, sealed kit unchanged. This is not the full three-export render/restore self-run or a reproduction on the original Linux runner.

Reproduce the focused probe with an existing verified delivered directory:

```sh
node scripts/probe-installed-kit-reopen.mjs --kit <delivered-directory> --evidence artifacts/reopen-probe
# On Windows also pass --npm <npm-cli.js>; CHROME_PATH may select an installed Chromium per process.
node --test --test-concurrency=1 tests/integration/kit-ui-observer.test.mjs
npm run check
```

Local raw logs/reports and retained consumer remain ignored. Initial check failed because the browser environment was unspecified; the next check passed unit tests but distribution audit rejected a synthetic private-path literal in the redaction test. Both RED logs were retained; the fixture now constructs the sentinel without distributing a home path. Final `npm run check`: build/audit PASS, 88 unit PASS + 1 Windows-only skip, exit 0. Final sequential `node --test --test-concurrency=1 tests/integration/kit-ui-observer.test.mjs`: 1/1 PASS, exit 0. Both use the existing Edge via per-process CHROME_PATH. No full local media matrix or natural reopen was repeated; exact-head required hosted checks are recorded in the PR. No timeout increase, navigation retry, runtime/security change, paid call, human/model trial or clean-OS claim.
