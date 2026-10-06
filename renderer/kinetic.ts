import type { ResolvedSpec, ResolvedScene, TextLayout } from '../src/types.js';

// Original Canvas recipes. Positions, reveals, camera moves and transitions are
// functions of the requested frame, including when frames are rendered out of order.
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const expo = (n: number) => n <= 0 ? 0 : n >= 1 ? 1 : 1 - 2 ** (-9 * n);
const smooth = (n: number) => { const k = clamp(n); return k * k * (3 - 2 * k); };
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
type Box = { x: number; y: number; w: number; h: number };

function fit(ctx: CanvasRenderingContext2D, text: string, box: Box, maximum: number, maxLines: number, display = true): TextLayout {
  const paragraphs = text.split('\n').filter(value => value.trim());
  // Explicit line breaks are an authoring decision. Reduce the font rather than
  // inserting an extra orphan line into a two-line poster composition.
  const lineLimit = paragraphs.length > 1 ? Math.min(maxLines, paragraphs.length) : maxLines;
  for (let size = maximum; size >= Math.min(maximum, display ? 60 : 28); size -= 2) {
    ctx.font = `${display ? 700 : 400} ${size}px ${display ? 'StudioDisplay' : 'StudioSans'}`;
    const lines: string[] = []; let impossible = false;
    for (const paragraph of paragraphs) {
      let line = '';
      for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
        if (ctx.measureText(word).width > box.w) { impossible = true; break; }
        const candidate = line ? `${line} ${word}` : word;
        if (ctx.measureText(candidate).width <= box.w) line = candidate;
        else { lines.push(line); line = word; }
      }
      if (line) lines.push(line);
    }
    const lineHeight = Math.ceil(size * 1.2);
    if (!impossible && lines.length <= lineLimit && lines.length * lineHeight <= box.h) {
      return { lines, fontSize: size, lineHeight, x: box.x, y: box.y + (box.h - lines.length * lineHeight) / 2, width: box.w, height: lines.length * lineHeight, align: 'left' };
    }
  }
  throw new Error(`TEXT_OVERFLOW: kinetic heading needs shorter copy: "${text.slice(0, 80)}"`);
}

export function kineticLayouts(ctx: CanvasRenderingContext2D, spec: ResolvedSpec) {
  const { width: w, height: h } = spec, portrait = w < h;
  const margin = w * (spec.video.safeArea ?? (portrait ? 0.08 : 0.075));
  for (const scene of spec.scenes) {
    if (scene.type === 'video' || scene.type === 'composition') continue;
    if (scene.type === 'kinetic_title' || scene.type === 'cta') {
      scene.layout = fit(ctx, spec.schemaVersion === 1 ? scene.text!.toLocaleUpperCase('ru-RU') : scene.text!, {
        x: margin, y: h * (portrait ? 0.19 : 0.18), w: w - margin * 2, h: h * (portrait ? 0.46 : 0.52),
      }, scene.fontSize ?? (portrait ? 248 : 286), portrait ? 4 : 3);
      if (scene.label) scene.labelLayout = fit(ctx, scene.label!, {
        x: margin + 30, y: h * (scene.type === 'kinetic_title' ? 0.68 : scene.resolvedCaptions?.length ? 0.68 : portrait ? 0.71 : 0.76), w: w - 2 * margin - (portrait ? 128 : w * 0.30), h: h * (scene.resolvedCaptions?.length ? 0.065 : 0.09),
      }, portrait ? 38 : 36, 2, false);
    } else {
      scene.captionLayout = fit(ctx, scene.caption!.toLocaleUpperCase('ru-RU'), {
        x: margin, y: h * (portrait ? 0.11 : 0.2), w: portrait ? w - margin * 2 : w * 0.35, h: h * (portrait ? 0.22 : 0.52),
      }, scene.fontSize ?? (portrait ? 124 : 162), portrait ? 3 : 4);
    }
  }
}

function onAccent(color: string) {
  const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return luminance > 0.179 ? '#101110' : '#FFFFFF';
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, angle: number, color: string, alpha = 1) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  for (let i = 0; i < 8; i++) {
    ctx.rotate(Math.PI / 8); ctx.fillRect(-radius, -radius * 0.105, radius * 2, radius * 0.21);
  }
  ctx.restore();
}

