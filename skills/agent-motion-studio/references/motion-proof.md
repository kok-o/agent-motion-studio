# Motion recipe: poses, hold and exact preview frames

Use for an ordinary v2 composition correction preserving a subject and its neighbours. Codex and Claude Code use the same AMS CLI; this recipe does not start either client. Existing films start with `state`. The setup below is **only a new technical example**, never a reset of an accepted film.

## Pose contract

Scene `motion-proof`: 16:9, 1920×1080, 30 fps, 5s = **150 frames, local indices0–149**. Image object `screen` keeps its ID, imported asset, fit and layer position. Panel, heading and marker stay unchanged; image centre stays (960,594).

| Frame | x / y | width / height | Meaning |
| --- | --- | --- | --- |
| 0 | 384 / 270 | 1152 / 648 | Initial pose |
| 24 | 384 / 270 | 1152 / 648 | Initial hold ends |
| 57 | 352 / 252 | 1216 / 684 | Middle pose, halfway through inOutCubic |
| 90 | 320 / 234 | 1280 / 720 | Movement ends |
| 149 | 320 / 234 | 1280 / 720 | Final hold, last valid frame |

Explicit x/y/width/height keys at24 and90; destination key90 has `inOutCubic`. Hold key24 prevents motion starting at0. Each property has an independent track; last value holds through149. **Frame150 does not exist.** No `scale`, `motionPath`, CSS, JS or new schema fields. See [composition](composition.md).

This example requires a static target without existing keys. In another scene, plan its actual coordinates/duration/property tracks first. Never erase opacity/rotation/reveal keys or assume independent easing at the same keyframe. Copy the **complete current objects array**, change only the selected ID and preserve neighbours/unrelated fields. Adapt an incompatible animation and preview again, rather than pasting this fixture over it.

## New example in an isolated workspace

Prerequisites: built/installed AMS, Node≥22.12, supported Chrome/Chromium/Edge, FFmpeg/ffprobe on PATH (or `CHROME_PATH`, `FFMPEG_PATH`, `FFPROBE_PATH`). These commands use **PowerShell7**, portable relative paths, no downloads. Another shell can use the same files/arguments with its own quoting. [Setup action](../assets/motion-proof-setup.json) uses `IMAGE_ASSET_ID`, replaced with the returned import ID. Input is a new locally generated FFmpeg test pattern: **synthetic technical data, not a real product or pilot result**. A real correction may use the person's permitted screenshot with its actual source/credits; unrelated coffee-media credits do not license a screenshot.

From an empty consumer workspace with the runtime already installed:

```powershell
$runtime = (Resolve-Path 'node_modules/agent-motion-studio').Path
$skill = Join-Path $runtime 'skills/agent-motion-studio'
$work = Join-Path (Get-Location) 'motion-proof-case'
if (Test-Path -LiteralPath $work) { throw 'Choose a new case directory.' }
New-Item -ItemType Directory -Path $work | Out-Null
$film = Join-Path $work 'film/project.json'
function Invoke-Ams($name, [string[]]$cliArgs) {
  & node (Join-Path $runtime 'dist/cli.js') @cliArgs 1> "$work/$name.stdout.json" 2> "$work/$name.stderr.txt"
  $code = $LASTEXITCODE
  Set-Content "$work/$name.exit.txt" $code
  if ($code -ne 0) { throw "AMS failed: $name, exit $code; inspect logs before continuing." }
  Get-Content "$work/$name.stdout.json" -Raw | ConvertFrom-Json
}
function Film-Hashes {
  @(Get-ChildItem -LiteralPath (Split-Path $film) -Recurse -Force -File |
    Sort-Object FullName | ForEach-Object {
      '{0} {1}' -f $_.FullName, (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    })
}
$null = Invoke-Ams 'new' @('new', '--dir', "$work/film", '--aspect', '16:9', '--json')
$state = Invoke-Ams 'new-state' @('state', $film, '--json')
$ffmpeg = if ($env:FFMPEG_PATH) { $env:FFMPEG_PATH } else { 'ffmpeg' }
& $ffmpeg -v error -f lavfi -i 'testsrc2=size=1280x720:rate=30' -frames:v 1 -c:v png -threads 1 -n "$work/input.png" 1> "$work/input.stdout.txt" 2> "$work/input.stderr.txt"
$inputExit = $LASTEXITCODE
Set-Content "$work/input.exit.txt" $inputExit
if ($inputExit -ne 0) { throw 'Synthetic image creation failed.' }
$imported = Invoke-Ams 'import' @('import', $film, '--file', "$work/input.png", '--if-match', $state.etag, '--json')
$setup = (Get-Content "$skill/assets/motion-proof-setup.json" -Raw).Replace('IMAGE_ASSET_ID', $imported.importedId)
Set-Content "$work/setup.json" $setup -Encoding utf8NoBOM
$null = Invoke-Ams 'setup' @('edit', $film, '--action', "$work/setup.json", '--if-match', $imported.etag, '--json')
$before = Invoke-Ams 'before' @('state', $film, '--json')
$baselineRevision = $before.manifest.revision
$beforeFiles = Film-Hashes
```

