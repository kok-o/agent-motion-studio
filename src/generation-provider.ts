import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { open, rm } from 'node:fs/promises';
import type { IncomingHttpHeaders } from 'node:http';
import { StudioError } from './errors.js';

export type ProviderRequest = { prompt: string; durationSeconds: number; resolution: '480p' | '720p'; frames: number; fps: number };
export type ProviderStatus = { remoteId: string; status: 'queued' | 'running' | 'output_ready' | 'failed' | 'cancelled' };
export type GenerationProvider = {
  capabilities(): ReturnType<typeof replicateCapabilities>;
  submit(request: ProviderRequest, reference: { bytes: Buffer; mime: string }): Promise<ProviderStatus>;
  status(remoteId: string): Promise<ProviderStatus>;
  download(remoteId: string, destination: string): Promise<void>;
};

const MODEL = 'wan-video/wan-2.2-i2v-fast';
const API_ORIGIN = 'https://api.replicate.com';
const REFERENCE_MAX_BYTES = 262_144;
const DOWNLOAD_MAX_BYTES = 128 * 1024 * 1024;
const JSON_MAX_BYTES = 1024 * 1024;
const FRAMES = 121;
const FPS = 16;
const PRICE_DATE = '2026-10-06';
export const estimateByResolution = { '480p': 0.05, '720p': 0.11 } as const;

export function replicateCapabilities(configured = Boolean(process.env.REPLICATE_API_TOKEN)) {
  return {
    provider: 'replicate', model: MODEL, mode: 'image-to-video', configured,
    credentialEnv: 'REPLICATE_API_TOKEN', resolutions: ['480p', '720p'],
    durationSeconds: FRAMES / FPS, frames: FRAMES, fps: FPS,
    referenceMaxBytes: REFERENCE_MAX_BYTES, downloadMaxBytes: DOWNLOAD_MAX_BYTES,
    estimateByResolution,
    cancel: false, idempotencyLookup: false, sourceAudio: false,
    estimate: {
      usd: estimateByResolution['480p'], usdByResolution: estimateByResolution,
      source: 'https://replicate.com/wan-video/wan-2.2-i2v-fast#pricing', date: PRICE_DATE,
      note: 'Dated estimate per output video: 480p $0.05; 720p $0.11, without interpolation. Confirm current account price before submit; this is not a provider-enforced spending cap. Scene duration stays unchanged.',
    },
  };
}

export class ProviderError extends StudioError {
  constructor(code: string, message: string, public retryAfterSeconds?: number) { super(code, 'generation', message, 2); }
}

export type ProviderHttpRequest = { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; timeoutMs: number; maxBytes: number };
export type ProviderHttpResponse = { status: number; headers: IncomingHttpHeaders; body: AsyncIterable<Uint8Array> };
/** Dependency injection is only for controlled tests; production never reads a base URL from project/UI/environment. */
export type ProviderTransport = (request: ProviderHttpRequest) => Promise<ProviderHttpResponse>;

/** Reject non-public addresses before connecting, then pin the validated address for this socket. */
export function isPublicNetworkAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const [first, second] = address.split(':').map(part => Number.parseInt(part || '0', 16));
    // Only global unicast. Exclude special-use/documentation and transition routes that can embed non-public IPv4.
    return first >= 0x2000 && first <= 0x3ffe && first !== 0x2002 &&
      !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8));
  }
  return false;
}

function trustedUrl(value: string, kind: 'api' | 'output'): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ProviderError('PROVIDER_URL_REJECTED', 'Provider returned an invalid result address.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hash ||
    (kind === 'api' ? url.origin !== API_ORIGIN : !(host === 'replicate.delivery' || host.endsWith('.replicate.delivery')))) {
    throw new ProviderError('PROVIDER_URL_REJECTED', 'Provider address is outside the permitted HTTPS origins.');
  }
  return url;
}

const productionTransport: ProviderTransport = async input => {
  const url = trustedUrl(input.url, input.url.startsWith(`${API_ORIGIN}/`) ? 'api' : 'output');
  const started = Date.now();
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  let addresses: { address: string; family: number }[];
  try {
    addresses = await Promise.race([
      lookup(url.hostname, { all: true }),
      new Promise<never>((_resolve, reject) => { dnsTimer = setTimeout(() => reject(new Error('DNS deadline')), Math.min(10_000, input.timeoutMs)); }),
    ]);
  } catch { throw new ProviderError('PROVIDER_NETWORK', 'Could not resolve the provider within the connection deadline. Resume the known job when the connection is available.'); }
  finally { clearTimeout(dnsTimer); }
  if (!addresses.length || addresses.some(item => !isPublicNetworkAddress(item.address))) throw new ProviderError('PROVIDER_ADDRESS_REJECTED', 'Provider resolved to a non-public network address.');
  const pinned = addresses.find(item => item.family === 4) ?? addresses[0];
  return new Promise((resolve, reject) => {
    let responseReceived = false;
    const request = httpsRequest(url, {
      method: input.method, headers: input.headers, agent: false,
      lookup: (_hostname, options, callback) => {
        // Node 22's family autoselection requests an array; @types/node's callback still describes the single-address overload.
        if ((options as { all?: boolean }).all) {
          (callback as unknown as (error: null, addresses: { address: string; family: number }[]) => void)(null, [pinned]);
        } else callback(null, pinned.address, pinned.family);
      },
    }, response => {
      responseReceived = true;
      response.on('close', () => clearTimeout(timer));
      // IncomingMessage is a bounded, streaming body; no redirects are followed.
      resolve({ status: response.statusCode ?? 0, headers: response.headers, body: response });
    });
    const timer = setTimeout(() => request.destroy(new ProviderError('PROVIDER_TIMEOUT', 'Provider request timed out. The remote job may still be running.')), Math.max(1, input.timeoutMs - (Date.now() - started)));
    request.on('error', error => {
      clearTimeout(timer);
      if (!responseReceived) reject(error instanceof ProviderError ? error : new ProviderError('PROVIDER_NETWORK', 'Provider connection failed. The remote job may still be running.'));
    });
    request.end(input.body);
  });
};

