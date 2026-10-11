import test from 'node:test';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { verifySourceAudio } from '../../scripts/verify-source-audio.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createProject, importMedia, editProject, readProject, acceptGeneratedTake, generatedTakeRequestHash } from '../../dist/project.js';
import { previewScene, previewGeneratedTake } from '../../dist/preview.js';
import { findTools, runProcess } from '../../dist/runtime.js';
import { launchBrowser } from '../../dist/runtime.js';
import { openKitStudio } from '../../scripts/kit-studio-process.mjs';
test('source audio follows actual picture clock with fractional trim, offsets, silence gaps, first stream and long sources', { timeout: 240000 }, async () => {
    await verifySourceAudio(resolve('.'), resolve('artifacts/source-audio', randomUUID()), { comprehensive: true });
});
test('real CLI Studio source audio draft, conflict siblings, discard, restore and new-session reopen', { timeout: 180000 }, async () => {
    const root = resolve('artifacts/source-audio-ui', randomUUID());
    await mkdir(root, { recursive: true });
    const tools = findTools(), source = join(root, 'source.mp4'), cli = resolve('dist/cli.js');
    await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=3', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
    const file = (await createProject(join(root, 'project'))).project;
    const asset = (await importMedia(file, 'source.mp4', await readFile(source))).importedId;
    await editProject(file, { type: 'edit-scene', sceneId: 'opening', patch: { durationFrames: 37 } });
    await editProject(file, { type: 'add-scene', scene: { id: 'selected', type: 'video', asset, durationFrames: 30 } });
    const initial = await readProject(file), sourcePath = join(dirname(file), initial.manifest.assets[asset].path), sourceBytes = await readFile(sourcePath), report = {};
    let studio, browser;
    const errors = [];
    try {
        studio = await openKitStudio({ cli, workspace: root, file, report, label: 'source-audio-initial' });
        browser = await launchBrowser(tools.chrome);
        const page = await browser.newPage();
        page.on('pageerror', error => errors.push(error.message));
        const idle = () => page.waitForFunction(() => !document.querySelector('#reload').disabled);
        const values = () => page.evaluate(() => ({ enabled: document.querySelector('#source-audio-enabled').value, gain: document.querySelector('#source-audio-gain').value }));
        const fill = (id, value) => page.$eval(`#${id}`, (node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
        async function open() {
            await page.setViewport({ width: 1440, height: 1100 });
            await page.evaluateOnNewDocument(() => localStorage.setItem('ams-language', 'en'));
            await page.goto(studio.url, { waitUntil: 'networkidle0' });
            await page.click('[data-scene-id="selected"]');
            await idle();
        }
        async function external(sourceAudio) {
            const action = join(root, `action-${randomUUID()}.json`);
            await writeFile(action, JSON.stringify({ type: 'edit-scene', sceneId: 'selected', patch: { sourceAudio } }));
            const result = await runProcess(process.execPath, [cli, 'edit', file, '--action', action, '--if-match', (await readProject(file)).etag, '--json']);
            assert.equal(result.exitCode, 0);
            return readProject(file);
        }
        async function conflict(choice) {
            await page.click('#save-scene');
            await page.waitForFunction(() => document.querySelector('#conflict-dialog').open);
            await idle();
            await page.click(`#conflict-${choice}`);
            await page.waitForFunction(() => !document.querySelector('#conflict-dialog').open);
            await idle();
        }
        await open();
        assert.deepEqual(await values(), { enabled: 'off', gain: '0' });
        assert.equal(await page.$eval('#source-preview video', node => node.muted), true);
        await fill('source-audio-enabled', 'on');
        await fill('source-audio-gain', -12);
        const beforePreview = await readFile(file);
        await page.click('#preview-scene');
        await page.waitForFunction(() => !document.querySelector('#scene-preview').hidden || document.querySelector('#notice').classList.contains('error'), { timeout: 90000 });
        await idle();
        assert.equal(await page.$eval('#scene-preview', node => node.hidden), false);
        assert.ok((await readFile(file)).equals(beforePreview));
        assert.deepEqual(await page.$eval('#scene-preview', node => ({ muted: node.muted, controls: node.controls, autoplay: node.autoplay, paused: node.paused })), { muted: false, controls: true, autoplay: false, paused: true });
        await page.$eval('#scene-preview', async (node) => { await node.play(); });
        await page.waitForFunction(() => document.querySelector('#scene-preview').currentTime > .2);
        await page.$eval('#scene-preview', node => node.pause());
        assert.ok(await page.$eval('#scene-preview', node => node.webkitAudioDecodedByteCount) > 0);
        await page.screenshot({ path: join(root, 'source-audio-ui.png') });
        // Only local On changes from the original default; externally changed gain wins.
        await fill('source-audio-gain', 0);
        await external({ enabled: false, gainDb: -18 });
        await conflict('local');
        assert.deepEqual((await readProject(file)).manifest.scenes[1].sourceAudio, { enabled: true, gainDb: -18 });
        assert.deepEqual(await values(), { enabled: 'on', gain: '-18' });
        // Only local gain changes; externally changed Off wins.
        await fill('source-audio-gain', -9);
        await external({ enabled: false, gainDb: -18 });
        await conflict('local');
        const off = await readProject(file);
        assert.deepEqual(off.manifest.scenes[1].sourceAudio, { enabled: false, gainDb: -9 });
        await fill('source-audio-gain', -6);
        const fresh = await external({ enabled: true, gainDb: -9 }), freshBytes = await readFile(file);
        await conflict('external');
        assert.ok((await readFile(file)).equals(freshBytes));
        assert.equal((await readProject(file)).etag, fresh.etag);
        assert.deepEqual(await values(), { enabled: 'on', gain: '-9' });
        await page.focus('#restore-scene');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('#source-audio-enabled').value === 'off');
        await idle();
        const restored = await readProject(file);
        assert.deepEqual(restored.manifest.scenes, off.manifest.scenes);
        assert.deepEqual(restored.manifest.assets, initial.manifest.assets);
        await studio.close();
        studio = await openKitStudio({ cli, workspace: root, file, report, label: 'source-audio-reopen' });
        await open();
        assert.deepEqual(await values(), { enabled: 'off', gain: '-9' });
        assert.equal((await readProject(file)).etag, restored.etag);
        assert.ok((await readFile(sourcePath)).equals(sourceBytes));
        assert.deepEqual(errors, []);
        await writeFile(join(root, 'verification.json'), JSON.stringify({ status: 'PASS', realCLIStudio: true, previewAudioDecoded: true, previewAcceptedUnchanged: true, defaultAbsentNotMaterialized: !Object.hasOwn(initial.manifest.scenes[1], 'sourceAudio'), externalGainPreserved: true, externalSwitchPreserved: true, explicitExternalDiscard: true, restoreAndNewSessionReopen: true, sourceUnchanged: true, errors, humanAcceptance: 'NOT RUN', processReport: report }, null, 2));
    }
    finally {
        await browser?.close();
        await studio?.close();
    }
});
test('source audio errors are explicit before publication; native replacement, restore and generated receipt preserve the setting', { timeout: 180000 }, async () => {
    const root = resolve('artifacts/source-audio-negative', randomUUID());
    await mkdir(root, { recursive: true });
    const tools = findTools(), hash = bytes => createHash('sha256').update(bytes).digest('hex');
    const normal = join(root, 'normal.mp4'), silent = join(root, 'silent.mp4'), variable = join(root, 'variable.mp4'), corrupt = join(root, 'corrupt.mp4');
    const video = ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=30:d=3'];
    await runProcess(tools.ffmpeg, [...video, '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=3', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', normal]);
    await runProcess(tools.ffmpeg, [...video, '-an', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', silent]);
    await runProcess(tools.ffmpeg, [...video, '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=3', '-vf', "setpts='if(lt(N,15),N/(30*TB),(N+6)/(30*TB))'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', variable]);
    // Damage only AAC packet bytes in this owned source, before immutable import.
    const probe = JSON.parse((await runProcess(tools.ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_entries', 'packet=pos,size', '-of', 'json', normal])).stdout);
    const broken = Buffer.from(await readFile(normal));
    for (const packet of probe.packets.slice(0, 4))
        broken.fill(255, Number(packet.pos), Number(packet.pos) + Number(packet.size));
    await writeFile(corrupt, broken);
    const file = (await createProject(join(root, 'project'))).project, assets = {};
    for (const [name, path] of Object.entries({ normal, silent, variable, corrupt }))
        assets[name] = (await importMedia(file, `${name}.mp4`, await readFile(path))).importedId;
    await editProject(file, { type: 'edit-scene', sceneId: 'opening', patch: { durationFrames: 30 } });
    await editProject(file, { type: 'add-scene', scene: { id: 'selected', type: 'video', asset: assets.normal, durationFrames: 30 } });
    const sources = async () => Object.fromEntries(await Promise.all(Object.entries((await readProject(file)).manifest.assets).map(async ([id, asset]) => [id, hash(await readFile(join(dirname(file), asset.path)))])));
    const hashes = await sources(), diagnostics = [];
    async function rejectWithoutPublication(action, code) {
        const before = await readProject(file), bytes = await readFile(file);
        await assert.rejects(editProject(file, action, before.etag), error => { assert.equal(error.code, code); diagnostics.push({ code: error.code, stage: error.stage, exitCode: error.exitCode }); return true; });
        assert.ok((await readFile(file)).equals(bytes));
        assert.deepEqual(await readProject(file), before);
        assert.deepEqual(await sources(), hashes);
    }
    await rejectWithoutPublication({ type: 'batch', actions: [{ type: 'edit-scene', sceneId: 'opening', patch: { sourceAudio: { enabled: false } } }, { type: 'edit-scene', sceneId: 'opening', patch: { sourceAudio: null } }] }, 'PROJECT_EDIT');
    await rejectWithoutPublication({ type: 'edit-scene', sceneId: 'selected', patch: { sourceAudio: { gainDb: -6 } } }, 'PROJECT_EDIT');
    for (const [name, code] of [['silent', 'SOURCE_AUDIO_MISSING'], ['corrupt', 'SOURCE_AUDIO_DECODE_FAILED'], ['variable', 'SOURCE_AUDIO_CLOCK_UNSUPPORTED']]) {
        await rejectWithoutPublication({ type: 'edit-scene', sceneId: 'selected', patch: { asset: assets[name], sourceAudio: { enabled: true } } }, code);
        const before = await readProject(file), bytes = await readFile(file);
        const output = join(root, `muted-${name}`);
        const result = await previewScene(file, { type: 'edit-scene', sceneId: 'selected', patch: { asset: assets[name], sourceAudio: { enabled: false } } }, before.etag, output);
        assert.equal(result.verification.audio, null);
        assert.ok((await readFile(file)).equals(bytes));
        assert.deepEqual(await readdir(output), ['output.mp4']);
    }
    await editProject(file, { type: 'edit-scene', sceneId: 'selected', patch: { sourceAudio: { enabled: true, gainDb: -12 } } });
    await editProject(file, { type: 'edit-scene', sceneId: 'selected', patch: { sourceAudio: { enabled: true } } });
    assert.deepEqual((await readProject(file)).manifest.scenes[1].sourceAudio, { enabled: true });
    await rejectWithoutPublication({ type: 'edit-scene', sceneId: 'selected', patch: { asset: assets.silent } }, 'SOURCE_AUDIO_MISSING');
    const enabled = await readProject(file), enabledBytes = await readFile(file);
    const disabledDraft = { type: 'edit-scene', sceneId: 'selected', patch: { asset: assets.silent, sourceAudio: { enabled: false, gainDb: -9 } } };
    assert.equal((await previewScene(file, disabledDraft, enabled.etag, join(root, 'explicit-off-replacement'))).verification.audio, null);
    assert.ok((await readFile(file)).equals(enabledBytes));
    await editProject(file, disabledDraft, enabled.etag);
    await editProject(file, { type: 'restore-scene', sceneId: 'selected', revisionId: enabled.manifest.revision });
    assert.deepEqual((await readProject(file)).manifest.scenes[1], enabled.manifest.scenes[1]);
    const before = await readProject(file), beforeBytes = await readFile(file);
    const candidateDraft = { sceneId: 'selected', candidateSha256: hash(await readFile(silent)), baseEtag: before.etag, trimStartSeconds: 0, fit: 'cover', focalPoint: { x: .5, y: .5 } };
    const insideSilent = join(dirname(file), before.manifest.assets[assets.silent].path), insideNormal = join(dirname(file), before.manifest.assets[assets.normal].path);
    await assert.rejects(previewGeneratedTake(file, candidateDraft, insideSilent, join(root, 'invalid-candidate')), error => error.code === 'SOURCE_AUDIO_MISSING');
    assert.ok((await readFile(file)).equals(beforeBytes));
    assert.equal(before.manifest.operationReceipts?.length ?? 0, 0);
    // A real audio-bearing candidate inherits On/default gain; acceptance and replay
    // use the existing intent fingerprint and receipt, with no new replay protocol.
    const preview = await previewGeneratedTake(file, { ...candidateDraft, candidateSha256: hash(await readFile(normal)) }, insideNormal, join(root, 'candidate-preview'));
    assert.equal(preview.verification.audio.codec, 'aac');
    assert.ok((await readFile(file)).equals(beforeBytes));
    const intent = { ...candidateDraft, candidatePath: insideNormal, candidateSha256: hash(await readFile(normal)), operationId: 'source-audio-accepted' };
    intent.requestHash = generatedTakeRequestHash(intent);
    const accepted = await acceptGeneratedTake(file, intent, before.etag);
    assert.deepEqual(accepted.manifest.scenes[1].sourceAudio, { enabled: true });
    await editProject(file, { type: 'edit-scene', sceneId: 'selected', patch: { sourceAudio: null } });
    const removed = await readProject(file), removedBytes = await readFile(file);
    assert.equal(Object.hasOwn(removed.manifest.scenes[1], 'sourceAudio'), false);
    const replay = await acceptGeneratedTake(file, intent, before.etag);
    assert.equal(replay.repeated, true);
    assert.deepEqual(replay.receipt, accepted.receipt);
    assert.ok((await readFile(file)).equals(removedBytes));
    assert.deepEqual(await sources(), hashes);
    assert.equal((await readdir(dirname(file))).some(name => name.startsWith('.preview-') || name.startsWith('.candidate-preview-')), false);
    await writeFile(join(root, 'verification.json'), JSON.stringify({ status: 'PASS', diagnostics, strictBatchChild: true, wholeObjectPatchAndNullRemoval: true, oldMutedSourcesRender: true, explicitOffRequiredForSilentReplacement: true, restorePreservesSetting: true, candidateInheritsSetting: true, receiptReplayDoesNotRestoreRemovedSetting: true, sources: hashes, humanAcceptance: 'NOT RUN' }, null, 2));
});