Initial batch is only new-film assembly. No pilot project or accepted MP4/take is a fixture. For an existing film skip new/import/setup and use its actual state/scene/object.

## Prepare one action from fresh state

The example writes a separate action file, never accepted JSON. It refuses a mismatched target rather than replacing an existing animation.

```powershell
@'
import {readFileSync, writeFileSync} from 'node:fs';
const [statePath, actionPath] = process.argv.slice(2);
const {manifest} = JSON.parse(readFileSync(statePath, 'utf8'));
const scene = manifest.scenes.find(s => s.id === 'motion-proof');
const objects = structuredClone(scene?.objects);
const target = objects?.find(o => o.id === 'screen');
if (scene?.type !== 'composition' || scene.durationFrames !== 150 || target?.type !== 'image' ||
    target.keyframes?.length || target.x !== 384 || target.y !== 270 || target.width !== 1152 || target.height !== 648)
  throw new Error('This example needs the static initial pose; adapt existing motion explicitly.');
target.keyframes = [
  {frame:24, x:384, y:270, width:1152, height:648},
  {frame:90, x:320, y:234, width:1280, height:720, easing:'inOutCubic'}
];
writeFileSync(actionPath, JSON.stringify({type:'edit-scene', sceneId:scene.id, patch:{objects}}, null, 2)+'\n', {flag:'wx'});
'@ | node --input-type=module - "$work/before.stdout.json" "$work/motion.json"
if ($LASTEXITCODE -ne 0) { throw 'Action preparation failed.' }
$actionHash = (Get-FileHash "$work/motion.json" -Algorithm SHA256).Hash
$preview = Invoke-Ams 'preview' @('preview', $film, '--action', "$work/motion.json", '--if-match', $before.etag, '--out', "$work/preview-1", '--json')
if ($preview.stale -ne $false -or $preview.projectHash -ne $before.etag -or $preview.totalFrames -ne 150) { throw 'Refresh context and preview again in a new directory.' }
if (Compare-Object $beforeFiles (Film-Hashes)) { throw 'Accepted project/assets/history changed; reconcile before any edit.' }
```

Preview is **silent**, shares export scene encoding and saves no draft/accepted state. It currently rejects a project with scene narration/captions; do not strip those fields to pass. Report the limitation or choose a supported case. Internal scene PNGs are removed by encoding; extract proofs from the returned MP4.

## Exact decoded proofs

```powershell
& node "$skill/scripts/extract-motion-proof.mjs" $preview.output --out "$work/proof-1" --frames '0,24,57,90,149' --total-frames 150 1> "$work/proof.stdout.json" 2> "$work/proof.stderr.txt"
$proofExit = $LASTEXITCODE
Set-Content "$work/proof.exit.txt" $proofExit
if ($proofExit -ne 0) { throw 'Proof extraction failed; inspect logs and any proof.json.' }
$proof = Get-Content "$work/proof.stdout.json" -Raw | ConvertFrom-Json
if ($proof.complete -ne $true) { throw 'Incomplete proof set.' }
```

