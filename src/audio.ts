import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StudioError } from './errors.js';
import { assertSupportedText } from './spec.js';
import { runProcess } from './runtime.js';
import type { AudioResult, Caption, ResolvedScene, ResolvedSpec, ToolPaths } from './types.js';

const SAMPLE_RATE = 48000;
const LEAD_IN = 0.15;
const TAIL = 0.15;
const AUDIO_VERSION = '1';
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** Original restrained chord bed, computed from seed and sample index. */
export function proceduralWav(duration: number, seed: number): Buffer {
  const samples = Math.round(duration * SAMPLE_RATE);
  const wav = Buffer.alloc(44 + samples * 4);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22); wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 4, 40);
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  for (let i = 0; i < samples; i++) {
    const t = i / SAMPLE_RATE;
    const chordIndex = Math.floor(t / 2);
    const chord = chords[(chordIndex + seed % chords.length) % chords.length];
    const local = t % 2;
    const envelope = Math.min(1, local / 0.06) * Math.min(1, (2 - local) / 0.18);
    const fade = Math.min(1, t / 0.35, (duration - t) / 0.5);
    let value = 0;
    for (let note = 0; note < chord.length; note++) {
      const frequency = 440 * 2 ** ((chord[note] - 69) / 12);
      value += Math.sin(2 * Math.PI * frequency * t + (seed % 97) * 0.013 * note) * 0.15;
      value += Math.sin(2 * Math.PI * frequency * 2 * t) * 0.025;
    }
    const beat = t % 0.5;
    value += Math.sin(2 * Math.PI * 74 * beat) * Math.exp(-beat * 34) * 0.09;
    const pcm = Math.round(Math.max(-1, Math.min(1, value * envelope * Math.max(0, fade))) * 32767);
    wav.writeInt16LE(pcm, 44 + i * 4); wav.writeInt16LE(pcm, 46 + i * 4);
  }
  return wav;
}