function checkedRemoteId(remoteId: string) {
  if (typeof remoteId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(remoteId)) throw new ProviderError('INVALID_REMOTE_ID', 'Expected a saved provider prediction ID.');
  return remoteId;
}

function retryAfter(headers: IncomingHttpHeaders): number | undefined {
  const raw = headers['retry-after'];
  if (typeof raw !== 'string') return;
  const seconds = /^\d+$/.test(raw) ? Number(raw) : (Date.parse(raw) - Date.now()) / 1000;
  return Number.isFinite(seconds) ? Math.min(3600, Math.max(1, Math.ceil(seconds))) : undefined;
}

function httpError(status: number, headers: IncomingHttpHeaders): ProviderError {
  const delay = retryAfter(headers);
  if (status === 401 || status === 403) return new ProviderError('PROVIDER_AUTH', 'Provider authentication failed. Configure the same account credential and resume the saved job.');
  if (status === 429) return new ProviderError('PROVIDER_RATE_LIMIT', 'Provider rate limit reached. Resume after the suggested delay; generation POST is never automatically retried.', delay);
  if (status === 404 || status === 410) return new ProviderError('PROVIDER_OUTPUT_EXPIRED', 'The provider no longer has this prediction or output. A download retry cannot recover deleted media.');
  if (status >= 500) return new ProviderError('PROVIDER_UNAVAILABLE', 'Provider is temporarily unavailable. Resume the saved job later.', delay);
  if (status >= 300 && status < 400) return new ProviderError('PROVIDER_REDIRECT_REJECTED', 'Provider redirect was rejected; credentials were not forwarded.');
  return new ProviderError('PROVIDER_REQUEST_REJECTED', `Provider rejected the request (HTTP ${status}). Raw response details are kept out of reports.`);
}

async function readJson(response: ProviderHttpResponse): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > JSON_MAX_BYTES) throw new ProviderError('PROVIDER_RESPONSE_TOO_LARGE', 'Provider metadata exceeded the supported limit.');
      chunks.push(Buffer.from(chunk));
    }
    if (response.status < 200 || response.status >= 300) throw httpError(response.status, response.headers);
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid object');
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('PROVIDER_INVALID_RESPONSE', 'Provider returned invalid or interrupted metadata. Resume the saved job; do not blindly submit again.');
  }
}

function normalizePrediction(value: Record<string, unknown>, expectedId?: string): ProviderStatus {
  const remoteId = checkedRemoteId(value.id as string);
  if (expectedId && remoteId !== expectedId) throw new ProviderError('PROVIDER_INVALID_RESPONSE', 'Provider returned a different prediction ID.');
  const map: Record<string, ProviderStatus['status']> = { starting: 'queued', processing: 'running', succeeded: 'output_ready', failed: 'failed', canceled: 'cancelled', aborted: 'cancelled' };
  const status = typeof value.status === 'string' ? map[value.status] : undefined;
  if (!status) throw new ProviderError('PROVIDER_INVALID_RESPONSE', 'Provider returned an unsupported prediction state.');
  // Persist the remote ID even when a completed response has missing/invalid output. Download diagnoses the result separately.
  return { remoteId, status };
}

function validateRequest(request: ProviderRequest, reference: { bytes: Buffer; mime: string }) {
  if (!request || typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 4000 ||
    !Object.hasOwn(estimateByResolution, request.resolution) || request.frames !== FRAMES || request.fps !== FPS || request.durationSeconds !== FRAMES / FPS) {
    throw new ProviderError('INVALID_GENERATION_REQUEST', 'This adapter requires a prompt of 1–4000 characters, 480p/720p and exactly 121 frames at 16 fps (7.5625 seconds).');
  }
  if (!Buffer.isBuffer(reference.bytes) || !reference.bytes.length || reference.bytes.length > REFERENCE_MAX_BYTES || !['image/png', 'image/jpeg'].includes(reference.mime)) throw new ProviderError('INVALID_REFERENCE', 'The approved reference must be a PNG/JPEG of at most 256 KiB.');
  const png = reference.bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = reference.bytes[0] === 255 && reference.bytes[1] === 216 && reference.bytes[2] === 255;
  if ((reference.mime === 'image/png' && !png) || (reference.mime === 'image/jpeg' && !jpeg)) throw new ProviderError('INVALID_REFERENCE', 'Reference bytes do not match the approved PNG/JPEG type.');
}

