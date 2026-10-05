import { mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { launchBrowser, findTools, runProcess } from '../dist/runtime.js';
import { kineticGrooveWav } from '../dist/audio.js';

// Original procedural footage, image and composition, authored for this prototype.
// This is a synthetic visual fixture, not a filmed or AI-generated product.
const dir = resolve('examples/orbit-sources'); await mkdir(dir, { recursive: true });
const tools = findTools(), browser = await launchBrowser(tools.chrome);
const page = await browser.newPage(); await page.setContent('<canvas></canvas>');
await page.evaluate(() => {
  window.drawOrbit = ({ width, height, frame, fps, variant }) => {
    const canvas = document.querySelector('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'), t = frame / fps, amber = variant === 'amber', wide = variant === 'wide';
    const w = width, h = height, cx = w * (wide ? 0.47 : 0.54), cy = h * (wide ? 0.47 : 0.51), radius = Math.min(w, h) * (wide ? 0.23 : 0.29) * (1 + t * 0.009);
    const accent = amber ? '#F5B363' : '#B6EED7', dark = amber ? '#382819' : '#153036';
    const bg = ctx.createRadialGradient(cx, cy, 10, cx, cy, w * .8); bg.addColorStop(0, dark); bg.addColorStop(1, '#080F12'); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    // Deterministic particles keep trim boundaries observable without clock labels.
    for (let i = 0; i < 100; i++) {
      const x = ((Math.sin(i * 127.1) * 43758.5453 % 1 + 1) * w + t * (amber ? 30 : 7)) % w;
      const y = ((Math.cos(i * 74.7) * 13758.5453 % 1 + 1) * h + t * (amber ? -5 : 2) + h) % h;
      ctx.fillStyle = accent; ctx.globalAlpha = .08 + (i % 4) * .025; ctx.fillRect(x, y, i % 3 === 0 ? 2 : 1, 1);
    }
    ctx.globalAlpha = 1;
    const halo = ctx.createRadialGradient(cx, cy, radius * .7, cx, cy, radius * 1.75); halo.addColorStop(0, amber ? '#F5B36333' : '#B6EED733'); halo.addColorStop(1, '#00000000'); ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
    // Floor reflection / contact shadow.
    ctx.save(); ctx.translate(cx, cy + radius * 1.30); ctx.scale(1, .16);
    const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 1.4); shadow.addColorStop(0, '#000000dd'); shadow.addColorStop(1, '#00000000'); ctx.fillStyle = shadow; ctx.beginPath(); ctx.arc(0, 0, radius * 1.4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    function ring(back) {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-.45 + Math.sin(t * .24) * .08);
      ctx.scale(1, .32 + Math.sin(t * .3) * .05); ctx.lineWidth = Math.max(1, radius * .024); ctx.strokeStyle = accent; ctx.globalAlpha = back ? .24 : .8;
      ctx.beginPath(); ctx.ellipse(0, 0, radius * 1.53, radius * 1.53, 0, back ? Math.PI : 0, back ? Math.PI * 2 : Math.PI); ctx.stroke(); ctx.restore();
    }
    ring(true);
    const sphere = ctx.createRadialGradient(cx - radius * .42, cy - radius * .5, radius * .03, cx, cy, radius * 1.14);
    sphere.addColorStop(0, amber ? '#DDD1B1' : '#C1D6CF'); sphere.addColorStop(.24, amber ? '#887352' : '#638381'); sphere.addColorStop(.65, '#253637'); sphere.addColorStop(1, '#081011');
    ctx.fillStyle = sphere; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = '#091819'; ctx.lineWidth = Math.max(1, radius * .008);
    for (let i = 0; i < 11; i++) {
      const longitude = i / 11 * Math.PI * 2 + t * .18;
      ctx.globalAlpha = .35;
      ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(.1, Math.abs(Math.sin(longitude)) * radius), radius, .18, Math.PI / 2, Math.PI * 1.5); ctx.stroke();
    }
    for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.ellipse(cx, cy + i * radius * .25, radius * Math.sqrt(1 - (i * .25) ** 2), radius * .11, -.08, 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = .9; ctx.strokeStyle = accent; ctx.lineWidth = radius * .015;
    ctx.beginPath(); ctx.ellipse(cx + Math.sin(t * .45) * radius * .45, cy, radius * .16, radius * .93, .15, 0, Math.PI * 2); ctx.stroke();
    ctx.restore(); ring(false);
    // Tiny design identifiers are authored graphics, not an invented product UI.
    ctx.fillStyle = accent; ctx.globalAlpha = .7; ctx.font = `${Math.round(h * .022)}px monospace`;
    ctx.fillText(amber ? 'ORBIT / AMBER' : wide ? 'ORBIT / FIELD' : 'ORBIT / JADE', w * .055, h * .89);
    ctx.fillStyle = '#D7E3DB'; ctx.globalAlpha = .4; ctx.font = `${Math.round(h * .017)}px monospace`; ctx.fillText('SYNTHETIC OBJECT STUDY', w * .055, h * .93); ctx.globalAlpha = 1;
    return canvas.toDataURL('image/png').split(',')[1];
  };
});
try {
  for (const [name, width, height, fps, duration, variant] of [
    ['jade.mp4', 960, 540, 24, 9, 'jade'], ['amber.mp4', 960, 540, 60, 9, 'amber'], ['field.mp4', 720, 720, 25, 8, 'wide']
  ]) {
    try { if ((await stat(join(dir, name))).size > 10000) { console.log(`Keeping ${name}`); continue; } } catch {}
    const frames = join(dir, `.frames-${variant}`); await mkdir(frames, { recursive: true });
    try {
      for (let frame = 0; frame < fps * duration; frame++) {
        const png = await page.evaluate(args => window.drawOrbit(args), { width, height, fps, frame, variant });
        await writeFile(join(frames, `${String(frame).padStart(5, '0')}.png`), Buffer.from(png, 'base64'));
      }
      await runProcess(tools.ffmpeg, ['-y','-v','error','-threads','1','-framerate',String(fps),'-i',join(frames,'%05d.png'),'-c:v','libx264','-threads','2','-preset','medium','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',join(dir,name)]);
      console.log(`Created ${name}: ${width}x${height}, ${fps} fps, ${duration}s`);
    } finally { await rm(frames, { recursive: true, force: true }); }
  }
  const png = await page.evaluate(args => window.drawOrbit(args), { width: 1200, height: 900, fps: 30, frame: 100, variant: 'wide' });
  await writeFile(join(dir, 'orbit.png'), Buffer.from(png, 'base64'));
  await writeFile(join(dir, 'orbit-score.wav'), kineticGrooveWav(20, 7, [0, 90, 300, 480]));
  await writeFile(join(dir, 'PROVENANCE.md'), '# ORBIT synthetic fixture\n\nAll footage, the still image and music were procedurally authored in this workspace for the 5 October 2026 prototype. No stock media, external API, AI video model or third-party music was used. Visual source: scripts/create-orbit-sources.mjs; musical source: src/audio.ts (kineticGrooveWav). These original assets may be used, modified and redistributed under the repository MIT license. They are synthetic technical/demo fixtures and do not prove artistic quality or demand.\n\nJade: 960x540, 24 fps, 9 s. Amber alternative: 960x540, 60 fps, 9 s. Field: 720x720, 25 fps, 8 s. Still: 1200x900 PNG. Music: original 20-second stereo PCM score. Source video has no audio.\n');
} finally { await browser.close(); }