/** Original sample-index groove; scene accents use the same integer frame timeline as the picture. */
export function kineticGrooveWav(duration: number, seed: number, sceneStartFrames: readonly number[] = []): Buffer {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60 || !Number.isInteger(seed)) {
    throw new StudioError('INVALID_GROOVE_INPUT', 'audio', 'Groove needs a finite duration of 0–60 seconds and an integer seed.', 2);
  }
  if (sceneStartFrames.some(frame => !Number.isInteger(frame) || frame < 0 || frame / 30 >= duration)) {
    throw new StudioError('INVALID_GROOVE_TIMING', 'audio', 'Groove scene accents must use frame indices inside the video.', 2);
  }
  const samples = Math.round(duration * SAMPLE_RATE);
  const wav = Buffer.alloc(44 + samples * 4);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22); wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 4, 40);

  const tau = 2 * Math.PI, beatSamples = SAMPLE_RATE / 2, eighthSamples = beatSamples / 2;
  const chords = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]];
  const pitch = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
  const rotation = ((seed % 4) + 4) % 4;
  const envelope = (local: number, length: number, attack: number, decay: number, release: number) => local < 0 || local >= length
    ? 0 : Math.min(1, local / attack) * Math.exp(-local * decay) * Math.min(1, (length - local) / release);
  const noise = (index: number) => {
    let value = Math.imul(index ^ seed, 0x45d9f3b);
    value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
    return ((value ^ value >>> 16) >>> 0) / 2147483648 - 1;
  };
  const accents = [...new Set(sceneStartFrames)].map(frame => ({
    sample: frame * SAMPLE_RATE / 30,
    frequencies: chords[(Math.floor(frame / 60) + rotation) % 4].map(note => pitch(note + 12)),
  }));
  for (let index = 0; index < samples; index++) {
    const beat = Math.floor(index / beatSamples), eighth = Math.floor(index / eighthSamples);
    const beatLocal = (index % beatSamples) / SAMPLE_RATE;
    const eighthLocal = (index % eighthSamples) / SAMPLE_RATE;
    const chord = chords[(Math.floor(beat / 4) + rotation) % chords.length];
    const kickEnvelope = envelope(beatLocal, 0.26, 0.002, 18, 0.025);
    // Integral of a decaying pitch sweep, so the kick starts continuously at zero phase.
    const kickPhase = tau * (48 * beatLocal + 94 * 0.022 * (1 - Math.exp(-beatLocal / 0.022)));
    const kick = Math.sin(kickPhase) * kickEnvelope * 0.36;
    const sub = Math.sin(tau * pitch(chord[0] - 24) * beatLocal) * envelope(beatLocal, 0.42, 0.008, 7, 0.035) * 0.16;
    const note = chord[(eighth + rotation) % chord.length] + 12;
    const frequency = pitch(note);
    const pluckEnvelope = envelope(eighthLocal, 0.24, 0.004, 16, 0.025);
    const pluck = (Math.sin(tau * frequency * eighthLocal) * 0.18
      + Math.sin(tau * frequency * 2 * eighthLocal) * 0.037
      + Math.sin(tau * frequency * 3 * eighthLocal) * 0.018) * pluckEnvelope;
    const hat = (noise(index) - noise(index - 1)) * 0.5
      * envelope(eighthLocal, 0.075, 0.0015, 62, 0.012) * (eighth % 2 ? 0.07 : 0.044);
    const pan = ((eighth + rotation) % 2 ? 0.22 : -0.22);
    let left = kick + sub + pluck * (1 - pan) + hat * 0.9;
    let right = kick + sub + pluck * (1 + pan) + hat;
    for (const accent of accents) {
      const local = (index - accent.sample) / SAMPLE_RATE;
      if (local < 0 || local >= 0.38) continue;
      const accentEnvelope = envelope(local, 0.38, 0.004, 11, 0.035);
      const signal = accent.frequencies.reduce((value, tone, number) => value + Math.sin(tau * tone * local) * (number ? 0.038 : 0.064), 0) * accentEnvelope;
      left += signal; right += signal;
    }
    const fade = Math.max(0, Math.min(1, index / (SAMPLE_RATE * 0.012), (samples - 1 - index) / (SAMPLE_RATE * 0.035)));
    const pcm = (signal: number) => Math.round(Math.tanh(signal * 1.2) * 0.86 * fade * 32767);
    wav.writeInt16LE(pcm(left), 44 + index * 4);
    wav.writeInt16LE(pcm(right), 46 + index * 4);
  }
  return wav;
}

export async function audioDuration(file: string, tools: ToolPaths): Promise<number> {
  let probe;
  try {
    probe = await runProcess(tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file], { timeoutMs: 20000 });
  } catch (error) {
    throw new StudioError('INVALID_AUDIO', 'audio', `Cannot read audio ${path.basename(file)}: ${error instanceof Error ? error.message : error}`, 2);
  }
  const info = JSON.parse(probe.stdout);
  const duration = Number(info.format?.duration);
  if (!info.streams?.some((stream: { codec_type: string }) => stream.codec_type === 'audio') || !Number.isFinite(duration) || duration <= 0 || duration > 600) {
    throw new StudioError('INVALID_AUDIO', 'audio', 'Audio must contain a readable stream and have a duration of 0–600 seconds.', 2);
  }
  try {
    await runProcess(tools.ffmpeg, ['-v', 'error', '-xerror', '-i', file, '-map', '0:a:0', '-f', 'null', '-'], { timeoutMs: 60000 });
  } catch (error) {
    throw new StudioError('AUDIO_DECODE_FAILED', 'audio', `Audio failed full decode: ${error instanceof Error ? error.message : error}`, 2);
  }
  return duration;
}

