# First video provider: Replicate Wan 2.2 I2V Fast

Checked: **6 October 2026**. Scope: one generated replacement of an existing video scene. The adapter is implemented; **real provider verification is NOT RUN**. No generation, reference transfer or publication was authorized during this implementation.

## Decision and alternatives

Choose the official Replicate API with model **`wan-video/wan-2.2-i2v-fast`**, image-to-video, **121 frames at 16 fps**, **480p**, interpolation disabled and safety enabled. The requested source length is 7.5625 seconds, covering the coffee example's seven-second scene without changing its timeline. Actual downloaded duration is checked before preview/accept. This model is the least expensive documented option considered, with a small inline reference and a resumable prediction ID.

| Official option | Relevant findings | Decision |
| --- | --- | --- |
| [Replicate Wan 2.2 I2V Fast](https://replicate.com/wan-video/wan-2.2-i2v-fast/api/schema) | Captured schema permits 81–121 frames and 5–30 fps. [Current pricing](https://replicate.com/wan-video/wan-2.2-i2v-fast#pricing) lists base 480p at $0.05/output and base 720p at $0.11/output. | One production adapter. |
| [fal Wan 2.2 5B I2V](https://fal.ai/models/fal-ai/wan/v2.2-5b/image-to-video/api) | The model advertises up to five seconds, while its schema permits 17–161 frames and configurable fps. At the default 24 fps, 161 frames cover 6.708 seconds. Its [model page](https://fal.ai/models/fal-ai/wan/v2.2-5b/image-to-video) exposes $0.15/video pricing. | More expensive, and seven-second coverage needs clarification beyond the advertised mode. No adapter added. |
| [Gemini Veo 3.1 Lite](https://ai.google.dev/gemini-api/docs/veo) | Eight-second 720p I2V and resumable operations; audio is always generated. [Pricing](https://ai.google.dev/gemini-api/docs/pricing#veo-3.1) is $0.05/second, so eight seconds cost $0.40 before taxes. | Covers the scene, but costs more and produces audio this editor does not use. No adapter added. |

fal's [API Services agreement](https://fal.ai/legal/api-services) expressly describes API integration into client products; its [general terms](https://fal.ai/legal/terms-of-service) contain additional restrictions on competing products and application integrations. Which agreement applies to a particular BYOK account requires clarification before selecting fal for a live run. This comparison does not declare fal unusable.

Replicate's [API access](https://replicate.com/docs/reference/http) and [terms](https://replicate.com/terms) support using an account's own credentials to run models. The chosen local client uses each user's own account, exposes no shared hosted service and resells no access. This is an implementation choice, not a provider endorsement or a legal guarantee. Input rights, model terms and account eligibility remain the user's responsibility; output ownership is subject to third-party rights and model terms.

## Captured contract

The exact public input schema, output schema and pricing tiers are saved in [the checked snapshot](providers/replicate-wan-2.2-i2v-fast.snapshot.json). They were extracted from the official pages' JSON, without an account, token or provider call.

- Endpoint: `POST https://api.replicate.com/v1/models/wan-video/wan-2.2-i2v-fast/predictions`.
- This is an official **versionless** endpoint. The schema page exposed internal revision `4d9f302ce75125a365469e2fe1b65e50d70de4e0e1e3d438d695db5e8bb32e27`, created 17 September 2026. Recording it establishes the inspected schema; it does not pin future official-model inference to that private internal revision.
- Input schema SHA-256: `53c2159744aebb0dffcf600e8778ebb8e6b0ba1436bf49b782cb9b4a67b9177e`.
- Pricing tiers SHA-256: `ea2b07ea971e1f96c5deb91ab476a57c7dc21c3c71e7e4a9f1acab2d28992851`.

Hashes cover UTF-8 `JSON.stringify(snapshot.inputSchema)` and `JSON.stringify(snapshot.billingConfig)`, preserving the snapshot's property order.

The P1 profile submits only `prompt`, `image`, `num_frames: 121`, `frames_per_second: 16`, `resolution`, `go_fast: true`, `interpolate_output: false`, and `disable_safety_checker: false`. It does not expose arbitrary LoRA URLs, last-frame images or other schema features. Provider aspect is inferred from the image; there is no invented aspect-ratio field. The local scene's cover/contain and focal controls remain explicit in the candidate draft. The provider output is a single media locator; MP4 bytes and measured source duration/geometry/fps are validated locally by the generation service.

## Credentials, references and network

Set **`REPLICATE_API_TOKEN` in the Node server/CLI environment**, outside the project. No key value belongs in request JSON, browser code, job state or reports. A configured token grants no spending or reference-transfer permission.

The reference is one approved local PNG/JPEG, at most **256 KiB**, sent as a base64 data URI inside the single generation POST. This follows the conservative small-file recommendation in the [HTTP API](https://replicate.com/docs/reference/http); the [input-file guide](https://replicate.com/docs/topics/predictions/input-files) also documents data URIs. Prepare reads and checks the local reference, and transfers nothing. There is no public storage, tunnel, secondary upload or entire-project transfer. A larger image requires an explicit local resized copy/import; it is not silently converted or uploaded elsewhere.

The production transport uses fixed API endpoints and permits result URLs only on HTTPS `replicate.delivery` or its subdomains, port 443, without URL credentials or redirects. It resolves DNS with a ten-second bound, rejects non-public IPv4/IPv6 addresses and pins a validated address to the TLS connection. Provider authorization is sent only to these documented provider origins. The official [HTTP API](https://replicate.com/docs/reference/http) documents authenticated output downloads. Result locators and response bodies are never returned by the adapter's public status.

JSON reads are capped at 1 MiB. Downloads are streamed to a new staging file, capped by actual bytes at 128 MiB, with a 120-second deadline. A failed download removes only that newly created incomplete staging file. Existing destinations are never overwritten. Media validation is a subsequent local stage; a successful HTTP download is not evidence of a valid clip.

## Recovery, retention and cost limits

Persist the returned prediction ID before any polling/download. [Prediction status](https://replicate.com/docs/topics/predictions/lifecycle) is observed with `GET /v1/predictions/{id}`; `starting`/`processing`/`succeeded`/`failed`/`canceled`/`aborted` normalize into queued/running/output-ready/failed/cancelled. A known ID survives instance/server restart. Missing media in a succeeded response is diagnosed during download, preserving that ID.

No documented request-key reconciliation was found. The adapter sends one POST and never retries it. Loss of its response becomes `submission_unknown`; inspect the same Replicate account before any new authorized generation. Poll/download operations do not submit. A download retry fetches a fresh locator for the same prediction. No automatic model fallback exists. This does not promise exactly-once execution inside Replicate.

After checking the provider account, the user can explicitly record that the first submission may already have been charged with the local `resolve-unknown` operation. It preserves the original unknown status, request, approval, one attempted submission and error, and makes no provider call. Stop/restart do not replace this acknowledgement. A later generation uses a new prepared intent and separate request/reference/budget approval; the old POST is never repeated. See [recovery commands](GENERATION_RU.md).

The model's public metadata indicates cancellation unsupported, so P1 advertises **remote cancel: false** despite the platform having a generic cancellation endpoint. Stopping local tracking does not cancel inference or guarantee a refund. The adapter adds no provider retries/fallback options; undocumented internal provider behavior is not claimed.

API inputs, output values/files and logs are normally [removed after one hour](https://replicate.com/docs/topics/predictions/data-retention). Download promptly. A fresh status query can refresh an expired locator while output remains; it cannot recover deleted output. Local candidates and accepted sources do not depend on provider retention. Job state/prompt/reference metadata remains private local `.studio` state, outside the accepted manifest and public distribution.

The captured pricing tiers use **`video_output_count`** with base/interpolation and resolution criteria only. Thus the dated estimate for this 121-frame, 16-fps, noninterpolated request is **$0.05 at 480p** or **$0.11 at 720p**, before taxes/account-specific charges. An older description in the same input schema says pricing uses duration at 16 fps; the captured pricing table is more explicit about the current unit. Keep that discrepancy visible until live billing is verified. The schema/profile cannot bind future provider prices.

The application limits new submissions through the approved local intent; it cannot enforce a hard upper bound on a provider invoice. A timeout is not a spending stop, and failed/partial runs may be billed according to [Replicate's terms](https://replicate.com/terms). Before live submit, confirm the current account price and approve the exact request, reference and maximum submission count. Default checks never make a live request.

## First live request to approve

Proposed profile: `wan-video/wan-2.2-i2v-fast`, I2V, 121 frames/16 fps, 480p, no interpolation, safety enabled, **one maximum new submission**, estimated **$0.05 before taxes**. It replaces an existing seven-second video scene with candidate trim 0; the scene keeps seven seconds. The source may be lower-resolution/lower-fps than the local 1080p/30-fps export, and its audio is not added to the film.

The request needs a concrete imported reference ID/hash, permission to transfer that image, an agreed prompt, the credential source and an explicit expense ceiling acknowledging the dated estimate. Publication remains unauthorized. No key values should be pasted into the request or chat.

**NOT RUN:** live submit, actual provider duration/codec/geometry, real output/CDN authentication behavior, account/region eligibility, exact charge, visual suitability, and the full original → generated → restored live film. Controlled HTTP tests establish this application's contract only. After authorized live acceptance, the next milestone is an independent person following the README.
