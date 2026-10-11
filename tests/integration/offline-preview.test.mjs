import test from 'node:test';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { verifyOfflinePreview } from '../../scripts/verify-offline-preview.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pulseFixture } from '../../scripts/verify-source-audio.mjs';
import { readProject } from '../../dist/project.js';
import { previewScene } from '../../dist/preview.js';
test('offline file narration and captions share full-draft audio and global boundary frames in preview, export and real Studio', { timeout: 240000 }, async () => {
    await verifyOfflinePreview(resolve('.'), resolve('artifacts/offline-preview', randomUUID()), { comprehensive: true, ui: true });
});
test('offline preview retains native missing, malformed, voice length and caption diagnostics without publishing a draft', async () => {
    const root = resolve('artifacts/offline-preview-errors', randomUUID());
    await mkdir(root, { recursive: true });
    const voice = pulseFixture(.8, 0, .8, 660), hash = bytes => createHash('sha256').update(bytes).digest('hex');
    const results = [];
    for (const [name, expectedCode, patch] of [
        ['missing', 'ASSET_MISSING', {}],
        ['malformed', 'PROCESS_FAILED', {}],
        ['voice-long', 'VOICE_TOO_LONG', { durationFrames: 30 }],
        ['overlap', 'INVALID_CAPTION_TIMING', { captions: [{ startMs: 0, endMs: 200, text: 'First' }, { startMs: 199, endMs: 400, text: 'Second' }] }],
        ['caption-overflow', 'CAPTION_TIMING', { captions: [{ startMs: 0, endMs: 802, text: 'Too late' }] }],
    ]) {
        const dir = join(root, name);
        await mkdir(dir, { recursive: true });
        const file = join(dir, 'project.json');
        if (name !== 'missing')
            await writeFile(join(dir, 'voice.wav'), name === 'malformed' ? Buffer.from('not a WAV') : voice);
        const manifest = { schemaVersion: 2, id: 'offline-errors', seed: 7, revision: randomUUID(), history: [], video: { aspectRatio: '16:9', fps: 30, style: 'studio' }, brand: { theme: 'dark', background: '#10171C', foreground: '#F4F1E9', accent: '#D9EE86', font: 'builtin-sans' }, assets: { voice: { type: 'audio', path: 'voice.wav' } }, audio: { narration: { provider: 'file', gainDb: -6 }, music: { provider: 'none' } }, scenes: [{ id: 'before', type: 'kinetic_title', text: 'Before', durationFrames: 37 }, { id: 'selected', type: 'kinetic_title', text: 'Voice', durationFrames: 67, narration: { asset: 'voice' }, captions: [{ startMs: 0, endMs: 700, text: 'Caption' }] }] };
        // Each malformed input is a fresh never-accepted native fixture, not an edit
        // to an accepted source or history. Preview must retain its initial bytes.
        await writeFile(file, JSON.stringify(manifest));
        const before = await readProject(file), bytes = await readFile(file), out = join(dir, 'preview');
        await mkdir(out);
        const old = Buffer.from('owned previous output');
        await writeFile(join(out, 'output.mp4'), old);
        let diagnostic;
        await assert.rejects(previewScene(file, { type: 'edit-scene', sceneId: 'selected', patch }, before.etag, out), error => {
            assert.equal(error.code, expectedCode);
            diagnostic = { code: error.code, stage: error.stage, exitCode: error.exitCode };
            return true;
        });
        assert.ok((await readFile(file)).equals(bytes));
        assert.deepEqual(await readProject(file), before);
        assert.ok((await readFile(join(out, 'output.mp4'))).equals(old));
        assert.deepEqual(await readdir(out), ['output.mp4']);
        assert.equal((await readdir(dir)).some(name => name.startsWith('.preview-')), false);
        if (!['missing', 'malformed'].includes(name))
            assert.equal(hash(await readFile(join(dir, 'voice.wav'))), hash(voice));
        results.push({ name, diagnostic, acceptedUnchanged: true, priorOutputPreserved: true, temporaryCleaned: true });
    }
    await writeFile(join(root, 'verification.json'), JSON.stringify({ status: 'PASS', cases: results, edgeSentinels: 'Separate measured music lifecycle cases retained', humanAcceptance: 'NOT RUN' }, null, 2));
});