export function resolveCaptions(scene: ResolvedScene, captions: Caption[], voiceDuration: number) {
  let previousEnd = 0;
  let previousEndFrame = scene.startFrame;
  return captions.map((caption, index) => {
    if (caption.startMs < previousEnd || caption.endMs <= caption.startMs || caption.endMs > voiceDuration * 1000 + 1) {
      throw new StudioError('CAPTION_TIMING', 'audio', `Caption ${index} of ${scene.id} overlaps or extends beyond its voiceover.`, 2, `scenes.${scene.id}.captions[${index}]`);
    }
    previousEnd = caption.endMs;
    const startFrame = Math.max(previousEndFrame, scene.startFrame + Math.floor((LEAD_IN + caption.startMs / 1000) * 30));
    const endFrame = scene.startFrame + Math.ceil((LEAD_IN + caption.endMs / 1000) * 30);
    if (startFrame >= endFrame || endFrame > scene.endFrame) {
      throw new StudioError('CAPTION_TIMING', 'audio', `Caption ${index} does not fit inside scene ${scene.id}.`, 2);
    }
    previousEndFrame = endFrame;
    return { startFrame, endFrame, text: caption.text };
  });
}

export function parseSrt(srt: string): Caption[] {
  const millis = (time: string) => {
    const m = /^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/.exec(time);
    if (!m || Number(m[2]) > 59 || Number(m[3]) > 59) throw new StudioError('TTS_CAPTIONS', 'tts', 'Provider returned invalid subtitle timestamps.', 5);
    return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
  };
  return srt.trim().split(/\r?\n\s*\r?\n/).filter(Boolean).map(block => {
    const rows = block.trim().split(/\r?\n/);
    const timing = rows.findIndex(line => line.includes('-->'));
    const match = /^(\S+)\s+-->\s+(\S+)\s*$/.exec(rows[timing] ?? '');
    if (!match || !rows[timing + 1]) throw new StudioError('TTS_CAPTIONS', 'tts', 'Provider returned an invalid subtitle block.', 5);
    return { startMs: millis(match[1]), endMs: millis(match[2]), text: rows.slice(timing + 1).join(' ').replace(/<[^>]*>/g, '') };
  });
}

/** Edge sentence boundaries can overlap by a small provider padding interval. */
export function normalizeEdgeCaptions(captions: Caption[], duration: number): Caption[] {
  return captions.map((caption, index) => {
    const next = captions[index + 1];
    if (caption.startMs < 0 || caption.endMs <= caption.startMs || caption.endMs > duration * 1000 + 100 || (next && next.startMs <= caption.startMs)) {
      throw new StudioError('TTS_CAPTIONS', 'tts', 'Edge subtitle timestamps do not match the produced audio.', 5);
    }
    const endMs = Math.min(caption.endMs, Math.floor(duration * 1000), next?.startMs ?? Infinity);
    if (endMs <= caption.startMs) throw new StudioError('TTS_CAPTIONS', 'tts', 'Edge subtitle cue has no valid display interval.', 5);
    return { ...caption, endMs };
  });
}

