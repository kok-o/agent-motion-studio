import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { comparePCM, toneAmplitude } from './verify-music-preview.mjs';
const rate = 48000, hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function pulseFixture(seconds, start, end, frequency = 880) {
    const samples = Math.round(seconds * rate), wav = Buffer.alloc(44 + samples * 4);
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
    for (let i = Math.round(start * rate); i < Math.min(samples, Math.round(end * rate)); i++) {
        const value = Math.round(.2 * 32767 * Math.sin(2 * Math.PI * frequency * i / rate));
        wav.writeInt16LE(value, 44 + i * 4);
        wav.writeInt16LE(value, 46 + i * 4);
    }
    return wav;
}
export async function verifySourceAudio(app, root, { comprehensive = false } = {}) {
    const load = file => import(pathToFileURL(join(resolve(app), 'dist', file)));
    const { createProject, importMedia, editProject, readProject } = await load('project.js');
    const { loadManifest } = await load('spec.js'), { prepareAudio, prepareSceneAudio } = await load('audio.js'), { previewScene } = await load('preview.js'), { findTools, runProcess } = await load('runtime.js');
    const tools = findTools();
    await mkdir(root, { recursive: true });
    const definitions = [
        { name: 'aligned24', fps: 24, trim: .375 },
        { name: 'delayed30-offset5', fps: 30, trim: .35, audioOffset: .4, base: 5, audioPulse: .6 },
        { name: 'audio-leading24-offset5', fps: 24, trim: .45, videoOffset: .4, base: 5, flash: .6 },
        { name: 'audio-entirely-later', fps: 30, trim: 0, audioOffset: 2, audioSeconds: .5, audioPulse: .1, frames: 30, expectSilence: true },
        { name: 'short-audio-no-loop', fps: 30, trim: .2, audioSeconds: .9, audioPulse: .3, flash: .3 },
        { name: 'first-of-two-audio', fps: 30, trim: .35, multiple: true },
        { name: 'long-source-short-window', fps: 1, trim: 1.25, seconds: 601, audioSeconds: .6, audioPulse: .1, frames: 30, expectSilence: true },
    ];
    const cases = [];
    for (const definition of comprehensive ? definitions : [definitions[1]]) {
        const { name, fps, trim } = definition, dir = join(root, name);
        await mkdir(dir, { recursive: true });
        const seconds = definition.seconds ?? 3, audioSeconds = definition.audioSeconds ?? 3, pulse = definition.audioPulse ?? 1, flash = definition.flash ?? 1;
        const voice = join(dir, 'pulse.wav');
        await writeFile(voice, pulseFixture(audioSeconds, pulse, pulse + .1));
        const inputs = ['-y', '-v', 'error', ...(definition.videoOffset ? ['-itsoffset', String(definition.videoOffset)] : []), '-f', 'lavfi', '-i', `color=c=black:s=160x90:r=${fps}:d=${seconds},drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(t,${flash},${flash + .1})'`, ...(definition.audioOffset ? ['-itsoffset', String(definition.audioOffset)] : []), '-i', voice];
        if (definition.multiple) {
            const second = join(dir, 'second.wav');
            await writeFile(second, pulseFixture(3, 0, 3, 1760));
            inputs.push('-i', second);
        }
        const sourceFile = join(dir, 'source.mp4');
        await runProcess(tools.ffmpeg, [...inputs, '-map', '0:v:0', '-map', '1:a:0', ...(definition.multiple ? ['-map', '2:a:0'] : []), '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', ...(definition.base ? ['-output_ts_offset', String(definition.base)] : []), sourceFile]);
        const file = (await createProject(join(dir, 'project'))).project, asset = await importMedia(file, 'clock.mp4', await readFile(sourceFile));
        await editProject(file, { type: 'edit-scene', sceneId: 'opening', patch: { durationFrames: 37 } });
        await editProject(file, { type: 'add-scene', scene: { id: 'selected', type: 'video', asset: asset.importedId, durationFrames: definition.frames ?? 60, trimStartSeconds: trim } });
        await editProject(file, { type: 'add-scene', scene: { id: 'after', type: 'kinetic_title', text: 'After', durationFrames: 31 } });
        const decode = async (input, name) => { const out = join(dir, `${name}.s16le`); await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-xerror', '-i', input, '-map', '0:a:0', '-ar', String(rate), '-ac', '2', '-c:a', 'pcm_s16le', '-f', 's16le', out]); return readFile(out); };
        let offProof;
        if (name === 'aligned24') {
            const off = await readProject(file), offBytes = await readFile(file);
            const absent = await previewScene(file, { type: 'edit-scene', sceneId: 'selected', patch: {} }, off.etag, join(dir, 'absent-preview'));
            const disabled = await previewScene(file, { type: 'edit-scene', sceneId: 'selected', patch: { sourceAudio: { enabled: false, gainDb: -12 } } }, off.etag, join(dir, 'off-preview'));
            assert.equal(absent.verification.audio, null);
            assert.equal(disabled.verification.audio, null);
            assert.ok((await readFile(file)).equals(offBytes));
            offProof = { absentAndOffHaveNoAudio: true, disabledGainNotMaterialized: true };
        }
        await editProject(file, { type: 'edit-scene', sceneId: 'selected', patch: { sourceAudio: { enabled: true, gainDb: -6 } } });
        const before = await readProject(file), bytes = await readFile(file), spec = await loadManifest(file), scene = spec.scenes[1], assetPath = join(dir, 'project', before.manifest.assets[asset.importedId].path), sourceHash = hash(await readFile(assetPath));
        assert.equal(scene.startFrame, 37);
        assert.notEqual(scene.startFrame * 1600 % 1024, 0);
        assert.ok(scene.sourceAudioClock);
        const intervalDir = join(dir, 'interval'), fullDir = join(dir, 'independent-full');
        await mkdir(join(intervalDir, 'logs'), { recursive: true });
        await mkdir(fullDir, { recursive: true });
        const interval = await prepareSceneAudio(spec, scene, intervalDir, tools), full = await prepareAudio(await loadManifest(file), fullDir, tools);
        assert.equal(full.report.sourceTracks.length, 1);
        assert.equal(full.report.sourceTracks[0].gainDb, -6);
        assert.equal(full.report.sourceTracks[0].hash, sourceHash);
        const pcm = await decode(interval, 'interval'), fullPCM = await decode(full.path, 'full');
        assert.ok(pcm.equals(fullPCM.subarray(scene.startFrame * 1600 * 4, scene.endFrame * 1600 * 4)), 'exact pre-AAC global interval');
        const out = join(dir, 'preview'), result = await previewScene(file, { type: 'edit-scene', sceneId: 'selected', patch: {} }, before.etag, out), aac = await decode(join(out, 'output.mp4'), 'aac');
        assert.equal(pcm.length / 4, scene.durationFrames * 1600, 'exact pre-AAC scene duration');
        assert.ok(Math.abs(aac.length / 4 - pcm.length / 4) <= 1024, 'decoded AAC duration within one 1024-sample packet');
        assert.equal(Number(result.verification.audio.sampleRate), rate);
        assert.equal(result.verification.audio.channels, 2);
        assert.equal(result.stale, false);
        assert.ok((await readFile(file)).equals(bytes));
        assert.deepEqual(await readProject(file), before);
        assert.equal(hash(await readFile(assetPath)), sourceHash);
        assert.deepEqual(await readdir(out), ['output.mp4']);
        let metrics, alignment;
        if (definition.expectSilence) {
            assert.ok(pcm.every(value => value === 0), 'leading/tail gap must be genuine silence, not loop/reset');
            assert.ok(aac.every(value => value === 0));
        }
        else {
            metrics = comparePCM(pcm, aac);
            const expectedAudioTime = pulse + (definition.audioOffset ?? 0) + (definition.base ?? 0) - scene.sourceAudioClock.firstVideoSeconds;
            const actualAmplitude = toneAmplitude(aac, 880, expectedAudioTime + .02, .05), expectedAmplitude = .2 * 10 ** (-6 / 20);
            assert.ok(Math.abs(actualAmplitude - expectedAmplitude) < .008, 'independent source tone/gain');
            const energy = (data, start, duration) => { let sum = 0; const n = Math.round(duration * rate); for (let i = Math.round(start * rate); i < Math.round(start * rate) + n; i++)
                sum += (data.readInt16LE(i * 4) / 32767) ** 2; return Math.sqrt(sum / n); };
            assert.ok(energy(pcm, Math.max(0, expectedAudioTime - .12), .06) < .001, 'gap before known pulse retained');
            assert.ok(energy(pcm, expectedAudioTime + .15, .06) < .001, 'no source loop after known pulse');
            if (name === 'short-audio-no-loop') {
                assert.ok(energy(pcm, 1, .1) < .00001, 'actual silence after source EOS, including first possible loop');
                assert.ok(energy(aac, 1, .1) < .001, 'decoded AAC retains silent tail after source EOS');
            }
            if (definition.multiple)
                assert.ok(toneAmplitude(aac, 1760, expectedAudioTime + .02, .05) < actualAmplitude * .05, 'only first source audio stream');
            const rgbFile = join(dir, 'picture.rgb');
            await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-i', join(out, 'output.mp4'), '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', rgbFile]);
            const rgb = await readFile(rgbFile);
            const firstFlash = Array.from({ length: result.totalFrames }, (_, index) => index).find(index => rgb[index * 3] > 230);
            const expectedPictureTime = flash + (definition.videoOffset ?? 0) + (definition.base ?? 0) - scene.sourceAudioClock.firstVideoSeconds;
            assert.ok(firstFlash !== undefined);
            assert.ok(Math.abs(firstFlash / 30 - expectedPictureTime) <= 1 / 30 + 1 / fps, 'independent visual flash alignment within one output/input frame');
            assert.ok(Math.abs(firstFlash / 30 - expectedAudioTime) <= 1 / 30 + 1 / fps, 'known flash and tone remain aligned');
            alignment = { firstFlashFrame: firstFlash, expectedPictureTime, expectedAudioTime, toleranceSeconds: 1 / 30 + 1 / fps, actualAmplitude, expectedAmplitude };
        }
        cases.push({ name, definition, sourceClock: scene.sourceAudioClock, sourceHash, globalStartFrame: scene.startFrame, exactPCMSamples: pcm.length / 4, exactPCMHash: hash(pcm), metrics, alignment, offProof, sourceReport: full.report.sourceTracks[0], verification: result.verification });
    }
    const report = { status: 'PASS', cases, sourceClock: 'actual retained picture PTS against container origin; copyts + timestamp-preserving resample; no packet reset', beforeAAC: 'exact shared full-mix interval', afterAAC: 'decoded length +/-1024 samples; interior comparison excludes2048 samples each end; correlation>.98/RMSE<.18/RMSratio +/- .12; silence exact', humanSoundQuality: 'NOT RUN', productionNetworkRequests: 0 };
    await writeFile(join(root, 'verification.json'), JSON.stringify(report, null, 2));
    return report;
}
