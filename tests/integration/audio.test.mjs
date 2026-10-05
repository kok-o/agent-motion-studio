import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { loadManifest } from '../../dist/spec.js';
import { findTools } from '../../dist/runtime.js';
import { prepareAudio, proceduralWav, audioDuration } from '../../dist/audio.js';

test('local speech longer than its scene is rejected before any frames; file music is a measured exact-length mix', async () => {
  const project = path.resolve('.cache/tests', `Аудио ${randomUUID()}`);
  await mkdir(project, { recursive: true });
  try {
    const input = JSON.parse(await readFile('examples/feature-explainer/manifest.json', 'utf8'));
    input.assets = { voice: { type: 'audio', path: './речь.wav' } };
    input.scenes = [{ id: 'hook', type: 'kinetic_title', durationFrames: 30, text: 'Короткая сцена', narration: { asset: 'voice' } }];
    input.audio.music.provider = 'none';
    await copyFile('examples/feature-explainer/assets/voice.wav', path.join(project, 'речь.wav'));
    const file = path.join(project, 'manifest.json');
    await writeFile(file, JSON.stringify(input));
    await assert.rejects(prepareAudio(await loadManifest(file), project, findTools()), error => error.code === 'VOICE_TOO_LONG' && error.exitCode === 2);
    await writeFile(path.join(project, 'музыка.wav'), proceduralWav(0.3, 7));
    input.assets = { music: { type: 'audio', path: './музыка.wav' } };
    input.audio = { narration: { provider: 'none' }, music: { provider: 'file', asset: 'music', gainDb: -12 } };
    input.scenes[0].durationFrames = 90; delete input.scenes[0].narration;
    await writeFile(file, JSON.stringify(input));
    const result = await prepareAudio(await loadManifest(file), project, findTools());
    assert.ok(result.path); assert.equal(await audioDuration(result.path, findTools()), 3);
    assert.equal(result.report.music, 'file'); assert.equal(result.report.verifiedDuration, 3);
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('missing optional Edge interpreter fails explicitly while core remains available', async () => {
  const project = path.resolve('.cache/tests', `edge-${randomUUID()}`);
  const oldPython = process.env.PYTHON_PATH;
  await mkdir(project, { recursive: true });
  try {
    const file = path.join(project, 'manifest.json');
    const input = JSON.parse(await readFile('examples/edge-speech/manifest.json', 'utf8'));
    await writeFile(file, JSON.stringify(input));
    process.env.PYTHON_PATH = path.join(project, 'missing-python.exe');
    await assert.rejects(prepareAudio(await loadManifest(file), project, findTools()), error => error.code === 'EDGE_NOT_INSTALLED' && error.exitCode === 3);
    input.audio = { narration: { provider: 'none' }, music: { provider: 'none' } }; delete input.scenes[0].narration;
    await writeFile(file, JSON.stringify(input));
    const local = await prepareAudio(await loadManifest(file), project, findTools());
    assert.equal(local.path, undefined);
  } finally {
    if (oldPython === undefined) delete process.env.PYTHON_PATH; else process.env.PYTHON_PATH = oldPython;
    await rm(project, { recursive: true, force: true });
  }
});
