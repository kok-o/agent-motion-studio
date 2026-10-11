import { isDeepStrictEqual } from 'node:util';
import { hashBytes, validateManifest } from './spec.js';
import { patchScene, type ProjectAction } from './project.js';
import { StudioError } from './errors.js';
import type { CompositionObject, Manifest, ResolvedSpec, ResolvedAsset } from './types.js';

export type VisualAction = Extract<ProjectAction, { type: 'edit-scene' }>;
export type VisualIntent = 'create' | null;
export type BrowserVisualSpec = Omit<ResolvedSpec, 'projectDir' | 'history' | 'operationReceipts' | 'assets'> & {
  assets: Record<string, Pick<ResolvedAsset, 'type' | 'width' | 'height'>>;
};
const geometry = ['x', 'y', 'width', 'height'];
const fail = (message: string) => new StudioError('VISUAL_INPUT', 'visual', message);
export function visualETag(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw fail('A nonempty project ETag is required.');
  return value;
}
export function assertVisualETag(actual: string, expected: string) {
  if (actual !== expected) throw new StudioError('PROJECT_CONFLICT', 'visual', 'Project changed. Keep the draft or explicitly reread; do not resubmit it.');
}
/** Optional transport metadata, never a project/action field. Reject duplicate raw headers too. */
export function visualSelectedObject(value: unknown, rawHeaders: readonly string[] = []): string | null {
  if (rawHeaders.filter((_, index) => index % 2 === 0 && rawHeaders[index].toLowerCase() === 'x-ams-selected-object').length > 1) throw fail('Send one selected object header.');
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) throw fail('Expected a nonempty native selected object ID.');
  return value;
}
/** Creation is explicit session transport metadata, never accepted scene data. */
export function visualObjectIntent(value: unknown, rawHeaders: readonly string[] = []): VisualIntent {
  if (rawHeaders.filter((_, index) => index % 2 === 0 && rawHeaders[index].toLowerCase() === 'x-ams-object-intent').length > 1) throw fail('Send one object intent header.');
  if (value === undefined) return null;
  if (value !== 'create') throw fail('Expected the create object intent.');
  return value;
}
const omitted = (object: object, keys: string[]) => Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
function validateObjectChange(before: CompositionObject, after: CompositionObject, properties: string[]) {
  if (!isDeepStrictEqual(omitted(before, [...geometry, 'keyframes', ...properties]), omitted(after, [...geometry, 'keyframes', ...properties]))) throw fail('Only supported properties and geometry of the selected object may change.');
  if (after.keyframes !== undefined && !Array.isArray(after.keyframes)) throw fail('Expected native keyframes.');
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
/** Headerless requests retain the legacy geometry/text contract. Selection enables scoped properties/order. */
export function validateVisualAction(manifest: Manifest, input: unknown, selectedId: string | null = null, intent: VisualIntent = null): VisualAction {
  if (intent !== null) visualObjectIntent(intent);
  const action = input as VisualAction;
  if (!action || action.type !== 'edit-scene' || Object.keys(action).some(key => !['type', 'sceneId', 'patch'].includes(key))) throw fail('Expected a composition scene edit.');
  const scene = manifest.scenes.find(item => item.id === action.sceneId);
  if (manifest.schemaVersion !== 2 || scene?.type !== 'composition') throw fail('Select an existing v2 composition scene.');
  if (!action.patch || Object.keys(action.patch).some(key => !['objects', 'durationFrames'].includes(key)) || !Array.isArray(action.patch.objects)) throw fail('Expected existing objects and optional durationFrames.');
  const objects = action.patch.objects;
  if (intent === 'create') {
    if (selectedId === null) throw fail('Select the new object ID.');
    visualSelectedObject(selectedId);
    if (scene.objects!.some(object => object.id === selectedId) || objects.length !== scene.objects!.length + 1) throw fail('Create exactly one new selected object.');
    const ids = objects.map(object => object?.id), created = objects.find(object => object?.id === selectedId);
    if (new Set(ids).size !== ids.length || !created || !['text', 'shape', 'image'].includes(created.type)) throw fail('Expected one unique native object.');
    if (!isDeepStrictEqual(scene.objects!, objects.filter(object => object?.id !== selectedId))) throw fail('Preserve every existing object and their relative order.');
  } else if (objects.length !== scene.objects!.length) throw fail('Use explicit create intent to add one object.');
  else if (selectedId !== null) {
    visualSelectedObject(selectedId);
    const before = scene.objects!.find(object => object.id === selectedId);
    if (!before) throw fail('Selected object is not in this scene.');
    const ids = objects.map(object => object?.id);
    if (new Set(ids).size !== ids.length || scene.objects!.some(object => !ids.includes(object.id))) throw fail('Preserve the unique set of object IDs.');
    if (!isDeepStrictEqual(scene.objects!.filter(object => object.id !== selectedId), objects.filter(object => object.id !== selectedId))) throw fail('Preserve every neighbour and their relative order.');
    const after = objects.find(object => object.id === selectedId)!;
    const properties = before.type === 'text' ? ['text', 'color', 'fontSize', 'weight', 'align'] : before.type === 'shape' ? ['color', 'stroke', 'strokeWidth', ...(before.shape === 'rect' ? ['radius'] : [])] : [];
    validateObjectChange(before, after, properties);
  } else {
    let changed = 0;
    for (let index = 0; index < objects.length; index++) {
      const before = scene.objects![index], after = objects[index];
      if (!after || before.id !== after.id || before.type !== after.type) throw fail('Object identity and storage order must remain unchanged.');
      if (isDeepStrictEqual(before, after)) continue;
      if (++changed > 1) throw fail('Apply one selected object at a time.');
      validateObjectChange(before, after, before.type === 'text' ? ['text'] : []);
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
  private tickets = new Map<string, { etag: string; hash: string; selectedId: string | null; intent: VisualIntent }>();
  add(id: string, etag: string, action: VisualAction, selectedId: string | null = null, intent: VisualIntent = null) {
    this.tickets.set(id, { etag, hash: visualActionHash(action), selectedId, intent });
    while (this.tickets.size > 2) this.tickets.delete(this.tickets.keys().next().value!);
  }
  consume(id: unknown, etag: string, action: VisualAction, selectedId: string | null = null, intent: VisualIntent = null) {
    const ticket = typeof id === 'string' ? this.tickets.get(id) : undefined;
    if (!ticket || ticket.etag !== etag || ticket.selectedId !== selectedId || ticket.intent !== intent || ticket.hash !== visualActionHash(action)) throw new StudioError('VISUAL_PREVIEW_REQUIRED', 'visual', 'Render a new preview of this exact action, intent and selection before applying.');
    this.tickets.clear();
  }
}

/** JSON response only; neither local paths, history nor executable source are sent to the renderer. */
export function visualSpec(spec: ResolvedSpec): BrowserVisualSpec {
  const { projectDir, history, operationReceipts, ...safe } = spec;
  return { ...safe, assets: Object.fromEntries(Object.entries(spec.assets).map(([id, asset]) => [id, { type: asset.type, width: asset.width, height: asset.height }])) };
}
