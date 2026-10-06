import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import { imageSize } from 'image-size';
import { StudioError } from './errors.js';
import { probeSource } from './media.js';
import type { Manifest, ResolvedSpec, ResolvedAsset } from './types.js';
export const ENGINE_VERSION = '0.1.0';
export const SCENE_VERSION = '2';
export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function hashBytes(bytes: Uint8Array | string) { return createHash('sha256').update(bytes).digest('hex'); }
const schema = JSON.parse(await readFile(resolve(packageRoot, 'schemas/manifest.schema.json'), 'utf8'));
const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(schema);
export function assertSupportedText(text: string, field: string) {
  if (!text.trim()) throw new StudioError('EMPTY_TEXT', 'validate', `${field}: provide visible text, not only whitespace.`, 2, field);
  if (!/^[\u0020-\u007E\u00A0-\u00FF\u0400-\u052F\u2000-\u206F\u2116\n\r\t]+$/u.test(text)) {
    throw new StudioError('UNSUPPORTED_CHARACTER', 'validate', `${field}: builtin-sans supports Latin and Cyrillic text; remove unsupported symbols or emoji.`, 2, field);
  }
}
export function validateManifest(value: unknown): Manifest {
  if (!validateSchema(value)) {
    const messages = validateSchema.errors!.map(error => `${error.instancePath || '/'} ${error.message}${error.keyword === 'additionalProperties' ? ` (${error.params.additionalProperty})` : ''}`);
    throw new StudioError('INVALID_MANIFEST', 'validate', messages.join('; '), 2, validateSchema.errors![0].instancePath);
  }
  const manifest = value as Manifest;
  const ids = new Set<string>(); let total = 0;
  for (const [index, scene] of manifest.scenes.entries()) {
    const field = `scenes[${index}]`;
    if (ids.has(scene.id)) throw new StudioError('DUPLICATE_SCENE_ID', 'validate', `${field}.id: duplicate id ${scene.id}.`, 2, `${field}.id`);
    ids.add(scene.id); total += scene.durationFrames;
    if (scene.type !== 'video' && scene.trimStartSeconds !== undefined) throw new StudioError('INVALID_TRIM', 'validate', 'trimStartSeconds only applies to video scenes.', 2, field);
    if (scene.type === 'video' && manifest.assets[scene.asset!]?.type !== 'video') throw new StudioError('MISSING_VIDEO', 'validate', `${field}.asset must identify a video asset.`, 2, field);
    if (scene.type === 'video' && (scene.captions || scene.narration)) throw new StudioError('VIDEO_OVERLAY_UNSUPPORTED', 'validate', 'This iteration supports file music over video and narration/captions on motion scenes.', 2, field);
    for (const key of ['text', 'highlight', 'label', 'caption'] as const) if (scene[key]) assertSupportedText(scene[key]!, `${field}.${key}`);
    if (scene.highlight && !scene.text?.includes(scene.highlight)) throw new StudioError('INVALID_HIGHLIGHT', 'validate', `${field}.highlight must occur in text.`, 2, `${field}.highlight`);
    if (scene.type === 'product_zoom' && manifest.assets[scene.asset!]?.type !== 'image') throw new StudioError('MISSING_IMAGE', 'validate', `${field}.asset must identify an image in assets.`, 2, `${field}.asset`);
    const provider = manifest.audio.narration.provider;
    if (provider === 'none' && (scene.narration || scene.captions)) throw new StudioError('UNEXPECTED_NARRATION', 'validate', `${field}: narration/captions requires a narration provider.`, 2, `${field}.narration`);
    if (provider === 'file' && scene.narration && (!scene.narration.asset || manifest.assets[scene.narration.asset]?.type !== 'audio')) throw new StudioError('MISSING_AUDIO', 'validate', `${field}.narration.asset must identify an audio asset.`, 2, `${field}.narration.asset`);
    if (provider === 'edge' && scene.narration && !scene.narration.text) throw new StudioError('MISSING_NARRATION_TEXT', 'validate', `${field}.narration.text is required for edge.`, 2, `${field}.narration.text`);
    if (scene.captions && !scene.narration) throw new StudioError('CAPTIONS_WITHOUT_NARRATION', 'validate', `${field}.captions requires scene narration.`, 2, `${field}.captions`);
    let priorEnd = 0;
    for (const [captionIndex, caption] of (scene.captions ?? []).entries()) {
      assertSupportedText(caption.text, `${field}.captions[${captionIndex}].text`);
      if (caption.startMs < priorEnd || caption.endMs <= caption.startMs) throw new StudioError('INVALID_CAPTION_TIMING', 'validate', `${field}.captions must be ordered, non-overlapping positive intervals.`, 2, `${field}.captions`);
      priorEnd = caption.endMs;
    }
  }
  if (total < 30 || total > 1800) throw new StudioError('INVALID_DURATION', 'validate', 'Total duration must be 30–1800 frames (1–60 seconds).', 2, 'scenes');
  const music = manifest.audio.music;
  if (music.provider === 'file' && (!music.asset || manifest.assets[music.asset]?.type !== 'audio')) throw new StudioError('MISSING_MUSIC', 'validate', 'audio.music.asset must identify an audio asset.', 2, 'audio.music.asset');
  if (music.provider !== 'file' && music.asset) throw new StudioError('UNEXPECTED_MUSIC_ASSET', 'validate', 'audio.music.asset only applies to provider:file.', 2, 'audio.music.asset');
  if (manifest.audio.narration.provider !== 'edge' && (manifest.audio.narration.voice || manifest.audio.narration.rate || manifest.audio.narration.pitch)) throw new StudioError('UNEXPECTED_TTS_OPTION', 'validate', 'voice/rate/pitch only apply to provider:edge.', 2, 'audio.narration');
  const revisionIds = new Set<string>();
  const operationIds = new Set<string>();
  for (const receipt of manifest.operationReceipts ?? []) {
    if (operationIds.has(receipt.operationId)) throw new StudioError('INVALID_RECEIPTS', 'validate', 'Accepted operation IDs must be unique.', 2);
    operationIds.add(receipt.operationId);
  }
  for (const revision of manifest.history ?? []) {
    if (revisionIds.has(revision.id) || revision.id === manifest.revision) throw new StudioError('INVALID_HISTORY', 'validate', 'Revision IDs must be unique.', 2);
    revisionIds.add(revision.id);
    validateManifest({ ...manifest, scenes: revision.scenes, video: revision.video, audio: revision.audio, brand: revision.brand, revision: undefined, history: undefined, operationReceipts: undefined });
  }
  return manifest;
}
export async function loadManifest(manifestPath: string): Promise<ResolvedSpec> {
  const absoluteManifest = resolve(manifestPath);
  let bytes: Buffer;
  try { if ((await stat(absoluteManifest)).size > 1024 * 1024) throw new Error('exceeds 1 MiB'); bytes = await readFile(absoluteManifest); }
  catch (error) { throw new StudioError('MANIFEST_READ_FAILED', 'validate', `Cannot read manifest ${absoluteManifest}: ${error instanceof Error ? error.message : String(error)}`, 2); }
  let input: unknown;
  try { input = JSON.parse(bytes.toString('utf8')); } catch { throw new StudioError('INVALID_JSON', 'validate', 'Manifest must be valid JSON.', 2); }
  const manifest = validateManifest(input);
  const projectDir = await realpath(dirname(absoluteManifest));
  const assets: Record<string, ResolvedAsset> = {};
  for (const [id, asset] of Object.entries(manifest.assets)) {
    const field = `assets.${id}.path`;
    if (isAbsolute(asset.path) || /^[a-z][a-z0-9+.-]*:/i.test(asset.path) || asset.path.includes('\0')) throw new StudioError('UNSAFE_ASSET_PATH', 'validate', `${field}: use a local relative path inside the manifest directory.`, 2, field);
    let assetPath: string;
    try { assetPath = await realpath(resolve(projectDir, asset.path)); } catch { throw new StudioError('ASSET_MISSING', 'validate', `${field}: file does not exist.`, 2, field); }
    const rel = relative(projectDir, assetPath);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new StudioError('UNSAFE_ASSET_PATH', 'validate', `${field}: resolved file is outside the project. Copy it inside first.`, 2, field);
    const info = await stat(assetPath);
    const limit = (asset.type === 'image' ? 20 : asset.type === 'video' ? 512 : 100) * 1024 * 1024;
    if (!info.isFile() || info.size > limit) throw new StudioError('ASSET_LIMIT', 'validate', `${field}: file exceeds ${limit / 1024 / 1024} MiB or is not a regular file.`, 2, field);
    const content = await readFile(assetPath);
    const resolved: ResolvedAsset = { ...asset, absolutePath: assetPath, hash: hashBytes(content), bytes: content.length };
    if (asset.sha256 && asset.sha256 !== resolved.hash) throw new StudioError('ASSET_CHANGED', 'validate', `${field}: the accepted source hash has changed. Import edits as a new asset.`, 2, field);
    if (asset.type === 'image') {
      if (!['.png', '.jpg', '.jpeg'].includes(extname(assetPath).toLowerCase())) throw new StudioError('UNSUPPORTED_IMAGE', 'validate', `${field}: only PNG and JPEG are supported.`, 2, field);
      try { const size = imageSize(content); if (!['png', 'jpg'].includes(size.type!) || size.width > 4096 || size.height > 4096 || !size.width || !size.height) throw new Error('invalid dimensions or format'); resolved.width = size.width; resolved.height = size.height; }
      catch { throw new StudioError('INVALID_IMAGE', 'validate', `${field}: image header is invalid or dimensions exceed 4096×4096.`, 2, field); }
    } else if (asset.type === 'video') {
      if (extname(assetPath).toLowerCase() !== '.mp4') throw new StudioError('UNSUPPORTED_VIDEO', 'validate', `${field}: use MP4.`, 2, field);
      Object.assign(resolved, await probeSource(assetPath, 'video'));
    } else {
      if (!['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac'].includes(extname(assetPath).toLowerCase())) throw new StudioError('UNSUPPORTED_AUDIO', 'validate', `${field}: use WAV, MP3, M4A, AAC, OGG or FLAC.`, 2, field);
      if (manifest.schemaVersion === 2) Object.assign(resolved, await probeSource(assetPath, 'audio'));
    }
    assets[id] = resolved;
  }
  let cursor = 0;
  for (const scene of [...manifest.scenes, ...(manifest.history ?? []).flatMap(revision => revision.scenes)]) {
    if (scene.type === 'video' && (scene.trimStartSeconds ?? 0) + scene.durationFrames / 30 > assets[scene.asset!].durationSeconds! + 0.001) throw new StudioError('TRIM_OUT_OF_RANGE', 'validate', `${scene.id}: trim plus scene duration exceeds the video source.`, 2);
  }
  const scenes = manifest.scenes.map(scene => { const startFrame = cursor; cursor += scene.durationFrames; return { ...scene, startFrame, endFrame: cursor }; });
  const [width, height] = manifest.video.aspectRatio === '9:16' ? [1080, 1920] : [1920, 1080];
  return { ...manifest, assets, scenes, width, height, totalFrames: cursor, projectDir, engineVersion: ENGINE_VERSION, sceneVersion: SCENE_VERSION };
}
