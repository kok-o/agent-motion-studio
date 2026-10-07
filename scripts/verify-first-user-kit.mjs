import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, realpath, readdir, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { extractZip } from './zip-archive.mjs';
import { root } from './check-release.mjs';
import { command, sha256, verifyKit, recordKitSmoke } from './first-user-kit.mjs';

export async function verifyFirstUserKit({ kit, npm, evidence }) {
  const consumer = await realpath(await mkdtemp(join(tmpdir(), 'ams Первый запуск ')));
  const within = relative(await realpath(root), consumer);
  assert.ok(within.startsWith('..') || isAbsolute(within), 'Consumer must be outside checkout');
  extractZip(kit.archive, consumer);
  const delivered = join(consumer, kit.name), manifest = await verifyKit(delivered);
  const blank = await readFile(join(delivered, 'RESULTS_BLANK_RU.md'));
  assert.equal(blank.toString().split('\n').filter(line => /^\|[^|]+\| \|$/.test(line)).length, 14);
  const workspace = join(delivered, 'workspace'); await mkdir(workspace); await mkdir(evidence, { recursive: true });
  const report = { status: 'running', testedAt: new Date().toISOString(), gitSha: manifest.source.gitSha, version: manifest.version, runtimeSha256: manifest.runtime.sha256, consumer: { outsideCheckout: true, spaceAndCyrillicPath: true }, commands: [], limitations: { independentHuman: 'NOT RUN', liveModel: 'NOT RUN', viewingAndListening: 'NOT RUN', macOSKit: 'NOT RUN', cleanOS: 'NOT RUN' } };
  assert.match(consumer, / /); assert.match(consumer, /[А-Яа-я]/);
  async function run(args, label, { json = true } = {}) {
    const result = await new Promise((ok, bad) => {
      const child = spawn(process.execPath, args, { cwd: workspace, windowsHide: true, env: process.env });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { child.kill(); bad(new Error(`${label}: timeout`)); }, 300000);
      child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
      child.once('error', error => { clearTimeout(timer); bad(error); });
      child.once('close', code => { clearTimeout(timer); ok({ code, stdout, stderr }); });
    });
    report.commands.push({ command: label, exitCode: result.code });
    assert.equal(result.code, 0, `${label} failed; private diagnostic: ${result.stderr.slice(-2000)}`);
    return json ? JSON.parse(result.stdout) : result.stdout;
  }
  let browser, studio;
  const app = join(workspace, 'node_modules/agent-motion-studio'), cli = join(app, 'dist/cli.js');
  const cliRun = (args, label) => run([cli, ...args, '--json'], `agent-motion-studio ${label}`);
  async function openStudio(file) {
    // Exercise the installed studio CLI and its normal cleanup using IPC to emit
    // a controlled SIGINT event; never persist its private session URL.
    const wrapper = join(workspace, 'studio-smoke.mjs');
    await writeFile(wrapper, `const log = console.log;
console.log = (...args) => { if (String(args[0]).startsWith('Local studio:')) process.send({ ready: /http:\\/\\/127\\.0\\.0\\.1:\\d+\\/#[a-f0-9]+/.exec(args[0])[0] }); else log(...args); };
process.on('message', value => { if (value === 'SIGINT') process.emit('SIGINT'); });
try { await import(${JSON.stringify(pathToFileURL(cli).href)}); } finally { process.disconnect(); }`);
    const child = spawn(process.execPath, [wrapper, 'studio', file, '--port', '0', '--json'], { cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    const done = new Promise((ok, bad) => { child.once('error', bad); child.once('close', code => ok({ code, stdout, stderr })); });
    const url = await new Promise((ok, bad) => {
      const timer = setTimeout(() => { child.kill(); bad(new Error('studio startup timeout')); }, 15000);
      child.once('message', value => { clearTimeout(timer); ok(value.ready); });
      child.once('error', error => { clearTimeout(timer); bad(error); });
      child.once('close', () => { clearTimeout(timer); bad(new Error('studio stopped before readiness')); });
    });
    let closed = false;
    return { url, async close() { if (closed) return; closed = true; child.send('SIGINT'); const stopped = await done; assert.equal(stopped.code, 0, stopped.stderr); report.commands.push({ command: 'agent-motion-studio studio / controlled idle SIGINT', exitCode: stopped.code }); } };
  }
  try {
    await run([npm, 'init', '-y'], 'npm init -y', { json: false });
    await run([npm, 'install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', join('..', manifest.runtime.file)], `npm install --ignore-scripts --omit=dev --no-audit --no-fund ../${manifest.runtime.file}`, { json: false });
    const appWithin = relative(consumer, await realpath(app)); assert.ok(!appWithin.startsWith('..') && !isAbsolute(appWithin));
    const doctor = await cliRun(['doctor'], 'doctor --json'); assert.equal(doctor.ready, true);
    report.environment = { os: doctor.os, node: doctor.node.version, browser: doctor.browser.version, canvas: doctor.browser.canvas, ffmpeg: doctor.ffmpeg.version.trim(), ffprobe: doctor.ffprobe.version.trim(), lowMemory: process.env.AMS_LOW_MEMORY === '1' };
    const installed = await run([join(app, 'scripts/install-agent-skill.mjs'), '--client', 'codex', '--scope', 'project'], 'node node_modules/agent-motion-studio/scripts/install-agent-skill.mjs --client codex --scope project');
    assert.equal(installed.installs[0].status, 'installed');
    assert.deepEqual(await readFile(join(workspace, '.agents/skills/agent-motion-studio/SKILL.md')), await readFile(join(app, 'skills/agent-motion-studio/SKILL.md')));
    await cliRun(['init', 'coffee-ritual', '--dir', 'film'], 'init coffee-ritual --dir film');
    const file = join(workspace, 'film/project.json'), initial = await cliRun(['state', file], 'state film/project.json --json'), before = await readFile(file);
    const sources = async () => Object.fromEntries(await Promise.all(Object.entries(initial.manifest.assets).map(async ([id, asset]) => [id, sha256(await readFile(join(workspace, 'film', asset.path)))])));
    const initialSources = await sources();
    const credits = await readFile(join(workspace, 'film/CREDITS.md'));
    assert.deepEqual(credits, await readFile(join(delivered, 'CREDITS.md')));
    const baseline = await cliRun(['render', file, '--out', 'baseline', '--no-cache'], 'render film/project.json --out baseline --no-cache --json');
    assert.equal(baseline.totalFrames, 600); assert.equal(baseline.studioExport.status, 'registered');
    const baselineBytes = await readFile(join(workspace, 'baseline/output.mp4'));
    const { launchBrowser, findTools, runProcess } = await import(pathToFileURL(join(app, 'dist/runtime.js')));
    browser = await launchBrowser(findTools().chrome); studio = await openStudio(file);
    const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.evaluateOnNewDocument(() => localStorage.setItem('ams-language', 'ru'));
    await page.goto(studio.url, { waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('#project-title', node => node.textContent), 'film');
    assert.equal(await page.$eval('#exports', node => node.options.length), 1);
    const action = { type: 'edit-scene', sceneId: 'first-pour', patch: { durationFrames: 180 } };
    await writeFile(join(workspace, 'change.json'), JSON.stringify(action));
    const preview = await cliRun(['preview', file, '--action', 'change.json', '--if-match', initial.etag, '--out', 'preview'], 'preview film/project.json --action change.json --if-match CURRENT_ETAG --out preview --json');
    assert.equal(preview.totalFrames, 180); assert.equal(preview.stale, false); assert.deepEqual(await readFile(file), before);
    await cliRun(['edit', file, '--action', 'change.json', '--if-match', preview.projectHash], 'edit film/project.json --action change.json --if-match PREVIEW_HASH --json');
    const edited = await cliRun(['state', file], 'state film/project.json --json');
    assert.deepEqual(edited.manifest.history.at(-1).scenes, initial.manifest.scenes);
    const changed = await cliRun(['render', file, '--out', 'changed', '--no-cache'], 'render film/project.json --out changed --no-cache --json');
    assert.equal(changed.totalFrames, 570); assert.equal(changed.studioExport.status, 'registered');
    const changedBytes = await readFile(join(workspace, 'changed/output.mp4'));
    await page.waitForFunction(() => document.querySelector('#exports').options.length === 2, { timeout: 15000 });
    await writeFile(join(workspace, 'restore.json'), JSON.stringify({ type: 'restore', revisionId: initial.manifest.revision }));
    await cliRun(['edit', file, '--action', 'restore.json', '--if-match', edited.etag], 'edit film/project.json --action restore.json --if-match CURRENT_ETAG --json');
    const restoredState = await cliRun(['state', file], 'state film/project.json --json');
    assert.deepEqual(restoredState.manifest.scenes, initial.manifest.scenes); assert.deepEqual(await sources(), initialSources);
    assert.deepEqual(await readFile(join(workspace, 'film/CREDITS.md')), credits);
    const restored = await cliRun(['render', file, '--out', 'restored', '--no-cache'], 'render film/project.json --out restored --no-cache --json');
    assert.equal(restored.totalFrames, 600); assert.equal(restored.verification.audio.codec, 'aac');
    await studio.close(); studio = await openStudio(file);
    await page.goto(studio.url, { waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('#project-title', node => node.textContent), 'film');
    assert.equal(await page.$eval('#exports', node => node.options.length), 3);
    assert.equal(await page.$eval('#export-state', node => node.textContent), 'Текущая версия');
    assert.deepEqual(await readFile(join(workspace, 'baseline/output.mp4')), baselineBytes);
    assert.deepEqual(await readFile(join(workspace, 'changed/output.mp4')), changedBytes);
    for (const [rendered, bytes] of [[baseline, baselineBytes], [changed, changedBytes]]) assert.deepEqual(await readFile(join(workspace, 'film', rendered.studioExport.path)), bytes);
    const decode = async path => (await runProcess(findTools().ffmpeg, ['-v', 'error', '-threads', '1', '-i', path, '-map', '0:v:0', '-f', 'framemd5', '-'])).stdout;
    const originalFrames = await decode(join(workspace, 'baseline/output.mp4')), restoredFrames = await decode(join(workspace, 'restored/output.mp4'));
    assert.equal(originalFrames, restoredFrames); assert.equal(restoredFrames.split('\n').filter(line => /^0,/.test(line)).length, 600);
    assert.deepEqual(errors, []); assert.deepEqual(await readFile(join(delivered, 'RESULTS_BLANK_RU.md')), blank);
    report.status = 'self-run-passed';
    report.checks = { doctor: true, skillFiles: installed.installs[0].files, projectFromInstalledRuntime: true, previewFrames: 180, previewAcceptedBytesUnchanged: true, initialRevision: initial.manifest.revision, changedFrames: 570, restoredFrames: 600, restoredAllDecodedFramesEqual: true, sourceHashes: initialSources, creditsPreserved: true, historySnapshots: restoredState.manifest.history.length, earlierMp4sPreserved: true, studioReopenedExports: 3, humanProtocolBlank: true, studioStop: 'controlled SIGINT; native console NOT RUN' };
    report.mp4 = { baseline: sha256(baselineBytes), changed: sha256(changedBytes), restored: sha256(await readFile(join(workspace, 'restored/output.mp4'))) };
  } finally { await browser?.close(); await studio?.close(); }
  await writeFile(join(evidence, 'SELF_RUN.json'), JSON.stringify(report, null, 2) + '\n');
  await recordKitSmoke({ kit, report });
  const release = dirname(kit.archive), candidate = JSON.parse(await readFile(join(release, 'candidate.json'), 'utf8'));
  const archive = candidate.archives.find(item => item.file === basename(kit.archive)); assert.ok(archive);
  archive.bytes = (await stat(kit.archive)).size; archive.sha256 = sha256(await readFile(kit.archive));
  await writeFile(join(release, 'candidate.json'), JSON.stringify(candidate, null, 2) + '\n');
  await writeFile(join(release, 'SHA256SUMS.txt'), candidate.archives.map(item => `${item.sha256}  ${item.file}\n`).join(''));
  return { status: report.status, gitSha: report.gitSha, runtimeSha256: report.runtimeSha256, kitSha256: archive.sha256, checks: report.checks, consumer };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const latest = JSON.parse(await readFile(join(root, 'artifacts/release/latest.json'), 'utf8'));
  const result = await verifyFirstUserKit({ kit: latest.userKit, npm: process.env.npm_execpath, evidence: join(latest.directory, 'first-user-kit-check') });
  // The retained private consumer path stays local, outside the distributable report.
  console.log(JSON.stringify({ ...result, consumer: '[retained OS temporary workspace]' }, null, 2));
}
