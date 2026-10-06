# Roadmap

The goal is a free, open-source local studio where users create and revise videos with their own Claude Code, Codex or other supported agent, using an existing subscription or their own API access. The studio keeps accepted takes, original sources and a portable editable project.

The main workflow is brief → agent-authored scenes → local preview → requested revisions → MP4 and editable project. The agent can arrange supplied footage, write titles and control procedural motion through the studio's supported tools. Editing, history and final export run locally. A separate video-generation account is optional for this workflow.

For realistic generated footage, users can additionally bring permitted clips from a service they use, connect an official supported subscription integration, use a media API key or later run a supported local model. Each service has its own capabilities, quota and costs; a coding-agent subscription does not itself supply every image/video model. These are priorities and completion criteria, not release-date promises.

## 0.1 — experimental developer preview

Implemented: local video/image/music import, storyboard, trim/crop, draft scene preview, explicit external-edit conflicts, take restoration and verified MP4 export. Includes a redistributable 20-second example. Cloud generation and built-in chat are not included.

## A1 — demonstrated film workflow; remaining client checks

**Completed on 2026-10-06:** the Codex desktop session created the ContextOS film from a new brief, previewed and accepted two demonstration corrections, restored the original and reopened the preferred project. The edits changed exactly 210 and 120 frames respectively; unaffected frames matched, all 600 restored frames matched, and accepted sources/history were retained. These were agent-selected demonstration corrections, not two subsequent human requests. A separate real OpenAI Responses API-agent produced a 600-frame film. Do not repeat completed tasks without a detected regression. See [verification scope](docs/AGENT_VALIDATION.md).

**Native discovery checked:** a fresh official Codex 0.149.1 app-server process found the enabled skill through `skills/list`; no model turn was started. This is distinct from model continuation in a fresh session.

**Still open:**

- Continue the existing film in a fresh official Codex model session. The available CLI uses API-key auth, so this check was not run under the no-paid-calls instruction. Keep login unchanged.
- Run Claude Code discovery and continuation when installed and authorized; it is absent from PATH here.
- Obtain two follow-up corrections from a person and continuous human viewing/listening. Demonstration edits and decode checks do not establish these.

The workflow contract for later client checks remains:

- Make the existing CLI/skill workflow discoverable and runnable in the user's officially authenticated Claude Code and Codex. Verify each client separately; other clients remain planned until tested.
- Start with a natural-language brief and permitted local materials. Produce a 15–30-second motion/explainer or edited film with 3–4 scenes, an editable project, MP4 and contact sheet.
- Support two follow-up requests, such as changing the second scene's visual treatment and shortening a title. Preserve unaffected scenes and sources; demonstrate restoration and reopening.
- Inspect actual rendered frames and continuous playback. Record readability, framing and pacing separately from successful encoding.
- Provide the same workflow through an officially supported API-key agent path. An API key used by the agent model and a key used by a media generator are distinct optional configurations.

**Completion:** evidence from actual agent sessions, the resulting film and two edits, source/history checks and per-client status. A tested CLI, written skill or controlled LLM response alone does not establish Claude Code/Codex interoperability. If one client or an API account is unavailable, complete the independent implementation and state which real-client checks remain unrun.

The first demonstration uses supplied assets and supported procedural scenes. It needs no Replicate key or paid neural-video generation. Advanced animation capabilities must be added and visually verified when needed; the current renderer does not imply an unrestricted animation engine. Keep the user's login in the official client. Embedded chat, a custom subscription-login proxy and simultaneous implementation of every provider are not prerequisites.

## Optional media track — P0/P1: one generated replacement shot

This media track connects one official video API and one model to the editor. Earlier implementation reports call it P0/P1; that label describes the video-provider milestone, not completion of the whole subscription/API-agent product.

Current working implementation: Replicate `wan-video/wan-2.2-i2v-fast`, persisted jobs, candidate preview/accept, UI and CLI. Offline HTTP, media and browser tests exercise this contract. **Live provider and full generated-film acceptance remain unverified.** See [the workflow](docs/GENERATION_RU.md) and [provider decision](docs/GENERATION_PROVIDER_DECISION.md); package version remains 0.1.0 until a separately authorized release. Keep the implemented adapter and recovery protections while advancing A1.

**P0 — establish the baseline and provider contract.** Verify the current checkout and tools, then document the chosen model's inputs, duration limits, authorization, costs, reference upload, output retention and job recovery. An API key in the environment does not itself authorize spending or uploading media.

**P1 — finish one complete workflow:**

- Select an existing video scene, provide a prompt/reference and see the data sent and estimated cost.
- Persist the job and remote ID; resume polling after restart without blindly resubmitting an uncertain paid request.
- Download and validate a candidate outside the accepted project. Previewing it must not change the project, history or accepted assets.
- Explicitly accept the previewed candidate in one project operation, keeping the scene duration and previous take. Recover safely if the process stops between acceptance and job acknowledgement.
- Export the film, restore the previous take and export again. Preserve other accepted scenes and all sources; recheck external-edit conflicts at acceptance time.
- Expose the same operations through the UI and CLI, with updated instructions for the user's external agent.

**Completion:** an authorized real provider run, job recovery, preview, acceptance, export and restoration, plus offline failure cases and a real UI conflict check. Without live-run authorization, finish the local implementation and report it as **offline contract verified; live provider unverified**. Mocks alone do not complete the milestone.

An unavailable or unauthorized video-provider live run blocks this optional track's live verification only. It does not block making a film through the user's agent and local renderer. Do not add more media providers merely to bypass that missing authorization.

## Current work — P2: first-user and agent workflow

The [getting-started guide](docs/GETTING_STARTED.md) covers source/runtime installation, dependency recovery, skill connection, opening an existing film, preview, acceptance, export and reopen. `doctor` reports missing dependencies together with recovery hints and checks required encoders. A [short independent-user trial](docs/USER_TRIAL_RU.md) is ready; no independent participant has completed it yet.

- Make setup, opening and reopening a project clear; provide consistent English/Russian UI.
- Improve the A1 brief-to-film workflow and onboarding based on observed use.
- Have an independent new user follow the README and make a remix with their own material. Record setup failures, assistance, generation attempts and time to a usable result.
- Verify another computer and system-dependency installation before widening platform claims. Review the film through continuous viewing and listening as well as frame tests.

**Completion:** an observed independent attempt to create, revise, export and restore a film. Fix demonstrated obstacles before broadening the feature set; this is not proof of demand or artistic quality in general.

## P3 — measured local rendering improvements

- Measure cold export, unchanged export, one-scene edits, music-only edits and preview on a fixed project and environment.
- Add scene caching with correct source, timing, rendering and encoder dependencies.
- Consider lighter previews, reduced temporary I/O and hardware encoding only where measurements justify them.

**Completion:** a measured improvement with output verification against the uncached path and documented resource costs. Local rendering optimization does not speed up a remote model or remove its generation charges.

## P4 — additional generation choices

- Add further agent clients or media providers and official subscription integrations when a demonstrated workflow needs them. Claude Code/Codex agent access belongs to A1, not this later expansion.
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
