# Preparing and publishing a release

0.1.0 is a GitHub developer preview. Runtime installation uses the attached local `.tgz`; this repository deliberately keeps `private: true` and has no npm-publish automation.

## Prepare a candidate locally

From a Git checkout with Node, Chrome and FFmpeg installed. ZIP creation, extraction and resealing use the absolute SystemRoot/System32/tar.exe on Windows (Sysnative for a 32-bit process on 64-bit Windows), verified as bsdtar. A missing/non-bsdtar executable produces an explicit error; GNU tar from Git Bash/PATH is never a fallback. Node opens ZIP files and passes seekable file descriptors via stdin/stdout and passes the working directory through cwd, so older bsdtar builds do not have to decode Cyrillic archive/destination paths from argv. Linux/macOS use zip and unzip (install them separately if missing):

```sh
npm ci --ignore-scripts
npm run check
npm run test:integration
npm run release:prepare
npm run verify:package
```

`release:prepare` rebuilds, audits public files and writes a new timestamped directory under `artifacts/release/`. It creates a source ZIP (root `agent-motion-studio-0.1.0-source`), runtime `.tgz`, editable-example ZIP, first-user kit ZIP, release notes, file inventory and SHA-256 sums. It includes current non-ignored files (including uncommitted changes), so inspect `git status` and the inventory before accepting a candidate. The candidate and kit record the actual Git SHA and `dirty` flag. Dirty kits are explicitly marked preparation-only and cannot pass the kit smoke. Personal briefs, agent settings, research clones, projects, caches and previous verification reports remain on disk and are excluded.

`verify:package` uses the latest candidate, verifies its archive hash, installs it into a fresh OS-temporary directory, and runs installed doctor/init/validate/render/verify plus an unsaved preview and edit/restore. It records exit codes and source hashes. System tools and npm network/cache are still required. It does not prove a clean-OS installation or publish anything. To check a specific runtime: `npm run verify:package -- /absolute/path/archive.tgz`.

For the latest candidate it also runs `verify:user-kit`: extract only the supplied kit into a new temporary consumer with a space and Cyrillic in its path, install the supplied runtime, run doctor/skill/init, open the real studio, preview/edit/export, restore the initial revision and reopen. The technical report checks accepted preview bytes, sources/credits/history, previous exports and all restored decoded frames. No model or human participant is invoked. It adds a sanitized `SELF_RUN.json` and verified environment to the kit, reseals its internal checksums, rebuilds the kit ZIP and updates its external hash in candidate.json/SHA256SUMS. The blank human protocol stays empty. `npm run verify:user-kit` repeats only this smoke. The kit includes the existing installation, agent workflow, status and composition documents as local Markdown, readable before npm install without private GitHub access. Additional source references are explicitly optional. Instructions: [USER_TRIAL_RU.md](USER_TRIAL_RU.md). Source/runtime hashes are not self-referential; the outer kit ZIP hash lives outside it.

Extract the source ZIP into a new directory and check the documented build there as well. Run `git init -b main` if checking a source ZIP without Git metadata. Check the original and changed demo with sound and ask someone else to follow the quickstart. Do not record those human checks as passed until they happen.

## First publication

1. Review the source inventory, license/credits, changelog and candidate results. Commit the intended files on `main`. Do not commit `artifacts/` or temporary paths. Rebuild the candidate if source changes after verification.
2. Use the existing `kok-o/agent-motion-studio` repository. Audit all published Git refs/history, discussions, Actions logs and retained artifact diagnostics before changing visibility. Keep private evidence outside published assets; do not overwrite remote history or relabel source stamps. Existing Git author metadata will be public. The limited source-file check is not a full secret/privacy audit.
3. Verify maintainer access; do not send duplicate invitations. When publication is authorized, configure About/topics/social preview, make the repository public, enable private vulnerability reporting and protect `main` as described in CONTRIBUTING. Read settings back; files do not configure them automatically.
4. Wait for **Verify** on the exact release commit and read the actual logs. Preserve earlier failures; do not substitute another SHA or a successful sibling run for a failed required gate. Locally passing Windows tests do not establish Linux success.
5. Tag the verified commit `v0.1.0` and create a GitHub **pre-release** using `docs/releases/v0.1.0.md`. Attach the candidate archives and `SHA256SUMS.txt`. Link the release to that commit. No npm publication is needed.
6. Download the attached runtime and verify its SHA-256 against the accepted candidate. Save the commit SHA, release URL and actual CI result in the maintainer record.

For this first preview, also attach the unchanged first-human kit `agent-motion-studio-first-user-0.1.0-8e5106ad2a18.zip` identified in [USER_TRIAL](USER_TRIAL_RU.md). Its older clean source stamp, embedded STATUS and SELF_RUN are build snapshots, not the new release commit. Label it separately from newly prepared source/runtime archives and include its original ZIP hash in the release checksums. Never reseal or rename that accepted kit to claim a new verification.

Human viewing/listening, an independent participant and clean-OS setup remain separate NOT RUN checks. A public repository and a pre-release do not establish a stable product. The [recorded launch demo](LAUNCH_DEMO.md) uses real local UI/CLI actions and original assets, not a fake model conversation.

Preparation commands above never commit, tag, push, create repositories or upload releases. Perform publication only when the project owner has chosen the destination and requested it.

## Distribution checks and their limits

`check:release` checks Git-visible files, local Markdown destinations, package/version agreement, size limits, unsafe paths, a few credential patterns and private home/session paths. It checks the candidate surface, not every file on the computer. It is not a comprehensive secret scanner or license audit. Review new third-party assets and generated archives explicitly.

Workflow action revisions are pinned. Update them deliberately, using the upstream [checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node), [setup-chrome](https://github.com/browser-actions/setup-chrome) and [upload-artifact](https://github.com/actions/upload-artifact) documentation. CI has read-only repository permissions and no publishing credentials.
