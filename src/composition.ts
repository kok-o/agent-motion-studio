import type { CompositionObject, ObjectState, ObjectKeyframe } from './types.js';

const clamp = (n: number) => Math.max(0, Math.min(1, n));
function easing(t: number, kind: ObjectKeyframe['easing']) {
  t = clamp(t);
  if (kind === 'step') return t >= 1 ? 1 : 0;
  if (kind === 'outCubic') return 1 - (1 - t) ** 3;
  if (kind === 'inOutCubic') return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
  return t;
}

/** Each property has its own track. The base is frame zero; the destination
 * keyframe supplies easing. No accumulated state, clocks, randomness or code. */
export function sampleObject(object: CompositionObject, frame: number): ObjectState {
  const state: ObjectState = { x: object.x, y: object.y, width: object.width, height: object.height, opacity: object.opacity ?? 1, rotation: object.rotation ?? 0, reveal: object.reveal ?? 1 };
  for (const key of Object.keys(state) as (keyof ObjectState)[]) {
    let priorFrame = 0, prior = state[key];
    for (const point of object.keyframes ?? []) {
      const value = point[key];
      if (value === undefined) continue;
      if (frame < point.frame) {
        const t = easing((frame - priorFrame) / (point.frame - priorFrame), point.easing);
        state[key] = prior + (value - prior) * t; break;
      }
      priorFrame = point.frame; prior = value; state[key] = value;
    }
  }
  return state;
}
