import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const rate = 48000, samplesPerFrame = 1600;
// Four independent, recognizable tone quarters; no product music generator is used.
export function loopFixture() {
    const samples = rate * .8, wav = Buffer.alloc(44 + samples * 4);
    wav.write('RIFF');
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVE', 8);
    wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(2, 22);
    wav.writeUInt32LE(rate, 24);
    wav.writeUInt32LE(rate * 4, 28);
    wav.writeUInt16LE(4, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(samples * 4, 40);
    for (let i = 0; i < samples; i++) {
        const frequency = [440, 880, 1320, 1760][Math.floor(i / (rate * .2))];
        const pcm = Math.round(.1 * 32767 * Math.sin(2 * Math.PI * frequency * i / rate));
        wav.writeInt16LE(pcm, 44 + i * 4);
        wav.writeInt16LE(pcm, 46 + i * 4);
    }
    return wav;
}
export function comparePCM(expected, actual) {
    const count = Math.min(expected.length, actual.length) / 4, margin = 2048;
    assert.ok(count > margin * 2);
    let xx = 0, yy = 0, xy = 0, error = 0;
    for (let i = margin; i < count - margin; i++)
        for (let channel = 0; channel < 2; channel++) {
            const x = expected.readInt16LE(i * 4 + channel * 2), y = actual.readInt16LE(i * 4 + channel * 2);
            xx += x * x;
            yy += y * y;
            xy += x * y;
            error += (x - y) ** 2;
        }
    const result = { correlation: xy / Math.sqrt(xx * yy), normalizedRMSE: Math.sqrt(error / xx), rmsRatio: Math.sqrt(yy / xx), comparedSamplesPerChannel: count - margin * 2 };
    // AAC is lossy: compare decoded signals, never claim separately encoded bytes equal.
    assert.ok(result.correlation > .98, JSON.stringify(result));
    assert.ok(result.normalizedRMSE < .18, JSON.stringify(result));
    assert.ok(Math.abs(result.rmsRatio - 1) < .12, JSON.stringify(result));
    return result;
}
export function toneAmplitude(pcm, frequency, startSeconds, duration = .06) {
    const start = Math.round(startSeconds * rate), count = Math.round(duration * rate);
    let sin = 0, cos = 0;
    assert.ok((start + count) * 4 <= pcm.length);
    for (let i = 0; i < count; i++) {
        const value = pcm.readInt16LE((start + i) * 4) / 32767, phase = 2 * Math.PI * frequency * i / rate;
        sin += value * Math.sin(phase);
        cos += value * Math.cos(phase);
    }
    return 2 * Math.hypot(sin, cos) / count;
}
/** Runs against the supplied installed app, with only owned synthetic assets. */
export async function verifyMusicPreview(app, root, { comprehensive = false } = {}) {
    const load = file => import(pathToFileURL(join(resolve(app), 'dist', file)));
    const { createProject, importMedia, editProject, readProject, patchScene, acceptGeneratedTake, generatedTakeRequestHash } = await load('project.js');
    const { prepareAudio, prepareSceneAudio } = await load('audio.js');
    const { previewScene } = await load('preview.js');
    const { loadManifest } = await load('spec.js');
    const { findTools, runProcess } = await load('runtime.js');
    const tools = findTools();
    await mkdir(root, { recursive: true });
    const video = join(root, 'source-with-220hz.mp4');
    await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=3', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
    const file = (await createProject(join(root, 'project'))).project;
    const source = await importMedia(file, 'source.mp4', await readFile(video));
    const music = await importMedia(file, 'four-tones.wav', loopFixture());
    for (const [id, durationFrames] of [['before', 37], ['selected', 53], ['after', 31]])
        await editProject(file, { type: 'add-scene', scene: { id, type: 'video', asset: source.importedId, durationFrames } });
    await editProject(file, { type: 'remove-scene', sceneId: 'opening' });
    const candidatePath = join(root, 'project', 'candidate.mp4');
    await writeFile(candidatePath, await readFile(video));
    const initial = await readProject(file);
    const intent = { sceneId: 'selected', candidatePath, candidateSha256: hash(await readFile(candidatePath)), baseEtag: initial.etag, trimStartSeconds: 0, fit: 'cover', focalPoint: { x: .5, y: .5 }, operationId: 'music-preview-owned-receipt' };
    intent.requestHash = generatedTakeRequestHash(intent);
    await acceptGeneratedTake(file, intent, initial.etag);
    const decode = async (input, name) => {
        const output = join(root, `${name}.s16le`);
        await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-xerror', '-i', input, '-map', '0:a:0', '-ar', String(rate), '-ac', '2', '-c:a', 'pcm_s16le', '-f', 's16le', output]);
        return readFile(output);
    };
    const sources = async (state) => Object.fromEntries(await Promise.all(Object.entries(state.manifest.assets).map(async ([id, asset]) => [id, hash(await readFile(join(root, 'project', asset.path)))])));
    const cases = [];
    for (const kind of comprehensive ? ['file', 'studio', 'kinetic', 'none'] : ['file']) {
        await editProject(file, { type: 'composition', video: { aspectRatio: '16:9', fps: 30, style: kind === 'kinetic' ? 'kinetic' : 'studio' } });
        await editProject(file, kind === 'file' ? { type: 'music', asset: music.importedId, gainDb: -9 } : { type: 'music', provider: kind === 'none' ? 'none' : 'procedural', gainDb: -9 });
        const before = await readProject(file), bytes = await readFile(file), hashes = await sources(before);
        assert.equal(before.manifest.operationReceipts.length, 1, 'preview must retain a real native acceptance receipt');
        const action = { type: 'edit-scene', sceneId: 'selected', patch: { durationFrames: 67, trimStartSeconds: .4, fit: 'contain' } };
        const draft = structuredClone(before.manifest);
        draft.scenes[1] = patchScene(draft.scenes[1], action.patch);
        const draftFile = join(root, 'project', `expected-${kind}.json`);
        await writeFile(draftFile, JSON.stringify(draft));
        const spec = await loadManifest(draftFile), scene = spec.scenes[1];
        assert.equal(scene.startFrame, 37);
        assert.equal(scene.endFrame, 104);
        assert.equal(spec.totalFrames, 135);
        assert.notEqual(scene.startFrame * samplesPerFrame % 1024, 0, 'test start must not align with an AAC packet');
        const intervalDir = join(root, `${kind}-interval`), fullDir = join(root, `${kind}-independent-full`);
        await mkdir(join(intervalDir, 'logs'), { recursive: true });
        await mkdir(fullDir, { recursive: true });
        const interval = await prepareSceneAudio(spec, scene, intervalDir, tools);
        const independent = await prepareAudio(await loadManifest(draftFile), fullDir, tools);
        const output = join(root, `${kind}-preview`), result = await previewScene(file, action, before.etag, output);
        assert.equal(result.totalFrames, 67);
        assert.equal(result.sourceStart, .4);
        assert.equal(result.stale, false);
        assert.ok((await readFile(file)).equals(bytes));
        assert.deepEqual(await readProject(file), before);
        assert.deepEqual(await sources(before), hashes);
        assert.deepEqual(await readdir(output), ['output.mp4'], 'all transient video/audio/mix files cleaned');
        let proof = { kind, result, acceptedHash: before.etag, sources: hashes };
        if (kind === 'none') {
            assert.equal(interval, undefined);
            assert.equal(independent.path, undefined);
            assert.equal(result.verification.audio, null);
        }
        else {
            const full = await decode(independent.path, `${kind}-full`), pcm = await decode(interval, `${kind}-interval`);
            const expected = full.subarray(scene.startFrame * samplesPerFrame * 4, scene.endFrame * samplesPerFrame * 4);
            assert.equal(pcm.length, 67 * samplesPerFrame * 4);
            assert.ok(pcm.equals(expected), 'pre-AAC PCM must equal exact integer sample interval from independent full shared mix');
            const actual = await decode(join(output, 'output.mp4'), `${kind}-aac`);
            assert.ok(Math.abs(actual.length / 4 - pcm.length / 4) <= 1024, 'decoded AAC length tolerance is plus/minus one packet');
            assert.equal(Number(result.verification.audio.sampleRate), rate);
            assert.equal(result.verification.audio.channels, 2);
            const metrics = comparePCM(pcm, actual);
            assert.ok(!pcm.equals(full.subarray(0, pcm.length)), 'fixture must distinguish global interval from reset-to-zero');
            proof = { ...proof, exactPCMSamplesPerChannel: pcm.length / 4, exactPCMHash: hash(pcm), metrics };
            if (kind === 'file') {
                const amplitude = toneAmplitude(actual, 1320, .01), resetTone = toneAmplitude(actual, 440, .01), sourceTone = toneAmplitude(actual, 220, .01);
                const targetAmplitude = .1 * 10 ** (-9 / 20);
                assert.ok(Math.abs(amplitude - targetAmplitude) < .003, 'independent tone/gain at global t=1.2433; no new local fade');
                assert.ok(resetTone < amplitude * .05);
                assert.ok(sourceTone < amplitude * .05, 'source-video audio must remain off');
                const endTone = toneAmplitude(actual, 440, 2.04);
                assert.ok(Math.abs(endTone - targetAmplitude) < .003, 'selected scene end must not add a local fade');
                // Full timeline global fades remain applied at the film edges, not the clip edges.
                const first = toneAmplitude(full, 440, .01), last = toneAmplitude(full, 1320, 4.41);
                assert.ok(first < targetAmplitude * .12);
                assert.ok(last < targetAmplitude * .18);
                proof.tones = { amplitude, targetAmplitude, resetTone, sourceTone, endTone, fullStartFadeAmplitude: first, fullEndFadeAmplitude: last };
            }
        }
        cases.push(proof);
    }
    assert.equal((await readdir(join(root, 'project'))).some(name => name.startsWith('.preview-')), false);
    const report = { status: 'PASS', installedApp: true, cases, beforeAAC: 'exact PCM integer sample equality with independent full shared mix', afterAAC: 'lossy: correlation > .98; normalized RMSE < .18; RMS ratio within .12; decoded length +/-1024 samples; signal comparison excludes first/last2048 samples per channel', humanSoundQuality: 'NOT RUN', productionNetworkRequests: 0 };
    await writeFile(join(root, 'verification.json'), JSON.stringify(report, null, 2));
    return report;
}
