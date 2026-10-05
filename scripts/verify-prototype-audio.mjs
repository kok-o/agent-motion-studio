import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findTools, runProcess } from '../dist/runtime.js';
const latest = JSON.parse(await readFile('artifacts/prototype/latest-run.json', 'utf8'));
const acceptance = JSON.parse(await readFile(join(latest.runDir, 'acceptance.json'), 'utf8'));
const original = join(latest.runDir, 'editable-project/exports', acceptance.checks.export_original.id);
const tools = findTools();
async function samples(file, name) {
  const target = join(latest.runDir, `${name}.f32`);
  await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_f32le', '-f', 'f32le', target]);
  const bytes = await readFile(target); return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
const mixed = await samples(join(original, 'mixed.wav'), 'mix-reference');
const decoded = await samples(join(original, 'output.mp4'), 'aac-decoded');
assert.equal(mixed.length, 20 * 48000); assert.ok(Math.abs(decoded.length - mixed.length) <= 1024);
let peak = 0, energy = 0;
for (const sample of decoded) { peak = Math.max(peak, Math.abs(sample)); energy += sample * sample; }
assert.ok(peak > .005 && peak < .99); assert.ok(Math.sqrt(energy / decoded.length) > .001);
const windows = [];
for (const seconds of [1, 3, 6, 10, 16, 19]) {
  const start = seconds * 48000; let best = { correlation: -1, offsetSamples: 0 };
  for (let offset = -48; offset <= 48; offset++) {
    let xy = 0, xx = 0, yy = 0;
    for (let i = start; i < start + 4800; i += 3) { const x = mixed[i], y = decoded[i + offset]; xy += x * y; xx += x * x; yy += y * y; }
    const correlation = xy / Math.sqrt(xx * yy);
    if (correlation > best.correlation) best = { correlation, offsetSamples: offset };
  }
  assert.ok(best.correlation > .97, `Audio correspondence at ${seconds}s`); assert.ok(Math.abs(best.offsetSamples) <= 2, `Audio drift at ${seconds}s`);
  windows.push({ seconds, ...best, offsetMs: best.offsetSamples / 48 });
}
const report = { passed: true, source: 'actual mixed.wav vs decoded AAC', sampleRate: 48000, durationSeconds: 20, decodedPeak: peak, decodedRms: Math.sqrt(energy / decoded.length), windows, subjectiveListening: 'NOT PERFORMED; automated amplitude/correlation checks are not a listening review' };
await writeFile(join(latest.runDir, 'audio-verification.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
