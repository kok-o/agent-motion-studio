import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat, readdir, realpath, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join, extname, relative, isAbsolute } from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { packageRoot, loadManifest, hashBytes } from './spec.js';
import { readProject, importMedia, editProject, withProjectLock } from './project.js';
import { render } from './engine.js';
import { normalizeError, StudioError } from './errors.js';
import { previewScene } from './preview.js';
import { GenerationService } from './generation.js';
import type { GenerationProvider } from './generation-provider.js';

async function body(request: IncomingMessage, limit: number) {
  if (Number(request.headers['content-length'] ?? 0) > limit) throw new Error('Request exceeds upload limit.');
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of request) { bytes += chunk.length; if (bytes > limit) throw new Error('Request exceeds upload limit.'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
const mime = (file: string) => ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac' }[extname(file).toLowerCase()] ?? 'application/octet-stream');

async function sendFile(request: IncomingMessage, response: ServerResponse, file: string) {
  const info = await stat(file); let start = 0, end = info.size - 1, status = 200;
  response.setHeader('Content-Type', mime(file)); response.setHeader('Accept-Ranges', 'bytes');
  if (request.headers.range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
    if (!match) { response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); response.end(); return; }
    start = Number(match[1]); end = match[2] ? Math.min(end, Number(match[2])) : end;
    if (start > end || start >= info.size) { response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); response.end(); return; }
    status = 206; response.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
  }
  response.writeHead(status, { 'Content-Length': end - start + 1 });
  if (request.method === 'HEAD') { response.end(); return; }
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => response.destroy()); response.on('close', () => stream.destroy()); stream.pipe(response);
}