function dotField(ctx: CanvasRenderingContext2D, spec: ResolvedSpec, local: number, color: string) {
  const { width: w, height: h } = spec, portrait = w < h, seconds = local / 30;
  ctx.save(); ctx.fillStyle = color;
  for (let row = 0; row < 20; row++) for (let col = 0; col < 34; col++) {
    const u = col / 33, v = row / 19;
    const wave = Math.sin(u * 8 + v * 5 - seconds * 1.9 + spec.seed * 0.2);
    const x = u * w;
    const y = h * (portrait ? 0.65 : 0.62) + v * h * 0.39 + wave * h * 0.025 * (1 - v);
    ctx.globalAlpha = (0.09 + 0.2 * (wave + 1) / 2) * Math.min(1, v * 4);
    ctx.beginPath(); ctx.arc(x, y, (portrait ? 1.4 : 1.8) + v * 1.4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function type(ctx: CanvasRenderingContext2D, layout: TextLayout, local: number, color: string, accent: string, highlight?: string, duration = 90, preserveCase = false) {
  const words = new Set((preserveCase ? highlight : highlight?.toLocaleUpperCase('ru-RU'))?.split(/\s+/) ?? []);
  ctx.font = `700 ${layout.fontSize}px StudioDisplay`; ctx.textBaseline = 'top';
  layout.lines.forEach((line, row) => {
    const y = layout.y + row * layout.lineHeight;
    // A low contrast outline leaves a visual anchor even on the first frame.
    ctx.save(); ctx.globalAlpha = 0.15; ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.strokeText(line, layout.x, y); ctx.restore();
    let charIndex = 0, letter = 0;
    const inkAbove = Math.max(6, ctx.measureText(line).actualBoundingBoxAscent);
    ctx.save(); ctx.beginPath(); ctx.rect(layout.x - 4, y - inkAbove, layout.width + 8, layout.lineHeight + inkAbove + 12); ctx.clip();
    for (const word of line.split(' ')) {
      for (const char of word) {
        // Position each letter using whole-prefix metrics, retaining pair kerning.
        const x = layout.x + ctx.measureText(line.slice(0, charIndex) + char).width - ctx.measureText(char).width;
        const delay = Math.min(row * 3 + letter * 0.35, Math.max(0, duration / 5));
        const k = duration < 24 ? 1 : expo((local - delay + 1) / Math.min(13, duration / 3));
        ctx.save(); ctx.globalAlpha = k; ctx.fillStyle = words.has(word) ? accent : color;
        ctx.fillText(char, x, y + layout.fontSize * (1 - k)); ctx.restore();
        charIndex += char.length; letter++;
      }
      charIndex++;
    }
    ctx.restore();
  });
}

function hud(ctx: CanvasRenderingContext2D, spec: ResolvedSpec, scene: ResolvedScene, frame: number, color: string) {
  const { width: w, height: h } = spec, portrait = w < h;
  const margin = w * (spec.video.safeArea ?? (portrait ? 0.08 : 0.075));
  const index = spec.scenes.indexOf(scene);
  ctx.save(); ctx.fillStyle = color; ctx.strokeStyle = color; ctx.globalAlpha = 0.65;
  ctx.font = `400 ${portrait ? 26 : 22}px StudioSans`; ctx.textBaseline = 'top';
  ctx.fillText(spec.schemaVersion === 2 ? scene.id : `${String(index + 1).padStart(2, '0')} / ${String(spec.scenes.length).padStart(2, '0')}`, margin, h * 0.055);
  ctx.lineWidth = 2;
  const corners = [[margin, h * 0.04, 1, 1], [w - margin, h * 0.04, -1, 1], [margin, h * 0.94, 1, -1], [w - margin, h * 0.94, -1, -1]];
  for (const [x, y, dx, dy] of corners) {
    ctx.beginPath(); ctx.moveTo(x + dx * 18, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * 18); ctx.stroke();
  }
  const width = w - 2 * margin, gap = 8;
  for (const item of spec.schemaVersion === 2 ? [scene] : spec.scenes) {
    const x = spec.schemaVersion === 2 ? margin : margin + width * item.startFrame / spec.totalFrames;
    const length = spec.schemaVersion === 2 ? width : width * item.durationFrames / spec.totalFrames - gap;
    if (length <= 0) continue;
    ctx.globalAlpha = 0.16; ctx.fillRect(x, h * 0.91, length, 4);
    ctx.globalAlpha = 0.9; ctx.fillRect(x, h * 0.91, length * clamp((frame - item.startFrame + 1) / item.durationFrames), 4);
  }
  ctx.restore();
}

function productBox(spec: ResolvedSpec, scene: ResolvedScene): Box {
  const { width: w, height: h } = spec;
  return w < h ? { x: w * 0.065, y: h * 0.38, w: w * 0.87, h: h * (scene.resolvedCaptions?.length ? 0.40 : 0.43) }
    : { x: w * 0.48, y: h * 0.18, w: w * 0.47, h: h * (scene.resolvedCaptions?.length ? 0.57 : 0.62) };
}

function product(ctx: CanvasRenderingContext2D, spec: ResolvedSpec, scene: ResolvedScene, images: Record<string, HTMLImageElement>, local: number) {
  const { width: w, height: h } = spec, portrait = w < h;
  type(ctx, scene.captionLayout!, local, spec.brand.foreground, spec.brand.accent, undefined, scene.durationFrames);
  const image = images[scene.asset!], area = productBox(spec, scene);
  const fitRatio = scene.fit === 'cover' ? Math.max(area.w / image.naturalWidth, area.h / image.naturalHeight)
    : Math.min(area.w / image.naturalWidth, area.h / image.naturalHeight);
  // Contain never crops a screenshot. Cover intentionally moves the virtual camera
  // toward focalPoint; the bounded crop stays completely inside the source image.
  const size = scene.fit === 'cover' ? area : { ...area, w: image.naturalWidth * fitRatio, h: image.naturalHeight * fitRatio };
  const box = { ...size, x: area.x + (area.w - size.w) / 2, y: area.y + (area.h - size.h) / 2 };
  const entry = scene.durationFrames < 24 ? 1 : expo((local + 2) / 17);
  ctx.save(); ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
  const scale = mix(0.9, 1, entry); ctx.scale(scale, scale);
  ctx.rotate(Math.sin(local / 30 * 1.1) * 0.006 * (1 - Math.min(1, local / 24)));
  ctx.translate(-box.w / 2, -box.h / 2);
  ctx.shadowColor = '#000000'; ctx.shadowBlur = 42; ctx.shadowOffsetY = 18;
  ctx.fillStyle = spec.brand.background; ctx.beginPath(); ctx.roundRect(-5, -5, box.w + 10, box.h + 10, 22); ctx.fill();
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.beginPath(); ctx.roundRect(0, 0, box.w, box.h, 18); ctx.clip();
  const progress = scene.durationFrames < 24 ? 1 : smooth((local - 18) / Math.max(1, scene.durationFrames - 30));
  const zoom = scene.fit === 'cover' ? mix(1, 1.32, progress) : 1;
  const iw = image.naturalWidth * fitRatio * zoom, ih = image.naturalHeight * fitRatio * zoom;
  const point = scene.focalPoint ?? { x: 0.5, y: 0.5 };
  const fx = mix(0.5, point.x, progress), fy = mix(0.5, point.y, progress);
  const x = Math.max(box.w - iw, Math.min(0, box.w / 2 - iw * fx));
  const y = Math.max(box.h - ih, Math.min(0, box.h / 2 - ih * fy));
  ctx.drawImage(image, x, y, iw, ih);
  // A traveling edge reveals the actual supplied image rather than a white card.
  if (local < 20 && scene.durationFrames >= 24) {
    const reveal = expo((local + 1) / 20) * box.w;
    ctx.fillStyle = spec.brand.background; ctx.fillRect(reveal, 0, box.w - reveal, box.h);
    ctx.fillStyle = spec.brand.accent; ctx.fillRect(reveal - 3, 0, 3, box.h);
  }
  ctx.restore();
  // Contain communicates the whole material. Cover makes its focal point explicit.
  if (scene.fit === 'cover') {
    const k = scene.durationFrames < 24 ? 1 : expo((local - 24) / 14), r = (portrait ? 36 : 30) * (1 + Math.sin(local * Math.PI / 15) * 0.05);
    const px = box.x + x + iw * point.x, py = box.y + y + ih * point.y;
    ctx.save(); ctx.globalAlpha = k * 0.75; ctx.strokeStyle = spec.brand.accent; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
    // If the actual target is offscreen, show no displaced fake target. Edge
    // targets get clipped brackets centered on their real projected coordinate.
    for (const [dx, dy] of (px < box.x || px > box.x + box.w || py < box.y || py > box.y + box.h) ? [] : [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.beginPath(); ctx.moveTo(px + dx * r, py + dy * (r - 12)); ctx.lineTo(px + dx * r, py + dy * r); ctx.lineTo(px + dx * (r - 12), py + dy * r); ctx.stroke();
    }
    ctx.restore();
  }
  if (scene.resolvedCaptions?.length) return;
  ctx.save(); ctx.fillStyle = spec.brand.accent;
  const axisY = h * (portrait ? 0.855 : 0.85), axisX = w * (portrait ? 0.12 : 0.52), axisWidth = w * (portrait ? 0.76 : 0.37);
  ctx.globalAlpha = 0.22; ctx.fillRect(axisX, axisY, axisWidth, 2);
  ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(axisX + axisWidth * clamp(local / Math.max(1, scene.durationFrames - 1)), axisY, 6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function shot(ctx: CanvasRenderingContext2D, spec: ResolvedSpec, scene: ResolvedScene, images: Record<string, HTMLImageElement>, frame: number) {
  const { width: w, height: h } = spec, local = frame - scene.startFrame, portrait = w < h;
  const cta = scene.type === 'cta';
  const bg = cta ? spec.brand.accent : spec.brand.background, fg = cta ? onAccent(bg) : spec.brand.foreground;
  ctx.save(); ctx.globalAlpha = 1; ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  if (scene.type === 'product_zoom') product(ctx, spec, scene, images, local);
  else {
    if (!cta) {
      dotField(ctx, spec, local, spec.brand.accent);
      const layout = scene.layout!;
      ctx.save(); ctx.globalAlpha = 0.06; ctx.strokeStyle = fg; ctx.lineWidth = 1.5; ctx.font = `700 ${layout.fontSize}px StudioDisplay`; ctx.textBaseline = 'top';
      ctx.beginPath(); ctx.rect(0, h * 0.16, w, h * 0.62); ctx.clip();
      const echo = layout.lines.at(-1)!;
      ctx.strokeText(echo, layout.x, layout.y + layout.height + 18); ctx.restore();
    }
    type(ctx, scene.layout!, local, fg, spec.brand.accent, scene.highlight, scene.durationFrames, spec.schemaVersion === 2);
    const radius = w * (portrait ? 0.105 : 0.073);
    if (!scene.resolvedCaptions?.length) star(ctx, w * 0.78, h * (portrait ? cta ? 0.84 : 0.76 : 0.75), radius, local / 30 * 0.45, cta ? fg : spec.brand.accent);
    if (!cta && scene.labelLayout) {
      const label = scene.labelLayout;
      ctx.save(); ctx.globalAlpha = scene.durationFrames < 24 ? 1 : expo((local - 8) / 12); ctx.fillStyle = fg;
      ctx.font = `400 ${label.fontSize}px StudioSans`; ctx.textBaseline = 'top';
      label.lines.forEach((line, index) => ctx.fillText(line, label.x, label.y + label.lineHeight * index)); ctx.restore();
    }
    if (cta) {
      const label = scene.labelLayout!, k = scene.durationFrames < 24 ? 1 : expo((local - 8) / 12);
      ctx.save(); ctx.globalAlpha = k; ctx.fillStyle = fg;
      ctx.beginPath(); ctx.roundRect(label.x - 26, label.y - 20, label.width + 52, label.height + 40, 8); ctx.fill();
      ctx.fillStyle = bg; ctx.font = `400 ${label.fontSize}px StudioSans`; ctx.textBaseline = 'top';
      label.lines.forEach((line, index) => ctx.fillText(line, label.x, label.y + label.lineHeight * index)); ctx.restore();
    }
  }
  hud(ctx, spec, scene, frame, fg); ctx.restore();
}

export function drawKineticFrame(ctx: CanvasRenderingContext2D, spec: ResolvedSpec, images: Record<string, HTMLImageElement>, frame: number) {
  const index = spec.scenes.findIndex(scene => frame >= scene.startFrame && frame < scene.endFrame);
  const scene = spec.scenes[index], local = frame - scene.startFrame;
  const length = Math.min(16, Math.floor(scene.durationFrames / 3));
  if (spec.schemaVersion === 2 || index === 0 || length < 2 || local >= length) { shot(ctx, spec, scene, images, frame); return; }
  // Freeze the outgoing composition. The new scene is fully rendered behind a
  // deterministic clip; there is no opacity dip or blank boundary frame.
  const previous = spec.scenes[index - 1];
  shot(ctx, spec, previous, images, previous.endFrame - 1);
  const k = smooth(local / (length - 1)), { width: w, height: h } = spec;
  ctx.save(); ctx.beginPath();
  if (scene.type === 'cta') {
    const x = w * 0.78, y = h * (w < h ? 0.76 : 0.75);
    const radius = Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) * k;
    ctx.arc(x, y, Math.max(0, radius), 0, Math.PI * 2);
  } else {
    // Staggered horizontal bands reveal different regions of the supplied UI.
    const bands = 6;
    for (let i = 0; i < bands; i++) {
      const reveal = smooth((k - i * 0.045) / (1 - i * 0.045));
      ctx.rect(0, h / bands * i, w * reveal, h / bands + 1);
    }
  }
  ctx.clip(); shot(ctx, spec, scene, images, frame); ctx.restore();
}
