# Public preview preparation record

This records a bounded publication check, not an independent security certification or stable-product acceptance. Existing evidence and Git history are retained.

## Audited baseline

Accepted main `38ea986fa4b32cb8413d3fbb73cbf303624a4c4d` was checked before public preparation:

- Gitleaks 8.30.1 default rules, fully redacted output: all reachable Git history/ref changes; 29 diff-bearing commits, no credential findings. A separate path/privacy pass examined 351 historical text blobs among 572 reachable objects and found no private home path or live-looking session link. No historical credential filename was found.
- GitHub metadata: 17 Issue/PR records, 52 comments and one review; no credential-like value, private home path or live-looking session URL in those texts.
- Actions: 44 runs / 47 attempts. Logs from 46 attempts were checked; the remaining cancelled attempt had three jobs with zero executed steps and no available logs. Earlier failures were not removed or turned into expected successes.
- All 37 retained artifact containers were inventoried; their outer text/report/log entries were read with verified byte-range requests and scanned. Gitleaks found no credentials in the extracted diagnostic text or Actions logs. Nested source/runtime provenance was checked through Git and accepted candidate checks, not by claiming a steganographic scan of every binary.
- Home-path matches were GitHub's hosted Windows short runner home and Dependabot automation home, not personal development paths. Scanner examples in the downloaded Gitleaks tool itself were outside the publication target and were not project leaks.

Standard Git author names/emails remain part of the retained history and become public with it. User projects, original films, caches, credentials and local agent settings are not staged or attached to the release. The limited `check:release` patterns alone were not treated as this audit.

## Release boundaries

Version 0.1.0 is an experimental **pre-release**. Keep the fixed first-human kit `8e5106a`, its original stamp/hashes/SELF_RUN and blank protocol unchanged. Newly prepared source/runtime archives carry their own actual source stamp. Never relabel the old kit with a release or merge SHA.

The launch media is a real local CLI/Studio recording with original assets and disclosed acceleration. It is not a fresh model-session recording or a human trial; see [demo provenance](LAUNCH_DEMO.md).

Before publication, check the new commit/diff and its own CI, scan newly generated diagnostic text, verify candidate assets/checksums and read back the GitHub settings. Download the final attached runtime and compare its hash before reporting publication complete. [Maintainer procedure](RELEASING.md).

Natural Windows EPERM and the earlier installed-kit reopen timeout remain **UNKNOWN**. Independent human viewing/listening/usability, clean-OS installation and unsupported live model/provider scopes remain **NOT RUN**. No new stable guarantee, paid calls or npm-registry publication is implied by opening GitHub or creating a pre-release.
