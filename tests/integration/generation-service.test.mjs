import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GenerationService } from '../../dist/generation.js';
import { readProject, editProject, generatedTakeRequestHash } from '../../dist/project.js';
import { hashBytes, loadManifest } from '../../dist/spec.js';
import { render } from '../../dist/engine.js';
import { findTools, runProcess } from '../../dist/runtime.js';
import { createControlledProvider } from '../fixtures/generation-http-provider.mjs';

async function fixture(name) {
  const root = resolve('artifacts/generation/service', `${name}-${randomUUID()}`); await mkdir(root, { recursive: true });
  const tools = findTools(), manifest = JSON.parse(await readFile('examples/smoke/manifest.json', 'utf8'));
  manifest.schemaVersion = 2; manifest.revision = randomUUID(); manifest.history = []; manifest.assets = {};
  manifest.audio = { narration: { provider: 'none' }, music: { provider: 'none' } }; manifest.scenes = [];
  for (const [id, color] of [['before', 'red'], ['target', 'green'], ['after', 'blue'], ['candidate', 'yellow']]) {
    const path = join(root, `${id}.mp4`);
    await runProcess(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=160x90:r=30:d=1`, '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', path]);
    if (id !== 'candidate') {
      manifest.assets[id] = { type: 'video', path: `${id}.mp4`, sha256: hashBytes(await readFile(path)) };
      manifest.scenes.push({ id, type: 'video', asset: id, durationFrames: 30, trimStartSeconds: 0, fit: 'cover', focalPoint: { x: 0.5, y: 0.5 } });
    }
  }
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6SUAAAAASUVORK5CYII=', 'base64');
  await writeFile(join(root, 'reference.png'), image);
  manifest.assets.reference = { type: 'image', path: 'reference.png', sha256: hashBytes(image) };
  const file = join(root, 'project.json'); await writeFile(file, JSON.stringify(manifest, null, 2));
  const http = await createControlledProvider(await readFile(join(root, 'candidate.mp4')));
  return { root, file, tools, http, service: new GenerationService(file, http.provider) };
}
const request = intentId => ({ intentId, sceneId: 'target', prompt: 'Controlled offline replacement test.', referenceAssetId: 'reference', durationSeconds: 7.5625, resolution: '480p' });
const approval = job => ({ requestHash: job.requestHash, maxSubmissions: 1, maxCostUsd: job.estimate.usd, uploadReference: true });
const draft = { trimStartSeconds: 0, fit: 'cover', focalPoint: { x: 0.5, y: 0.5 } };
async function frames(file, tools) {
  const result = await runProcess(tools.ffmpeg, ['-v', 'error', '-threads', '1', '-i', file, '-map', '0:v:0', '-an', '-f', 'framemd5', '-']);
  return result.stdout.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim());
}

test('controlled HTTP submission has consent/key gates, duplicate/restart protection, unknown outcomes and corrupt-state protection', { timeout: 120000 }, async () => {
  const { root, file, http, service } = await fixture('lifecycle');
  try {
    const initialBytes = await readFile(file), input = request('same-intent');
    const job = await service.prepare(input), repeated = await service.prepare(input);
    assert.equal(repeated.id, job.id); assert.equal(http.counts.submits, 0);
    assert.ok((await readFile(file)).equals(initialBytes), 'prepare does not edit the accepted project');
    await assert.rejects(service.prepare({ ...input, prompt: 'different' }), error => error.code === 'GENERATION_INTENT_CONFLICT');
    await assert.rejects(service.submit(job.id, { ...approval(job), uploadReference: false }), error => error.code === 'GENERATION_APPROVAL');
    await assert.rejects(service.submit(job.id, { ...approval(job), requestHash: 'a'.repeat(64) }), error => error.code === 'GENERATION_APPROVAL');
    await assert.rejects(service.submit(job.id, { ...approval(job), maxCostUsd: 0 }), error => error.code === 'GENERATION_APPROVAL');
    http.control.configured = false;
    await assert.rejects(service.submit(job.id, approval(job)), error => error.code === 'GENERATION_AUTH');
    assert.equal(http.counts.submits, 0);
    http.control.configured = true;
    await assert.rejects(service.reject(job.id), error => error.code === 'GENERATION_STATE');
    assert.equal((await service.get(job.id)).decision, 'pending');
    const capabilities = http.provider.capabilities;
    http.provider.capabilities = () => ({ ...capabilities(), model: 'changed-after-approval' });
    await assert.rejects(service.submit(job.id, approval(job)), error => error.code === 'GENERATION_APPROVAL_STALE');
    assert.equal(http.counts.submits, 0);
    http.provider.capabilities = capabilities;
    const changedEstimate = await service.prepare({ ...input, intentId: '720-intent', resolution: '720p' });
    assert.equal(changedEstimate.estimate.usd, 0.11);
    await assert.rejects(service.submit(changedEstimate.id, approval(job)), error => error.code === 'GENERATION_APPROVAL');
    // The controlled server accepts the POST and drops its response. A restart
    // can observe uncertainty but must never issue a second paid-style POST.
    http.control.dropSubmit = true;
    const unknown = await service.submit(job.id, approval(job));
    assert.equal(unknown.status, 'submission_unknown'); assert.equal(unknown.submissions, 1); assert.equal(http.counts.submits, 1);
    const restarted = new GenerationService(file, http.provider);
    assert.equal((await restarted.submit(job.id, approval(job))).status, 'submission_unknown');
    assert.equal((await restarted.resume(job.id)).status, 'submission_unknown');
    assert.equal(http.counts.submits, 1); assert.equal(http.counts.status, 0);
    await assert.rejects(restarted.submit(changedEstimate.id, approval(changedEstimate)), error => error.code === 'GENERATION_BUSY');
    await restarted.stop(job.id);
    const afterRestart = new GenerationService(file, http.provider);
    await assert.rejects(afterRestart.submit(changedEstimate.id, approval(changedEstimate)), error => error.code === 'GENERATION_BUSY');
    const resolution = { requestHash: job.requestHash, accountChecked: true, acknowledgePossibleCharge: true };
    await assert.rejects(afterRestart.resolveUnknown(job.id, { ...resolution, acknowledgePossibleCharge: false }), error => error.code === 'GENERATION_RESOLUTION');
    await assert.rejects(afterRestart.resolveUnknown(job.id, { ...resolution, requestHash: 'f'.repeat(64) }), error => error.code === 'GENERATION_RESOLUTION');
    await assert.rejects(afterRestart.resolveUnknown(changedEstimate.id, resolution), error => error.code === 'GENERATION_STATE');
    const resolved = await afterRestart.resolveUnknown(job.id, resolution);
    assert.equal(resolved.status, 'submission_unknown'); assert.equal(resolved.submissions, 1);
    assert.deepEqual(resolved.unknownResolution, (await afterRestart.resolveUnknown(job.id, resolution)).unknownResolution);
    assert.equal(http.counts.submits, 1); assert.equal(http.counts.status, 0);
    assert.ok((await readFile(file)).equals(initialBytes));
    assert.equal((await new GenerationService(file, http.provider).get(job.id)).unknownResolution.kind, 'user_acknowledged');
    await afterRestart.submit(job.id, approval(job)); await afterRestart.resume(job.id);
    assert.equal(http.counts.submits, 1, 'resolved intent never resubmits its original POST');
    http.control.dropSubmit = false;
    await assert.rejects(afterRestart.submit(changedEstimate.id, approval(job)), error => error.code === 'GENERATION_APPROVAL');
    assert.equal(http.counts.submits, 1, 'new intent still needs its own approval');
    assert.equal((await afterRestart.submit(changedEstimate.id, approval(changedEstimate))).status, 'queued');
    assert.equal(http.counts.submits, 2, 'only a separately approved new intent sends another POST');
    // Syntactically valid JSON must also satisfy lifecycle invariants: changing
    // an uncertain submitted state back to prepared cannot enable another POST.
    const saved = await restarted.store.read(job.id);
    await restarted.store.write(job.id, { ...saved, status: 'prepared' });
    const inconsistentPath = await restarted.store.path('jobs', `${job.id}.json`), inconsistentBytes = await readFile(inconsistentPath);
    await assert.rejects(restarted.submit(job.id, approval(job)), error => error.code === 'GENERATION_CORRUPT');
    assert.ok((await readFile(inconsistentPath)).equals(inconsistentBytes)); assert.equal(http.counts.submits, 2);
    await restarted.store.write(job.id, saved);
    const jobPath = await service.store.path('jobs', `${job.id}.json`), corrupt = Buffer.from('{damaged');
    await writeFile(jobPath, corrupt);
    await assert.rejects(restarted.get(job.id), error => error.code === 'GENERATION_CORRUPT');
    await assert.rejects(restarted.submit(job.id, approval(job)), error => error.code === 'GENERATION_CORRUPT');
    assert.ok((await readFile(jobPath)).equals(corrupt)); assert.equal(http.counts.submits, 2);
    await writeFile(join(root, 'verification.json'), JSON.stringify({ passed: true, provider: 'controlled local HTTP', submits: http.counts.submits, checks: ['prepare without accepted mutation', 'consent/key/budget/request gates', 'duplicate intent', 'changed estimate', 'unknown accepted POST has no blind retry after restart', 'unknown job blocks second submission', 'corrupt state preserved'] }, null, 2));
  } finally { await http.close(); }
});

test('candidate download/preview/atomic accept/restart/export/restore preserves the complete controlled film', { timeout: 360000 }, async () => {
  const { root, file, http, tools, service } = await fixture('workflow');
  try {
    const originalState = await readProject(file), sourceHashes = Object.fromEntries(Object.entries(originalState.manifest.assets).map(([id, asset]) => [id, asset.sha256]));
    await render(file, join(root, 'original'), { noCache: true });
    const originalFrames = await frames(join(root, 'original/output.mp4'), tools);
    const job = await service.prepare(request('single-live-style-intent'));
    const queued = await service.submit(job.id, approval(job)); assert.equal(queued.status, 'queued');
    assert.equal((await service.submit(job.id, approval(job))).status, 'queued'); assert.equal(http.counts.submits, 1);
    const restarted = new GenerationService(file, http.provider);
    assert.equal((await restarted.resume(job.id)).status, 'output_ready');
    assert.equal(http.counts.status, 1); assert.deepEqual(http.counts.remoteIds, ['remote-1']);
    const untouched = await readFile(file);
    http.control.invalidDownload = true;
    await assert.rejects(restarted.download(job.id));
    assert.equal((await restarted.get(job.id)).status, 'output_ready'); assert.ok((await readFile(file)).equals(untouched));
    http.control.invalidDownload = false; http.control.interruptedDownloads = 1;
    await assert.rejects(restarted.download(job.id));
    assert.equal((await restarted.get(job.id)).status, 'output_ready'); assert.equal(http.counts.submits, 1);
    http.control.expiredDownloads = 1;
    const ready = await restarted.download(job.id); assert.equal(ready.status, 'ready'); assert.equal(http.counts.submits, 1);
    const candidate = await restarted.candidateFile(job.id);
    await writeFile(candidate, Buffer.concat([await readFile(candidate), Buffer.from('tamper')]));
    await assert.rejects(restarted.candidateFile(job.id), error => error.code === 'CANDIDATE_CHANGED');
    await restarted.download(job.id); // Repairs a private corrupted candidate, never generates again.
    assert.equal(http.counts.submits, 1);
    const acceptedBeforePreview = await readProject(file), bytesBeforePreview = await readFile(file);
    let preview = await restarted.preview(job.id, draft, acceptedBeforePreview.etag);
    assert.ok((await readFile(file)).equals(bytesBeforePreview));
    for (const damage of ['missing', 'corrupt']) {
      const path = await restarted.candidateFile(job.id), stalePreview = preview;
      if (damage === 'missing') await rm(path); else await writeFile(path, 'damaged private candidate');
      await assert.rejects(restarted.accept(job.id, draft, preview.previewId, acceptedBeforePreview.etag, `precommit-${damage}`), error => error.constructor.name === 'ProjectPrecommitError');
      assert.ok((await readFile(file)).equals(bytesBeforePreview), `${damage} candidate failure must not edit project`);
      const failed = await restarted.get(job.id);
      assert.equal(failed.acceptance, undefined); assert.equal(failed.preview, undefined);
      assert.equal((await readProject(file)).manifest.operationReceipts?.length ?? 0, 0);
      const recovery = new GenerationService(file, http.provider);
      await recovery.download(job.id);
      await assert.rejects(recovery.accept(job.id, draft, stalePreview.previewId, acceptedBeforePreview.etag, `retry-${damage}`), error => error.code === 'GENERATION_PREVIEW_STALE');
      preview = await recovery.preview(job.id, draft, acceptedBeforePreview.etag);
      assert.equal(http.counts.submits, 1, 'recovery downloads the existing result without another generation');
    }
    assert.equal((await readProject(file)).etag, acceptedBeforePreview.etag);
    assert.equal((await readProject(file)).manifest.history.length, acceptedBeforePreview.manifest.history.length);
    assert.equal(Object.keys((await readProject(file)).manifest.assets).length, Object.keys(acceptedBeforePreview.manifest.assets).length);
    await assert.rejects(restarted.accept(job.id, { ...draft, fit: 'contain' }, preview.previewId, acceptedBeforePreview.etag, 'wrong-crop'), error => error.code === 'GENERATION_PREVIEW_STALE');
    assert.ok((await readFile(file)).equals(bytesBeforePreview));
    // A remote job holds no project edit lock; a later accepted edit is preserved.
    await editProject(file, { type: 'edit-scene', sceneId: 'target', patch: { focalPoint: { x: 0.8, y: 0.2 } } }, acceptedBeforePreview.etag);
    await assert.rejects(restarted.accept(job.id, draft, preview.previewId, acceptedBeforePreview.etag, 'conflicted-accept'), error => error.code === 'PROJECT_CONFLICT');
    const beforeAccept = await readProject(file), refreshedPreview = await restarted.preview(job.id, draft, beforeAccept.etag), operationId = randomUUID();
    // A pre-update/crashed saved intent cannot be assumed to have failed before
    // commit. Rehydrate exactly its original bytes without resetting that intent.
    const savedIntent = { ...draft, sceneId: 'target', candidateSha256: ready.candidate.sha256, baseEtag: beforeAccept.etag };
    const pending = await restarted.store.read(job.id);
    pending.acceptance = { operationId, intent: savedIntent, requestHash: generatedTakeRequestHash(savedIntent) };
    await restarted.store.write(job.id, pending);
    await rm(await restarted.candidateFile(job.id));
    await assert.rejects(restarted.accept(job.id, draft, refreshedPreview.previewId, beforeAccept.etag, operationId));
    assert.deepEqual((await restarted.store.read(job.id)).acceptance, pending.acceptance);
    http.control.outputOverride = await readFile(join(root, 'before.mp4'));
    await assert.rejects(restarted.download(job.id), error => error.code === 'GENERATION_ACCEPT_CONFLICT');
    assert.deepEqual((await restarted.store.read(job.id)).acceptance, pending.acceptance);
    http.control.outputOverride = null;
    await new GenerationService(file, http.provider).download(job.id);
    assert.deepEqual((await restarted.store.read(job.id)).acceptance, pending.acceptance);
    assert.equal(http.counts.submits, 1);
    assert.equal((await readProject(file)).etag, beforeAccept.etag);
    const write = restarted.store.write.bind(restarted.store); let ackFailed = false;
    restarted.store.write = async (id, value) => {
      if (!ackFailed && value.decision === 'accepted' && value.acceptance?.revisionId) { ackFailed = true; throw new Error('controlled sidecar acknowledgement failure'); }
      return write(id, value);
    };
    await assert.rejects(restarted.accept(job.id, draft, refreshedPreview.previewId, beforeAccept.etag, operationId));
    assert.equal(ackFailed, true);
    restarted.store.write = write;
    const afterCommit = await readProject(file), receipt = afterCommit.manifest.operationReceipts.find(item => item.operationId === operationId);
    assert.ok(receipt); assert.equal(afterCommit.manifest.history.length, beforeAccept.manifest.history.length + 1);
    assert.equal(afterCommit.manifest.scenes[1].durationFrames, 30); assert.equal(afterCommit.manifest.scenes[1].trimStartSeconds, 0);
    const promoted = afterCommit.manifest.assets[afterCommit.manifest.scenes[1].asset];
    assert.equal(hashBytes(await readFile(join(root, promoted.path))), ready.candidate.sha256);
    await rm(await restarted.candidateFile(job.id));
    const recovered = new GenerationService(file, http.provider), committedBytes = await readFile(file);
    assert.equal((await recovered.get(job.id)).decision, 'accepted', 'read-only reload reconciles the authoritative receipt before an explicit retry');
    assert.equal((await recovered.list()).find(item => item.id === job.id).decision, 'accepted');
    const retry = await recovered.accept(job.id, draft, refreshedPreview.previewId, beforeAccept.etag, operationId);
    assert.equal(retry.repeated, true); assert.equal(retry.receipt.revisionId, receipt.revisionId);
    assert.ok((await readFile(file)).equals(committedBytes), 'receipt recovers despite missing candidate bytes');
    assert.equal((await recovered.get(job.id)).decision, 'accepted'); assert.equal(http.counts.submits, 1);
    await render(file, join(root, 'changed'), { noCache: true });
    const changedFrames = await frames(join(root, 'changed/output.mp4'), tools), previewFrames = await frames(refreshedPreview.output, tools);
    assert.deepEqual(previewFrames, changedFrames.slice(30, 60));
    assert.deepEqual(changedFrames.slice(0, 30), originalFrames.slice(0, 30));
    assert.deepEqual(changedFrames.slice(60, 90), originalFrames.slice(60, 90));
    assert.notDeepEqual(changedFrames.slice(30, 60), originalFrames.slice(30, 60));
    await editProject(file, { type: 'edit-scene', sceneId: 'target', patch: { fit: 'contain' } });
    const newerBytes = await readFile(file);
    await recovered.accept(job.id, draft, refreshedPreview.previewId, beforeAccept.etag, operationId);
    assert.ok((await readFile(file)).equals(newerBytes));
    await editProject(file, { type: 'restore-scene', sceneId: 'target', revisionId: beforeAccept.manifest.revision });
    const restoredBytes = await readFile(file);
    await recovered.accept(job.id, draft, refreshedPreview.previewId, beforeAccept.etag, operationId);
    assert.ok((await readFile(file)).equals(restoredBytes));
    await render(file, join(root, 'restored'), { noCache: true });
    assert.deepEqual(await frames(join(root, 'restored/output.mp4'), tools), originalFrames);
    for (const [id, sha256] of Object.entries(sourceHashes)) assert.equal(hashBytes(await readFile(join(root, originalState.manifest.assets[id].path))), sha256);
    assert.equal(hashBytes(await readFile(join(root, promoted.path))), ready.candidate.sha256);
    await loadManifest(file);
    await writeFile(join(root, 'verification.json'), JSON.stringify({ passed: true, provider: 'controlled local HTTP', liveProvider: 'NOT RUN', submits: http.counts.submits, httpCounts: http.counts, checks: ['resume same remote ID', 'damaged/interrupted/expired downloads', 'corrupted candidate repaired without generation', 'preview does not write accepted state', 'changed crop rejects old preview', 'external target edit conflicts', 'receipt recovers commit before job ack without candidate file', 'exact preview/full export frames', 'other scenes preserve 60 decoded frames', 'restore preserves all 90 original decoded frames', 'old and new source hashes remain', 'old accept after later edits and restore never reapplies'] }, null, 2));
  } finally { await http.close(); }
});
