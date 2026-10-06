import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { render } from '../../dist/engine.js';
import { hashBytes } from '../../dist/spec.js';
import { findTools, runProcess } from '../../dist/runtime.js';

test('source mutation during a full export refuses publication and preserves the previous output', { timeout: 90000 }, async () => {
  const root = resolve('artifacts/generation/source-mutation', randomUUID());
  await mkdir(root, { recursive: true });
  const tools = findTools(), source = join(root, 'source.mp4'), replacement = join(root, 'replacement.mp4');
  for (const [file, color] of [[source, 'red'], [replacement, 'blue']]) {
    await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=160x90:r=30:d=1`, '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', file]);
  }
  const manifest = JSON.parse(await readFile('examples/smoke/manifest.json', 'utf8'));
  manifest.schemaVersion = 2;
  manifest.assets = { clip: { type: 'video', path: 'source.mp4', sha256: hashBytes(await readFile(source)) } };
  manifest.scenes = [{ id: 'shot', type: 'video', asset: 'clip', durationFrames: 30, trimStartSeconds: 0, fit: 'cover' }];
  manifest.audio = { narration: { provider: 'none' }, music: { provider: 'none' } };
  const file = join(root, 'project.json'), output = join(root, 'export');
  await writeFile(file, JSON.stringify(manifest));
  await render(file, output, { noCache: true });
  const beforeOutput = await readFile(join(output, 'output.mp4')), beforeReport = await readFile(join(output, 'render-report.json'));
  let mutated = false;
  const attempt = render(file, output, { noCache: true, overwrite: true, progress(message) {
    if (!mutated && message.startsWith('Scene 1/')) { copyFileSync(replacement, source); mutated = true; }
  } });
  await assert.rejects(attempt, error => error.code === 'SOURCE_CHANGED');
  assert.equal(mutated, true, 'mutation occurred after source validation and before encoding');
  assert.ok((await readFile(join(output, 'output.mp4'))).equals(beforeOutput));
  assert.ok((await readFile(join(output, 'render-report.json'))).equals(beforeReport));
  await copyFile(replacement, join(root, 'mutated-source.mp4'));
  // Cached bytes are also refused if the accepted source changes after lookup.
  await writeFile(source, await readFile(join(root, 'mutated-source.mp4')));
  manifest.assets.clip.sha256 = hashBytes(await readFile(source));
  await writeFile(file, JSON.stringify(manifest));
  const cacheBaseline = await render(file, output, { overwrite: true });
  manifest.operationReceipts = [{ operationId: 'metadata-only', requestHash: 'a'.repeat(64), revisionId: 'older-revision' }];
  await writeFile(file, JSON.stringify(manifest));
  const metadataOnly = await render(file, output, { overwrite: true });
  assert.equal(metadataOnly.fingerprint, cacheBaseline.fingerprint, 'accepted operation receipts are not render inputs');
  assert.equal(metadataOnly.cache.status, 'hit');
  const cachedOutput = await readFile(join(output, 'output.mp4')), cachedReport = await readFile(join(output, 'render-report.json'));
  let mutatedCache = false;
  const cachedAttempt = render(file, output, { overwrite: true, progress(message) {
    if (!mutatedCache && message.startsWith('Verified cache integrity')) { writeFileSync(source, Buffer.concat([readFileSync(source), Buffer.from('mutated')])); mutatedCache = true; }
  } });
  await assert.rejects(cachedAttempt, error => error.code === 'SOURCE_CHANGED');
  assert.equal(mutatedCache, true, 'mutation occurred after cache lookup');
  assert.ok((await readFile(join(output, 'output.mp4'))).equals(cachedOutput));
  assert.ok((await readFile(join(output, 'render-report.json'))).equals(cachedReport));
  await writeFile(join(root, 'verification.json'), JSON.stringify({ passed: true, scenarios: ['source changed after loadManifest during full export', 'source changed during verified cache hit', 'operation receipts do not change render fingerprint/cache'], expectedError: 'SOURCE_CHANGED', previousOutputPreserved: true, previousReportPreserved: true }, null, 2));
});
