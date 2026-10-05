import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadManifest } from '../dist/spec.js';
import { openRenderer } from '../dist/browser.js';
import { findTools } from '../dist/runtime.js';
import { prepareAudio } from '../dist/audio.js';

const manifest = process.argv[2] || 'examples/kinetic-promo/manifest.json';
const output = path.resolve(process.argv[3] || 'artifacts/quality-v2/preflight');
await mkdir(output, { recursive: true });
const spec = await loadManifest(manifest), tools = findTools();
if (spec.audio.narration.provider !== 'none') {
  const audio = path.join(output, 'audio'); await mkdir(audio, { recursive: true });
  await prepareAudio(spec, audio, tools); // Resolve the actual caption regions before inspection.
}
const renderer = await openRenderer(spec, tools.chrome);
try {
  const settled = renderer.spec.scenes.map(scene => scene.startFrame + Math.floor(scene.durationFrames / 2));
  const cuts = renderer.spec.scenes.slice(1).flatMap(scene => [scene.startFrame - 1, scene.startFrame, scene.startFrame + 8, scene.startFrame + 16]);
  await renderer.sheet(settled, path.join(output, 'shots.jpg'));
  await renderer.sheet(cuts, path.join(output, 'transitions.jpg'));
  for (const frame of [0, ...settled, renderer.spec.totalFrames - 1]) await writeFile(path.join(output, `frame-${frame}.png`), await renderer.frame(frame));
  await writeFile(path.join(output, 'layout.json'), JSON.stringify(renderer.spec, null, 2));
  console.log(JSON.stringify({ output, settled, cuts }));
} finally { await renderer.finish(); }