export function createReplicateProvider(options: { transport?: ProviderTransport; credential?: () => string | undefined } = {}): GenerationProvider {
  const transport = options.transport ?? productionTransport;
  const credential = options.credential ?? (() => process.env.REPLICATE_API_TOKEN);
  function headers() {
    const token = credential();
    if (!token) throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'Set REPLICATE_API_TOKEN in the server environment. The production provider never falls back to mock generation.');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }
  async function prediction(remoteId: string) {
    const id = checkedRemoteId(remoteId);
    return readJson(await transport({ url: `${API_ORIGIN}/v1/predictions/${id}`, method: 'GET', headers: headers(), timeoutMs: 30_000, maxBytes: JSON_MAX_BYTES }));
  }
  return {
    capabilities: () => replicateCapabilities(Boolean(credential())),
    async submit(request, reference) {
      validateRequest(request, reference);
      const auth = headers();
      const body = JSON.stringify({ input: {
        prompt: request.prompt, image: `data:${reference.mime};base64,${reference.bytes.toString('base64')}`,
        num_frames: FRAMES, frames_per_second: FPS, resolution: request.resolution,
        go_fast: true, interpolate_output: false, disable_safety_checker: false,
      } });
      // Exactly one POST. Neither transport nor adapter retries an uncertain submission.
      try {
        return normalizePrediction(await readJson(await transport({ url: `${API_ORIGIN}/v1/models/${MODEL}/predictions`, method: 'POST', headers: auth, body, timeoutMs: 60_000, maxBytes: JSON_MAX_BYTES })));
      } catch (error) {
        if (error instanceof ProviderError && ['PROVIDER_AUTH', 'PROVIDER_RATE_LIMIT', 'PROVIDER_REQUEST_REJECTED'].includes(error.code)) throw error;
        throw new ProviderError('SUBMISSION_UNKNOWN', 'Submission response was not safely recorded. Check this account in Replicate; do not blindly submit again.');
      }
    },
    async status(remoteId) { return normalizePrediction(await prediction(remoteId), remoteId); },
    async download(remoteId, destination) {
      const value = await prediction(remoteId);
      if (normalizePrediction(value, remoteId).status !== 'output_ready') throw new ProviderError('PROVIDER_OUTPUT_NOT_READY', 'The saved prediction has no downloadable result yet.');
      if (value.data_removed === true || typeof value.output !== 'string' || !value.output) throw new ProviderError('PROVIDER_OUTPUT_EXPIRED', 'Prediction completed but its output is absent or removed. No new generation was submitted.');
      const url = trustedUrl(value.output as string, 'output');
      const response = await transport({ url: url.href, method: 'GET', headers: headers(), timeoutMs: 120_000, maxBytes: DOWNLOAD_MAX_BYTES });
      if (response.status < 200 || response.status >= 300) {
        // Consume a bounded body so the connection is closed; never expose a signed URL or response body.
        try { for await (const _chunk of response.body) { break; } } catch { /* normalized below */ }
        throw httpError(response.status, response.headers);
      }
      const length = Number(response.headers['content-length']);
      if (Number.isFinite(length) && length > DOWNLOAD_MAX_BYTES) {
        try { for await (const _chunk of response.body) { break; } } catch { /* normalized below */ }
        throw new ProviderError('CANDIDATE_TOO_LARGE', 'Provider video exceeds the 128 MiB download limit.');
      }
      let file: Awaited<ReturnType<typeof open>>;
      try { file = await open(destination, 'wx'); } catch {
        try { for await (const _chunk of response.body) { break; } } catch { /* normalized below */ }
        throw new ProviderError('CANDIDATE_STORAGE_FAILED', 'Could not create candidate staging file. Check local disk space and permissions.');
      }
      let bytes = 0;
      let complete = false;
      try {
        for await (const chunk of response.body) {
          bytes += chunk.byteLength;
          if (bytes > DOWNLOAD_MAX_BYTES) throw new ProviderError('CANDIDATE_TOO_LARGE', 'Provider video exceeds the 128 MiB download limit.');
          let offset = 0;
          while (offset < chunk.byteLength) {
            const written = await file.write(chunk, offset, chunk.byteLength - offset);
            if (!written.bytesWritten) throw new Error('No write progress');
            offset += written.bytesWritten;
          }
        }
        if (!bytes || (Number.isFinite(length) && length > 0 && length !== bytes)) throw new ProviderError('CANDIDATE_DOWNLOAD_INCOMPLETE', 'Provider video download was empty or truncated. Retry download for this prediction.');
        await file.sync();
        complete = true;
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError('CANDIDATE_DOWNLOAD_FAILED', 'Provider video download failed. Retry download for this prediction; do not start a new generation.');
      } finally {
        try { await file.close(); } catch { /* the original error is preserved */ }
        if (!complete) await rm(destination, { force: true }).catch(() => undefined);
      }
    },
  };
}
