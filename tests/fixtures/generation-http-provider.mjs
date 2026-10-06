import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { StudioError } from '../../dist/errors.js';

/** Test-only transport: every submit/status/result/download is a real HTTP request. */
export async function createControlledProvider(clip) {
  const counts = { submits: 0, status: 0, locators: 0, downloads: 0, remoteIds: [] };
  const control = { configured: true, dropSubmit: false, status: 'output_ready', invalidDownload: false, expiredDownloads: 0, interruptedDownloads: 0, outputOverride: null };
  let origin;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, origin);
    const send = value => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.method === 'POST' && url.pathname === '/jobs') {
      let body = ''; for await (const chunk of request) body += chunk;
      JSON.parse(body); counts.submits++;
      if (control.dropSubmit) { response.destroy(); return; }
      send({ remoteId: `remote-${counts.submits}`, status: 'queued' }); return;
    }
    const job = /^\/jobs\/(remote-\d+)(\/result)?$/.exec(url.pathname);
    if (job) {
      counts.remoteIds.push(job[1]);
      if (job[2]) { counts.locators++; send({ url: `${origin}/media/${job[1]}?lease=${counts.locators}` }); }
      else { counts.status++; send({ remoteId: job[1], status: control.status }); }
      return;
    }
    if (url.pathname.startsWith('/media/remote-')) {
      counts.downloads++;
      if (control.expiredDownloads > 0) { control.expiredDownloads--; response.writeHead(403); response.end('expired'); return; }
      if (control.interruptedDownloads > 0) { control.interruptedDownloads--; response.writeHead(200, { 'Content-Length': clip.length }); response.write(clip.subarray(0, 16)); response.destroy(); return; }
      const bytes = control.invalidDownload ? Buffer.from('<html>provider error</html>') : control.outputOverride ?? clip;
      response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': bytes.length }); response.end(bytes); return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const failure = () => new StudioError('PROVIDER_TEST_TRANSPORT', 'generation', 'Controlled provider transport failed.', 2);
  const get = async path => { const response = await fetch(`${origin}${path}`); if (!response.ok) throw failure(); return response.json(); };
  const provider = {
    capabilities() { return { provider: 'controlled-http', model: 'controlled-video-fixture', mode: 'image-to-video', configured: control.configured, credentialEnv: 'CONTROLLED_TEST_ONLY', resolutions: ['480p', '720p'], durationSeconds: 7.5625, frames: 121, fps: 16, referenceMaxBytes: 262144, cancel: false, estimate: { usd: 0.05, source: 'controlled test fixture', date: '2026-10-06', note: 'No real provider and no expense.' }, estimateByResolution: { '480p': 0.05, '720p': 0.11 } }; },
    async submit(input, reference) {
      const response = await fetch(`${origin}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input, reference: { mime: reference.mime, base64: reference.bytes.toString('base64') } }) });
      if (!response.ok) throw failure(); return response.json();
    },
    async status(id) { return get(`/jobs/${id}`); },
    async download(id, destination) {
      // An expired locator is refreshed for the same saved remote ID.
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await get(`/jobs/${id}/result`), response = await fetch(result.url);
        if (response.status === 403 && attempt === 0) continue;
        if (!response.ok) throw failure();
        await writeFile(destination, Buffer.from(await response.arrayBuffer())); return;
      }
      throw failure();
    }
  };
  return { provider, control, counts, async close() { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); } };
}
