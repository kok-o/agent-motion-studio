// Adapted from HyperFrames bb34e301ec3c5f7b9edad07932356bd02a9f7934 (Apache-2.0).
// See third-party/hyperframes/PROVENANCE.json and LICENSE. Pure helpers; no React/DOM engine.
import type { CompositionObject, ObjectState } from '../src/types.js';
import type { ObjectPatch, Point } from './object-editor-types.js';
type ResizeInput = { pointerStart: Point; centerStart: Point; pointer: Point };
export function resolveCenterResizeScale(input: ResizeInput): number {
  const startDist = Math.hypot(input.pointerStart.x - input.centerStart.x, input.pointerStart.y - input.centerStart.y);
  if (!Number.isFinite(startDist) || startDist < 0.5) return 1;
  return Math.hypot(input.pointer.x - input.centerStart.x, input.pointer.y - input.centerStart.y) / startDist;
}
export function resolveCenterResizeSize(input: ResizeInput & { baseWidth: number; baseHeight: number }): { width: number; height: number } {
  const baseWidth = Math.max(input.baseWidth, 1), baseHeight = Math.max(input.baseHeight, 1);
  const scale = Math.max(1 / Math.min(baseWidth, baseHeight), resolveCenterResizeScale(input));
  return { width: baseWidth * scale, height: baseHeight * scale };
}
export function formatNumericValue(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
export function parseNumericToken(value: string): { value: number; unit: string } | null {
  if (!value) return null;
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)([a-z%]*)$/i);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? { value: parsed, unit: match[2] ?? '' } : null;
}
export function adjustNumericToken(value: string, direction: 1 | -1, modifiers?: { altKey?: boolean; shiftKey?: boolean }): string | null {
  const token = parseNumericToken(value);
  if (!token) return null;
  const baseStep = modifiers?.altKey ? 0.1 : modifiers?.shiftKey ? 10 : 1;
  return `${formatNumericValue(token.value + baseStep * direction)}${token.unit}`;
}

// AMS adapters. The renderer remains the sole interpolation source.
export function geometryKey(object: CompositionObject, frame: number, geometry: ObjectPatch): CompositionObject {
  const result = structuredClone(object), points = result.keyframes ?? [];
  const existing = points.find(point => point.frame === frame);
  if (existing) Object.assign(existing, geometry);
  else points.push({ frame, ...geometry });
  result.keyframes = points.sort((a, b) => a.frame - b.frame);
  return result;
}
export function containsPoint(state: Pick<ObjectState, 'x' | 'y' | 'width' | 'height'> & Partial<Pick<ObjectState, 'rotation'>>, point: Point): boolean {
  const cx = state.x + state.width / 2, cy = state.y + state.height / 2, angle = -(state.rotation ?? 0) * Math.PI / 180;
  const dx = point.x - cx, dy = point.y - cy;
  const x = dx * Math.cos(angle) - dy * Math.sin(angle), y = dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.abs(x) <= state.width / 2 && Math.abs(y) <= state.height / 2;
}
