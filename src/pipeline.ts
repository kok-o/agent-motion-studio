import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runProcess, throwIfCancelled } from './runtime.js';
import type { ResolvedSpec, ResolvedScene, ToolPaths } from './types.js';
import { openRenderer } from './browser.js';

// One SDR pixel/metadata contract across image- and footage-derived H.264 segments.
// Changing frame colour metadata at a cut reinitializes downstream FFmpeg filters.
const outputPixels = 'scale=out_color_matrix=bt709:out_range=tv,setsar=1,format=yuv420p,setparams=range=limited:colorspace=bt709:color_primaries=bt709:color_trc=bt709';

export function videoFilter(spec: Pick<ResolvedSpec, 'width' | 'height'>, scene: ResolvedScene) {
  const { width: w, height: h } = spec;
  const focal = scene.focalPoint ?? { x: 0.5, y: 0.5 };
  // FFmpeg autorotates first. Normalize sample aspect ratio before fitting.
  const fit = scene.fit === 'contain'
    ? `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`
    : `scale=${w}:${h}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=${w}:${h}:max(0\\,min(iw-ow\\,iw*${focal.x}-ow/2)):max(0\\,min(ih-oh\\,ih*${focal.y}-oh/2))`;
  return `trim=start=${scene.trimStartSeconds ?? 0}:duration=${scene.durationFrames / 30},setpts=PTS-STARTPTS,scale=trunc(iw*sar/2)*2:ih,setsar=1,${fit},fps=30,trim=end_frame=${scene.durationFrames},setpts=N/(30*TB),${outputPixels}`;
}

/** Exact same visual path for a full export segment and an unsaved scene preview. */
export async function encodeScene(spec: ResolvedSpec, scene: ResolvedScene, segment: string, work: string, tools: ToolPaths, renderer?: Awaited<ReturnType<typeof openRenderer>>, progress?: (message: string) => void) {
  let activeRenderer = renderer;
  try {
  const encoder = ['-an', '-c:v', 'libx264', '-threads', '2', '-preset', 'medium', '-crf', '18', '-rc-lookahead', '12', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-video_track_timescale', '15360'];
    const prefix = ['-y', '-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_threads', '1'];
    if (scene.type === 'video') {
      await activeRenderer?.finish(); activeRenderer = undefined;
      await runProcess(tools.ffmpeg, [...prefix, '-xerror', '-err_detect', 'explode', '-i', spec.assets[scene.asset!].absolutePath, '-map', '0:v:0', '-vf', videoFilter(spec, scene), '-frames:v', String(scene.durationFrames), ...encoder, segment], { timeoutMs: 300_000, logPath: join(work, 'logs', `scene-${scene.id}.log`) });
    } else {
      activeRenderer ??= await openRenderer(spec, tools.chrome);
      const frameDir = join(work, 'motion-frames'); await mkdir(frameDir);
      try {
        for (let local = 0; local < scene.durationFrames; local++) {
          throwIfCancelled();
          await writeFile(join(frameDir, `f${String(local).padStart(5, '0')}.png`), await activeRenderer.frame(scene.startFrame + local));
          if (local % 60 === 0) progress?.(`${scene.id}: frame ${local + 1}/${scene.durationFrames}`);
        }
        // Keep the browser and the encoder from competing for peak memory.
        await activeRenderer.finish(); activeRenderer = undefined;
        await runProcess(tools.ffmpeg, [...prefix, '-framerate', '30', '-i', join(frameDir, 'f%05d.png'), '-vf', outputPixels, '-frames:v', String(scene.durationFrames), ...encoder, segment], { timeoutMs: 300_000, logPath: join(work, 'logs', `scene-${scene.id}.log`) });
      } finally { await rm(frameDir, { recursive: true, force: true }); }
    }
  } finally { await activeRenderer?.finish(); }
}

/** Decode footage with FFmpeg; Canvas is used only for the existing motion scenes. */
export async function renderMixed(spec: ResolvedSpec, work: string, tools: ToolPaths, renderer: Awaited<ReturnType<typeof openRenderer>>, audioPath?: string, progress?: (message: string) => void) {
  // encodeScene owns and closes the optional initial renderer, including failures.
  let initialRenderer: typeof renderer | undefined = renderer;
  try {
  const segments = join(work, 'segments'); await mkdir(segments);
  for (const [index, scene] of spec.scenes.entries()) {
    throwIfCancelled(); progress?.(`Scene ${index + 1}/${spec.scenes.length}: ${scene.id}`);
    const active = initialRenderer; initialRenderer = undefined;
    await encodeScene(spec, scene, join(segments, `${index}.mp4`), work, tools, active, progress);
  }
  await writeFile(join(work, 'segments.txt'), spec.scenes.map((_, index) => `file 'segments/${index}.mp4'`).join('\n'));
  await runProcess(tools.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '1', '-i', join(work, 'segments.txt'),
    ...(audioPath ? ['-i', audioPath, '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k'] : ['-map', '0:v:0']),
    '-c:v', 'copy', '-t', String(spec.totalFrames / 30), '-movflags', '+faststart', join(work, 'output.mp4')], { timeoutMs: 300_000, logPath: join(work, 'logs/ffmpeg.log') });
  const indices = [...new Set(spec.scenes.flatMap(scene => [scene.startFrame, scene.startFrame + Math.floor(scene.durationFrames / 2), scene.endFrame - 1]))];
  const selection = indices.map(index => `eq(n\\,${index})`).join('+');
  await mkdir(join(work, 'frames'));
  await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-threads', '1', '-filter_threads', '1', '-i', join(work, 'output.mp4'), '-vf', `select=${selection}`, '-fps_mode', 'vfr', '-threads', '1', join(work, 'frames/sample-%02d.png')]);
  await writeFile(join(work, 'frames/index.json'), JSON.stringify(indices.map((frame, index) => ({ file: `sample-${String(index + 1).padStart(2, '0')}.png`, frame, seconds: frame / 30 })), null, 2));
  await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-threads', '1', '-filter_threads', '1', '-i', join(work, 'output.mp4'), '-vf', `select=${selection},scale=480:-1,tile=3x${Math.ceil(indices.length / 3)}`, '-frames:v', '1', '-threads', '1', join(work, 'contact-sheet.jpg')]);
  await rm(segments, { recursive: true, force: true });
  await rm(join(work, 'segments.txt'));
  } finally { await initialRenderer?.finish(); }
}