export async function startStudio(manifestPath: string, port = 4173, options: { provider?: GenerationProvider } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be 0–65535.');
  const file = await realpath(resolve(manifestPath)), root = dirname(file);
  const generation = new GenerationService(file, options.provider);
  let mediaCache = { etag: (await readProject(file)).etag, spec: await loadManifest(file) };
  let mediaLoading: { etag: string; promise: ReturnType<typeof loadManifest> } | undefined;
  async function resolvedProject(etag: string) {
    if (mediaCache.etag === etag) return mediaCache.spec;
    if (mediaLoading?.etag !== etag) mediaLoading = { etag, promise: loadManifest(file) };
    const pending = mediaLoading;
    try { const spec = await pending.promise; mediaCache = { etag, spec }; return spec; }
    finally { if (mediaLoading === pending) mediaLoading = undefined; }
  }
  const token = randomBytes(32).toString('hex');
  const equal = (value: string) => value.length === token.length && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  const job: { status: string; progress?: string; exportId?: string; error?: unknown } = { status: 'idle' };
  const previewRoot = await mkdtemp(join(tmpdir(), 'ams-preview-'));
  let previewBusy = false, previewWork: Promise<unknown> | undefined;
  const previews = new Map<string, string>();
  let origin = '';
  async function inside(path: string) {
    const resolved = await realpath(path), rel = relative(root, resolved);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('File must remain inside the project.');
    return resolved;
  }
  async function exportsList() {
    const entries = await readdir(join(root, 'exports'), { withFileTypes: true }).catch(() => []);
    const exports = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-zA-Z0-9_-]+$/.test(entry.name)) continue;
      try {
        const directory = await inside(join(root, 'exports', entry.name));
        const report = JSON.parse(await readFile(join(directory, 'render-report.json'), 'utf8'));
        const input = await readFile(join(directory, 'manifest.json'));
        exports.push({ id: entry.name, projectHash: hashBytes(input), duration: report.durationSeconds, url: `/exports/${entry.name}/output.mp4` });
      } catch { /* Incomplete jobs have no accepted export. */ }
    }
    return exports.sort((a, b) => b.id.localeCompare(a.id));
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (value: unknown, code = 200) => { response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
    try {
      if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)) { send({ error: 'Origin/Host rejected' }, 403); return; }
      const url = new URL(request.url ?? '/', origin);
      const publicFiles: Record<string, string> = { '/': 'index.html', '/app.js': 'app.js', '/i18n.js': 'i18n.js', '/generation-ui.js': 'generation-ui.js', '/style.css': 'style.css' };
      if (publicFiles[url.pathname] && (request.method === 'GET' || request.method === 'HEAD')) { await sendFile(request, response, join(packageRoot, 'dist/studio', publicFiles[url.pathname])); return; }
      if (request.method === 'POST' && url.pathname === '/api/session') {
        if (request.headers.origin !== origin) { send({ error: 'Origin required' }, 403); return; }
        const input = JSON.parse((await body(request, 1024)).toString());
        if (typeof input.token !== 'string' || !equal(input.token)) { send({ error: 'Session rejected' }, 403); return; }
        response.setHeader('Set-Cookie', `studio=${token}; HttpOnly; SameSite=Strict; Path=/`); send({ ok: true }); return;
      }
      const cookie = /(?:^|;\s*)studio=([a-f0-9]+)/.exec(request.headers.cookie ?? '')?.[1] ?? '';
      if (!equal(cookie)) { send({ error: 'Open the session link printed by the local CLI.' }, 401); return; }
      if (request.method === 'POST' && request.headers.origin !== origin) { send({ error: 'Origin required' }, 403); return; }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        const state = await readProject(file), spec = await resolvedProject(state.etag);
        send({ ...state, projectPath: file, metadata: Object.fromEntries(Object.entries(spec.assets).map(([id, asset]) => [id, { width: asset.width, height: asset.height, durationSeconds: asset.durationSeconds, sourceFps: asset.sourceFps, bytes: asset.bytes, hash: asset.hash }])), exports: await exportsList(), job }); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/job') { send(job); return; }
      if (request.method === 'GET' && url.pathname === '/api/generation/capabilities') { send(generation.capabilities()); return; }
      if (request.method === 'GET' && url.pathname === '/api/generation/jobs') { send(await generation.list()); return; }
      const generationMatch = /^\/api\/generation\/([a-zA-Z0-9_-]+)\/(submit|resume|download|preview|accept|reject|stop|resolve-unknown|candidate)$/.exec(url.pathname);
      if (generationMatch && generationMatch[2] === 'candidate' && (request.method === 'GET' || request.method === 'HEAD')) { await sendFile(request, response, await generation.candidateFile(generationMatch[1])); return; }
      if (request.method === 'POST' && url.pathname === '/api/generation/prepare') { send(await generation.prepare(JSON.parse((await body(request, 16384)).toString()))); return; }
      if (request.method === 'POST' && generationMatch) {
        const [, id, operation] = generationMatch;
        if (['download', 'preview', 'accept'].includes(operation) && (job.status === 'running' || previewBusy)) { send({ error: 'Render is running. Wait before using candidate media.' }, 409); return; }
        const raw = await body(request, 16384), input = raw.length ? JSON.parse(raw.toString()) : {};
        const etag = request.headers['if-match'] as string;
        if (operation === 'submit') { send(await generation.submit(id, input)); return; }
        if (operation === 'resume') { send(await generation.resume(id)); return; }
        if (operation === 'download') { send(await generation.download(id)); return; }
        if (operation === 'accept') { send(await generation.accept(id, input.draft, input.previewId, etag, input.operationId)); return; }
        if (operation === 'reject') { send(await generation.reject(id)); return; }
        if (operation === 'stop') { send(await generation.stop(id)); return; }
        if (operation === 'resolve-unknown') { send(await generation.resolveUnknown(id, input.resolution)); return; }
        if (operation === 'preview') {
          previewBusy = true;
          const sessionPreviewId = randomUUID(), output = join(previewRoot, sessionPreviewId);
          try {
            const work = generation.preview(id, input.draft, etag, output); previewWork = work;
            const result = await work; previews.set(sessionPreviewId, join(output, 'output.mp4'));
            while (previews.size > 2) { const old = previews.keys().next().value!; previews.delete(old); await rm(join(previewRoot, old), { recursive: true, force: true }); }
            const { output: localOutput, ...safeResult } = result;
            send({ ...safeResult, url: `/previews/${sessionPreviewId}/output.mp4` });
          } catch (error) { await rm(output, { recursive: true, force: true }); throw error; }
          finally { previewBusy = false; previewWork = undefined; }
          return;
        }
      }
      if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/media/')) {
        const state = await readProject(file), spec = await resolvedProject(state.etag), asset = spec.assets[decodeURIComponent(url.pathname.slice(7))];
        if (!asset) { send({ error: 'Media not found' }, 404); return; }
        await sendFile(request, response, await inside(asset.absolutePath)); return;
      }
      const outputMatch = /^\/exports\/([a-zA-Z0-9_-]+)\/output\.mp4$/.exec(url.pathname);
      if ((request.method === 'GET' || request.method === 'HEAD') && outputMatch) { await sendFile(request, response, await inside(join(root, 'exports', outputMatch[1], 'output.mp4'))); return; }
      const previewMatch = /^\/previews\/([a-f0-9-]+)\/output\.mp4$/.exec(url.pathname);
      if ((request.method === 'GET' || request.method === 'HEAD') && previewMatch && previews.has(previewMatch[1])) { await sendFile(request, response, previews.get(previewMatch[1])!); return; }
      if (request.method === 'POST' && (job.status === 'running' || previewBusy)) { send({ error: 'Render is running. Wait before editing.' }, 409); return; }
      if (request.method === 'POST' && url.pathname === '/api/preview') {
        const action = JSON.parse((await body(request, 1024 * 1024)).toString());
        if (previewBusy || job.status === 'running') { send({ error: 'Render is running. Wait before previewing.' }, 409); return; }
        previewBusy = true;
        const id = randomUUID(), output = join(previewRoot, id);
        try {
          previewWork = previewScene(file, action, request.headers['if-match'] as string, output);
          const preview = await previewWork;
          previews.set(id, join(output, 'output.mp4'));
          // Keep only the latest two successful clips for this session.
          while (previews.size > 2) { const old = previews.keys().next().value!; previews.delete(old); await rm(join(previewRoot, old), { recursive: true, force: true }); }
          send({ ...(preview as object), url: `/previews/${id}/output.mp4` });
        } catch (error) { await rm(output, { recursive: true, force: true }); throw error; }
        finally { previewBusy = false; previewWork = undefined; }
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/import') {
        send(await importMedia(file, url.searchParams.get('name') ?? '', await body(request, 512 * 1024 * 1024), request.headers['if-match'] as string)); return;
      }
      if (request.method === 'POST' && url.pathname === '/api/edit') {
        send(await editProject(file, JSON.parse((await body(request, 1024 * 1024)).toString()), request.headers['if-match'] as string)); return;
      }
      if (request.method === 'POST' && url.pathname === '/api/export') {
        const state = await readProject(file);
        if (state.etag !== request.headers['if-match']) { send({ error: 'Project changed. Reload before exporting.' }, 409); return; }
        if (state.manifest.audio.narration.provider === 'edge') throw new Error('Online speech is not enabled in the local studio. Use the explicit CLI addon.');
        job.status = 'running'; job.progress = 'Starting export'; delete job.error;
        const exportId = `${Date.now()}-${randomUUID().slice(0, 8)}`; job.exportId = exportId;
        void withProjectLock(file, async () => {
          if ((await readProject(file)).etag !== state.etag) throw new StudioError('PROJECT_CONFLICT', 'project', 'Project changed before export.', 2);
          await mkdir(join(root, 'exports'), { recursive: true }); await inside(join(root, 'exports'));
          await render(file, join(root, 'exports', exportId), { noCache: true, progress: message => { job.progress = message; } });
        }).then(() => { job.status = 'complete'; job.progress = 'Verified MP4'; }, error => { job.status = 'failed'; job.error = normalizeError(error); });
        send({ ...job }, 202); return;
      }
      send({ error: 'Route not found' }, 404);
    } catch (error) { if (!response.headersSent) send(normalizeError(error), error instanceof StudioError && (error.code === 'PROJECT_CONFLICT' || error.code.endsWith('_BUSY') || error.code === 'GENERATION_PREVIEW_STALE') ? 409 : 400); else response.destroy(); }
  });
  try { await new Promise<void>((ok, bad) => { server.once('error', bad); server.listen(port, '127.0.0.1', () => ok()); }); }
  catch (error) { await rm(previewRoot, { recursive: true, force: true }); throw error; }
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Server did not start');
  origin = `http://127.0.0.1:${address.port}`;
  return { server, url: `${origin}/#${token}`, project: file, async close() { server.closeAllConnections(); await new Promise<void>(ok => server.close(() => ok())); await previewWork?.catch(() => {}); await rm(previewRoot, { recursive: true, force: true }); } };
}
