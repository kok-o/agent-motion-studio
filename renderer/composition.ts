import type { CompositionObject, ResolvedScene, ResolvedSpec } from '../src/types.js';
import { sampleObject } from '../src/composition.js';

function color(value: string | undefined, spec: ResolvedSpec) {
  return value && ['foreground', 'background', 'accent'].includes(value) ? spec.brand[value as 'foreground' | 'background' | 'accent'] : value ?? spec.brand.foreground;
}
function lines(ctx: CanvasRenderingContext2D, object: CompositionObject, width: number, height: number) {
  ctx.font = `${object.weight ?? 700} ${object.fontSize ?? 48}px StudioSans`;
  const result: string[] = [];
  for (const paragraph of object.text!.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (ctx.measureText(word).width > width) throw new Error(`TEXT_OVERFLOW: object ${object.id}, word ${word.slice(0, 40)}; enlarge its box or reduce fontSize.`);
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= width) line = next;
      else { result.push(line); line = word; }
    }
    result.push(line);
  }
  if (result.length * (object.fontSize ?? 48) * 1.25 > height) throw new Error(`TEXT_OVERFLOW: object ${object.id}; enlarge its height or shorten text.`);
  return result;
}
export function validateCompositionLayout(ctx: CanvasRenderingContext2D, scene: ResolvedScene) {
  for (const object of scene.objects ?? []) if (object.type === 'text') {
    // Linear/cubic interpolation stays within endpoint sizes. Validate the
    // smallest box, including future keys which can reappear after extending.
    const width = Math.min(object.width, ...(object.keyframes ?? []).flatMap(k => k.width === undefined ? [] : [k.width]));
    const height = Math.min(object.height, ...(object.keyframes ?? []).flatMap(k => k.height === undefined ? [] : [k.height]));
    lines(ctx, object, width, height);
  }
}
export function drawComposition(ctx: CanvasRenderingContext2D, spec: ResolvedSpec, scene: ResolvedScene, images: Record<string, HTMLImageElement>, frame: number) {
  ctx.globalAlpha = 1; ctx.fillStyle = color(scene.background ?? 'background', spec); ctx.fillRect(0, 0, spec.width, spec.height);
  for (const object of scene.objects!) {
    const state = sampleObject(object, frame);
    ctx.save(); ctx.globalAlpha = state.opacity;
    ctx.translate(state.x + state.width / 2, state.y + state.height / 2); ctx.rotate(state.rotation * Math.PI / 180); ctx.translate(-state.width / 2, -state.height / 2);
    ctx.fillStyle = color(object.color, spec);
    if (object.type === 'text') {
      const textLines = lines(ctx, object, state.width, state.height);
      ctx.textBaseline = 'top'; ctx.textAlign = object.align ?? 'left';
      const x = object.align === 'center' ? state.width / 2 : object.align === 'right' ? state.width : 0;
      // Keep the final line breaks fixed as characters are revealed.
      let remaining = Math.floor(object.text!.length * state.reveal);
      textLines.forEach((line, index) => { const visible = line.slice(0, Math.max(0, remaining)); ctx.fillText(visible, x, index * (object.fontSize ?? 48) * 1.25); remaining -= line.length + 1; });
    } else if (object.type === 'shape') {
      ctx.beginPath();
      if (object.shape === 'ellipse') ctx.ellipse(state.width / 2, state.height / 2, state.width / 2, state.height / 2, 0, 0, Math.PI * 2);
      else ctx.roundRect(0, 0, state.width, state.height, Math.min(object.radius ?? 0, state.width / 2, state.height / 2));
      if (object.color) ctx.fill();
      if (object.stroke) { ctx.strokeStyle = color(object.stroke, spec); ctx.lineWidth = object.strokeWidth ?? 2; ctx.stroke(); }
    } else {
      const image = images[object.asset!], cover = object.fit === 'cover';
      const ratio = (cover ? Math.max : Math.min)(state.width / image.naturalWidth, state.height / image.naturalHeight);
      const w = image.naturalWidth * ratio, h = image.naturalHeight * ratio;
      const focal = object.focalPoint ?? { x: 0.5, y: 0.5 };
      const x = cover ? Math.max(state.width - w, Math.min(0, state.width / 2 - w * focal.x)) : (state.width - w) / 2;
      const y = cover ? Math.max(state.height - h, Math.min(0, state.height / 2 - h * focal.y)) : (state.height - h) / 2;
      ctx.beginPath(); ctx.rect(0, 0, state.width, state.height); ctx.clip(); ctx.drawImage(image, x, y, w, h);
    }
    ctx.restore();
  }
}
