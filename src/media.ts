import { StudioError } from './errors.js';
import { runProcess } from './runtime.js';
import type { ToolPaths } from './types.js';
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
  return { durationSeconds, sourceFps, width: swap ? stream.height : stream.width, height: swap ? stream.width : stream.height, rotation };
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
