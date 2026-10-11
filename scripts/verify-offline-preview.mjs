import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { loopFixture, comparePCM, toneAmplitude } from './verify-music-preview.mjs';
import { pulseFixture } from './verify-source-audio.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifyOfflinePreview(app, root, { comprehensive = false, ui = false } = {}) {
    const load = file => import(pathToFileURL(join(resolve(app), 'dist', file)));
    const { readProject, patchScene } = await load('project.js'), { loadManifest } = await load('spec.js'), { prepareAudio, prepareSceneAudio } = await load('audio.js'), { previewScene } = await load('preview.js'), { findTools, runProcess, launchBrowser } = await load('runtime.js'), { render } = await load('engine.js'), { startStudio } = await load('server.js');
    const tools = findTools();
    await mkdir(root, { recursive: true });
    const cases = [];
    for (const [kind, aspect, language] of comprehensive ? [['none', '16:9', 'ru'], ['file', '9:16', 'en'], ['procedural', '16:9', 'ru']] : [['file', '16:9', 'en']]) {
        const dir = join(root, kind);
        await mkdir(dir, { recursive: true });
        const file = join(dir, 'project.json');
        const voice = pulseFixture(.8, 0, .8, 660), music = loopFixture();
        await writeFile(join(dir, 'voice.wav'), voice);
        await writeFile(join(dir, 'music.wav'), music);
        const captions = [{ startMs: 0, endMs: 110, text: language === 'ru' ? 'Первая фраза' : 'First caption' }, { startMs: 150, endMs: 250, text: 'Second' }, { startMs: 250, endMs: 351, text: 'Adjacent' }, { startMs: 361, endMs: 701, text: language === 'ru' ? 'Последняя фраза' : 'Final caption' }];
        // New, never-accepted native file-narration fixture; accepted bytes below are immutable.
        const manifest = { schemaVersion: 2, id: 'offline-preview', seed: 7, revision: randomUUID(), history: [], video: { aspectRatio: aspect, fps: 30, style: 'studio' }, brand: { theme: 'dark', background: '#10171C', foreground: '#F4F1E9', accent: '#D9EE86', font: 'builtin-sans' }, assets: { voice: { type: 'audio', path: 'voice.wav', sha256: hash(voice) }, music: { type: 'audio', path: 'music.wav', sha256: hash(music) } }, audio: { narration: { provider: 'file', gainDb: -6 }, music: kind === 'file' ? { provider: 'file', asset: 'music', gainDb: -9 } : { provider: kind, gainDb: -9 } }, scenes: [{ id: 'before', type: 'kinetic_title', text: 'Before', durationFrames: 37 }, { id: 'selected', type: 'kinetic_title', text: language === 'ru' ? 'Локальная озвучка' : 'Offline narration', durationFrames: 67, narration: { asset: 'voice' }, captions }, { id: 'after', type: 'kinetic_title', text: 'After', durationFrames: 31 }] };
        await writeFile(file, JSON.stringify(manifest));
        const before = await readProject(file), bytes = await readFile(file), action = { type: 'edit-scene', sceneId: 'selected', patch: { durationFrames: 53 } };
        const draft = structuredClone(manifest);
        draft.scenes[1] = patchScene(draft.scenes[1], action.patch);
        const draftFile = join(dir, 'draft.json');
        await writeFile(draftFile, JSON.stringify(draft));
        const spec = await loadManifest(draftFile), scene = spec.scenes[1], work = join(dir, 'interval'), fullDir = join(dir, 'independent-full');
        await mkdir(join(work, 'logs'), { recursive: true });
        await mkdir(fullDir, { recursive: true });
        const interval = await prepareSceneAudio(spec, scene, work, tools), fullSpec = await loadManifest(draftFile), full = await prepareAudio(fullSpec, fullDir, tools);
        const expectedRanges = [[41, 45], [46, 49], [49, 53], [53, 63]];
        assert.deepEqual(scene.resolvedCaptions.map(c => [c.startFrame, c.endFrame]), expectedRanges);
        assert.equal(scene.startFrame, 37);
        assert.equal(spec.totalFrames, 121);
        assert.equal(full.report.voices[0].start, 37 / 30 + .15);
        assert.equal(full.report.voices[0].duration, .8);
        assert.equal(full.report.music, kind);
        const decode = async (input, name) => { const output = join(dir, `${name}.s16le`); await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-xerror', '-i', input, '-map', '0:a:0', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', '-f', 's16le', output]); return readFile(output); };
        const pcm = await decode(interval, 'interval'), fullPCM = await decode(full.path, 'full');
        assert.equal(pcm.length, 53 * 1600 * 4);
        assert.ok(pcm.equals(fullPCM.subarray(37 * 1600 * 4, 90 * 1600 * 4)));
        const out = join(dir, 'preview'), result = await previewScene(file, action, before.etag, out), actual = await decode(join(out, 'output.mp4'), 'aac');
        const metrics = comparePCM(pcm, actual);
        assert.equal(Number(result.verification.audio.sampleRate), 48000);
        assert.equal(result.verification.audio.channels, 2);
        assert.ok(Math.abs(actual.length / 4 - pcm.length / 4) <= 1024);
        assert.ok((await readFile(file)).equals(bytes));
        assert.deepEqual(await readProject(file), before);
        assert.deepEqual(await readdir(out), ['output.mp4']);
        const voiceAmplitude = toneAmplitude(actual, 660, .22, .05);
        assert.ok(Math.abs(voiceAmplitude - .2 * 10 ** (-6 / 20)) < .008);
        let voiceLead;
        if (kind === 'none') {
            voiceLead = toneAmplitude(actual, 660, .02, .05);
            assert.ok(voiceLead < .001, 'voice absent before the existing 150ms lead-in');
        }
        let duck;
        if (kind === 'file') {
            const beforeVoice = toneAmplitude(actual, 1320, .005, .04), duringVoice = toneAmplitude(actual, 1760, .22, .05), expected = .1 * 10 ** (-9 / 20);
            assert.ok(Math.abs(beforeVoice - expected) < .003);
            assert.ok(Math.abs(duringVoice - expected * .25) < .002);
            duck = { beforeVoice, duringVoice, expected, duckRatio: .25 };
        }
        const boundaryFrames = [...new Set(expectedRanges.flatMap(([start, end]) => [start - 1, start, end - 1, end]).map(frame => frame - 37))].sort((a, b) => a - b);
        const cropHeight = Math.floor(spec.height * .12 / 2) * 2, cropY = Math.floor(spec.height * .81 / 2) * 2, crop = join(dir, 'captions.gray');
        await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-i', join(out, 'output.mp4'), '-map', '0:v:0', '-vf', `crop=${spec.width}:${cropHeight}:0:${cropY}`, '-pix_fmt', 'gray', '-f', 'rawvideo', crop]);
        const pixels = await readFile(crop), frameBytes = spec.width * cropHeight, captionProof = [];
        for (const local of boundaryFrames) {
            const expected = expectedRanges.some(([start, end]) => local + 37 >= start && local + 37 < end), frame = pixels.subarray(local * frameBytes, (local + 1) * frameBytes);
            const bright = frame.reduce((sum, value) => sum + (value > 180 ? 1 : 0), 0);
            assert.equal(bright > 100, expected, `caption boundary local${local}/global${local + 37}`);
            captionProof.push({ local, global: local + 37, expectedVisible: expected, brightPixels: bright });
        }
        await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-i', join(out, 'output.mp4'), '-vf', "select='eq(n,16)'", '-frames:v', '1', join(dir, 'caption-frame.png')]);
        let exactVisualFrames;
        if (comprehensive && kind !== 'procedural') {
            const exported = join(dir, 'full-export');
            await render(draftFile, exported, { noCache: true });
            const frames = async (input) => { const r = await runProcess(tools.ffmpeg, ['-v', 'error', '-threads', '1', '-i', input, '-map', '0:v:0', '-f', 'framemd5', '-']); return r.stdout.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim()); };
            const clip = await frames(join(out, 'output.mp4')), film = await frames(join(exported, 'output.mp4'));
            assert.deepEqual(clip, film.slice(37, 90));
            exactVisualFrames = clip.length;
        }
        let uiProof;
        if (ui && kind === 'file') {
            const studio = await startStudio(file, 0), browser = await launchBrowser(tools.chrome);
            const errors = [];
            try {
                const page = await browser.newPage();
                page.on('pageerror', error => errors.push(error.message));
                await page.setViewport({ width: 1440, height: 1100 });
                await page.evaluateOnNewDocument(lang => localStorage.setItem('ams-language', lang), language);
                await page.goto(studio.url, { waitUntil: 'networkidle0' });
                await page.click('[data-scene-id="selected"]');
                await page.$eval('#duration', n => { n.value = String(53 / 30); n.dispatchEvent(new Event('input', { bubbles: true })); });
                await page.click('#preview-scene');
                await page.waitForFunction(() => !document.querySelector('#scene-preview').hidden || document.querySelector('#notice').classList.contains('error'), { timeout: 90000 });
                assert.equal(await page.$eval('#scene-preview', n => n.hidden), false);
                assert.ok((await readFile(file)).equals(bytes));
                const controls = await page.$eval('#scene-preview', n => ({ controls: n.controls, muted: n.muted, autoplay: n.autoplay, paused: n.paused }));
                assert.deepEqual(controls, { controls: true, muted: false, autoplay: false, paused: true });
                await page.$eval('#scene-preview', async (n) => { n.currentTime = .55; await n.play(); });
                await page.waitForFunction(() => document.querySelector('#scene-preview').currentTime > .65);
                await page.$eval('#scene-preview', n => n.pause());
                assert.ok(await page.$eval('#scene-preview', n => n.webkitAudioDecodedByteCount) > 0);
                await page.screenshot({ path: join(dir, 'offline-ui.png') });
                assert.deepEqual(errors, []);
                uiProof = { controls, actualAudioDecoded: true, acceptedUnchanged: true, errors };
            }
            finally {
                await browser.close();
                await studio.close();
            }
        }
        assert.ok((await readFile(file)).equals(bytes));
        assert.equal(hash(await readFile(join(dir, 'voice.wav'))), hash(voice));
        assert.equal(hash(await readFile(join(dir, 'music.wav'))), hash(music));
        cases.push({ kind, aspect, language, exactPCMSamples: pcm.length / 4, exactPCMHash: hash(pcm), metrics, voiceAmplitude, voiceLead, duck, captionProof, exactVisualFrames, uiProof, sourceHashes: { voice: hash(voice), music: hash(music) }, voiceOnset: 'Existing adelay rounds global onset to ms:1383ms; local onset149.667ms, no sample-exact onset claim', verification: result.verification });
    }
    const report = { status: 'PASS', cases, edgeGuardEvidence: 'Measured provider/cache sentinels are in the separate music lifecycle integration test; no independent call-count instrumentation here', beforeAAC: 'exact integer sample crop of full music+file voice mix', afterAAC: 'correlation>.98/RMSE<.18/RMSratio +/- .12; length +/-1024samples; comparison excludes first/last2048samples per channel', humanSoundQuality: 'NOT RUN' };
    await writeFile(join(root, 'verification.json'), JSON.stringify(report, null, 2));
    return report;
}
