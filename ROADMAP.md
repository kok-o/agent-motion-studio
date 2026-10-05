# Roadmap

The aim is a local studio where people and their agents can make and revise short films while keeping accepted takes and a portable editable project. These are priorities, not release-date promises.

## 0.1 — experimental developer preview

Implemented: local video/image/music import, storyboard, trim/crop, draft scene preview, explicit external-edit conflicts, take restoration and verified MP4 export. Includes a redistributable 20-second example. Cloud generation and built-in chat are not included.

## Next: one generated replacement shot

One official video API, one model, one working flow:

- Select a scene, provide a prompt/reference and see the data sent and estimated cost.
- Persist the job and remote ID; resume polling after restart without blindly resubmitting an uncertain paid request.
- Download and validate the result as a new immutable asset. Preview it, explicitly accept it into the scene, export, then restore the previous take.
- Preserve other accepted scenes and all sources. Recheck conflicts at acceptance time.

Completion needs a real provider run with an authorized key/budget, plus offline failure cases. Mocks alone do not satisfy it. Provider charges and model terms are separate from the open-source editor. No subscription-token extraction is planned.

## First-user improvements

- English UI with a clear first-run flow; retain Russian where maintainable.
- Have new users make their own remix and record actual setup failures.
- Verify another computer and system-dependency installation before widening platform claims.
- Improve the example based on continuous viewing and listening, beyond frame tests.

## Later, if these flows are useful

Additional provider adapters, local generation integration, measured scene caching and better sound/editing. Keep the project format portable. A multitrack NLE, model training, user accounts and a hosted billing service are outside the near-term scope.
