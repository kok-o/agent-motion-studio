import type { ResolvedSpec, ResolvedScene, TextLayout } from '../src/types.js';
import { drawKineticFrame, kineticLayouts } from './kinetic.js';
import { drawComposition, validateCompositionLayout } from './composition.js';
const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
// Export reads back every frame. Keep one software raster path instead of
// Chrome switching the canvas backend partway through an indexed render.
const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
let spec: ResolvedSpec;
const images: Record<string, HTMLImageElement> = {};
const captionLayouts = new Map<string, TextLayout>();
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const ease = (value: number) => 1 - Math.pow(1 - clamp(value), 3);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function fitText(text: string, box: { x: number; y: number; width: number; height: number }, maximum: number, minimum: number, maxLines: number, align: 'left' | 'center' = 'left', weight = 700): TextLayout {
  const words = text.trim().split(/\s+/);
  for (let size = maximum; size >= minimum; size -= 2) {
    ctx.font = `${weight} ${size}px StudioSans`;
    const lines: string[] = []; let line = ''; let impossible = false;
    for (const word of words) {
      if (ctx.measureText(word).width > box.width) { impossible = true; break; }
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= box.width) line = candidate;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    const lineHeight = Math.round(size * 1.14);
    if (!impossible && lines.length <= maxLines && lines.length * lineHeight <= box.height) {
      return { lines, fontSize: size, lineHeight, x: box.x, y: box.y + (box.height - lines.length * lineHeight) / 2, width: box.width, height: lines.length * lineHeight, align };
    }
  }
  throw new Error(`TEXT_OVERFLOW: text does not fit at ${minimum}px. Shorten: "${text.slice(0, 80)}"`);
}
function layouts(scene: ResolvedScene) {
  const { width: w, height: h } = spec;
  const portrait = w < h, margin = Math.round(w * (spec.video.safeArea ?? 0.09));
  const width = w - margin * 2;
  if (spec.video.style !== 'kinetic') {
  if (scene.type === 'kinetic_title') scene.layout = fitText(scene.text!, { x: margin, y: h * (portrait ? 0.3 : 0.2), width, height: h * (scene.label ? portrait ? 0.34 : 0.45 : portrait ? 0.36 : 0.56) }, scene.fontSize ?? (portrait ? 116 : 152), 60, portrait ? 5 : 3);
  if (scene.type === 'kinetic_title' && scene.label) scene.labelLayout = fitText(scene.label, { x: margin, y: h * 0.70, width, height: h * 0.09 }, portrait ? 42 : 48, 28, 2, 'left', 400);
  if (scene.type === 'cta') {
    scene.layout = fitText(scene.text!, { x: margin, y: h * (portrait ? 0.25 : 0.18), width, height: h * (portrait ? 0.34 : 0.4) }, scene.fontSize ?? (portrait ? 106 : 138), 60, portrait ? 4 : 2, 'center');
    scene.labelLayout = fitText(scene.label!, { x: margin + 32, y: h * 0.64, width: width - 64, height: h * 0.1 }, portrait ? 42 : 48, 30, 2, 'center', 400);
  }
  if (scene.type === 'product_zoom') scene.captionLayout = fitText(scene.caption!, { x: margin, y: h * (portrait ? 0.13 : 0.18), width: portrait ? width : width * 0.35, height: h * (portrait ? 0.2 : 0.62) }, scene.fontSize ?? (portrait ? 72 : 90), 48, portrait ? 3 : 5);
  }
  for (const caption of scene.resolvedCaptions ?? []) captionLayouts.set(`${scene.id}:${caption.startFrame}`, fitText(caption.text, { x: margin + 24, y: h * (spec.video.style === 'kinetic' ? 0.815 : 0.83), width: width - 48, height: h * (spec.video.style === 'kinetic' ? 0.075 : 0.105) }, portrait ? 40 : 42, 30, spec.video.style === 'kinetic' ? 2 : portrait ? 3 : 2, 'center', 400));
}
function roundedRect(x: number, y: number, w: number, h: number, radius: number) { ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); }
function textBlock(layout: TextLayout, local: number, duration: number, highlight?: string, weight = 700, animate = true) {
  animate = animate && duration >= 24;
  ctx.font = `${weight} ${layout.fontSize}px StudioSans`; ctx.textBaseline = 'top';
  const exit = 1 - ease((local - (duration - 12)) / 12);
  const highlightWords = new Set(highlight?.split(/\s+/) ?? []);
  layout.lines.forEach((line, index) => {
    const entry = animate ? ease((local - Math.min(index * 4, Math.max(0, duration - 20))) / Math.min(18, Math.max(4, duration / 3))) : 1;
    const lineWidth = ctx.measureText(line).width;
    let x = layout.align === 'center' ? layout.x + (layout.width - lineWidth) / 2 : layout.x;
    const y = layout.y + index * layout.lineHeight + (animate ? mix(56, 0, entry) : 0);
    ctx.globalAlpha = entry * (animate ? exit : 1);
    for (const word of line.split(' ')) {
      ctx.fillStyle = highlightWords.has(word) ? spec.brand.accent : spec.brand.foreground;
      ctx.fillText(word, x, y); x += ctx.measureText(`${word} `).width;
    }
  });
  ctx.globalAlpha = 1;
}
function background(local: number, scene: ResolvedScene) {
  const { width: w, height: h } = spec;
  ctx.fillStyle = spec.brand.background; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = spec.brand.foreground; ctx.globalAlpha = spec.brand.theme === 'light' ? 0.04 : 0.055; ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 108) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 108) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.globalAlpha = 1;
  const margin = w * (spec.video.safeArea ?? 0.09);
  ctx.fillStyle = spec.brand.accent; ctx.fillRect(margin, h * 0.09, 80 * ease((local + 1) / 18), 8);
  ctx.globalAlpha = 0.26; ctx.fillStyle = spec.brand.foreground; ctx.fillRect(margin, h * 0.94, w - 2 * margin, 2);
  ctx.globalAlpha = 1; ctx.fillStyle = spec.brand.accent; ctx.fillRect(margin, h * 0.94, (w - 2 * margin) * (local + 1) / scene.durationFrames, 2);
}
function product(scene: ResolvedScene, local: number) {
  textBlock(scene.captionLayout!, local, scene.durationFrames);
  const { width: w, height: h } = spec; const portrait = w < h;
  const margin = w * (spec.video.safeArea ?? 0.09);
  const availableWidth = w - 2 * margin;
  const area = portrait
    ? { x: margin, y: h * 0.4, w: availableWidth, h: h * 0.36 }
    : { x: margin + availableWidth * 0.4, y: h * 0.18, w: availableWidth * 0.6, h: h * 0.62 };
  const image = images[scene.asset!];
  const fit = Math.min((area.w - 24) / image.naturalWidth, (area.h - 24) / image.naturalHeight);
  const cardWidth = scene.fit === 'cover' ? area.w : image.naturalWidth * fit + 24;
  const cardHeight = scene.fit === 'cover' ? area.h : image.naturalHeight * fit + 24;
  const box = { x: area.x + (area.w - cardWidth) / 2, y: area.y + (area.h - cardHeight) / 2, w: cardWidth, h: cardHeight };
  const entry = scene.durationFrames < 24 ? 1 : ease((local - 5) / Math.min(20, Math.max(4, scene.durationFrames / 3)));
  const exit = scene.durationFrames < 24 ? 1 : 1 - ease((local - (scene.durationFrames - 10)) / 10);
  ctx.save(); ctx.globalAlpha = entry * exit;
  ctx.translate(w / 2, box.y + box.h / 2 + mix(50, 0, entry));
  const zoom = mix(0.96, 1, entry) * mix(1, 1.04, ease(local / Math.max(1, scene.durationFrames - 1)));
  ctx.scale(zoom, zoom); ctx.translate(-w / 2, -(box.y + box.h / 2));
  ctx.fillStyle = spec.brand.theme === 'dark' ? '#FFFFFF' : '#FFFFFF'; roundedRect(box.x, box.y, box.w, box.h, 28); ctx.fill();
  roundedRect(box.x + 12, box.y + 12, box.w - 24, box.h - 24, 20); ctx.clip();
  const inner = { x: box.x + 12, y: box.y + 12, w: box.w - 24, h: box.h - 24 };
  const ratio = scene.fit === 'cover' ? Math.max(inner.w / image.naturalWidth, inner.h / image.naturalHeight) : Math.min(inner.w / image.naturalWidth, inner.h / image.naturalHeight);
  const iw = image.naturalWidth * ratio, ih = image.naturalHeight * ratio;
  const focal = scene.focalPoint ?? { x: 0.5, y: 0.5 };
  const x = inner.x + (scene.fit === 'cover' ? Math.max(inner.w - iw, Math.min(0, inner.w / 2 - iw * focal.x)) : (inner.w - iw) / 2);
  const y = inner.y + (scene.fit === 'cover' ? Math.max(inner.h - ih, Math.min(0, inner.h / 2 - ih * focal.y)) : (inner.h - ih) / 2);
  ctx.drawImage(image, x, y, iw, ih); ctx.restore();
}
function drawFrame(frameIndex: number) {
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= spec.totalFrames) throw new Error(`FRAME_OUT_OF_RANGE: ${frameIndex}`);
  ctx.resetTransform(); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.globalAlpha = 1;
  const scene = spec.scenes.find(candidate => frameIndex >= candidate.startFrame && frameIndex < candidate.endFrame)!;
  const local = frameIndex - scene.startFrame;
  ctx.save();
  if (scene.type === 'composition') drawComposition(ctx, spec, scene, images, local);
  else if (spec.video.style === 'kinetic') drawKineticFrame(ctx, spec, images, frameIndex);
  else { background(local, scene);
  if (scene.type === 'kinetic_title') {
    textBlock(scene.layout!, local, scene.durationFrames, scene.highlight); if (scene.labelLayout) textBlock(scene.labelLayout, local, scene.durationFrames, undefined, 400);
    const layout = scene.layout!;
    ctx.fillStyle = spec.brand.accent; ctx.globalAlpha = 1 - ease((local - (scene.durationFrames - 12)) / 12);
    ctx.fillRect(layout.x, layout.y + layout.height + 36, 180 * ease((local - 22) / 18), 8);
  } else if (scene.type === 'product_zoom') product(scene, local);
  else {
    textBlock(scene.layout!, local, scene.durationFrames);
    const label = scene.labelLayout!;
    const opacity = ease((local - 14) / 16) * (1 - ease((local - (scene.durationFrames - 10)) / 10));
    ctx.globalAlpha = opacity; ctx.strokeStyle = spec.brand.accent; ctx.lineWidth = 3; roundedRect(label.x - 20, label.y - 20, label.width + 40, label.height + 40, 26); ctx.stroke();
    textBlock(label, local - 10, scene.durationFrames - 10, undefined, 400);
  }
  }
  const caption = scene.resolvedCaptions?.find(value => frameIndex >= value.startFrame && frameIndex < value.endFrame);
  if (caption) {
    const layout = captionLayouts.get(`${scene.id}:${caption.startFrame}`)!;
    ctx.globalAlpha = 0.9; ctx.fillStyle = spec.brand.background; roundedRect(layout.x - 20, layout.y - 14, layout.width + 40, layout.height + 28, 16); ctx.fill(); ctx.globalAlpha = 1;
    textBlock(layout, local, scene.durationFrames, undefined, 400, false);
  }
  ctx.restore();
}
async function initialize(value: ResolvedSpec) {
  spec = value; canvas.width = value.width; canvas.height = value.height;
  await Promise.all([document.fonts.load('700 120px StudioSans', 'АБВГД Казахстан Hello'), document.fonts.load('400 42px StudioSans', 'Русский English')]);
  await document.fonts.ready;
  if (!document.fonts.check('700 120px StudioSans', 'Русский')) throw new Error('FONT_LOAD_FAILED');
  if (spec.video.style === 'kinetic') {
    await document.fonts.load('700 180px StudioDisplay', 'АБВГД Казахстан Hello');
    if (!document.fonts.check('700 180px StudioDisplay', 'Русский')) throw new Error('FONT_LOAD_FAILED: display');
  }
  await Promise.all(Object.entries(spec.assets).filter(([, asset]) => asset.type === 'image').map(async ([id]) => {
    const image = new Image(); image.src = `/assets/${encodeURIComponent(id)}`; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error(`IMAGE_DECODE_FAILED: ${id}`); images[id] = image;
  }));
  for (const scene of spec.scenes) { layouts(scene); if (scene.type === 'composition') validateCompositionLayout(ctx, scene); }
  if (spec.video.style === 'kinetic') kineticLayouts(ctx, spec);
  return { scenes: spec.scenes, captionLayouts: Array.from(captionLayouts.entries()) };
}
function renderSheet(indices: number[]) {
  const cols = 3, thumbWidth = spec.width < spec.height ? 270 : 480, thumbHeight = Math.round(thumbWidth * spec.height / spec.width), labelHeight = 34;
  const sheet = document.createElement('canvas'); sheet.width = cols * thumbWidth; sheet.height = Math.ceil(indices.length / cols) * (thumbHeight + labelHeight);
  const target = sheet.getContext('2d')!; target.fillStyle = '#171923'; target.fillRect(0, 0, sheet.width, sheet.height);
  indices.forEach((frame, index) => { drawFrame(frame); const x = index % cols * thumbWidth, y = Math.floor(index / cols) * (thumbHeight + labelHeight); target.drawImage(canvas, x, y, thumbWidth, thumbHeight); target.fillStyle = '#FFFFFF'; target.font = '16px StudioSans'; target.fillText(`frame ${frame} · ${(frame / 30).toFixed(2)}s`, x + 12, y + thumbHeight + 24); });
  return sheet.toDataURL('image/jpeg', 0.92);
}
(window as unknown as { studio: unknown }).studio = { initialize, renderFrame(frameIndex: number) { drawFrame(frameIndex); return canvas.toDataURL('image/png'); }, renderSheet };
