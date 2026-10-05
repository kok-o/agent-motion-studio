import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchBrowser } from './runtime.js';
import { packageRoot } from './spec.js';
import { StudioError } from './errors.js';
import type { ResolvedSpec, ResolvedScene } from './types.js';

export async function openRenderer(spec: ResolvedSpec, chrome: string) {
  const routes = new Map<string, { path: string; type: string }>([
    ['/', { path: resolve(packageRoot, 'dist/renderer/index.html'), type: 'text/html; charset=utf-8' }],
    ['/entry.js', { path: resolve(packageRoot, 'dist/renderer/entry.js'), type: 'text/javascript' }]
  ]);
  for (const subset of ['latin', 'cyrillic', 'cyrillic-ext']) for (const weight of [400, 700]) {
    const filename = `noto-sans-${subset}-${weight}-normal.woff2`;
    routes.set(`/fonts/${filename}`, { path: resolve(packageRoot, 'assets/fonts', filename), type: 'font/woff2' });
  }
  for (const subset of ['latin', 'cyrillic', 'cyrillic-ext']) {
    const filename = `oswald-${subset}-700-normal.woff2`;
    routes.set(`/fonts/${filename}`, { path: resolve(packageRoot, 'assets/fonts', filename), type: 'font/woff2' });
  }
  for (const [id, asset] of Object.entries(spec.assets)) if (asset.type === 'image') routes.set(`/assets/${encodeURIComponent(id)}`, { path: asset.absolutePath, type: asset.path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg' });
  const server = createServer(async (request, response) => {
    const route = routes.get(request.url ?? '');
    if (!route) { response.writeHead(404); response.end(); return; }
    try { const content = await readFile(route.path); response.writeHead(200, { 'Content-Type': route.type, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'" }); response.end(content); }
    catch { response.writeHead(500); response.end(); }
  });
  await new Promise<void>((ok, bad) => { server.once('error', bad); server.listen(0, '127.0.0.1', () => ok()); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('SERVER_ADDRESS_FAILED');
  let browser;
  try {
    browser = await launchBrowser(chrome); const page = await browser.newPage();
    await page.setViewport({ width: spec.width, height: spec.height, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    const allowedOrigin = `http://127.0.0.1:${address.port}`;
    page.on('request', request => { if (request.url().startsWith(`${allowedOrigin}/`)) void request.continue(); else void request.abort('blockedbyclient'); });
    await page.goto(`${allowedOrigin}/`, { waitUntil: 'networkidle0', timeout: 30_000 });
    const layout = await page.evaluate(async data => {
      const api = (window as unknown as { studio: { initialize(value: ResolvedSpec): Promise<{ scenes: ResolvedScene[]; captionLayouts: unknown }> } }).studio;
      return api.initialize(data);
    }, spec);
    spec.scenes = layout.scenes; spec.browserVersion = await browser.version();
    const finish = async () => {
      try { await browser!.close(); }
      finally { server.closeAllConnections(); await new Promise<void>(ok => server.close(() => ok())); }
    };
    return {
      spec, captionLayouts: layout.captionLayouts,
      async frame(index: number) {
        const data = await page.evaluate(frame => (window as unknown as { studio: { renderFrame(index: number): string } }).studio.renderFrame(frame), index);
        return Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
      },
      async sheet(indices: number[], output: string) {
        const data = await page.evaluate(frames => (window as unknown as { studio: { renderSheet(indices: number[]): string } }).studio.renderSheet(frames), indices);
        await writeFile(output, Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
      }, finish
    };
  } catch (error) {
    try { await browser?.close(); }
    finally { server.closeAllConnections(); await new Promise<void>(ok => server.close(() => ok())); }
    if (error instanceof StudioError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new StudioError(message.includes('TEXT_OVERFLOW') ? 'TEXT_OVERFLOW' : 'BROWSER_RENDER_FAILED', message.includes('TEXT_OVERFLOW') ? 'layout' : 'render', message, message.includes('TEXT_OVERFLOW') ? 2 : 4);
  }
}
