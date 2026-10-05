import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readProject, patchScene, type ProjectAction } from './project.js';
import { loadManifest, hashBytes } from './spec.js';
import { encodeScene } from './pipeline.js';
import { findTools } from './runtime.js';
import { verifyVideo } from './media.js';
import { StudioError } from './errors.js';

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