The read-only [helper](../scripts/extract-motion-proof.mjs) checks actual decoded count/fps, sorted unique in-range integer indices and exclusive new output. It uses FFmpeg `select=eq(n\,0)+eq(n\,24)+eq(n\,57)+eq(n\,90)+eq(n\,149)`, `-fps_mode vfr`, PNG and `-n`. **`n` is local decode index from the start of the preview: no approximate `-ss`, scene offset or input renumbering.** Mapping in `proof.json`: `proof-000.png`→0, `001`→24, `002`→57, `003`→90, `004`→149. Actual FFprobe/FFmpeg argv/exits/stdout/stderr are recorded. Short/mismatched video, invalid/duplicate indices, existing output, encoder failure or missing PNG makes it fail. Keep partial output as failed evidence; do not reuse it or report PASS.

Inspect all five PNGs at delivery size and the continuous preview MP4: identity/centred zoom, initial hold, middle, destination/final hold, unchanged neighbours. PNGs come from lossy H.264, so held-pose PNG hashes can differ; inspect geometry/content. Independent property tracks define the exact poses. Sampled proofs do **not** establish every intermediate frame, smoothness, sound, artistic quality or human acceptance. Report continuous viewing/listening/ratings separately; this silent preview is not a music-mix test.

## Accept the same action, restore, reopen

Accept after the authorized inspection. Ordinary action+ETag is not a generated-take receipt. Keep action bytes unchanged. Stale/conflict requires fresh state and a new preview of the resulting action.

```powershell
if ((Get-FileHash "$work/motion.json" -Algorithm SHA256).Hash -ne $actionHash) { throw 'Action changed; preview its current bytes again.' }
$accepted = Invoke-Ams 'accept' @('edit', $film, '--action', "$work/motion.json", '--if-match', $preview.projectHash, '--json')
# Compare accepted scene/asset IDs, neighbours and unrelated fields with before/action.
# Example recovery exercise only: restore when requested, through native history.
$current = Invoke-Ams 'before-restore' @('state', $film, '--json')
@{type='restore'; revisionId=$baselineRevision} | ConvertTo-Json | Set-Content "$work/restore.json" -Encoding utf8NoBOM
$null = Invoke-Ams 'restore' @('edit', $film, '--action', "$work/restore.json", '--if-match', $current.etag, '--json')
$reopened = Invoke-Ams 'reopen' @('state', $film, '--json')
# Compare baseline scenes/assets; history retains the edit and native restore.
# Restore creates a new revision, not byte-identical project.json.
```

For a real correction keep the accepted edit; restore only on request. Preserve complete film/assets/hidden `.history`/earlier exports. `state` returns `manifest.history` with revision `id`; there is no standalone history CLI. These commands perform a local CLI reopen, not a model/client session.

Save **whole tool results**, stdout/stderr, terminal exit and live session/task handle for long commands. Poll the same running process to completion. Ending a tool wait or empty stdout is not PASS. Never duplicate an unresolved preview/edit. After uncertain ordinary edit/import, read fresh state/history/sources and reconcile whether it committed before the next operation; no blind retry. Keep browser sandbox and client/config/trust guards.

## Reuse record

Pose/proof/hold idea inspired by [HyperFrames keyframe guidance, pin f46033d048983e914e98d9ed834b51b0c448bb16, lines14–58](https://github.com/heygen-com/hyperframes/blob/f46033d048983e914e98d9ed834b51b0c448bb16/skills/hyperframes-keyframes/SKILL.md#L14-L58) and [proof times, lines211–263](https://github.com/heygen-com/hyperframes/blob/f46033d048983e914e98d9ed834b51b0c448bb16/skills/hyperframes-keyframes/SKILL.md#L211-L263), [Apache-2.0 upstream license](https://github.com/heygen-com/hyperframes/blob/f46033d048983e914e98d9ed834b51b0c448bb16/LICENSE). Recipe/helper/example independently written for AMS: integer-frame data, supported geometry, whole-array preservation, ETag preview/edit, MP4 decode, native restore. No upstream code/text block, GSAP, binary assets or external skill copied. AMS license/notices remain at runtime-relative `LICENSE` and `THIRD_PARTY_NOTICES.md`; copied skills need no link outside their own tree for this recipe. The example PNG is generated locally from testsrc2, with the actual command saved, not imported third-party artwork.