async function edgeVoice(spec: ResolvedSpec, scene: ResolvedScene, tools: ToolPaths) {
  const python = process.env.PYTHON_PATH || 'python';
  let providerVersion: string;
  try {
    providerVersion = (await runProcess(python, ['-m', 'edge_tts', '--version'], { timeoutMs: 10000 })).stdout.trim();
  } catch {
    throw new StudioError('EDGE_NOT_INSTALLED', 'tts', 'Edge speech needs optional Python/edge-tts. Set PYTHON_PATH to its interpreter; see docs/AUDIO.md.', 3);
  }
  const narration = spec.audio.narration;
  const text = scene.narration!.text!;
  const voice = narration.voice || 'ru-RU-SvetlanaNeural';
  const rate = narration.rate || '+0%';
  const pitch = narration.pitch || '+0Hz';
  const fingerprint = sha(JSON.stringify({ text, voice, rate, pitch, providerVersion, version: AUDIO_VERSION }));
  const root = path.join(spec.projectDir, '.cache', 'agent-motion-studio', 'audio');
  await mkdir(root, { recursive: true });
  const rootReal = await realpath(root);
  const relative = path.relative(await realpath(spec.projectDir), rootReal);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new StudioError('CACHE_PATH', 'tts', 'Audio cache must stay inside the project directory.', 2);
  const finalFile = path.join(root, `${fingerprint}.mp3`);
  const metadataPath = path.join(root, `${fingerprint}.json`);
  try {
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    if (metadata.fingerprint === fingerprint && metadata.hash === sha(await readFile(finalFile)) && Array.isArray(metadata.captions)) {
      const duration = await audioDuration(finalFile, tools);
      return { file: finalFile, captions: metadata.captions as Caption[], duration, fingerprint, cache: 'hit', providerVersion };
    }
  } catch { /* A partial or damaged cache is a miss. */ }
  const temporary = path.join(root, `${fingerprint}.${randomUUID()}`);
  try {
    await writeFile(`${temporary}.txt`, text, 'utf8');
    let providerError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await runProcess(python, ['-m', 'edge_tts', '--file', `${temporary}.txt`, '--voice', voice, `--rate=${rate}`, `--pitch=${pitch}`, '--write-media', `${temporary}.mp3`, '--write-subtitles', `${temporary}.srt`], { timeoutMs: 35000 });
        providerError = undefined; break;
      } catch (error) { providerError = error; }
    }
    if (providerError) throw new StudioError('EDGE_FAILED', 'tts', `Edge speech failed after two bounded attempts: ${providerError instanceof Error ? providerError.message : providerError}`, 5);
    const duration = await audioDuration(`${temporary}.mp3`, tools);
    const captions = parseSrt(await readFile(`${temporary}.srt`, 'utf8'));
    if (!captions.length) throw new StudioError('TTS_CAPTIONS', 'tts', 'Edge speech returned no subtitle timing.', 5);
    const hash = sha(await readFile(`${temporary}.mp3`));
    await writeFile(`${temporary}.json`, JSON.stringify({ fingerprint, hash, captions, providerVersion }));
    await rename(`${temporary}.mp3`, finalFile);
    await rename(`${temporary}.json`, metadataPath);
    return { file: finalFile, captions, duration, fingerprint, cache: 'miss', providerVersion };
  } finally {
    await Promise.all(['txt', 'mp3', 'srt', 'json'].map(extension => rm(`${temporary}.${extension}`, { force: true })));
  }
}

