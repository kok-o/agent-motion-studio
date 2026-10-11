# Audio

Core audio rendering is local. It uses Node and FFmpeg and does not require Python or an online service.

## Scene preview

Ordinary and generated-candidate previews use the same full patched timeline mix as export, then take the scene's exact 48 kHz sample interval (`startFrame * 1600` to `endFrame * 1600`) and reset its playback timestamp to zero. Video encoding, trim/crop and caption frame rounding are shared with export. Preview includes local music, existing file narration with supplied captions on motion scenes, and explicitly enabled source-video audio. It does not save a draft. The browser exposes unmuted controls and waits for Play. With no enabled audio source, preview has no audio track. Active Edge narration anywhere in the draft returns `ONLINE_PREVIEW_UNSUPPORTED/preview/2` before provider or cache access, even when another scene is selected. Full export retains its existing optional Edge workflow.

Music keeps its global loops, accents, gain and fades. File voice keeps its existing 150 ms lead/tail, millisecond delay, gain and music ducking. AAC introduces encoder framing: decoded preview samples are not claimed byte-identical to the pre-encoding PCM or a separately encoded full film. Captions remain manually supplied timing; preview adds no transcription or video-scene overlays.

## Source-video audio

Only v2 video scenes can opt in with `"sourceAudio": {"enabled": true, "gainDb": -12}`. Absence or `enabled:false` preserves visual-only behavior; optional gain defaults to 0 dB and accepts −60 through 0. An `edit-scene.patch.sourceAudio` replaces the whole object, so include `enabled`; `null` removes it. Unrelated Studio edits keep an absent field absent.

The first audio stream follows the actual first picture frame retained by native trim, against the container's timestamp origin. The engine preserves timestamp offsets, resamples to 48 kHz stereo, crops the selected interval, pads short/late audio with silence, applies gain and places it at the scene's integer sample offset in the shared mix. It does not loop or speed up source audio. Import keeps original bytes; audio-bearing video sources may exceed the separate 600-second file-voice limit, subject to the existing 3600-second/512 MiB video import limits and scene trim validation.

Source audio requires finite common timestamps/time bases, readable first-stream packets and decodable audio. Constant-rate picture timing is validated with a bounded frame/packet probe; variable or backward picture clocks, missing/backward audio timestamps, unavailable decoder delay or an oversized probe return `SOURCE_AUDIO_CLOCK_UNSUPPORTED/validate/2`. A video with no audio returns `SOURCE_AUDIO_MISSING/validate/2`; corrupt audio returns `SOURCE_AUDIO_DECODE_FAILED/validate/2`. These errors do not silently mute an enabled scene. Explicitly turn source audio Off and rebuild preview to use visual-only rendering. Current technical fixtures cover offsets, fractional trims, leading/late/short silence, first-stream selection and long sources; internal packet-gap playback is not independently demonstrated by those fixtures.

Replacement and generated acceptance preserve the current source-audio setting and use existing ETag/preview/receipt contracts. Restore returns the setting with the scene. A replacement without usable audio fails while On; explicitly switching Off requires a new preview. No new auto-retry or replay behavior is introduced.

Set `audio.music.provider` to `none`, `procedural`, or `file`. A file requires `audio.music.asset`, referring to a local `type: "audio"` asset. File music loops to cover the video; procedural music is generated from the manifest seed and duration. `gainDb` is between -60 and 0. Studio/file music defaults to -22 dB. Kinetic procedural music uses an original 120 BPM groove (fifteen frames per beat), plus tonal accents at scene start frames. It is normalized toward -16 LUFS/-1.5 dBTP before user gain; its default gain is -3 dB. The report records the arrangement, timing grid, gain, and normalization target. Final loudness must be measured separately; the target is not a claim that the final AAC has exactly that loudness. The mix has short fades and lowers music under each spoken interval.

For existing speech, set `audio.narration.provider` to `file` and add `narration: { "asset": "voice" }` to each voiced scene. Speech starts 150 ms after the scene begins. The scene must accommodate measured speech duration plus 150 ms lead-in and 150 ms tail. Longer speech is an input error. The engine does not cut words, speed up speech, or silently extend the timeline. Short speech is padded with silence.

Each voiced scene can contain `captions: [{ "startMs": 0, "endMs": 1400, "text": "Your caption" }]`. Times are relative to the original voice file; the engine adds the scene offset and lead-in. Cues must be ordered and non-overlapping and must fit the actual speech and scene. Frame rounding preserves cue order. Providing captions is not automatic transcription or word alignment.

The feature-explainer fixture uses original Russian text synthesized locally with the installed Windows SAPI voice. It is normalized with FFmpeg toward -16 LUFS / -2 dBTP before distribution; the example applies -3 dB speech gain and ducks its kinetic music. The original unnormalized fixture made the earlier demo too quiet by measurement. Runtime file speech retains the user's supplied level; it is not automatically normalized. Sentence cues are manually supplied approximate intervals, not measured word boundaries. `scripts/create-demo-voice.ps1` regenerates and normalizes this development fixture; PowerShell and SAPI are not production dependencies. No voice engine is distributed.

## Optional Edge speech

Edge speech is explicitly enabled with `audio.narration.provider: "edge"`. Each voiced scene contains `narration: { "text": "Speak this text" }`. Common options are `voice`, `rate` (for example `"+0%"`), and `pitch` (for example `"+0Hz"`). The default voice is `ru-RU-SvetlanaNeural`. Text is sent to Microsoft's online speech service by the optional Python [edge-tts package](https://github.com/rany2/edge-tts). See its [CLI source](https://github.com/rany2/edge-tts/blob/master/src/edge_tts/util.py) for media and subtitle options.

Install the addon separately in a virtual environment, then point `PYTHON_PATH` to that environment's Python executable. The tested addon version is 7.2.8; the exact dependency snapshot is [edge-requirements.txt](edge-requirements.txt).

```powershell
python -m venv .edge-addon
.edge-addon/Scripts/python.exe -m pip install -r <package-directory>/docs/edge-requirements.txt
$env:PYTHON_PATH = (Resolve-Path .edge-addon/Scripts/python.exe).Path
```

The renderer checks `python -m edge_tts --version` only when Edge is selected. It makes at most two requests, with a 35-second timeout per attempt. Provider failure returns exit 5; a missing addon returns exit 3. Offline and file rendering continue without it.

Successful Edge audio and subtitle timings are cached separately inside the user's project under `.cache/agent-motion-studio/audio`. The key includes text, voice, rate, pitch, addon version, and adapter version. Audio content is hashed and decoded before cache reuse. An image change does not request new speech. A speech or voice change requires fresh synthesis and timing validation. Edge sentence cues can overlap due to provider padding: the adapter ends a generated cue at the next cue's start and allows at most 100 ms of end padding beyond the measured audio. Raw provider metadata stays in the audio cache. This adjustment applies only to provider cues; supplied cues must already satisfy the strict timing contract. These are sentence captions, not word-level karaoke. Online service availability and voice quality require their own live checks; see [compatibility](COMPATIBILITY.md) for the release scope.
