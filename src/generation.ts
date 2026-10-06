import { readFile, rename, rm, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { GenerationStore, checkedId, generationError } from './generation-store.js';
import { createReplicateProvider, type GenerationProvider } from './generation-provider.js';
import { loadManifest, hashBytes } from './spec.js';
import { readProject, generatedTakeRequestHash, acceptGeneratedTake, ProjectPrecommitError, type GeneratedTakeDraft } from './project.js';
import { previewGeneratedTake } from './preview.js';
import { probeSource } from './media.js';
import { runProcess } from './runtime.js';
import { StudioError } from './errors.js';

export type GenerationRequest = { intentId: string; sceneId: string; prompt: string; referenceAssetId: string; durationSeconds: number; resolution: '480p' | '720p' };
export type CandidateDraft = { trimStartSeconds: number; fit: 'cover' | 'contain'; focalPoint: { x: number; y: number } };
export type GenerationApproval = { requestHash: string; maxSubmissions: 1; maxCostUsd: number; uploadReference: true };
export type UnknownResolution = { requestHash: string; accountChecked: true; acknowledgePossibleCharge: true };
type Candidate = { sha256: string; bytes: number; durationSeconds: number; sourceFps?: number; width?: number; height?: number };
type Status = 'prepared' | 'submitting' | 'submission_unknown' | 'queued' | 'running' | 'output_ready' | 'downloading' | 'ready' | 'failed' | 'cancelled';
type Job = {
  schemaVersion: 1; id: string; createdAt: string; updatedAt: string; inputHash: string; requestHash: string;
  request: GenerationRequest; provider: string; model: string; baseEtag: string; sceneDurationSeconds: number;
  referenceSha256: string; referenceMime: string; estimate: { usd: number; source: string; date: string; note: string };
  status: Status; submissions: number; decision: 'pending' | 'accepted' | 'rejected'; remoteId?: string;
  approval?: GenerationApproval; candidate?: Candidate; stopped?: boolean; nextPollAt?: string;
  resolution?: UnknownResolution & { kind: 'user_acknowledged'; at: string };
  preview?: { previewId: string; requestHash: string; baseEtag: string; draft: CandidateDraft };
  acceptance?: { operationId: string; intent: GeneratedTakeDraft; requestHash: string; revisionId?: string };
  error?: { code: string; message: string };
};
const hash = (value: unknown) => hashBytes(JSON.stringify(value));
const states: Status[] = ['prepared', 'submitting', 'submission_unknown', 'queued', 'running', 'output_ready', 'downloading', 'ready', 'failed', 'cancelled'];
const now = () => new Date().toISOString();
const exactKeys = (value: unknown, keys: string[]) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
function normalizeRequest(value: GenerationRequest): GenerationRequest {
  if (!exactKeys(value, ['intentId', 'sceneId', 'prompt', 'referenceAssetId', 'durationSeconds', 'resolution']) || typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 2000 || !['480p', '720p'].includes(value.resolution) || value.durationSeconds !== 7.5625) throw generationError('GENERATION_REQUEST', 'Use a prompt of 1–2000 characters, 480p or 720p, and 7.5625 seconds (121 frames at 16 fps).');
  return { intentId: checkedId(value.intentId), sceneId: checkedId(value.sceneId), prompt: value.prompt.trim(), referenceAssetId: checkedId(value.referenceAssetId), durationSeconds: 7.5625, resolution: value.resolution };
}
function validateJob(value: unknown, id: string): Job {
  const job = value as Job;
  try {
    if (!job || job.schemaVersion !== 1 || job.id !== id || !states.includes(job.status) || !['pending', 'accepted', 'rejected'].includes(job.decision) || !Number.isInteger(job.submissions) || job.submissions < 0 || job.submissions > 1 || !/^[a-f0-9]{64}$/.test(job.baseEtag) || !/^[a-f0-9]{64}$/.test(job.referenceSha256) || !Number.isFinite(job.sceneDurationSeconds) || job.sceneDurationSeconds <= 0 || job.sceneDurationSeconds > 7.5625 || !Number.isFinite(job.estimate?.usd) || job.estimate.usd < 0 || (job.remoteId && !/^[a-zA-Z0-9_-]{1,128}$/.test(job.remoteId)) || !Number.isFinite(Date.parse(job.createdAt)) || !Number.isFinite(Date.parse(job.updatedAt))) throw new Error();
    if ((job.status === 'prepared' && (job.submissions !== 0 || job.remoteId)) || (['submitting', 'submission_unknown', 'queued', 'running', 'output_ready', 'downloading', 'ready'].includes(job.status) && job.submissions !== 1) || (['queued', 'running', 'output_ready', 'downloading', 'ready'].includes(job.status) && !job.remoteId) || (job.status === 'ready' && !job.candidate) || (job.decision === 'accepted' && !job.acceptance)) throw new Error();
    const request = normalizeRequest(job.request);
    if (job.inputHash !== hash(request) || job.requestHash !== requestFingerprint(job)) throw new Error();
    if (job.candidate && (!/^[a-f0-9]{64}$/.test(job.candidate.sha256) || !Number.isInteger(job.candidate.bytes) || job.candidate.bytes < 1 || job.candidate.bytes > 512 * 1024 * 1024 || !Number.isFinite(job.candidate.durationSeconds))) throw new Error();
    if (job.preview && (!job.candidate || job.preview.requestHash !== generatedTakeRequestHash({ ...job.preview.draft, sceneId: request.sceneId, candidateSha256: job.candidate.sha256, baseEtag: job.preview.baseEtag }))) throw new Error();
    if (job.acceptance && job.acceptance.requestHash !== generatedTakeRequestHash(job.acceptance.intent)) throw new Error();
    if (job.resolution && (job.status !== 'submission_unknown' || job.remoteId || job.submissions !== 1 || job.resolution.kind !== 'user_acknowledged' || job.resolution.requestHash !== job.requestHash || job.resolution.accountChecked !== true || job.resolution.acknowledgePossibleCharge !== true || !Number.isFinite(Date.parse(job.resolution.at)))) throw new Error();
    return job;
  } catch { throw generationError('GENERATION_CORRUPT', 'Saved generation state is invalid. It was preserved; do not submit again.'); }
}
function requestFingerprint(job: Pick<Job, 'request' | 'baseEtag' | 'referenceSha256' | 'provider' | 'model' | 'estimate'>) { return hash({ request: job.request, baseEtag: job.baseEtag, referenceSha256: job.referenceSha256, provider: job.provider, model: job.model, estimate: job.estimate }); }
function safeError(error: unknown, fallback = 'GENERATION_FAILED') {
  if (error instanceof StudioError && /^(GENERATION_|PROVIDER_|REPLICATE_|SUBMISSION_UNKNOWN|PROJECT_CONFLICT|PROJECT_BUSY|CANDIDATE_)/.test(error.code)) return { code: error.code, message: error.message };
  return { code: fallback, message: 'Operation failed. Saved job and accepted project were retained. Check local configuration or retry the same result download.' };
}
export class GenerationService {
  readonly store: GenerationStore;
  constructor(readonly file: string, readonly provider: GenerationProvider = createReplicateProvider()) { this.file = realpathSync(resolve(file)); this.store = new GenerationStore(this.file); }
  capabilities() { return this.provider.capabilities(); }
  private async read(id: string) { return validateJob(await this.store.read(id), id); }
  private async save(job: Job) { job.updatedAt = now(); validateJob(job, job.id); await this.store.write(job.id, job); }
  private public(job: Job) {
    return { id: job.id, createdAt: job.createdAt, updatedAt: job.updatedAt, sceneId: job.request.sceneId, status: job.status, requestHash: job.requestHash, provider: job.provider, model: job.model, prompt: job.request.prompt, referenceAssetId: job.request.referenceAssetId, durationSeconds: job.request.durationSeconds, resolution: job.request.resolution, sceneDurationSeconds: job.sceneDurationSeconds, estimate: job.estimate, submissions: job.submissions, decision: job.decision, candidate: job.candidate, preview: job.preview, error: job.error, stopped: job.stopped, nextPollAt: job.nextPollAt, unknownResolution: job.resolution, acceptance: job.acceptance ? { operationId: job.acceptance.operationId, revisionId: job.acceptance.revisionId } : undefined };
  }
  private async view(job: Job) {
    // Read-only reconciliation makes a committed take visible after an ack crash
    // and browser reload, without requiring the original candidate file/preview.
    if (job.acceptance) {
      const receipt = (await readProject(this.file)).manifest.operationReceipts?.find(item => item.operationId === job.acceptance!.operationId);
      if (receipt) {
        if (receipt.requestHash !== job.acceptance.requestHash) throw generationError('GENERATION_CORRUPT', 'Saved acceptance and project receipt disagree. Keep both files for diagnosis.');
        job.decision = 'accepted'; job.acceptance.revisionId = receipt.revisionId; delete job.error;
      }
    }
    return this.public(job);
  }
  async list() { const jobs = []; for (const id of await this.store.ids()) jobs.push(await this.view(await this.read(id))); return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async get(id: string) { return this.view(await this.read(id)); }
  async prepare(input: GenerationRequest) {
    const request = normalizeRequest(input), inputHash = hash(request);
    return this.store.locked(async () => {
      for (const id of await this.store.ids()) {
        const old = await this.read(id);
        if (old.request.intentId === request.intentId) {
          if (old.inputHash !== inputHash) throw generationError('GENERATION_INTENT_CONFLICT', 'This intent ID belongs to different parameters. Use a new explicit intent.');
          return this.public(old);
        }
      }
      const before = await readProject(this.file), spec = await loadManifest(this.file), scene = before.manifest.scenes.find(item => item.id === request.sceneId);
      if ((await readProject(this.file)).etag !== before.etag) throw generationError('PROJECT_CONFLICT', 'Project changed during preparation. Refresh.');
      if (!scene || scene.type !== 'video' || scene.durationFrames / 30 > request.durationSeconds) throw generationError('GENERATION_SCENE', 'Choose an existing video scene of at most 7.5625 seconds.');
      if (before.manifest.scenes.some(item => item.narration || item.captions)) throw generationError('GENERATION_PREVIEW_UNAVAILABLE', 'Exact candidate preview currently requires a project without narration/captions.');
      if (Object.keys(before.manifest.assets).length >= 24) throw generationError('GENERATION_ASSET_CAP', 'Accepted registry is full (24 assets); generation cannot be accepted.');
      const reference = spec.assets[request.referenceAssetId];
      if (!reference || reference.type !== 'image' || reference.bytes > 262144) throw generationError('GENERATION_REFERENCE', 'Choose an imported PNG/JPEG reference no larger than 256 KiB.');
      const caps = this.capabilities();
      const estimate = { ...caps.estimate, usd: caps.estimateByResolution?.[request.resolution] ?? caps.estimate.usd };
      const job: Job = { schemaVersion: 1, id: randomUUID(), createdAt: now(), updatedAt: now(), request, inputHash, requestHash: '', provider: caps.provider, model: caps.model, baseEtag: before.etag, sceneDurationSeconds: scene.durationFrames / 30, referenceSha256: reference.hash, referenceMime: /\.png$/i.test(reference.path) ? 'image/png' : 'image/jpeg', estimate, status: 'prepared', submissions: 0, decision: 'pending' };
      job.requestHash = requestFingerprint(job); await this.save(job); return this.public(job);
    });
  }
  async submit(id: string, approval: GenerationApproval) {
    return this.store.locked(async () => {
      const job = await this.read(id);
      if (job.status === 'submitting') { job.status = 'submission_unknown'; await this.save(job); }
      if (job.status !== 'prepared') return this.public(job);
      if (job.decision !== 'pending') throw generationError('GENERATION_STATE', 'A rejected intent cannot be submitted.');
      if (!exactKeys(approval, ['requestHash', 'maxSubmissions', 'maxCostUsd', 'uploadReference']) || approval.requestHash !== job.requestHash || approval.maxSubmissions !== 1 || approval.uploadReference !== true || !Number.isFinite(approval.maxCostUsd) || approval.maxCostUsd < job.estimate.usd) throw generationError('GENERATION_APPROVAL', 'Approve this exact request, reference upload, one submission and a sufficient USD estimate budget.');
      const caps = this.capabilities();
      if (!caps.configured) throw generationError('GENERATION_AUTH', 'Configure REPLICATE_API_TOKEN in the server environment. No request was sent.');
      const currentEstimate = { ...caps.estimate, usd: caps.estimateByResolution?.[job.request.resolution] ?? caps.estimate.usd };
      if (job.provider !== caps.provider || job.model !== caps.model || hash(currentEstimate) !== hash(job.estimate)) throw generationError('GENERATION_APPROVAL_STALE', 'Provider/model or the dated estimate changed. Prepare a new explicit intent and review it before submitting.');
      for (const otherId of await this.store.ids()) { const other = await this.read(otherId); if (other.id !== id && ['submitting', 'submission_unknown', 'queued', 'running'].includes(other.status) && !other.resolution) throw generationError('GENERATION_BUSY', 'Another remote job is active or uncertain. Resolve it before a new submission.'); }
      if ((await readProject(this.file)).etag !== job.baseEtag) throw generationError('PROJECT_CONFLICT', 'Project changed since preparation. Prepare a new intent and review its cost.');
      const spec = await loadManifest(this.file), ref = spec.assets[job.request.referenceAssetId];
      if (!ref || ref.type !== 'image' || ref.hash !== job.referenceSha256 || ref.bytes > 262144) throw generationError('GENERATION_REFERENCE', 'Prepared reference changed. Prepare a new request.');
      const bytes = await readFile(ref.absolutePath);
      if (hashBytes(bytes) !== job.referenceSha256) throw generationError('GENERATION_REFERENCE', 'Reference changed before submission.');
      job.approval = approval; job.status = 'submitting'; job.submissions = 1; await this.save(job);
      try {
        const result = await this.provider.submit({ prompt: job.request.prompt, durationSeconds: job.request.durationSeconds, resolution: job.request.resolution, frames: 121, fps: 16 }, { bytes, mime: job.referenceMime });
        job.remoteId = result.remoteId; job.status = result.status; delete job.error; await this.save(job);
      } catch (error) {
        const rejected = error instanceof StudioError && ['PROVIDER_AUTH', 'PROVIDER_RATE_LIMIT', 'PROVIDER_REQUEST_REJECTED', 'PROVIDER_NOT_CONFIGURED'].includes(error.code);
        job.status = rejected && !job.remoteId ? 'failed' : 'submission_unknown'; job.error = safeError(error); await this.save(job);
      }
      return this.public(job);
    });
  }
  async resume(id: string) {
    return this.store.locked(async () => {
      const job = await this.read(id);
      if (job.status === 'submitting') { job.status = 'submission_unknown'; await this.save(job); }
      if (!job.remoteId || ['ready', 'failed', 'cancelled'].includes(job.status)) return this.public(job);
      if (job.nextPollAt && Date.parse(job.nextPollAt) > Date.now()) return this.public(job);
      job.stopped = false;
      try { const result = await this.provider.status(job.remoteId); job.status = result.status; delete job.error; job.nextPollAt = new Date(Date.now() + 5000).toISOString(); }
      catch (error) {
        job.error = safeError(error);
        const retry = (error as { retryAfterSeconds?: number }).retryAfterSeconds;
        job.nextPollAt = new Date(Date.now() + Math.max(30, Number.isFinite(retry) ? Math.min(3600, retry!) : 30) * 1000).toISOString();
      }
      await this.save(job); return this.public(job);
    });
  }
  async candidateFile(id: string) {
    const job = await this.read(id);
    if (!job.candidate) throw generationError('GENERATION_CANDIDATE', 'Candidate has not been downloaded.');
    const path = await this.store.path('candidates', `${job.candidate.sha256}.mp4`);
    if ((await stat(path)).size !== job.candidate.bytes || hashBytes(await readFile(path)) !== job.candidate.sha256) throw generationError('CANDIDATE_CHANGED', 'Candidate bytes changed. Download the same result again.');
    return this.store.contained(path);
  }
  async download(id: string) {
    return this.store.locked(async () => {
      const job = await this.read(id);
      if (job.decision === 'accepted' || (job.acceptance && (await readProject(this.file)).manifest.operationReceipts?.some(item => item.operationId === job.acceptance!.operationId))) throw generationError('GENERATION_STATE', 'This result has an accepted receipt; reconcile acceptance instead of replacing its candidate.');
      if (!job.remoteId || !['output_ready', 'downloading', 'ready'].includes(job.status)) throw generationError('GENERATION_STATE', 'Resume the saved remote job until its output is ready.');
      const staging = await this.store.path('staging', `${randomUUID()}.mp4`);
      job.status = 'downloading'; await this.save(job);
      try {
        await this.provider.download(job.remoteId, staging);
        const size = (await stat(staging)).size;
        if (!size || size > 512 * 1024 * 1024) throw generationError('CANDIDATE_SIZE', 'Candidate exceeds the 512 MiB limit.');
        const metadata = await probeSource(staging, 'video');
        if (metadata.durationSeconds < job.sceneDurationSeconds || metadata.durationSeconds > 30) throw generationError('CANDIDATE_DURATION', 'Candidate is too short for the scene or exceeds 30 seconds.');
        const probe = JSON.parse((await runProcess(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_format', '-of', 'json', staging], { timeoutMs: 30000 })).stdout);
        if (!String(probe.format?.format_name).split(',').includes('mp4')) throw generationError('CANDIDATE_FORMAT', 'Provider output must be an MP4 source.');
        await runProcess(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-xerror', '-threads', '1', '-i', staging, '-map', '0:v:0', '-map', '0:a?', '-threads', '1', '-f', 'null', '-'], { timeoutMs: 180000 });
        const sha256 = hashBytes(await readFile(staging)), target = await this.store.path('candidates', `${sha256}.mp4`);
        // Older/crashed acceptance intents remain uncertain. Rehydrate only the
        // identical viewed bytes, never clear or replace that saved intent.
        if (job.acceptance && sha256 !== job.acceptance.intent.candidateSha256) throw generationError('GENERATION_ACCEPT_CONFLICT', 'The downloaded result differs from the saved acceptance. Keep the original intent and reconcile its outcome; it cannot be replaced.');
        try {
          if (hashBytes(await readFile(target)) !== sha256) {
            const damaged = await this.store.path('staging', `damaged-${randomUUID()}.mp4`);
            await rename(target, damaged); await rename(staging, target);
          }
        }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await rename(staging, target); }
        if (job.candidate?.sha256 !== sha256) delete job.preview;
        job.candidate = { sha256, bytes: size, ...metadata }; job.status = 'ready'; delete job.error; await this.save(job);
      } catch (error) { job.status = 'output_ready'; job.error = safeError(error, 'CANDIDATE_INVALID'); await this.save(job); throw generationError(job.error.code, job.error.message); }
      finally { await rm(staging, { force: true }); }
      return this.public(job);
    });
  }
  private draft(job: Job, draft: CandidateDraft, etag: string): GeneratedTakeDraft {
    if (!exactKeys(draft, ['trimStartSeconds', 'fit', 'focalPoint']) || !job.candidate) throw generationError('GENERATION_DRAFT', 'A downloaded candidate and exact trim/crop draft are required.');
    const result = { sceneId: job.request.sceneId, candidateSha256: job.candidate.sha256, baseEtag: etag, trimStartSeconds: draft.trimStartSeconds, fit: draft.fit, focalPoint: draft.focalPoint };
    generatedTakeRequestHash(result); return result;
  }
  async preview(id: string, draft: CandidateDraft, etag: string, output?: string) {
    return this.store.locked(async () => {
      const job = await this.read(id), intent = this.draft(job, draft, etag), previewId = randomUUID();
      if (job.status !== 'ready' || job.decision !== 'pending') throw generationError('GENERATION_STATE', 'Choose a ready, undecided candidate.');
      const path = await this.candidateFile(id), directory = output ?? await this.store.path('previews', previewId);
      const result = await previewGeneratedTake(this.file, intent, path, directory);
      if (result.stale) throw generationError('PROJECT_CONFLICT', 'Project changed during preview. Refresh and preview again.');
      job.preview = { previewId, requestHash: generatedTakeRequestHash(intent), baseEtag: etag, draft: { trimStartSeconds: intent.trimStartSeconds, fit: intent.fit, focalPoint: intent.focalPoint } }; await this.save(job);
      return { ...result, previewId, requestHash: job.preview.requestHash, output: join(directory, 'output.mp4') };
    });
  }
  async accept(id: string, draft: CandidateDraft, previewId: string, etag: string, operationId: string) {
    checkedId(operationId);
    return this.store.locked(async () => {
      const job = await this.read(id), intent = this.draft(job, draft, etag), requestHash = generatedTakeRequestHash(intent);
      const newAcceptance = !job.acceptance;
      if (job.acceptance) {
        if (job.acceptance.operationId !== operationId || job.acceptance.requestHash !== requestHash) throw generationError('GENERATION_ACCEPT_CONFLICT', 'This job already has an acceptance intent. Reconcile it before another operation.');
        const state = await readProject(this.file), receipt = state.manifest.operationReceipts?.find(item => item.operationId === operationId);
        if (receipt) {
          if (receipt.requestHash !== requestHash) throw generationError('GENERATION_ACCEPT_CONFLICT', 'Receipt belongs to a different intent.');
          job.decision = 'accepted'; job.acceptance.revisionId = receipt.revisionId; delete job.error; await this.save(job);
          return { ...state, receipt, importedId: `media-${intent.candidateSha256.slice(0, 24)}`, repeated: true };
        }
        if (!receipt && state.etag !== etag) throw generationError('GENERATION_ACCEPTANCE_UNKNOWN', 'Acceptance outcome cannot be proven. Inspect current project/history; the candidate will not be reapplied automatically.');
      } else {
        if (!job.preview || job.preview.previewId !== previewId || job.preview.requestHash !== requestHash) throw generationError('GENERATION_PREVIEW_STALE', 'Preview these exact trim/crop parameters and current project before accepting.');
        if (job.decision !== 'pending' || job.status !== 'ready') throw generationError('GENERATION_STATE', 'This candidate is not pending acceptance.');
        if ((await readProject(this.file)).etag !== etag) throw generationError('PROJECT_CONFLICT', 'Project changed after preview. Refresh and preview the candidate again.');
        job.acceptance = { operationId, intent, requestHash }; await this.save(job);
      }
      let enteredProjectOperation = false;
      try {
        const path = await this.store.path('candidates', `${intent.candidateSha256}.mp4`);
        enteredProjectOperation = true;
        const result = await acceptGeneratedTake(this.file, { ...intent, operationId, requestHash, candidatePath: path }, etag);
        job.decision = 'accepted'; job.acceptance!.revisionId = result.receipt.revisionId; delete job.error;
        await this.save(job); return result;
      } catch (error) {
        // A completed commit is authoritative even if the sidecar acknowledgement fails.
        const state = await readProject(this.file);
        const knownPrecommit = !enteredProjectOperation || error instanceof ProjectPrecommitError;
        if (newAcceptance && !state.manifest.operationReceipts?.some(item => item.operationId === operationId) && knownPrecommit) {
          delete job.acceptance; delete job.preview; job.error = safeError(error, 'CANDIDATE_RECOVERY'); await this.save(job);
        }
        throw error;
      }
    });
  }
  async resolveUnknown(id: string, resolution: UnknownResolution) {
    return this.store.locked(async () => {
      const job = await this.read(id);
      if (!['submitting', 'submission_unknown'].includes(job.status) || job.remoteId || job.submissions !== 1) throw generationError('GENERATION_STATE', 'Only an uncertain submission without a remote ID can be acknowledged.');
      if (!exactKeys(resolution, ['requestHash', 'accountChecked', 'acknowledgePossibleCharge']) || resolution.requestHash !== job.requestHash || resolution.accountChecked !== true || resolution.acknowledgePossibleCharge !== true) throw generationError('GENERATION_RESOLUTION', 'Check the provider account and explicitly acknowledge a possible existing charge for this exact request.');
      if (job.resolution) return this.public(job);
      job.status = 'submission_unknown';
      job.resolution = { kind: 'user_acknowledged', requestHash: resolution.requestHash, accountChecked: true, acknowledgePossibleCharge: true, at: now() };
      await this.save(job); return this.public(job);
    });
  }
  async reject(id: string) { return this.store.locked(async () => { const job = await this.read(id); if (job.acceptance || job.decision === 'accepted') throw generationError('GENERATION_STATE', 'Use project history to restore an accepted take.'); if (!job.candidate || job.status !== 'ready') throw generationError('GENERATION_STATE', 'Reject applies to a downloaded candidate. Use stop for an unsubmitted intent.'); job.decision = 'rejected'; await this.save(job); return this.public(job); }); }
  async stop(id: string) { return this.store.locked(async () => { const job = await this.read(id); job.stopped = true; if (job.status === 'prepared') job.status = 'cancelled'; await this.save(job); return this.public(job); }); }
}
