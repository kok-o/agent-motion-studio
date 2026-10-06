import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import filesystem from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProject, importMedia, editProject, readProject, acceptGeneratedTake, generatedTakeRequestHash, ProjectPrecommitError } from '../../dist/project.js';
import { hashBytes, loadManifest } from '../../dist/spec.js';
import { findTools, runProcess } from '../../dist/runtime.js';
import { previewGeneratedTake } from '../../dist/preview.js';

test('atomic generated take acceptance preserves sources/history and receipts prevent replay after edits and restore', { timeout: 120000 }, async () => {
  const root = resolve('artifacts/generation/project-operation', randomUUID()); await mkdir(root, { recursive: true });
  const file = (await createProject(root)).project, tools = findTools();
  const original = join(root, 'original.mp4'), candidate = join(root, 'candidate.mp4');
  for (const [out, color] of [[original, 'red'], [candidate, 'blue']]) {
    await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=160x90:r=30:d=2`, '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', out]);
  }
  const imported = await importMedia(file, 'Original.mp4', await readFile(original));
  await editProject(file, { type: 'add-scene', scene: { id: 'shot', type: 'video', asset: imported.importedId, durationFrames: 30, trimStartSeconds: 0.5, fit: 'contain', focalPoint: { x: 0.3, y: 0.7 } } });
  const before = await readProject(file), beforeBytes = await readFile(file), previous = structuredClone(before.manifest.scenes[1]);
  const intent = { sceneId: 'shot', candidatePath: candidate, candidateSha256: hashBytes(await readFile(candidate)), baseEtag: before.etag, trimStartSeconds: 0, fit: 'cover', focalPoint: { x: 0.8, y: 0.2 }, operationId: 'accepted-shot' };
  intent.requestHash = generatedTakeRequestHash(intent);
  const changedCrop = { ...intent, focalPoint: { x: 0.9, y: 0.2 } };
  await assert.rejects(acceptGeneratedTake(file, changedCrop, before.etag), /fingerprint does not match/);
  assert.ok((await readFile(file)).equals(beforeBytes));
  const candidateBytes = await readFile(candidate);
  await rm(candidate);
  await assert.rejects(acceptGeneratedTake(file, intent, before.etag), error => error instanceof ProjectPrecommitError && error.code === 'ENOENT');
  assert.ok((await readFile(file)).equals(beforeBytes), 'missing candidate is a proven precommit failure');
  assert.equal((await readProject(file)).manifest.operationReceipts?.length ?? 0, 0);
  await writeFile(candidate, Buffer.concat([candidateBytes, Buffer.from('damaged')]));
  await assert.rejects(acceptGeneratedTake(file, intent, before.etag), error => error instanceof ProjectPrecommitError && error.code === 'PROJECT_EDIT' && /candidate changed after preview/.test(error.message));
  assert.ok((await readFile(file)).equals(beforeBytes));
  await writeFile(candidate, candidateBytes);
  const shortInterval = { ...intent, operationId: 'too-short', trimStartSeconds: 1.1 }; shortInterval.requestHash = generatedTakeRequestHash(shortInterval);
  await assert.rejects(acceptGeneratedTake(file, shortInterval, before.etag), error => error instanceof ProjectPrecommitError && error.code === 'TRIM_OUT_OF_RANGE');
  assert.ok((await readFile(file)).equals(beforeBytes), 'invalid interval cannot add registry/history or change the scene');
  const wrongType = { ...intent, operationId: 'wrong-type', sceneId: 'opening' }; wrongType.requestHash = generatedTakeRequestHash(wrongType);
  await assert.rejects(acceptGeneratedTake(file, wrongType, before.etag), /existing video scene only/);
  assert.ok((await readFile(file)).equals(beforeBytes));
  const originalRename = filesystem.rename;
  let renameAttempts = 0;
  filesystem.rename = async (from, to) => {
    if (to === resolve(file)) { renameAttempts++; throw Object.assign(new Error('Injected manifest rename refusal'), { code: 'EPERM' }); }
    return originalRename(from, to);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(acceptGeneratedTake(file, intent, before.etag), error => !(error instanceof ProjectPrecommitError) && error.code === 'EPERM');
  } finally { filesystem.rename = originalRename; syncBuiltinESMExports(); }
  assert.equal(renameAttempts, 1);
  assert.ok((await readFile(file)).equals(beforeBytes), 'a failed rename stays conservatively uncertain even when this fixture did not commit');
  const accepted = await acceptGeneratedTake(file, intent, before.etag);
  assert.equal(accepted.repeated, false); assert.notEqual(accepted.etag, before.etag);
  assert.equal(accepted.manifest.history.length, before.manifest.history.length + 1);
  assert.deepEqual(accepted.manifest.history.at(-1).scenes[1], previous);
  assert.deepEqual(accepted.manifest.scenes[0], before.manifest.scenes[0]);
  assert.equal(accepted.manifest.scenes[1].durationFrames, previous.durationFrames);
  assert.equal(accepted.manifest.scenes[1].trimStartSeconds, 0);
  assert.equal(accepted.manifest.scenes[1].fit, 'cover');
  assert.deepEqual(accepted.manifest.scenes[1].focalPoint, intent.focalPoint);
  assert.equal(hashBytes(await readFile(join(root, accepted.manifest.assets[accepted.importedId].path))), intent.candidateSha256);
  assert.equal(hashBytes(await readFile(join(root, accepted.manifest.assets[imported.importedId].path))), hashBytes(await readFile(original)));
  assert.equal(accepted.receipt.revisionId, accepted.manifest.revision);
  // Simulate a process restart before job acknowledgement: the candidate is no
  // longer available, but the same intent must return its accepted receipt.
  await rm(candidate);
  const acceptedBytes = await readFile(file);
  const repeated = await acceptGeneratedTake(file, intent, before.etag);
  assert.equal(repeated.repeated, true); assert.deepEqual(repeated.receipt, accepted.receipt);
  assert.ok((await readFile(file)).equals(acceptedBytes));
  await editProject(file, { type: 'edit-scene', sceneId: 'shot', patch: { fit: 'contain' } });
  const edited = await readFile(file); await acceptGeneratedTake(file, intent, before.etag);
  assert.ok((await readFile(file)).equals(edited), 'retry after newer edit does not reapply the take');
  await editProject(file, { type: 'restore-scene', sceneId: 'shot', revisionId: before.manifest.revision });
  const restored = await readProject(file), restoredBytes = await readFile(file);
  assert.deepEqual(restored.manifest.scenes[1], previous);
  await acceptGeneratedTake(file, intent, before.etag);
  assert.ok((await readFile(file)).equals(restoredBytes), 'retry after restore does not reapply the take');
  const different = { ...intent, fit: 'contain' }; different.requestHash = generatedTakeRequestHash(different);
  await assert.rejects(acceptGeneratedTake(file, different, before.etag), /another generated take intent/);
  await assert.rejects(acceptGeneratedTake(file, { ...intent, operationId: 'stale-new-operation' }, before.etag), error => error.code === 'PROJECT_CONFLICT');
  assert.ok((await readFile(file)).equals(restoredBytes));
  // A successful rename followed by a failed acknowledgement read must retain
  // the receipt and must never be reported as a proven precommit failure.
  await writeFile(candidate, candidateBytes);
  const nextIntent = { ...intent, operationId: 'post-commit-read-failure', baseEtag: restored.etag };
  nextIntent.requestHash = generatedTakeRequestHash(nextIntent);
  const originalReadFile = filesystem.readFile;
  let published = false, failedReads = 0;
  filesystem.rename = async (from, to) => { const result = await originalRename(from, to); if (to === resolve(file)) published = true; return result; };
  filesystem.readFile = async (...args) => {
    if (published && args[0] === file && failedReads === 0) { failedReads++; throw Object.assign(new Error('Injected read failure after accepted rename'), { code: 'EIO' }); }
    return originalReadFile(...args);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(acceptGeneratedTake(file, nextIntent, restored.etag), error => !(error instanceof ProjectPrecommitError) && error.code === 'EIO');
  } finally { filesystem.rename = originalRename; filesystem.readFile = originalReadFile; syncBuiltinESMExports(); }
  assert.equal(published, true); assert.equal(failedReads, 1);
  const afterReadFailure = await readProject(file), afterReadFailureBytes = await readFile(file);
  assert.equal(afterReadFailure.manifest.history.length, restored.manifest.history.length + 1);
  assert.equal(afterReadFailure.manifest.operationReceipts.filter(item => item.operationId === nextIntent.operationId).length, 1);
  await rm(candidate);
  const replayAfterReadFailure = await acceptGeneratedTake(file, nextIntent, restored.etag);
  assert.equal(replayAfterReadFailure.repeated, true);
  assert.ok((await readFile(file)).equals(afterReadFailureBytes));
  await editProject(file, { type: 'restore-scene', sceneId: 'shot', revisionId: restored.manifest.revision });
  assert.deepEqual((await readProject(file)).manifest.scenes[1], previous);
  await loadManifest(file);
  await writeFile(join(root, 'verification.json'), JSON.stringify({ passed: true, checks: ['single accepted commit', 'prior complete scene snapshot', 'scene duration preserved', 'new trim begins at zero', 'immutable old/new source hashes', 'missing/corrupt candidate and invalid interval proven precommit', 'rename refusal remains conservatively uncertain', 'post-rename read failure preserves receipt and replay', 'only existing video scenes supported', 'commit before job ack retry', 'replay after newer edit and restore', 'different same-operation intent rejected', 'stale new operation rejected'] }, null, 2));
});

test('24 accepted assets including a shared source allow exact candidate preview but refuse a new accepted asset', { timeout: 120000 }, async () => {
  const root = resolve('artifacts/generation/asset-cap', randomUUID()); await mkdir(root, { recursive: true });
  const candidate = join(root, 'candidate.mp4'), tools = findTools();
  await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=30:d=1', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', candidate]);
  const source = 'examples/coffee-ritual/assets/052fbf81e7340d7edff49391c2fe83e6d6472fd26b05a22665e51b39ae32dc9f.mp4';
  const original = await readFile(source); await writeFile(join(root, 'original.mp4'), original);
  const manifest = JSON.parse(await readFile('examples/smoke/manifest.json', 'utf8'));
  manifest.schemaVersion = 2; manifest.revision = randomUUID(); manifest.history = [];
  manifest.assets = Object.fromEntries(Array.from({ length: 23 }, (_, i) => [`source-${i}`, { type: 'video', path: 'original.mp4', sha256: hashBytes(original) }]));
  // A legal custom asset ID matching the previous deterministic candidate ID
  // must never be overwritten by preview's temporary registry entry.
  const collisionId = `candidate-${hashBytes(await readFile(candidate)).slice(0, 24)}`;
  const reference = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6SUAAAAASUVORK5CYII=', 'base64');
  await writeFile(join(root, 'reference.png'), reference);
  manifest.assets[collisionId] = { type: 'image', path: 'reference.png', sha256: hashBytes(reference) };
  manifest.scenes = [{ id: 'shot', type: 'video', asset: 'source-0', durationFrames: 30 }, { id: 'shared', type: 'video', asset: 'source-0', durationFrames: 30 }, { id: 'custom-image', type: 'product_zoom', asset: collisionId, caption: 'CUSTOM', durationFrames: 30 }];
  manifest.audio = { narration: { provider: 'none' }, music: { provider: 'none' } };
  manifest.history = [{ id: randomUUID(), label: 'History-only source must remain validated', createdAt: new Date().toISOString(), scenes: [{ id: 'shot', type: 'video', asset: 'source-22', durationFrames: 30 }], video: structuredClone(manifest.video), audio: structuredClone(manifest.audio), brand: structuredClone(manifest.brand) }];
  const file = join(root, 'project.json'); await writeFile(file, JSON.stringify(manifest));
  const before = await readProject(file), beforeBytes = await readFile(file);
  const intent = { sceneId: 'shot', candidatePath: candidate, candidateSha256: hashBytes(await readFile(candidate)), baseEtag: before.etag, trimStartSeconds: 0, fit: 'cover', focalPoint: { x: 0.5, y: 0.5 }, operationId: 'full-registry' };
  intent.requestHash = generatedTakeRequestHash(intent);
  const preview = await previewGeneratedTake(file, intent, candidate, join(root, 'candidate-preview'));
  assert.equal(preview.verification.passed, true); assert.equal(preview.totalFrames, 30); assert.equal(preview.stale, false);
  assert.ok((await readFile(file)).equals(beforeBytes));
  const afterPreview = await readProject(file);
  assert.equal(afterPreview.etag, before.etag); assert.equal(Object.keys(afterPreview.manifest.assets).length, 24);
  assert.deepEqual(afterPreview.manifest.history, before.manifest.history);
  assert.equal(afterPreview.manifest.scenes[1].asset, 'source-0', 'candidate has its own temporary asset; shared source remains accepted');
  assert.equal(afterPreview.manifest.assets[collisionId].type, 'image');
  await assert.rejects(acceptGeneratedTake(file, intent, before.etag), /registry is full/);
  assert.ok((await readFile(file)).equals(beforeBytes));
  assert.equal(hashBytes(await readFile(candidate)), intent.candidateSha256);
  assert.equal(hashBytes(await readFile(join(root, 'original.mp4'))), hashBytes(original));
  await writeFile(join(root, 'verification.json'), JSON.stringify({ passed: true, checks: ['24 accepted assets and history-only source validated', 'shared accepted source remains available', 'exact 30-frame candidate preview succeeds', 'accepted bytes/ETag/history/registry unchanged by preview', 'accept rejects cap without deleting candidate or sources'] }, null, 2));
});
