# Roadmap

The goal is a free, open-source local studio where people and their AI agents can make and revise short films while keeping accepted takes, original sources and a portable editable project.

Editing, history and final export run locally. Users bring their own AI access through an official agent client, provider API key or supported integration. Cloud generation has the provider's costs and terms; local video-model inference is an optional later capability. These are priorities and completion criteria, not release-date promises.

## 0.1 — experimental developer preview

Implemented: local video/image/music import, storyboard, trim/crop, draft scene preview, explicit external-edit conflicts, take restoration and verified MP4 export. Includes a redistributable 20-second example. Cloud generation and built-in chat are not included.

## Next — P0/P1: one generated replacement shot

The first generative MVP, provisionally 0.2, connects one official video API and one model to the existing editor.

**P0 — establish the baseline and provider contract.** Verify the current checkout and tools, then document the chosen model's inputs, duration limits, authorization, costs, reference upload, output retention and job recovery. An API key in the environment does not itself authorize spending or uploading media.

**P1 — finish one complete workflow:**

- Select an existing video scene, provide a prompt/reference and see the data sent and estimated cost.
- Persist the job and remote ID; resume polling after restart without blindly resubmitting an uncertain paid request.
- Download and validate a candidate outside the accepted project. Previewing it must not change the project, history or accepted assets.
- Explicitly accept the previewed candidate in one project operation, keeping the scene duration and previous take. Recover safely if the process stops between acceptance and job acknowledgement.
- Export the film, restore the previous take and export again. Preserve other accepted scenes and all sources; recheck external-edit conflicts at acceptance time.
- Expose the same operations through the UI and CLI, with updated instructions for the user's external agent.

**Completion:** an authorized real provider run, job recovery, preview, acceptance, export and restoration, plus offline failure cases and a real UI conflict check. Without live-run authorization, finish the local implementation and report it as **offline contract verified; live provider unverified**. Mocks alone do not complete the milestone.

The first implementation assignment covers P0/P1. Do not add several providers, a built-in chat or local model inference before this flow works.

## P2 — first-user and agent workflow

- Make setup, opening and reopening a project clear; provide consistent English/Russian UI.
- Let an external agent turn a brief into an editable shot plan, with explicit operations for creating scenes.
- Have an independent new user follow the README and make a remix with their own material. Record setup failures, assistance, generation attempts and time to a usable result.
- Verify another computer and system-dependency installation before widening platform claims. Review the film through continuous viewing and listening as well as frame tests.

**Completion:** an observed independent attempt to create, revise, export and restore a film. Fix demonstrated obstacles before broadening the feature set; this is not proof of demand or artistic quality in general.

## P3 — measured local rendering improvements

- Measure cold export, unchanged export, one-scene edits, music-only edits and preview on a fixed project and environment.
- Add scene caching with correct source, timing, rendering and encoder dependencies.
- Consider lighter previews, reduced temporary I/O and hardware encoding only where measurements justify them.

**Completion:** a measured improvement with output verification against the uncached path and documented resource costs. Local rendering optimization does not speed up a remote model or remove its generation charges.

## P4 — additional generation choices

- Add another provider or official subscription integration when a demonstrated workflow needs it.
- Evaluate optional local video inference separately for model license, supported hardware, memory, speed and output quality.
- Give each backend a complete, tested flow with truthful capabilities, costs and cancellation behavior.

**Completion:** one additional justified workflow works end to end. Do not extract or proxy unsupported subscription credentials, or promise cloud-model quality on every local computer.

## P5 — stable release candidate

- Verify installation from the distributed runtime and opening portable projects on independent machines.
- Preserve accepted sources and takes in the documented project format; opening an accepted film must not require the original provider account.
- Check compatibility, packaged resources, documentation, licenses and release artifacts against the actual implementation.

**Completion:** reproducible installation and the main workflow across several independent projects, with supported environments and remaining limits documented. Publishing a release remains a separate action.

## Implementation handoff and scope

In a source checkout, use `docs/DEVELOPMENT_PLAN_RU.md` for the detailed tasks and acceptance tests, and `docs/AGENT_START_PROMPT_RU.md` for the first agent assignment. These engineering documents are included in the source distribution; they are not part of the installed runtime. Keep this roadmap concise and synchronize its priorities with the detailed plan.

A multitrack NLE, model training, user accounts, hosted billing and a built-in chat are outside the first generative MVP. Broader sound and editing features follow demonstrated user needs.
