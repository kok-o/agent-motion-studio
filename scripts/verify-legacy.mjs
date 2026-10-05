import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { render, validateForRender } from '../dist/engine.js';
const root = resolve('artifacts/prototype/legacy-v1'); await mkdir(root, { recursive: true });
const report = { status: 'running', cases: [], onlineRequests: 0 };
for (const name of ['smoke', 'repo-promo', 'product-ad', 'feature-explainer', 'kinetic-promo']) {
  const file = resolve('examples', name, 'manifest.json');
  if (JSON.parse(await readFile(file, 'utf8')).audio.narration.provider === 'edge') throw new Error('This is an offline verification.');
  const validated = await validateForRender(file);
  const output = await render(file, join(root, name), { overwrite: true, noCache: true, progress: message => console.error(`${name}: ${message}`) });
  report.cases.push({ name, validation: validated.valid, frames: output.totalFrames, elapsedSeconds: output.elapsedSeconds, verification: output.verification });
  await writeFile(join(root, 'verification.json'), JSON.stringify(report, null, 2)); console.log(`PASS ${name}`);
}
report.status = 'passed'; await writeFile(join(root, 'verification.json'), JSON.stringify(report, null, 2));
