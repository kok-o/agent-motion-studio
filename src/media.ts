import { StudioError } from './errors.js';
import { runProcess } from './runtime.js';
import type { ToolPaths, ResolvedAsset, Scene, SourceAudioClock } from './types.js';
export type ExpectedVideo = { width: number; height: number; totalFrames: number; fps: number; audio?: boolean };
/** Read the actual stream, never trust an extension or client supplied metadata. */
export async function probeSource(file: string, type: 'video' | 'audio') {
  const probe = await runProcess(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-threads', '1', '-show_streams', '-show_format', '-of', 'json', file], { timeoutMs: 30_000 });
  const info = JSON.parse(probe.stdout);
  const stream = info.streams?.find((item: { codec_type: string; disposition?: { attached_pic?: number } }) => item.codec_type === type && !item.disposition?.attached_pic);
  const durationSeconds = Number(stream?.duration ?? info.format?.duration);
  if (!stream || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 3600) throw new StudioError('INVALID_SOURCE', 'import', `Expected a decodable ${type} stream with a duration of 0–3600 seconds.`, 2);
  if (type === 'audio') return { durationSeconds };
  const [a, b] = String(stream.avg_frame_rate).split('/').map(Number);
  const sourceFps = a / b;
  const rotation = Number(stream.side_data_list?.find((item: { rotation?: number }) => item.rotation !== undefined)?.rotation ?? 0);
  if (!Number.isFinite(sourceFps) || sourceFps <= 0 || sourceFps > 240 || !stream.width || !stream.height || stream.width > 4096 || stream.height > 4096) throw new StudioError('INVALID_SOURCE', 'import', 'Video must be at most 4096 pixels per side and 240 fps.', 2);
  const swap = Math.abs(rotation) % 180 === 90;
  const audio = info.streams.find((item: { codec_type: string }) => item.codec_type === 'audio');
  const [nominalNumerator, nominalDenominator] = String(stream.r_frame_rate).split('/').map(Number);
  const originSeconds = Number(info.format?.start_time), videoStartSeconds = Number(stream.start_time);
  const sourceClock = audio ? { originSeconds, videoStartSeconds, audioStartSeconds: Number(audio.start_time), videoTimeBase: String(stream.time_base), audioTimeBase: String(audio.time_base), audioStreamIndex: Number(audio.index), nominalFps: nominalNumerator / nominalDenominator, decoderDelayFrames: Number(stream.has_b_frames) } : undefined;
  return { durationSeconds, sourceFps, width: swap ? stream.height : stream.width, height: swap ? stream.width : stream.height, rotation, hasAudio: Boolean(audio), sourceClock };
}

const badClock = (message: string) => new StudioError('SOURCE_AUDIO_CLOCK_UNSUPPORTED', 'validate', `${message} Disable source audio to retain visual-only rendering.`, 2);

/** Timestamp continuity is validated before a resampler can conceal a backward clock. */
export function validateSourceAudioPackets(packets: { pts_time?: string; duration_time?: string }[]) {
  if (!packets.length) throw badClock('The first source audio stream has no readable timestamped packets.');
  let previousEnd = -Infinity;
  for (const packet of packets) {
    const pts = Number(packet.pts_time), duration = Number(packet.duration_time);
    if (!Number.isFinite(pts) || !Number.isFinite(duration) || duration <= 0 || pts < previousEnd - 2 / 48000) throw badClock('The first source audio stream has missing or backward timestamps.');
    previousEnd = pts + duration;
  }
}

/** Resolve the first retained picture frame and preserve the audio's common source clock. */
export async function resolveSourceAudioClock(asset: ResolvedAsset, scene: Scene): Promise<SourceAudioClock> {
  if (!asset.hasAudio) throw new StudioError('SOURCE_AUDIO_MISSING', 'validate', `${scene.id}: the selected video has no audio stream. Explicitly disable source audio or choose another source.`, 2);
  const clock = asset.sourceClock;
  const rational = (value: string) => /^\d+\/[1-9]\d*$/.test(value) && Number(value.split('/')[0]) > 0;
  if (!clock || !Number.isFinite(clock.originSeconds) || !Number.isFinite(clock.videoStartSeconds) || !Number.isFinite(clock.audioStartSeconds) || !Number.isInteger(clock.audioStreamIndex) || !rational(clock.videoTimeBase) || !rational(clock.audioTimeBase)) throw badClock(`${scene.id}: source timestamps/time bases are unavailable.`);
  // Resolve the actual retained frame below, including audio-leading-video containers.
  if (!Number.isFinite(clock.nominalFps) || Math.abs(clock.nominalFps - asset.sourceFps!) > .00001) throw badClock(`${scene.id}: variable-rate video is unsupported with source audio.`);
  const tools = { ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg', ffprobe: process.env.FFPROBE_PATH || 'ffprobe' };
  if (!Number.isInteger(clock.decoderDelayFrames) || clock.decoderDelayFrames < 0 || clock.decoderDelayFrames > 16) throw badClock(`${scene.id}: picture decoder delay is unavailable.`);
  const trim = scene.trimStartSeconds ?? 0, end = clock.originSeconds + trim + scene.durationFrames / 30 + (clock.decoderDelayFrames + 2) / asset.sourceFps!;
  const probe = async (stream: string, kind: 'frames' | 'packets', entries: string, windowEnd = end) => {
    const result = await runProcess(tools.ffprobe, ['-v', 'error', '-select_streams', stream, '-read_intervals', `%${windowEnd}`, `-show_${kind}`, '-show_entries', entries, '-of', 'json', asset.absolutePath], { timeoutMs: 120000 });
    if (result.stdout.length >= 3_900_000) throw badClock(`${scene.id}: timestamp window exceeds the bounded probe.`);
    if (result.stderr.trim()) throw new StudioError('SOURCE_AUDIO_DECODE_FAILED', 'validate', `${scene.id}: source stream failed timestamp/decode inspection.`, 2);
    try { return JSON.parse(result.stdout); } catch { throw badClock(`${scene.id}: source timestamp probe was incomplete.`); }
  };
  const picture = await probe('v:0', 'frames', 'frame=best_effort_timestamp_time');
  const frames: number[] = (picture.frames ?? []).map((frame: { best_effort_timestamp_time?: string }) => Number(frame.best_effort_timestamp_time));
  if (!frames.length || frames.some(frame => !Number.isFinite(frame))) throw badClock(`${scene.id}: picture timestamps are unavailable.`);
  for (let index = 1; index < frames.length; index++) if (Math.abs(frames[index] - frames[index - 1] - 1 / asset.sourceFps!) > .00002) throw badClock(`${scene.id}: variable/backward picture timestamps are unsupported with source audio.`);
  const firstVideoSeconds = frames.find(frame => frame - clock.originSeconds >= trim - .0000001);
  if (firstVideoSeconds === undefined) throw badClock(`${scene.id}: no retained picture frame was found.`);
  // A stream starting after this picture interval is valid silence, not a missing
  // stream. Inspect its first packets as well before padding the chosen interval.
  const audio = await probe('a:0', 'packets', 'packet=pts_time,duration_time', Math.max(end, clock.audioStartSeconds + .1));
  validateSourceAudioPackets(audio.packets ?? []);
  try {
    await runProcess(tools.ffmpeg, ['-v', 'error', '-xerror', '-err_detect', 'explode', '-ss', String(Math.max(trim, clock.audioStartSeconds - clock.originSeconds)), '-i', asset.absolutePath, '-t', String(scene.durationFrames / 30), '-map', '0:a:0', '-f', 'null', '-'], { timeoutMs: 120000 });
  } catch (error) { throw new StudioError('SOURCE_AUDIO_DECODE_FAILED', 'validate', `${scene.id}: first source audio stream failed decoding: ${error instanceof Error ? error.message : String(error)}`, 2); }
  const startSample = Math.round((firstVideoSeconds - clock.originSeconds) * 48000);
  return { originSeconds: clock.originSeconds, streamIndex: clock.audioStreamIndex, firstVideoSeconds, startSample, endSample: startSample + scene.durationFrames * 1600 };
}
export async function verifyVideo(file: string, tools: Pick<ToolPaths, 'ffmpeg' | 'ffprobe'>, expected?: ExpectedVideo, logPath?: string) {
  const probe = await runProcess(tools.ffprobe, ['-v', 'error', '-threads', '1', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file], { timeoutMs: 120_000 });
  let info: {streams: Record<string, unknown>[]; format: Record<string, unknown>};
  try { info = JSON.parse(probe.stdout); } catch { throw new StudioError('INVALID_PROBE', 'verify', 'ffprobe returned invalid JSON.', 4); }
  const video = info.streams.find(stream => stream.codec_type === 'video');
  const audio = info.streams.find(stream => stream.codec_type === 'audio');
  if (!video || video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p') throw new StudioError('INVALID_VIDEO_STREAM', 'verify', 'Expected H.264 video with yuv420p pixels.', 4);
  const fpsParts = String(video.avg_frame_rate).split('/').map(Number);
  const fps = fpsParts[0] / fpsParts[1];
  const frames = Number(video.nb_read_frames);
  const duration = Number(video.duration ?? info.format.duration);
  if (!Number.isFinite(fps) || !Number.isFinite(frames) || !Number.isFinite(duration)) throw new StudioError('INVALID_VIDEO_METADATA', 'verify', 'Could not determine frame count, fps or duration.', 4);
  if (expected && (video.width !== expected.width || video.height !== expected.height || fps !== expected.fps || frames !== expected.totalFrames || Math.abs(duration - expected.totalFrames / expected.fps) > 1 / expected.fps)) throw new StudioError('VIDEO_MISMATCH', 'verify', `Expected ${expected.width}×${expected.height}, ${expected.fps} fps, ${expected.totalFrames} frames; received ${video.width}×${video.height}, ${fps} fps, ${frames} frames, ${duration}s.`, 4);
  if (expected?.audio && (!audio || audio.codec_name !== 'aac')) throw new StudioError('AUDIO_MISMATCH', 'verify', 'Expected an AAC audio stream.', 4);
  if (audio && Math.abs(Number(audio.duration) - duration) > 0.15) throw new StudioError('AUDIO_DURATION_MISMATCH', 'verify', 'Audio and video duration differ by more than 150ms.', 4);
  const decoded = await runProcess(tools.ffmpeg, ['-v', 'error', '-xerror', '-threads', '1', '-i', file, '-map', '0:v:0', ...(audio ? ['-map', '0:a:0'] : []), '-threads', '1', '-f', 'null', '-'], { timeoutMs: 180_000, logPath });
  return { passed: true, width: video.width, height: video.height, fps, totalFrames: frames, durationSeconds: duration, codec: video.codec_name, pixelFormat: video.pix_fmt, audio: audio ? { codec: audio.codec_name, durationSeconds: Number(audio.duration), sampleRate: audio.sample_rate, channels: audio.channels } : null, decode: { exitCode: decoded.exitCode, stderr: decoded.stderr }, ffprobe: info };
}
