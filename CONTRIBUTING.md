# Contributing

Agent Motion Studio 0.1 is an experimental local editor. Start with the [first remix](README.md#try-your-first-remix), read the [current status](docs/STATUS.md), then take the next incomplete step of the [single development plan](docs/PLAN_V0.2_RU.md). Bug reports with a small reproducible project are especially useful.

## Development setup

Install Git, Node.js ≥22.12, Chrome/Chromium and FFmpeg/ffprobe. Clone this repository, then run:

```sh
npm ci --ignore-scripts
npm run check
npm run doctor
npm run test:integration
```

`check` builds TypeScript, runs unit tests and checks the public source files and local documentation links. It requires a Git checkout; when starting from the source ZIP, run `git init -b main` first. Integration tests use a real browser and FFmpeg; they run sequentially and need more time and RAM. No API key is needed.

Make a personal copy of the example instead of editing the shared template:

```sh
node dist/cli.js init coffee-ritual --dir projects/my-remix
node dist/cli.js studio projects/my-remix/project.json
```

`projects/` is ignored. Rebuild after changing source files; the running server uses `dist`. Stop your server before restarting it, or choose another port.

## Working as a pair

1. Open an issue with a user-visible outcome and a way to check it. Assign one owner; agree before both people change the same subsystem.
2. Start from current `main`: `git switch main`, `git pull --ff-only`, then `git switch -c feat/short-name` (or `fix/short-name`). Keep one outcome per branch.
3. Make the change, run relevant checks and inspect `git diff`. Add code and permitted fixtures, never personal footage, keys, session links or generated render directories.
4. Open a pull request with the problem, resulting behavior and evidence. The other person reviews it and repeats the changed scenario where practical.
5. Merge after the required checks and review pass, preferably with squash merge. Pull `main` before the next task. Avoid force-pushing shared branches.

When several people contribute, agree on ownership of the affected files and the project-edit contract. The existing provider/job-resume implementation is preserved; current priorities come from the development plan. Historical briefs are not additional assignments.

Once the repository exists, invite the second maintainer with Write access, enable private vulnerability reporting and protect `main` with pull requests, one review and the CI checks. These are repository settings; files in this checkout do not enable them automatically. Do not require an approving review from the PR author. Add CODEOWNERS only after agreeing on the actual GitHub handles.

## Where things live

| Path | Responsibility |
| --- | --- |
| `src/project.ts`, `src/spec.ts`, `schemas/` | Project changes, validation, history and compatibility |
| `src/server.ts`, `src/preview.ts`, `studio/` | Local API, draft previews, editor UI |
| `src/pipeline.ts`, `src/engine.ts`, `renderer/` | MP4 export, scene composition and v1 rendering |
| `src/audio.ts`, `src/media.ts`, `src/runtime.ts` | Audio, media checks and child processes |
| `tests/unit/`, `tests/integration/` | Contract checks and real media/browser behavior |
| `examples/`, `docs/media/` | Redistributable fixtures, credits and curated demos |

## Tests and contribution boundaries

For a documentation-only change, run `npm run check:release`. For a bug fix, prefer a behavioral regression covering what failed. Preserve v1 projects and existing accepted sources. Do not rewrite unrelated code or mirror implementation details in tests.

Optional checks: `npm run test:edge` needs a configured Python fixture; `npm run test:windows` needs Windows and Python. Neither is part of the default offline suite. The optional online speech service is outside the local editor's release criteria.

Describe AI-assisted changes like any other contribution: the author understands the patch and is responsible for its behavior, provenance and tests. Do not submit generated claims of successful runs without the logs or actual execution.

Keep discussion respectful and focused on the work. By contributing code you agree to license it under the project's [Apache License 2.0](LICENSE). Preserve separate licenses and attribution for fonts and media; only add assets you are allowed to redistribute. See [notices](THIRD_PARTY_NOTICES.md), [security](SECURITY.md) and [release steps](docs/RELEASING.md).
