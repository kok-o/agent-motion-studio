import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readProject, patchScene, generatedTakeRequestHash, type GeneratedTakeDraft, type ProjectAction } from './project.js';
import { loadManifest, hashBytes } from './spec.js';
import { encodeScene } from './pipeline.js';
import { findTools } from './runtime.js';
import { verifyVideo } from './media.js';
import { StudioError } from './errors.js';

/** Render-only composition. Validate the whole accepted project before pruning history-only assets. */
export async function previewGeneratedTake(file: string, draft: GeneratedTakeDraft, candidatePath: string, output: string) {
  generatedTakeRequestHash(draft);
  const { manifest, etag } = await readProject(file);
  if (etag !== draft.baseEtag) throw new StudioError('PROJECT_CONFLICT', 'preview', 'Project changed. Refresh and preview the candidate again.', 2);
  await loadManifest(file);
  if ((await readProject(file)).etag !== etag) throw new StudioError('PROJECT_CONFLICT', 'preview', 'Project changed during validation. Refresh and preview again.', 2);
  const scene = manifest.scenes.find(item => item.id === draft.sceneId);
  if (!scene || scene.type !== 'video') throw new StudioError('PROJECT_CONFLICT', 'preview', 'The target video scene no longer exists.', 2);
  if (hashBytes(await readFile(candidatePath)) !== draft.candidateSha256) throw new StudioError('CANDIDATE_CHANGED', 'preview', 'Candidate bytes changed. Download the result again.', 2);
  const { relative, isAbsolute } = await import('node:path');
  const path = relative(dirname(file), candidatePath).replace(/\\/g, '/');
  if (path.startsWith('..') || isAbsolute(path)) throw new Error('Candidate must remain inside the project.');
  let id = `candidate-${randomUUID()}`;
  while (manifest.assets[id]) id = `candidate-${randomUUID()}`;
  const used = new Set<string>();
  for (const item of manifest.scenes) { if (item.asset) used.add(item.asset); if (item.narration?.asset) used.add(item.narration.asset); for (const object of item.objects ?? []) if (object.asset) used.add(object.asset); }
  if (manifest.audio.music.asset) used.add(manifest.audio.music.asset);
  // The old target source can be pruned only when no other scene references it.
  if (scene.asset && !manifest.scenes.some(item => item.id !== scene.id && (item.asset === scene.asset || item.narration?.asset === scene.asset || item.objects?.some(object => object.asset === scene.asset))) && manifest.audio.music.asset !== scene.asset) used.delete(scene.asset);
  manifest.assets = Object.fromEntries(Object.entries(manifest.assets).filter(([key]) => used.has(key)));
  manifest.assets[id] = { type: 'video', path, sha256: draft.candidateSha256 };
  scene.asset = id; scene.trimStartSeconds = draft.trimStartSeconds; scene.fit = draft.fit; scene.focalPoint = draft.focalPoint;
  delete manifest.history; delete manifest.operationReceipts;
  const temporary = join(dirname(file), `.candidate-preview-${randomUUID()}.json`);
  try {
    await writeFile(temporary, JSON.stringify(manifest), { flag: 'wx' });
    const temporaryEtag = (await readProject(temporary)).etag;
    const result = await previewScene(temporary, { type: 'edit-scene', sceneId: scene.id, patch: { asset: id, trimStartSeconds: draft.trimStartSeconds, fit: draft.fit, focalPoint: draft.focalPoint } }, temporaryEtag, output);
    if (hashBytes(await readFile(candidatePath)) !== draft.candidateSha256) throw new Error('Candidate changed during preview.');
    return { ...result, projectHash: etag, stale: (await readProject(file)).etag !== etag };
  } finally { await rm(temporary, { force: true }); }
}

export async function previewScene(file: string, action: Extract<ProjectAction, { type: 'edit-scene' }>, expectedEtag: string, output: string) {
  const { manifest, etag } = await readProject(file);
  if (etag !== expectedEtag) throw new StudioError('PROJECT_CONFLICT', 'preview', 'Project changed elsewhere. Reload before previewing.', 2);
  if (!action || action.type !== 'edit-scene' || Object.keys(action).some(key => !['type', 'sceneId', 'patch'].includes(key))) throw new Error('Expected a scene draft.');
  const index = manifest.scenes.findIndex(scene => scene.id === action.sceneId);
  if (index < 0) throw new Error('Scene does not exist.');
  manifest.scenes[index] = patchScene(manifest.scenes[index], action.patch);
  if (manifest.scenes.some(scene => scene.narration || scene.captions)) throw new Error('Scene preview currently supports projects without narration/captions. Full export remains available.');
  const temporary = join(dirname(file), `.preview-${randomUUID()}.json`);
  try {
    await writeFile(temporary, JSON.stringify(manifest), { flag: 'wx' });
    const spec = await loadManifest(temporary), scene = spec.scenes[index], tools = findTools();
    await mkdir(join(output, 'logs'), { recursive: true });
    const video = join(output, 'output.mp4');
    await encodeScene(spec, scene, video, output, tools);
    const verification = await verifyVideo(video, tools, { width: spec.width, height: spec.height, totalFrames: scene.durationFrames, fps: 30 });
    for (const asset of Object.values(spec.assets)) if (hashBytes(await readFile(asset.absolutePath)) !== asset.hash) throw new Error('Source changed while preparing preview; rebuild it.');
    const start = scene.type === 'video' ? scene.trimStartSeconds ?? 0 : 0;
    return { sceneId: scene.id, projectHash: etag, durationSeconds: scene.durationFrames / 30, totalFrames: scene.durationFrames, sourceStart: start, sourceEndExclusive: start + scene.durationFrames / 30, verification, stale: (await readProject(file)).etag !== etag };
  } finally { await rm(temporary, { force: true }); }
}
