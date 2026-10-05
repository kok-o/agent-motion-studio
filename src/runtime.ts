import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, platform, arch } from 'node:os';
import puppeteer from 'puppeteer-core';
import { StudioError } from './errors.js';
import type { ToolPaths } from './types.js';

const ownedChildren = new Set<ChildProcess>();
const cancellationController = new AbortController();
export let cancelled = false;
export function throwIfCancelled() {
  if (cancelled) throw new StudioError('CANCELLED', 'render', 'Rendering cancelled.', 130);
}
export function cancelProcesses() {
  if (cancelled) return;
  cancelled = true;
  // Puppeteer's launch signal owns only the browser launched by this process.
  // Its default SIGINT handler exits immediately, before the engine can clean up.
  cancellationController.abort();
  for (const child of ownedChildren) child.kill();
}
export async function runProcess(command: string, args: string[], options: { timeoutMs?: number; logPath?: string } = {}) {
  throwIfCancelled();
  return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    ownedChildren.add(child);
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs ?? 120_000);
    child.stdout.on('data', data => { stdout = (stdout + data.toString()).slice(-4_000_000); });
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-4_000_000); });
    child.once('error', error => { clearTimeout(timer); ownedChildren.delete(child); reject(new StudioError('PROCESS_START_FAILED', 'media', `Cannot start ${command}: ${error.message}`, 3)); });
    child.once('close', async code => {
      clearTimeout(timer); ownedChildren.delete(child);
      try { if (options.logPath) await writeFile(options.logPath, `${command}\n${args.join('\n')}\n${stderr}\n${stdout}`); }
      catch (error) { reject(error); return; }
      if (cancelled) reject(new StudioError('CANCELLED', 'render', 'Rendering cancelled.', 130));
      else if (timedOut) reject(new StudioError('PROCESS_TIMEOUT', 'media', `${command} exceeded its time limit.`, 4));
      else if (code !== 0) reject(new StudioError('PROCESS_FAILED', 'media', `${command} exited ${code}: ${stderr.slice(-4000)}`, 4));
      else resolve({ stdout, stderr, exitCode: code });
    });
  });
}
export function findTools(): ToolPaths {
  const candidates = [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    join(process.env.LOCALAPPDATA ?? homedir(), 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const chrome = process.env.CHROME_PATH ? (existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : undefined) : candidates.find(candidate => candidate && existsSync(candidate));
  if (!chrome) throw new StudioError('BROWSER_MISSING', 'doctor', 'Chrome/Chromium was not found. Install Chrome or set CHROME_PATH to its executable.', 3);
  return { chrome, ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg', ffprobe: process.env.FFPROBE_PATH || 'ffprobe' };
}
export async function launchBrowser(chrome: string) {
  throwIfCancelled();
  try { return await puppeteer.launch({ executablePath: chrome, headless: true, timeout: 30_000, protocolTimeout: 60_000,
    handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false, signal: cancellationController.signal,
    args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--disable-default-apps'] }); }
  catch (error) { throwIfCancelled(); throw new StudioError('BROWSER_START_FAILED', 'doctor', `Cannot launch the browser: ${error instanceof Error ? error.message : String(error)}`, 3); }
}
export async function doctor() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const nodeSupported = major > 22 || (major === 22 && minor >= 12);
  const tools = findTools();
  const results = await Promise.allSettled([
    runProcess(tools.ffmpeg, ['-version'], { timeoutMs: 15_000 }),
    runProcess(tools.ffprobe, ['-version'], { timeoutMs: 15_000 }),
    (async () => { const browser = await launchBrowser(tools.chrome); try { return await browser.version(); } finally { await browser.close(); } })()
  ]);
  const inspect = (index: number) => results[index].status === 'fulfilled'
    ? { ready: true, version: typeof (results[index] as PromiseFulfilledResult<unknown>).value === 'string' ? (results[index] as PromiseFulfilledResult<string>).value : (results[index] as PromiseFulfilledResult<{stdout:string}>).value.stdout.split('\n')[0] }
    : { ready: false, error: String((results[index] as PromiseRejectedResult).reason) };
  return { ready: nodeSupported && results.every(result => result.status === 'fulfilled'), node: { version: process.version, supported: nodeSupported }, os: { platform: platform(), arch: arch() }, browser: { path: tools.chrome, ...inspect(2) }, ffmpeg: { path: tools.ffmpeg, ...inspect(0) }, ffprobe: { path: tools.ffprobe, ...inspect(1) }, optionalTts: { edge: 'not-required; run an explicitly configured addon separately' } };
}
