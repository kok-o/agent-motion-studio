import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat, readdir, rename, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createProject, editProject, readProject } from '../../dist/project.js';

const cli = resolve('dist/cli.js');

function run(args, expectedCode = 0) {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, expectedCode, `Command failed: ${args.join(' ')}\nOutput: ${result.stdout}\nStderr: ${result.stderr}`);
  return JSON.parse(result.stdout || '{}');
}

// ─────────────────────────────────────────────────────────────────────────────
// M1 Tests: Input error handling and correct CLI exit codes/stages
// ─────────────────────────────────────────────────────────────────────────────

test('M1: missing project and missing arguments produce user-actionable exit code 2 and stage "input", not INTERNAL_ERROR/render/4', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ams-m1-'));
  try {
    const missingFile = join(root, 'non-existent.json');
    const validActionFile = join(root, 'action.json');
    await writeFile(validActionFile, JSON.stringify({ type: 'brand', patch: { theme: 'light' } }));

    // 1. state on missing project
    const stateRes = run(['state', missingFile], 2);
    assert.equal(stateRes.exitCode, 2);
    assert.equal(stateRes.error.stage, 'input');
    assert.ok(['PROJECT_NOT_FOUND', 'FILE_NOT_FOUND'].includes(stateRes.error.code));
    assert.notEqual(stateRes.error.code, 'INTERNAL_ERROR');

    // 2. edit on missing project
    const editRes = run(['edit', missingFile, '--action', validActionFile], 2);
    assert.equal(editRes.exitCode, 2);
    assert.equal(editRes.error.stage, 'input');
    assert.ok(['PROJECT_NOT_FOUND', 'FILE_NOT_FOUND'].includes(editRes.error.code));
    assert.notEqual(editRes.error.code, 'INTERNAL_ERROR');

    // 3. edit on missing action file
    const projDir = join(root, 'proj');
    await createProject(projDir);
    const projFile = join(projDir, 'project.json');
    const missingAction = join(root, 'missing-action.json');
    const editMissingAction = run(['edit', projFile, '--action', missingAction], 2);
    assert.equal(editMissingAction.exitCode, 2);
    assert.equal(editMissingAction.error.stage, 'input');
    assert.equal(editMissingAction.error.code, 'FILE_NOT_FOUND');

    // 4. import on missing media file
    const importMissingFile = run(['import', projFile, '--file', join(root, 'missing.png')], 2);
    assert.equal(importMissingFile.exitCode, 2);
    assert.equal(importMissingFile.error.stage, 'input');
    assert.equal(importMissingFile.error.code, 'FILE_NOT_FOUND');

    // 5. missing CLI required arguments
    const missingDirNew = run(['new'], 2);
    assert.equal(missingDirNew.exitCode, 2);
    assert.equal(missingDirNew.error.stage, 'input');
    assert.equal(missingDirNew.error.code, 'INVALID_COMMAND');

    const missingActionEdit = run(['edit', projFile], 2);
    assert.equal(missingActionEdit.exitCode, 2);
    assert.equal(missingActionEdit.error.stage, 'input');
    assert.equal(missingActionEdit.error.code, 'INVALID_COMMAND');

    const missingOutRender = run(['render', projFile], 2);
    assert.equal(missingOutRender.exitCode, 2);
    assert.equal(missingOutRender.error.stage, 'input');
    assert.equal(missingOutRender.error.code, 'INVALID_COMMAND');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// M7 Tests: Partial music and composition actions preserve unspecified fields
// ─────────────────────────────────────────────────────────────────────────────

test('M7: gain-only edit preserves procedural and file music provider/asset; explicit turn-off works', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ams-m7-music-'));
  try {
    await createProject(root, { aspect: '16:9', title: 'Music Test' });
    const file = join(root, 'project.json');

    // Case 1: procedural music
    await editProject(file, { type: 'music', provider: 'procedural', gainDb: -14 });
    let current = (await readProject(file)).manifest.audio.music;
    assert.equal(current.provider, 'procedural');
    assert.equal(current.gainDb, -14);

    // Gain-only edit on procedural music
    await editProject(file, { type: 'music', gainDb: -22 });
    current = (await readProject(file)).manifest.audio.music;
    assert.equal(current.provider, 'procedural', 'gain-only edit must retain procedural provider');
    assert.equal(current.gainDb, -22, 'gain-only edit must update gainDb');
    assert.equal(current.asset, undefined);

    // Case 2: import audio asset and use file provider
    const sampleAudio = resolve('examples/feature-explainer/assets/voice.wav');
    const audioContent = await readFile(sampleAudio);
    const { importMedia } = await import('../../dist/project.js');
    await importMedia(file, 'voice.wav', audioContent);
    const assetId = Object.entries((await readProject(file)).manifest.assets).find(
      ([, a]) => a.type === 'audio'
    )[0];

    await editProject(file, { type: 'music', asset: assetId, gainDb: -10 });
    current = (await readProject(file)).manifest.audio.music;
    assert.equal(current.provider, 'file');
    assert.equal(current.asset, assetId);
    assert.equal(current.gainDb, -10);

    // Gain-only edit on file music
    await editProject(file, { type: 'music', gainDb: -18 });
    current = (await readProject(file)).manifest.audio.music;
    assert.equal(current.provider, 'file', 'gain-only edit must retain file provider');
    assert.equal(current.asset, assetId, 'gain-only edit must retain asset');
    assert.equal(current.gainDb, -18);

    // Case 3: explicit turn off with provider: 'none'
    await editProject(file, { type: 'music', provider: 'none' });
    current = (await readProject(file)).manifest.audio.music;
    assert.equal(current.provider, 'none');
    assert.equal(current.asset, undefined);

    // Case 4: gain-only on 'none' retains 'none'
    await editProject(file, { type: 'music', gainDb: -25 });
    current = (await readProject(file)).manifest.audio.music;
    assert.equal(current.provider, 'none');
    assert.equal(current.gainDb, -25);

    // Case 5: choosing both asset and provider throws error
    await assert.rejects(
      editProject(file, { type: 'music', asset: assetId, provider: 'procedural' }),
      /Choose either a file asset or a music provider/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('M7: composition aspect ratio change preserves unspecified style and safeArea', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ams-m7-comp-'));
  try {
    await createProject(root, { aspect: '16:9', title: 'Composition Test' });
    const file = join(root, 'project.json');

    // Set composition with custom style and safeArea
    await editProject(file, {
      type: 'composition',
      video: { aspectRatio: '16:9', fps: 30, style: 'kinetic', safeArea: 0.12 }
    });
    let video = (await readProject(file)).manifest.video;
    assert.equal(video.aspectRatio, '16:9');
    assert.equal(video.style, 'kinetic');
    assert.equal(video.safeArea, 0.12);

    // Partial composition edit changing aspect ratio
    await editProject(file, {
      type: 'composition',
      video: { aspectRatio: '9:16', fps: 30 }
    });
    video = (await readProject(file)).manifest.video;
    assert.equal(video.aspectRatio, '9:16');
    assert.equal(video.fps, 30);
    assert.equal(video.style, 'kinetic', 'aspect-only edit must preserve existing style');
    assert.equal(video.safeArea, 0.12, 'aspect-only edit must preserve existing safeArea');

    // Full payload overriding style
    await editProject(file, {
      type: 'composition',
      video: { aspectRatio: '16:9', fps: 30, style: 'studio', safeArea: 0.06 }
    });
    video = (await readProject(file)).manifest.video;
    assert.equal(video.aspectRatio, '16:9');
    assert.equal(video.style, 'studio');
    assert.equal(video.safeArea, 0.06);

    // Invalid composition action rejected
    await assert.rejects(
      editProject(file, { type: 'composition', video: { aspectRatio: '4:3', fps: 30 } }),
      /Invalid video/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('M7: sequential batch children preserve previous children settings for music and composition', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ams-m7-seq-batch-'));
  try {
    await createProject(root, { aspect: '16:9', title: 'Sequential Batch Test' });
    const file = join(root, 'project.json');

    // 1. Music sequential children: procedural -12 -> gain-only -20 -> gain-only -6
    let res = await editProject(file, {
      type: 'batch',
      label: 'Sequential procedural gain batch',
      actions: [
        { type: 'music', provider: 'procedural', gainDb: -12 },
        { type: 'music', gainDb: -20 },
        { type: 'music', gainDb: -6 }
      ]
    });
    let music = res.manifest.audio.music;
    assert.equal(music.provider, 'procedural');
    assert.equal(music.gainDb, -6);

    // 2. Music file asset: import audio asset, then batch file asset -> gain-only
    const sampleAudio = resolve('examples/feature-explainer/assets/voice.wav');
    const audioContent = await readFile(sampleAudio);
    const { importMedia } = await import('../../dist/project.js');
    await importMedia(file, 'voice.wav', audioContent);
    const assetId = Object.entries((await readProject(file)).manifest.assets).find(
      ([, a]) => a.type === 'audio'
    )[0];

    res = await editProject(file, {
      type: 'batch',
      label: 'Sequential file music batch',
      actions: [
        { type: 'music', asset: assetId, gainDb: -10 },
        { type: 'music', gainDb: -18 }
      ]
    });
    music = res.manifest.audio.music;
    assert.equal(music.provider, 'file');
    assert.equal(music.asset, assetId);
    assert.equal(music.gainDb, -18);

    // 3. Music explicit none in batch: procedural -> none
    res = await editProject(file, {
      type: 'batch',
      label: 'Sequential turn off batch',
      actions: [
        { type: 'music', provider: 'procedural', gainDb: -12 },
        { type: 'music', provider: 'none' }
      ]
    });
    music = res.manifest.audio.music;
    assert.equal(music.provider, 'none');

    // 4. Sequential composition patches in batch: style + safeArea -> aspect ratio change
    res = await editProject(file, {
      type: 'batch',
      label: 'Sequential composition batch',
      actions: [
        { type: 'composition', video: { style: 'studio', safeArea: 0.1 } },
        { type: 'composition', video: { aspectRatio: '9:16' } }
      ]
    });
    const video = res.manifest.video;
    assert.equal(video.aspectRatio, '9:16');
    assert.equal(video.style, 'studio', 'Sequential composition patch must preserve style from earlier child');
    assert.equal(video.safeArea, 0.1, 'Sequential composition patch must preserve safeArea from earlier child');
    assert.equal(video.fps, 30);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('M7: invalid child in batch cleanly rejects entire batch and preserves accepted project state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ams-m7-atomic-fail-'));
  try {
    await createProject(root, { aspect: '16:9', title: 'Atomic Fail Test' });
    const file = join(root, 'project.json');

    const beforeState = await readProject(file);
    const beforeBytes = await readFile(file);
    const beforeEtag = beforeState.etag;
    const beforeRev = beforeState.manifest.revision;
    const beforeBrand = beforeState.manifest.brand;

    // Batch where child 0 is valid (brand edit) but child 1 is invalid (unknown music provider)
    await assert.rejects(
      editProject(file, {
        type: 'batch',
        actions: [
          { type: 'brand', patch: { accent: '#ff00ff' } },
          { type: 'music', provider: 'invalid_provider' }
        ]
      }),
      /Batch action\[1\]/
    );

    const afterState = await readProject(file);
    const afterBytes = await readFile(file);
    assert.ok(beforeBytes.equals(afterBytes), 'Rejected batch must not alter project bytes');
    assert.equal(afterState.etag, beforeEtag, 'Rejected batch must preserve ETag');
    assert.equal(afterState.manifest.revision, beforeRev, 'Rejected batch must preserve revision');
    assert.deepEqual(afterState.manifest.brand, beforeBrand, 'First child brand edit must NOT leak into project');

    // Batch with asset and provider conflict in child
    await assert.rejects(
      editProject(file, {
        type: 'batch',
        actions: [
          { type: 'brand', patch: { accent: '#00ff00' } },
          { type: 'music', asset: 'foo', provider: 'procedural' }
        ]
      }),
      /Choose either a file asset or a music provider/
    );

    const afterConflictBytes = await readFile(file);
    assert.ok(beforeBytes.equals(afterConflictBytes), 'Conflicting child must not alter project bytes');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// H1 Tests: History retention, size budget, 150 consecutive edits on 3x12 and 6x20
// ─────────────────────────────────────────────────────────────────────────────

function makeCompositionScenes(sceneCount, objectsPerScene) {
  const scenes = [];
  for (let s = 1; s <= sceneCount; s++) {
    const objects = [];
    for (let o = 1; o <= objectsPerScene; o++) {
      objects.push({
        id: `obj-${s}-${o}`,
        type: 'text',
        text: `Object ${o} in scene ${s} demonstrating rich composition state with text and properties`,
        fontSize: 28,
        x: 50 + o * 15,
        y: 50 + o * 25,
        width: 350,
        height: 80,
        opacity: 1,
        keyframes: [
          { frame: 0, opacity: 0, x: 20 },
          { frame: 15, opacity: 1, x: 50 },
          { frame: 30, opacity: 1, x: 50 }
        ]
      });
    }
    scenes.push({
      id: `scene-${s}`,
      type: 'composition',
      durationFrames: 60,
      objects
    });
  }
  return scenes;
}

test('H1: fixture 3 scenes x 12 objects survives 150 consecutive accepted edits; history bounded < 1 MiB', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ams-h1-3x12-'));
  try {
    await createProject(root, { aspect: '16:9', title: 'H1 3x12' });
    const file = join(root, 'project.json');

    const scenes = makeCompositionScenes(3, 12);
    await editProject(file, {
      type: 'batch',
      label: 'Setup 3x12 composition',
      actions: [
        { type: 'remove-scene', sceneId: 'opening' },
        ...scenes.map(scene => ({ type: 'add-scene', scene }))
      ]
    });

    const recordedRevisions = [];
    const initialManifest = (await readProject(file)).manifest;

    // Perform 150 consecutive accepted edits
    for (let i = 1; i <= 150; i++) {
      if (i === 80) {
        // Edit 80: create a substantially smaller state (1 scene instead of 3)
        const res = await editProject(file, {
          type: 'batch',
          label: 'Reduce to 1 scene',
          actions: [
            { type: 'remove-scene', sceneId: 'scene-2' },
            { type: 'remove-scene', sceneId: 'scene-3' }
          ]
        });
        recordedRevisions.push({ index: i, id: res.manifest.revision, scenesCount: 1 });
      } else if (i === 81) {
        // Edit 81: restore the other 2 scenes back
        const res = await editProject(file, {
          type: 'batch',
          label: 'Restore 3 scenes',
          actions: [
            { type: 'add-scene', scene: scenes[1] },
            { type: 'add-scene', scene: scenes[2] }
          ]
        });
        recordedRevisions.push({ index: i, id: res.manifest.revision, scenesCount: 3 });
      } else {
        const hex = ((i * 123456) % 0xFFFFFF).toString(16).padStart(6, '0');
        const res = await editProject(file, { type: 'brand', patch: { accent: `#${hex}` } });
        const currentRev = res.manifest.revision;
        if (i % 25 === 0 || i === 75 || i === 100 || i === 150) {
          recordedRevisions.push({ index: i, id: currentRev, accent: `#${hex}`, scenesCount: 3 });
        }
      }

      // Check file size never exceeds 1 MiB limit
      const s = await stat(file);
      assert.ok(s.size < 1024 * 1024, `project.json size ${s.size} bytes exceeded 1 MiB at edit ${i}`);
    }

    const finalState = await readProject(file);
    const finalSize = (await stat(file)).size;
    assert.ok(finalSize < 1024 * 1024, `Final project.json size ${finalSize} exceeded 1 MiB`);
    console.log(`3x12 fixture: 150 edits completed. Final project.json size: ${finalSize} bytes`);

    // Verify restore of a comparable size revision (edit 75: 75 edits ago, pruned from inline history, inside 100 retained window)
    const rev75 = recordedRevisions.find(r => r.index === 75);
    assert.ok(rev75, 'Recorded revision 75 exists');
    await editProject(file, { type: 'restore', revisionId: rev75.id });
    const restored75 = (await readProject(file)).manifest;
    assert.equal(restored75.brand.accent, rev75.accent, 'Restored revision 75 accent matches');
    assert.equal(restored75.scenes.length, 3, 'Restored revision 75 scenes count matches');

    // Verify restore of a substantially smaller state (edit 80: 1 scene)
    const rev80 = recordedRevisions.find(r => r.index === 80);
    assert.ok(rev80, 'Recorded revision 80 exists');
    await editProject(file, { type: 'restore', revisionId: rev80.id });
    const restored80 = (await readProject(file)).manifest;
    assert.equal(restored80.scenes.length, 1, 'Restored revision 80 has 1 scene');

    // Verify restoring pruned revision (initialManifest from >100 edits ago) throws and preserves project state
    const bytesBeforePrunedRestore = await readFile(file);
    const etagBeforePrunedRestore = (await readProject(file)).etag;
    await assert.rejects(
      editProject(file, { type: 'restore', revisionId: initialManifest.revision }),
      /Revision does not exist/
    );
    const bytesAfterPrunedRestore = await readFile(file);
    const etagAfterPrunedRestore = (await readProject(file)).etag;
    assert.ok(bytesBeforePrunedRestore.equals(bytesAfterPrunedRestore), 'Bytes preserved after pruned restore attempt');
    assert.equal(etagBeforePrunedRestore, etagAfterPrunedRestore, 'ETag preserved after pruned restore attempt');

    // Verify failed restore on non-existent revision preserves project state
    await assert.rejects(
      editProject(file, { type: 'restore', revisionId: 'non-existent-rev-id' }),
      /Revision does not exist/
    );
    const bytesAfterBadRestore = await readFile(file);
    const etagAfterBadRestore = (await readProject(file)).etag;
    assert.ok(bytesBeforePrunedRestore.equals(bytesAfterBadRestore), 'Bytes preserved after failed restore');
    assert.equal(etagBeforePrunedRestore, etagAfterBadRestore, 'ETag preserved after failed restore');

    // Verify directory transfer / portability
    const newRoot = join(tmpdir(), `ams-h1-moved-${Date.now()}`);
    await rename(root, newRoot);
    const movedFile = join(newRoot, 'project.json');

    // Verify reading from moved directory
    const movedState = await readProject(movedFile);
    assert.equal(movedState.manifest.id, 'my-film');

    // Verify restore in moved directory
    await editProject(movedFile, { type: 'restore', revisionId: rev75.id });
    const movedRestored = (await readProject(movedFile)).manifest;
    assert.equal(movedRestored.brand.accent, rev75.accent, 'Restore works after directory move');
    assert.equal(movedRestored.scenes.length, 3, 'Restore after move preserves scenes');

    // Cleanup moved folder
    await rm(newRoot, { recursive: true, force: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('H1: fixture 6 scenes x 20 objects survives 150 consecutive accepted edits; history bounded < 1 MiB', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ams-h1-6x20-'));
  try {
    await createProject(root, { aspect: '16:9', title: 'H1 6x20' });
    const file = join(root, 'project.json');

    const scenes = makeCompositionScenes(6, 20);
    await editProject(file, {
      type: 'batch',
      label: 'Setup 6x20 composition',
      actions: [
        { type: 'remove-scene', sceneId: 'opening' },
        ...scenes.map(scene => ({ type: 'add-scene', scene }))
      ]
    });

    const recordedRevisions = [];
    const initialManifest = (await readProject(file)).manifest;
    recordedRevisions.push({ index: 0, id: initialManifest.revision });

    // Perform 150 consecutive accepted edits
    for (let i = 1; i <= 150; i++) {
      const hex = ((i * 654321) % 0xFFFFFF).toString(16).padStart(6, '0');
      const res = await editProject(file, { type: 'brand', patch: { accent: `#${hex}` } });
      const currentRev = res.manifest.revision;
      if (i === 1 || i === 75 || i === 150) {
        recordedRevisions.push({ index: i, id: currentRev, accent: `#${hex}` });
      }

      // Check file size never exceeds 1 MiB limit
      const s = await stat(file);
      assert.ok(s.size < 1024 * 1024, `project.json size ${s.size} bytes exceeded 1 MiB at edit ${i}`);
    }

    const finalSize = (await stat(file)).size;
    assert.ok(finalSize < 1024 * 1024, `Final project.json size ${finalSize} exceeded 1 MiB`);
    console.log(`6x20 fixture: 150 edits completed. Final project.json size: ${finalSize} bytes`);

    // Verify restore of revision 75 (external history)
    const rev75 = recordedRevisions.find(r => r.index === 75);
    await editProject(file, { type: 'restore', revisionId: rev75.id });
    const restored75 = (await readProject(file)).manifest;
    assert.equal(restored75.brand.accent, rev75.accent);
    assert.equal(restored75.scenes.length, 6);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('H1: archive obstruction (.history as regular file) cleanly rejects edits and preserves initial project state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ams-h1-blocked-'));
  try {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, '.history'), 'Blocked archive obstruction; not a directory.\n');
    const file = join(root, 'project.json');
    await createProject(root, { title: 'Blocked archive test' });

    const state = await readProject(file);
    const initialRevision = state.manifest.revision;
    const beforeBytes = await readFile(file);
    const beforeEtag = state.etag;

    // edit must fail safely because .history is blocked
    await assert.rejects(
      editProject(file, { type: 'brand', patch: { accent: '#ff00ff' } }, state.etag),
      /Cannot access history directory/
    );

    const afterState = await readProject(file);
    const afterBytes = await readFile(file);
    assert.ok(beforeBytes.equals(afterBytes), 'Accepted bytes must be preserved after rejected edit');
    assert.equal(afterState.etag, beforeEtag, 'ETag must be preserved after rejected edit');
    assert.equal(afterState.manifest.revision, initialRevision, 'Initial revision must not be lost');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('H1: rejected commit (e.g. invalid manifest removing last scene) never mutates or prunes historical archive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ams-h1-rej-commit-'));
  try {
    await createProject(root, { title: 'Rejected commit test' });
    const file = join(root, 'project.json');
    let state = await readProject(file);

    // Perform 100 accepted edits
    for (let i = 1; i <= 100; i++) {
      const hex = ((i * 123456) % 0xFFFFFF).toString(16).padStart(6, '0');
      state = await editProject(file, { type: 'brand', patch: { accent: `#${hex}` } }, state.etag);
    }

    const beforeBytes = await readFile(file);
    const beforeEtag = state.etag;
    const historyDir = join(root, '.history');
    const archiveFilesBefore = (await readdir(historyDir)).filter(n => n.endsWith('.json') && !n.startsWith('.tmp-'));
    assert.equal(archiveFilesBefore.length, 100);

    const snapshotDigestsBefore = {};
    for (const name of archiveFilesBefore) {
      snapshotDigestsBefore[name] = (await readFile(join(historyDir, name))).toString('hex');
    }

    // Attempt invalid commit removing the only scene
    await assert.rejects(
      editProject(file, { type: 'remove-scene', sceneId: 'opening' }, beforeEtag),
      /must NOT have fewer than 1 items/
    );

    // Verify project bytes and ETag preserved
    const afterBytes = await readFile(file);
    const afterState = await readProject(file);
    assert.ok(beforeBytes.equals(afterBytes), 'Project bytes preserved after rejected commit');
    assert.equal(afterState.etag, beforeEtag, 'Project ETag preserved after rejected commit');

    // Verify NO archive snapshot was changed, added or pruned
    const archiveFilesAfter = (await readdir(historyDir)).filter(n => n.endsWith('.json') && !n.startsWith('.tmp-'));
    assert.equal(archiveFilesAfter.length, 100, 'Archive file count must remain 100');
    for (const name of archiveFilesAfter) {
      const currentDigest = (await readFile(join(historyDir, name))).toString('hex');
      assert.equal(currentDigest, snapshotDigestsBefore[name], `Snapshot ${name} must be unaltered`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('H1: corrupt external snapshot is healed from intact inline history before eviction; restore succeeds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ams-h1-corrupt-heal-'));
  try {
    await createProject(root, { title: 'Corrupt snapshot heal test' });
    const file = join(root, 'project.json');
    let state = await readProject(file);

    // Initial edit to create first revision in history
    const targetRevId = state.manifest.revision;
    state = await editProject(file, { type: 'brand', patch: { accent: '#112233' } }, state.etag);

    // Verify targetRevId exists both inline and in .history
    assert.ok(state.manifest.history.some(r => r.id === targetRevId));
    const historyDir = join(root, '.history');
    const targetSnapshotFile = join(historyDir, `${targetRevId}.json`);

    // Corrupt the external snapshot file on disk
    await writeFile(targetSnapshotFile, '{"corrupted": true, "garbage": 12345}');

    // Next edit should heal the external snapshot using the intact inline copy in before.history
    state = await editProject(file, { type: 'brand', patch: { accent: '#445566' } }, state.etag);

    // Verify external snapshot was healed
    const healedContent = await readFile(targetSnapshotFile, 'utf8');
    assert.notEqual(healedContent, '{"corrupted": true, "garbage": 12345}');
    assert.equal(JSON.parse(healedContent).id, targetRevId);

    // Perform 16 more edits to evict targetRevId from inline history
    for (let i = 1; i <= 16; i++) {
      const hex = ((i * 99999) % 0xFFFFFF).toString(16).padStart(6, '0');
      state = await editProject(file, { type: 'brand', patch: { accent: `#${hex}` } }, state.etag);
    }

    // Verify targetRevId is evicted from inline history
    assert.ok(!state.manifest.history.some(r => r.id === targetRevId));

    // Verify restore of targetRevId from external history succeeds
    const restored = await editProject(file, { type: 'restore', revisionId: targetRevId }, state.etag);
    assert.equal(restored.manifest.scenes[0].text, 'Corrupt snapshot heal test');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('H1: shape-corrupted external snapshot with matching ID is healed from intact inline history before eviction; restore succeeds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ams-h1-shape-heal-'));
  try {
    await createProject(root, { title: 'Shape corrupted snapshot heal test' });
    const file = join(root, 'project.json');
    let state = await readProject(file);

    const targetRevId = state.manifest.revision;
    state = await editProject(file, { type: 'brand', patch: { accent: '#112233' } }, state.etag);

    assert.ok(state.manifest.history.some(r => r.id === targetRevId));
    const historyDir = join(root, '.history');
    const targetSnapshotFile = join(historyDir, `${targetRevId}.json`);

    // Write shape-corrupted JSON: matching ID, but scenes: [] and missing video/audio/brand
    await writeFile(targetSnapshotFile, JSON.stringify({ id: targetRevId, scenes: [] }));

    // Next edit should heal the external snapshot using the intact inline copy
    state = await editProject(file, { type: 'brand', patch: { accent: '#445566' } }, state.etag);

    // Verify external snapshot was healed with valid shape
    const healed = JSON.parse(await readFile(targetSnapshotFile, 'utf8'));
    assert.equal(healed.id, targetRevId);
    assert.ok(Array.isArray(healed.scenes) && healed.scenes.length > 0);
    assert.ok(healed.video && healed.audio && healed.brand);

    // Perform 16 more edits to evict targetRevId from inline history
    for (let i = 1; i <= 16; i++) {
      const hex = ((i * 99999) % 0xFFFFFF).toString(16).padStart(6, '0');
      state = await editProject(file, { type: 'brand', patch: { accent: `#${hex}` } }, state.etag);
    }

    assert.ok(!state.manifest.history.some(r => r.id === targetRevId));

    // Verify restore succeeds
    const restored = await editProject(file, { type: 'restore', revisionId: targetRevId }, state.etag);
    assert.equal(restored.manifest.scenes[0].text, 'Shape corrupted snapshot heal test');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('H1: externally mutated snapshot with matching ID is healed from intact inline history before eviction; restore succeeds with original content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ams-h1-content-heal-'));
  try {
    await createProject(root, { title: 'Original retained content' });
    const file = join(root, 'project.json');
    let state = await readProject(file);

    const targetRevId = state.manifest.revision;
    state = await editProject(file, { type: 'brand', patch: { accent: '#112233' } }, state.etag);

    const intact = state.manifest.history.find(r => r.id === targetRevId);
    assert.ok(intact);
    const historyDir = join(root, '.history');
    const targetSnapshotFile = join(historyDir, `${targetRevId}.json`);

    // Write valid JSON with matching ID but altered scene text
    const altered = structuredClone(intact);
    altered.scenes[0].text = 'Altered corrupted title';
    await writeFile(targetSnapshotFile, JSON.stringify(altered));

    // Next edit should heal the external snapshot because content differs from intact inline copy
    state = await editProject(file, { type: 'brand', patch: { accent: '#445566' } }, state.etag);

    // Verify external snapshot was restored to original content
    const healed = JSON.parse(await readFile(targetSnapshotFile, 'utf8'));
    assert.equal(healed.scenes[0].text, 'Original retained content');

    // Perform 16 more edits to evict targetRevId from inline history
    for (let i = 1; i <= 16; i++) {
      const hex = ((i * 99999) % 0xFFFFFF).toString(16).padStart(6, '0');
      state = await editProject(file, { type: 'brand', patch: { accent: `#${hex}` } }, state.etag);
    }

    assert.ok(!state.manifest.history.some(r => r.id === targetRevId));

    // Verify restore returns original content, not altered text
    const restored = await editProject(file, { type: 'restore', revisionId: targetRevId }, state.etag);
    assert.equal(restored.manifest.scenes[0].text, 'Original retained content');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});



