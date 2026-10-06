import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReplicateProvider, isPublicNetworkAddress } from '../../dist/generation-provider.js';

const modelRequest = { prompt: 'A gentle camera push toward the espresso cup.', durationSeconds: 7.5625, resolution: '480p', frames: 121, fps: 16 };
const reference = { bytes: Buffer.from('89504e470d0a1a0a00000000', 'hex'), mime: 'image/png' };
const id = 'prediction_test_01';
const output = Buffer.from('controlled download bytes; media validation belongs to integration tests');

async function controlledHttp(t, handler) {
  const journal = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const entry = { method: req.method, path: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined };
    journal.push(entry);
    await handler(entry, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const transport = async input => {
    const logical = new URL(input.url);
    return new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path: logical.pathname + logical.search, method: input.method, headers: input.headers }, res => resolve({ status: res.statusCode, headers: res.headers, body: res }));
      req.on('error', reject);
      req.end(input.body);
    });
  };
  const provider = () => createReplicateProvider({ credential: () => 'fixture-only-credential', transport });
  return { journal, provider };
}

function json(res, value, status = 200, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(value));
}

test('adapter submits once, persists usable ID across instance restart, and refreshes download for the same ID', async t => {
  let state = 'starting';
  let locatorVersion = 0;
  const { journal, provider } = await controlledHttp(t, (entry, res) => {
    if (entry.method === 'POST') return json(res, { id, status: state });
    if (entry.path.startsWith('/v1/predictions/')) return json(res, { id, status: state, output: state === 'succeeded' ? `https://replicate.delivery/output.mp4?version=${++locatorVersion}` : null });
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': output.length });
    res.end(output);
  });
  const first = provider();
  assert.deepEqual(await first.submit(modelRequest, reference), { remoteId: id, status: 'queued' });
  const sent = journal[0].body.input;
  assert.equal(journal[0].path, '/v1/models/wan-video/wan-2.2-i2v-fast/predictions');
  assert.equal(sent.image, `data:image/png;base64,${reference.bytes.toString('base64')}`);
  assert.equal(sent.num_frames, 121);
  assert.equal(sent.frames_per_second, 16);
  assert.equal(sent.interpolate_output, false);
  assert.equal(sent.disable_safety_checker, false);
  state = 'processing';
  assert.deepEqual(await provider().status(id), { remoteId: id, status: 'running' });
  state = 'succeeded';
  const dir = await mkdtemp(path.join(tmpdir(), 'ams-provider-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await provider().download(id, path.join(dir, 'first.mp4'));
  await provider().download(id, path.join(dir, 'second.mp4'));
  assert.deepEqual(await readFile(path.join(dir, 'first.mp4')), output);
  assert.deepEqual(await readFile(path.join(dir, 'second.mp4')), output);
  assert.equal(journal.filter(entry => entry.method === 'POST').length, 1);
  assert.equal(journal.filter(entry => entry.path.startsWith('/v1/predictions/')).length, 3);
  assert.deepEqual(journal.filter(entry => entry.path.startsWith('/output.mp4')).map(entry => entry.path), ['/output.mp4?version=1', '/output.mp4?version=2']);
});

test('missing key and malformed request do not reach controlled HTTP', async t => {
  const { journal, provider } = await controlledHttp(t, (_entry, res) => json(res, { id, status: 'starting' }));
  const unconfigured = createReplicateProvider({ credential: () => undefined, transport: () => { throw new Error('must not reach transport'); } });
  assert.equal(unconfigured.capabilities().configured, false);
  await assert.rejects(unconfigured.submit(modelRequest, reference), { code: 'PROVIDER_NOT_CONFIGURED' });
  await assert.rejects(provider().submit({ ...modelRequest, frames: 81 }, reference), { code: 'INVALID_GENERATION_REQUEST' });
  await assert.rejects(provider().submit(modelRequest, { ...reference, bytes: Buffer.from('private data') }), { code: 'INVALID_REFERENCE' });
  assert.equal(journal.length, 0);
});

test('response lost after remote acceptance returns submission_unknown without automatic retry', async t => {
  const { journal, provider } = await controlledHttp(t, (_entry, res) => { res.socket.destroy(); });
  await assert.rejects(provider().submit(modelRequest, reference), { code: 'SUBMISSION_UNKNOWN' });
  assert.equal(journal.length, 1);
  assert.equal(journal[0].method, 'POST');
});

test('429 read preserves Retry-After and redacts provider body, abort is terminal', async t => {
  let limited = true;
  const { journal, provider } = await controlledHttp(t, (_entry, res) => limited ? json(res, { detail: 'fixture-only-credential https://private.example/result?secret=yes' }, 429, { 'Retry-After': '45' }) : json(res, { id, status: 'aborted' }));
  await assert.rejects(provider().status(id), error => error.code === 'PROVIDER_RATE_LIMIT' && error.retryAfterSeconds === 45 && !error.message.includes('private.example') && !error.message.includes('fixture-only-credential'));
  limited = false;
  assert.deepEqual(await provider().status(id), { remoteId: id, status: 'cancelled' });
  assert.equal(journal.filter(entry => entry.method === 'POST').length, 0);
});

test('expired locator is refreshed on download retry; missing output never submits again', async t => {
  let attempts = 0;
  let removed = false;
  const { journal, provider } = await controlledHttp(t, (entry, res) => {
    if (entry.path.startsWith('/v1/')) return json(res, { id, status: 'succeeded', output: removed ? null : `https://replicate.delivery/video.mp4?attempt=${++attempts}`, data_removed: removed });
    if (entry.path.endsWith('attempt=1')) return json(res, { secret: 'do not disclose' }, 410);
    res.writeHead(200, { 'Content-Length': output.length }); res.end(output);
  });
  const dir = await mkdtemp(path.join(tmpdir(), 'ams-provider-expiry-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const destination = path.join(dir, 'candidate.mp4');
  await assert.rejects(provider().download(id, destination), { code: 'PROVIDER_OUTPUT_EXPIRED' });
  await assert.rejects(access(destination));
  await provider().download(id, destination);
  assert.deepEqual(await readFile(destination), output);
  removed = true;
  assert.deepEqual(await provider().status(id), { remoteId: id, status: 'output_ready' });
  await assert.rejects(provider().download(id, path.join(dir, 'removed.mp4')), { code: 'PROVIDER_OUTPUT_EXPIRED' });
  assert.equal(journal.filter(entry => entry.method === 'POST').length, 0);
});

test('untrusted output address and redirects are blocked without following or writing a candidate', async t => {
  let locator = 'https://127.0.0.1/private.mp4';
  const { journal, provider } = await controlledHttp(t, (entry, res) => entry.path.startsWith('/v1/') ? json(res, { id, status: 'succeeded', output: locator }) : json(res, {}, 302, { Location: 'https://private.example/file?secret=yes' }));
  const dir = await mkdtemp(path.join(tmpdir(), 'ams-provider-origins-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'candidate.mp4');
  for (const address of ['https://127.0.0.1/private.mp4', 'http://replicate.delivery/file', 'https://replicate.delivery.evil.test/file', 'https://user:pass@replicate.delivery/file', 'https://replicate.delivery:444/file']) {
    locator = address;
    await assert.rejects(provider().download(id, file), { code: 'PROVIDER_URL_REJECTED' });
  }
  assert.equal(journal.length, 5);
  locator = 'https://replicate.delivery/file.mp4';
  await assert.rejects(provider().download(id, file), { code: 'PROVIDER_REDIRECT_REJECTED' });
  assert.equal(journal.length, 7);
  await assert.rejects(access(file));
});

test('truncated download removes only its newly created staging file and can resume same prediction', async t => {
  let damaged = true;
  const { journal, provider } = await controlledHttp(t, (entry, res) => {
    if (entry.path.startsWith('/v1/')) return json(res, { id, status: 'succeeded', output: 'https://replicate.delivery/video.mp4' });
    res.writeHead(200, { 'Content-Length': output.length + (damaged ? 10 : 0) });
    if (damaged) { res.write(output.subarray(0, 10)); return setTimeout(() => res.socket.destroy(), 5); }
    res.end(output);
  });
  const dir = await mkdtemp(path.join(tmpdir(), 'ams-provider-damaged-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'candidate.mp4');
  await assert.rejects(provider().download(id, file), { code: 'CANDIDATE_DOWNLOAD_FAILED' });
  await assert.rejects(access(file));
  damaged = false;
  await provider().download(id, file);
  assert.deepEqual(await readFile(file), output);
  await assert.rejects(provider().download(id, file), { code: 'CANDIDATE_STORAGE_FAILED' });
  assert.deepEqual(await readFile(file), output);
  assert.equal(journal.filter(entry => entry.method === 'POST').length, 0);
});

test('production network boundary rejects private, loopback, metadata, documentation and transition addresses', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.100.100.200', '0.0.0.0', '224.0.0.1', '198.18.0.1', '192.0.2.1', '203.0.113.2', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:0000:4136:e378:8000:63bf:3fff:fdd2', '2002:7f00:1::', '2001:2::1', '3fff::1']) assert.equal(isPublicNetworkAddress(address), false, address);
  for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPublicNetworkAddress(address), true, address);
});

test('checked official input and billing snapshot hashes reproduce the captured public contract', async () => {
  const snapshot = JSON.parse(await readFile(new URL('../../docs/providers/replicate-wan-2.2-i2v-fast.snapshot.json', import.meta.url), 'utf8'));
  for (const [field, hash] of [['inputSchema', 'inputSchemaSha256'], ['billingConfig', 'billingConfigSha256']]) assert.equal(createHash('sha256').update(JSON.stringify(snapshot[field])).digest('hex'), snapshot[hash]);
});
