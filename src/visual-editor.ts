import { isDeepStrictEqual } from 'node:util';
import { hashBytes, validateManifest } from './spec.js';
import { patchScene, type ProjectAction } from './project.js';
import { StudioError } from './errors.js';
import type { Manifest, ResolvedSpec } from './types.js';

export type VisualAction = Extract<ProjectAction, { type: 'edit-scene' }>;
const geometry = ['x', 'y', 'width', 'height'];
const fail = (message: string) => new StudioError('VISUAL_INPUT', 'visual', message);
export function visualETag(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw fail('A nonempty project ETag is required.');
  return value;
}
export function assertVisualETag(actual: string, expected: string) {
  if (actual !== expected) throw new StudioError('PROJECT_CONFLICT', 'visual', 'Project changed. Keep the draft or explicitly reread; do not resubmit it.');
}
/** Existing-object geometry/text only. Neighbours, identity, order and other tracks are immutable here. */
export function validateVisualAction(manifest: Manifest, input: unknown): VisualAction {
  const action = input as VisualAction;
  if (!action || action.type !== 'edit-scene' || Object.keys(action).some(key => !['type', 'sceneId', 'patch'].includes(key))) throw fail('Expected a composition scene edit.');
  const scene = manifest.scenes.find(item => item.id === action.sceneId);
  if (manifest.schemaVersion !== 2 || scene?.type !== 'composition') throw fail('Select an existing v2 composition scene.');
  if (!action.patch || Object.keys(action.patch).some(key => !['objects', 'durationFrames'].includes(key)) || !Array.isArray(action.patch.objects)) throw fail('Expected existing objects and optional durationFrames.');
  const objects = action.patch.objects;
  if (objects.length !== scene.objects!.length) throw fail('Adding/removing objects is not supported by this editor.');
  let changed = 0;
  for (let index = 0; index < objects.length; index++) {
    const before = scene.objects![index], after = objects[index];
    if (!after || before.id !== after.id || before.type !== after.type) throw fail('Object identity and storage order must remain unchanged.');
    if (isDeepStrictEqual(before, after)) continue;
    if (++changed > 1) throw fail('Apply one selected object at a time.');
    const omitted = (object: object, keys: string[]) => Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
    if (!isDeepStrictEqual(omitted(before, [...geometry, 'keyframes', ...(before.type === 'text' ? ['text'] : [])]), omitted(after, [...geometry, 'keyframes', ...(before.type === 'text' ? ['text'] : [])]))) throw fail('Only text and geometry may change.');
    const prior = before.keyframes ?? [], next = after.keyframes ?? [];
    if (next.length < prior.length || next.length > prior.length + 1) throw fail('Preserve existing keyframes.');
    for (const key of prior) {
      const revised = next.find(item => item.frame === key.frame);
      if (!revised || !isDeepStrictEqual(omitted(key, geometry), omitted(revised, geometry))) throw fail('Preserve keyframe timing, easing and non-geometry properties.');
    }
    for (const key of next.filter(item => !prior.some(old => old.frame === item.frame))) {
      if (Object.keys(key).some(name => !['frame', ...geometry].includes(name))) throw fail('New keys contain geometry only.');
    }
  }
  const next = structuredClone(manifest);
  next.scenes[next.scenes.findIndex(item => item.id === scene.id)] = patchScene(scene, action.patch);
  validateManifest(next);
  return structuredClone(action);
}
export function visualActionHash(action: VisualAction) { return hashBytes(Buffer.from(JSON.stringify(action))); }

/** Session-local tickets. No replay promise for ordinary edits: consumed before attempting publication. */
export class VisualTickets {
  private tickets = new Map<string, { etag: string; hash: string }>();
  add(id: string, etag: string, action: VisualAction) {
    this.tickets.set(id, { etag, hash: visualActionHash(action) });
    while (this.tickets.size > 2) this.tickets.delete(this.tickets.keys().next().value!);
  }
  consume(id: unknown, etag: string, action: VisualAction) {
    const ticket = typeof id === 'string' ? this.tickets.get(id) : undefined;
    if (!ticket || ticket.etag !== etag || ticket.hash !== visualActionHash(action)) throw new StudioError('VISUAL_PREVIEW_REQUIRED', 'visual', 'Render a new preview of this exact action before applying.');
    this.tickets.clear();
  }
}

/** JSON response only; neither local paths, history nor executable source are sent to the renderer. */
export function visualSpec(spec: ResolvedSpec) {
  const { projectDir, history, operationReceipts, ...safe } = spec;
  return { ...safe, assets: Object.fromEntries(Object.entries(spec.assets).map(([id, asset]) => [id, { type: asset.type, width: asset.width, height: asset.height }])) };
}