export async function prepareAudio(spec: ResolvedSpec, jobDir: string, tools: ToolPaths): Promise<AudioResult> {
  const duration = spec.totalFrames / 30;
  const inputs: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];
  const voices: { scene: string; start: number; end: number; duration: number; hash: string; provider: string; cache?: string }[] = [];
  const addInput = (file: string, loop = false) => {
    const index = inputs.filter(value => value === '-i').length;
    if (loop) inputs.push('-stream_loop', '-1');
    inputs.push('-i', file); return index;
  };
  for (const scene of spec.scenes) {
    if (!scene.narration) continue;
    let file: string;
    let voiceDuration: number;
    let hash: string;
    let captions = scene.captions || [];
    let cache: string | undefined;
    if (spec.audio.narration.provider === 'edge') {
      const edge = await edgeVoice(spec, scene, tools);
      file = edge.file; voiceDuration = edge.duration; hash = edge.fingerprint; cache = edge.cache;
      if (!captions.length) captions = normalizeEdgeCaptions(edge.captions, voiceDuration);
    } else {
      const asset = spec.assets[scene.narration.asset!];
      file = asset.absolutePath; hash = asset.hash; voiceDuration = await audioDuration(file, tools);
    }
    if (voiceDuration + LEAD_IN + TAIL > scene.durationFrames / 30 + 0.0001) {
      throw new StudioError('VOICE_TOO_LONG', 'audio', `Voiceover for scene ${scene.id} needs ${(voiceDuration + LEAD_IN + TAIL).toFixed(3)} seconds including lead-in/tail; scene has ${(scene.durationFrames / 30).toFixed(3)}. Shorten speech or increase durationFrames.`, 2, `scenes.${scene.id}.durationFrames`);
    }
    for (const [index, caption] of captions.entries()) assertSupportedText(caption.text, `scenes.${scene.id}.captions[${index}].text`);
    scene.resolvedCaptions = resolveCaptions(scene, captions, voiceDuration);
    const start = scene.startFrame / 30 + LEAD_IN;
    const end = start + voiceDuration;
    voices.push({ scene: scene.id, start, end, duration: voiceDuration, hash, provider: spec.audio.narration.provider, ...(cache ? { cache } : {}) });
    const index = addInput(file);
    const label = `voice${index}`;
    filters.push(`[${index}:a:0]aresample=${SAMPLE_RATE},aformat=channel_layouts=stereo,volume=${spec.audio.narration.gainDb ?? -3}dB,adelay=${Math.round(start * 1000)}:all=1,apad,atrim=duration=${duration}[${label}]`);
    labels.push(`[${label}]`);
  }
  const music = spec.audio.music;
  const kineticMusic = music.provider === 'procedural' && spec.video.style === 'kinetic';
  const musicGainDb = music.provider === 'none' ? undefined : music.gainDb ?? (kineticMusic ? -3 : -22);
  const musicLoudnessTarget = kineticMusic ? { integratedLufs: -16, truePeakDbTp: -1.5, loudnessRangeLu: 9, beforeUserGain: true } : undefined;
  let musicHash: string | undefined;
  if (music.provider !== 'none') {
    let file: string;
    if (music.provider === 'procedural') {
      file = path.join(jobDir, 'music.wav');
      const wav = spec.video.style === 'kinetic'
        ? kineticGrooveWav(duration, spec.seed, spec.scenes.map(scene => scene.startFrame))
        : proceduralWav(duration, spec.seed);
      await writeFile(file, wav); musicHash = sha(wav);
    } else {
      const asset = spec.assets[music.asset!];
      file = asset.absolutePath; musicHash = asset.hash; await audioDuration(file, tools);
    }
    const index = addInput(file, music.provider === 'file');
    const duck = voices.length ? `if(gt(${voices.map(voice => `between(t,${Math.max(0, voice.start - 0.08)},${Math.min(duration, voice.end + 0.12)})`).join('+')},0),0.25,1)` : '1';
    const fade = Math.min(0.45, duration / 3);
    const loudnessFilter = kineticMusic ? ',loudnorm=I=-16:TP=-1.5:LRA=9' : '';
    filters.push(`[${index}:a:0]aresample=${SAMPLE_RATE},aformat=channel_layouts=stereo,apad,atrim=duration=${duration}${loudnessFilter},volume=${musicGainDb}dB,volume='${duck}':eval=frame,afade=t=in:d=${fade},afade=t=out:st=${duration - fade}:d=${fade}[music]`);
    labels.push('[music]');
  }
  const proceduralStyle = music.provider === 'procedural' ? spec.video.style ?? 'studio' : undefined;
  const beatGrid = proceduralStyle === 'kinetic'
    ? { bpm: 120, framesPerBeat: 15, sceneAccentFrames: spec.scenes.map(scene => scene.startFrame), arrangementVersion: 'kinetic-2' }
    : undefined;
  const report = { version: AUDIO_VERSION, narration: spec.audio.narration.provider, music: music.provider, duration, voices, musicHash, musicGainDb, musicLoudnessTarget, proceduralStyle, beatGrid, captions: spec.scenes.map(scene => ({ scene: scene.id, captions: scene.resolvedCaptions || [] })) };
  const fingerprint = sha(JSON.stringify({ ...report, voices: voices.map(({ cache, ...voice }) => voice), settings: spec.audio, seed: spec.seed }));
  if (!labels.length) return { report: { ...report, fingerprint } };
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,alimiter=limit=0.95:level=false:latency=1,apad,atrim=duration=${duration}[mixed]`);
  const output = path.join(jobDir, 'mixed.wav');
  await runProcess(tools.ffmpeg, ['-y', '-v', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '[mixed]', '-ar', String(SAMPLE_RATE), '-ac', '2', '-c:a', 'pcm_s16le', output], { timeoutMs: 120000, logPath: path.join(jobDir, 'audio.log') });
  const finalDuration = await audioDuration(output, tools);
  if (Math.abs(finalDuration - duration) > 1 / 30) throw new StudioError('AUDIO_LENGTH', 'audio', 'Mixed audio does not match the timeline.', 4);
  return { path: output, report: { ...report, fingerprint, sampleRate: SAMPLE_RATE, channels: 2, verifiedDuration: finalDuration, outputHash: sha(await readFile(output)) } };
}
