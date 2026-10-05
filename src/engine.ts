import { mkdir, readFile, writeFile, rename, rm, stat, readdir, copyFile, realpath, open } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { platform, arch, release } from 'node:os';
import { loadManifest, hashBytes, packageRoot } from './spec.js';
import { StudioError, normalizeError } from './errors.js';
import { findTools, runProcess, cancelled, throwIfCancelled } from './runtime.js';
import { openRenderer } from './browser.js';
import { verifyVideo } from './media.js';
import { prepareAudio, audioDuration, resolveCaptions } from './audio.js';
import { renderMixed } from './pipeline.js';
import type { ResolvedSpec } from './types.js';

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
async function exists(file: string) { try { await stat(file); return true; } catch { return false; } }
async function treeFiles(directory: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const name = join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await treeFiles(directory, name)); else if (entry.isFile()) result.push(name);
  }
  return result.sort();
}
async function copyTree(from: string, to: string, files: string[]) {
  for (const file of files) { const target = join(to, file); await mkdir(resolve(target, '..'), { recursive: true }); await copyFile(join(from, file), target); }
}
async function validCache(path: string, fingerprint: string) {
  try {
    const metadata = JSON.parse(await readFile(join(path, 'integrity.json'), 'utf8')) as { fingerprint: string; hashes: Record<string, string> };
    if (metadata.fingerprint !== fingerprint || !metadata.hashes['output.mp4'] || !metadata.hashes['contact-sheet.jpg']) return false;
    for (const [file, hash] of Object.entries(metadata.hashes)) {
      if (file.includes('..') || file.startsWith('/') || file.includes(':')) return false;
      if (hashBytes(await readFile(join(path, file))) !== hash) return false;
    }
    return metadata;
  } catch { return false; }
}
export async function render(manifestPath: string, outputDir: string, options: { overwrite?: boolean; noCache?: boolean; progress?: (text: string) => void } = {}) {
  const started = performance.now();
  const manifestBytes = await readFile(resolve(manifestPath));
  const spec = await loadManifest(manifestPath);
  throwIfCancelled();
  const out = resolve(outputDir); const finalOutput = join(out, 'output.mp4');
  const tools = findTools();
  await mkdir(out, { recursive: true });
  const realOutput = await realpath(out);
  const protectedPaths = [await realpath(resolve(manifestPath)), ...Object.values(spec.assets).map(asset => asset.absolutePath)];
  if (protectedPaths.some(source => {
    const rel = relative(realOutput, source);
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.includes(':') && !rel.startsWith(sep);
  })) throw new StudioError('OUTPUT_CONTAINS_SOURCE', 'input', 'Choose a separate output folder that does not contain the project manifest or any source assets.', 2);
  const lockPath = join(out, '.render.lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); await lock.writeFile(json({ pid: process.pid, started: new Date().toISOString() })); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new StudioError('OUTPUT_LOCKED', 'render', `${out} already has a render lock. Wait for its job, or inspect .render.lock if a previous process crashed.`, 2); throw error; }
  const work = join(out, `.job-${randomUUID()}`);
  let renderer: Awaited<ReturnType<typeof openRenderer>> | undefined;
  try {
    if (await exists(finalOutput) && !options.overwrite) throw new StudioError('OUTPUT_EXISTS', 'input', `${finalOutput} already exists. Use --overwrite to replace it after a successful render.`, 2);
    await mkdir(join(work, 'logs'), { recursive: true });
    const ffmpegVersion = (await runProcess(tools.ffmpeg, ['-version'], { timeoutMs: 15_000 })).stdout.split('\n')[0];
    const ffprobeVersion = (await runProcess(tools.ffprobe, ['-version'], { timeoutMs: 15_000 })).stdout.split('\n')[0];
    const audio = await prepareAudio(spec, work, tools);
    renderer = await openRenderer(spec, tools.chrome);
    const captionLayouts = renderer.captionLayouts;
    const fontFiles = (await readdir(join(packageRoot, 'assets/fonts'))).filter(file => file.endsWith('.woff2')).sort();
    spec.fontsHash = hashBytes(Buffer.concat(await Promise.all(fontFiles.map(file => readFile(join(packageRoot, 'assets/fonts', file))))));
    const engineFiles = (await treeFiles(join(packageRoot, 'dist'))).filter(file => file.endsWith('.js') || file.endsWith('.html'));
    const engineHash = hashBytes(Buffer.concat(await Promise.all(engineFiles.map(file => readFile(join(packageRoot, 'dist', file))))));
    const fingerprintSpec = { ...spec, history: undefined, revision: undefined, projectDir: undefined, assets: Object.fromEntries(Object.entries(spec.assets).map(([id, asset]) => [id, { ...asset, path: undefined, absolutePath: undefined }])) };
    const fingerprint = hashBytes(json({ spec: fingerprintSpec, audio: audio.report.fingerprint, engineHash, fontsHash: spec.fontsHash, browserVersion: spec.browserVersion, environment: { platform: platform(), arch: arch(), release: release() }, encoder: ffmpegVersion, probe: ffprobeVersion }));
    const cacheRoot = join(spec.projectDir, '.cache', 'agent-motion-studio');
    await mkdir(cacheRoot, { recursive: true });
    const realCacheRoot = await realpath(cacheRoot); const cacheRelative = relative(spec.projectDir, realCacheRoot);
    if (cacheRelative === '..' || cacheRelative.startsWith(`..${sep}`) || cacheRelative.includes(':')) throw new StudioError('CACHE_PATH', 'render', 'The cache directory must resolve inside the project.', 2);
    const cachePath = join(realCacheRoot, fingerprint);
    let cacheHit = false;
    const cached = options.noCache ? false : await validCache(cachePath, fingerprint);
    if (cached) {
      options.progress?.('Verified cache integrity; checking the cached MP4.');
      await renderer.finish(); renderer = undefined;
      await copyTree(cachePath, work, Object.keys(cached.hashes)); cacheHit = true;
    } else if (spec.schemaVersion === 2) {
      const mixedRenderer = renderer; renderer = undefined;
      await renderMixed(spec, work, tools, mixedRenderer, audio.path, options.progress);
    } else {
      await mkdir(join(work, 'frames'), { recursive: true });
      for (let frame = 0; frame < spec.totalFrames; frame++) {
        if (cancelled) throw new StudioError('CANCELLED', 'render', 'Rendering cancelled.', 130);
        await writeFile(join(work, 'frames', `f${String(frame).padStart(5, '0')}.png`), await renderer.frame(frame));
        if (frame % 30 === 0 || frame === spec.totalFrames - 1) options.progress?.(`frame ${frame + 1}/${spec.totalFrames}`);
      }
      const indices = [...new Set(spec.scenes.flatMap(scene => [scene.startFrame + Math.min(6, scene.durationFrames - 1), scene.startFrame + Math.floor(scene.durationFrames / 2), scene.endFrame - Math.min(5, scene.durationFrames)]))];
      await renderer.sheet(indices, join(work, 'contact-sheet.jpg'));
      // Frames and layout data are complete; release browser memory before encoding.
      await renderer.finish(); renderer = undefined;
      const args = ['-y', '-hide_banner', '-loglevel', 'error', '-threads', '1', '-framerate', '30', '-i', join(work, 'frames', 'f%05d.png'), ...(audio.path ? ['-i', audio.path, '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k'] : []), '-frames:v', String(spec.totalFrames), '-t', String(spec.totalFrames / 30), '-c:v', 'libx264', '-threads', '2', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(work, 'output.mp4')];
      await runProcess(tools.ffmpeg, args, { timeoutMs: 300_000, logPath: join(work, 'logs/ffmpeg.log') });
    }
    const verification = await verifyVideo(join(work, 'output.mp4'), tools, { width: spec.width, height: spec.height, fps: 30, totalFrames: spec.totalFrames, audio: Boolean(audio.path) }, join(work, 'logs/decode.log'));
    if (cancelled) throw new StudioError('CANCELLED', 'render', 'Rendering cancelled.', 130);
    if (!manifestBytes.equals(await readFile(resolve(manifestPath)))) throw new StudioError('PROJECT_CHANGED', 'render', 'The project changed during export. Previous output is preserved; export the new revision again.', 2);
    await writeFile(join(work, 'manifest.json'), manifestBytes);
    await writeFile(join(work, 'resolved-manifest.json'), json({ ...spec, captionLayouts }));
    const report = { status: 'verified', outputFile: finalOutput, totalFrames: spec.totalFrames, durationSeconds: spec.totalFrames / 30, elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(3)), fingerprint, cache: { status: cacheHit ? 'hit' : options.noCache ? 'disabled' : 'miss', directory: cachePath }, software: { node: process.version, browser: spec.browserVersion, ffmpeg: ffmpegVersion, ffprobe: ffprobeVersion, engineVersion: spec.engineVersion, engineHash, fontsHash: spec.fontsHash }, environment: { platform: platform(), arch: arch(), release: release() }, audio: audio.report, verification, visualReview: 'not-performed-by-renderer', contactSheet: join(out, 'contact-sheet.jpg'), framesDirectory: join(out, 'frames') };
    await writeFile(join(work, 'render-report.json'), json(report));
    await writeFile(join(work, 'logs/render.log'), `Rendered ${spec.totalFrames} indexed frames. Cache ${report.cache.status}. MP4/decode verification passed.\n`);
    if (!cacheHit && !options.noCache) {
      const cacheTemp = join(cacheRoot, `.job-${randomUUID()}`); await mkdir(cacheTemp, { recursive: true });
      try {
        const files = (await treeFiles(work)).filter(file => !file.startsWith('audio')); const hashes: Record<string, string> = {};
        await copyTree(work, cacheTemp, files);
        for (const file of files) hashes[file] = hashBytes(await readFile(join(cacheTemp, file)));
        await writeFile(join(cacheTemp, 'integrity.json'), json({ fingerprint, hashes }));
        throwIfCancelled();
        if (await exists(cachePath)) await rm(cachePath, { recursive: true });
        await rename(cacheTemp, cachePath);
      } finally { if (await exists(cacheTemp)) await rm(cacheTemp, { recursive: true }); }
    }
    // Replace complete directories, so shortening a video cannot leave old frame files.
    // Keep rollback copies until the MP4 and all reports have been promoted successfully.
    await publishWork(work, out);
    return report;
  } catch (error) {
    const failureDir = join(out, 'failures', work.slice(work.lastIndexOf(sep) + 1));
    await mkdir(failureDir, { recursive: true });
    await writeFile(join(failureDir, 'failure-report.json'), json(normalizeError(cancelled ? new StudioError('CANCELLED', 'render', 'Rendering cancelled.', 130) : error)));
    if (await exists(join(work, 'logs'))) await copyTree(join(work, 'logs'), join(failureDir, 'logs'), await treeFiles(join(work, 'logs')));
    throw error;
  } finally {
    try { await renderer?.finish(); }
    finally {
      const rel = relative(out, work);
      if (rel.startsWith('.job-') && !rel.includes(sep)) await rm(work, { recursive: true, force: true });
      await lock.close(); await rm(lockPath, { force: true });
    }
  }
}
async function publishWork(work: string, out: string) {
  throwIfCancelled();
  const backup = join(out, `.previous-${randomUUID()}`); await mkdir(backup);
  const newEntries = (await readdir(work)).sort((a, b) => Number(a === 'output.mp4') - Number(b === 'output.mp4'));
  const knownEntries = [...new Set([...newEntries, 'music.wav', 'mixed.wav', 'audio.log'])];
  const backedUp: string[] = [], published: string[] = [];
  let backupCanBeRemoved = false;
  try {
    for (const entry of knownEntries) { throwIfCancelled(); if (await exists(join(out, entry))) { await rename(join(out, entry), join(backup, entry)); backedUp.push(entry); } }
    for (const entry of newEntries) { throwIfCancelled(); await rename(join(work, entry), join(out, entry)); published.push(entry); }
    throwIfCancelled();
    backupCanBeRemoved = true;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const entry of published.reverse()) try { await rename(join(out, entry), join(work, entry)); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    for (const entry of backedUp) try { await rename(join(backup, entry), join(out, entry)); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    backupCanBeRemoved = rollbackErrors.length === 0;
    if (rollbackErrors.length) throw new StudioError('PUBLISH_ROLLBACK_FAILED', 'publish', `File replacement and rollback failed. Previous files retained for recovery in ${backup}. Original failure: ${String(error)}`, 4);
    throw error;
  } finally { if (backupCanBeRemoved) await rm(backup, { recursive: true, force: true }); }
}
export async function validateForRender(manifestPath: string) {
  const spec = await loadManifest(manifestPath); const tools = findTools();
  let renderer: Awaited<ReturnType<typeof openRenderer>> | undefined;
  try {
    const music = spec.audio.music;
    if (music.provider === 'file') await audioDuration(spec.assets[music.asset!].absolutePath, tools);
    if (spec.audio.narration.provider === 'file') for (const scene of spec.scenes) {
      if (!scene.narration) continue;
      const duration = await audioDuration(spec.assets[scene.narration.asset!].absolutePath, tools);
      if (duration + 0.3 > scene.durationFrames / 30 + 0.0001) throw new StudioError('VOICE_TOO_LONG', 'audio', `Voiceover for ${scene.id} needs ${(duration + 0.3).toFixed(3)} seconds including lead-in/tail; increase durationFrames.`, 2, `scenes.${scene.id}.durationFrames`);
      scene.resolvedCaptions = resolveCaptions(scene, scene.captions ?? [], duration);
    }
    renderer = await openRenderer(spec, tools.chrome);
    return { valid: true, id: spec.id, width: spec.width, height: spec.height, fps: 30, totalFrames: spec.totalFrames, scenes: spec.scenes, assets: spec.assets, ...(spec.audio.narration.provider === 'edge' ? { onlineTts: 'not-run-during-validation; render will resolve audio timing' } : {}) };
  } finally { await renderer?.finish(); }
}
