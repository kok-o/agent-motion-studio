import type { CompositionObject, ObjectState, Manifest, Scene } from '../src/types.js';
import type { NativeRenderSpec } from '../renderer/types.js';
import type { readProject } from '../src/project.js';
import type { previewScene } from '../src/preview.js';
import type { VisualAction as ProjectVisualAction } from '../src/visual-editor.js';

// The exact path-free server projection, never a filesystem ResolvedSpec.
export type NativeSnapshot = NativeRenderSpec;
export type ProjectState = Awaited<ReturnType<typeof readProject>>;
export type Geometry = Pick<ObjectState, 'x' | 'y' | 'width' | 'height'>;
export type Point = { x: number; y: number };
export type DurationPatch = Pick<Scene, 'durationFrames'>;
export type ObjectPatch = Partial<Geometry>;
export type VisualAction = ProjectVisualAction & { patch: DurationPatch & { objects: CompositionObject[] } };
export type PreviewReply = Pick<Awaited<ReturnType<typeof previewScene>>, 'stale' | 'projectHash'> & { previewId: string | null; url: string };
export type ApplyReply = ProjectState & { committed: true };
type VisualReadOptions = { headers: { 'If-Match': string } };
type VisualWriteOptions = { method: 'POST'; headers: { 'Content-Type': 'application/json'; 'If-Match': string }; body: string };

/** Concrete bridge to the remaining JS app. No generic JSON-to-T assertion.
 * Runtime ETag/ticket and commit-response validation remain in their owners. */
export interface VisualAPI {
  (path: `/api/visual/state?scene=${string}`, options: VisualReadOptions): Promise<{ etag: string; spec: NativeSnapshot }>;
  (path: '/api/visual/preview', options: VisualWriteOptions): Promise<PreviewReply>;
  (path: '/api/visual/apply', options: VisualWriteOptions): Promise<ApplyReply>;
}
export interface EditorHost {
  getScene(): Scene | undefined;
  getManifest(): Manifest;
  getPatch(): DurationPatch;
  validatePatch(): DurationPatch;
  isDirty(): boolean;
  isBusy(): boolean;
  api: VisualAPI;
  notice(message: string, error?: boolean): void;
  task(operation: () => unknown | Promise<unknown>): Promise<void>;
  changed(): void;
  setDirty(value: boolean): void;
  discard(): void;
  accepted(result: ApplyReply): void;
  reopen(): Promise<void>;
}
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export interface PreviewTicket { actionJSON: string; readonly action: DeepReadonly<VisualAction>; baseETag: string; previewId: string }
export interface EditorModel {
  sceneId: string; etag: string; objects: CompositionObject[]; selectedId: string | undefined;
  frame: number; loaded: boolean; ready: boolean; stale: boolean; unknown: boolean;
  reconciliationMessage?: string; spec?: NativeSnapshot; ticket?: PreviewTicket;
}
export interface Gesture {
  model: EditorModel; etag: string; objectId: string; frame: number; mode: string; pointerId: number;
  start: Point; state: ObjectState; objects: CompositionObject[]; dirty: boolean; scalarJSON: string; resizing: boolean;
}
export type ContextChoice = 'apply' | 'discard' | 'stay';
export interface EditorController {
  active(): boolean;
  sync(scene: Scene, state: ProjectState): void;
  constraints(): void;
  externalChanged(etag: string): void;
  scalarChanged(): void;
  preview(): Promise<void>;
  apply(): Promise<boolean>;
  resolveContext(): Promise<boolean>;
  reopen(): Promise<boolean>;
  invalidate(): void;
  hasGesture(): boolean;
  reset(): void;
  isUnknown(): boolean;
}
