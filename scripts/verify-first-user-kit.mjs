import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { extractZip } from './zip-archive.mjs';
import { root } from './check-release.mjs';
import { sha256, verifyKit, recordKitSmoke } from './first-user-kit.mjs';
import { observeKitPage, safeError, runWithCleanup } from './kit-ui-observer.mjs';
import { openKitStudio, observeKitStudioHealth } from './kit-studio-process.mjs';

export async function verifyFirstUserKit(args) {
  const report = { status: 'running', stage: 'kit integrity', testedAt: new Date().toISOString(), commands: [], checks: {}, stages: [], limitations: { independentHuman: 'NOT RUN', liveModel: 'NOT RUN', viewingAndListening: 'NOT RUN', macOSKit: 'NOT RUN', cleanOS: 'NOT RUN' } };
  await mkdir(args.evidence, { recursive: true });
  const save = () => writeFile(join(args.evidence, 'SELF_RUN.json'), JSON.stringify(report, null, 2) + '\n');
  const result = await runWithCleanup({ report, save, run: async () => { await save(); return verifyKitRun({ ...args, report, save }); } });
  // Packaging finalization follows a successfully completed technical smoke.
  // Its errors fail the caller; they must not relabel that smoke as failed.
  const { kit } = args;
  await recordKitSmoke({ kit, report });
  const release = dirname(kit.archive), candidate = JSON.parse(await readFile(join(release, 'candidate.json'), 'utf8'));
  const archive = candidate.archives.find(item => item.file === basename(kit.archive)); assert.ok(archive);
  archive.bytes = (await stat(kit.archive)).size; archive.sha256 = sha256(await readFile(kit.archive));
  await writeFile(join(release, 'candidate.json'), JSON.stringify(candidate, null, 2) + '\n');
  await writeFile(join(release, 'SHA256SUMS.txt'), candidate.archives.map(item => `${item.sha256}  ${item.file}\n`).join(''));
  return { ...result, kitSha256: archive.sha256 };
}

async function verifyKitRun({ kit, npm, evidence, report, save }) {
  const consumer = await realpath(await mkdtemp(join(tmpdir(), 'ams Первый запуск ')));
  const within = relative(await realpath(root), consumer);
  assert.ok(within.startsWith('..') || isAbsolute(within), 'Consumer must be outside checkout');
  extractZip(kit.archive, consumer);
  const delivered = join(consumer, kit.name), manifest = await verifyKit(delivered);
  const blank = await readFile(join(delivered, 'RESULTS_BLANK_RU.md'));
  assert.equal(blank.toString().split('\n').filter(line => /^\|[^|]+\| \|$/.test(line)).length, 14);
  const workspace = join(delivered, 'workspace'); await mkdir(workspace); await mkdir(evidence, { recursive: true });
  Object.assign(report, { stage: 'install', gitSha: manifest.source.gitSha, version: manifest.version, runtimeSha256: manifest.runtime.sha256, consumer: { outsideCheckout: true, spaceAndCyrillicPath: true } });
  async function checkpoint(stage, checks = {}) {
    report.stages.push({ stage, status: 'passed' }); Object.assign(report.checks, checks); await save();
  }
  await save();
  assert.match(consumer, / /); assert.match(consumer, /[А-Яа-я]/);
  async function run(args, label, { json = true } = {}) {
    const entry = { command: label, status: 'running', exitCode: null }; report.stage = label; report.commands.push(entry); await save();
    let result;
    try { result = await new Promise((ok, bad) => {
      const child = spawn(process.execPath, args, { cwd: workspace, windowsHide: true, env: process.env });
      let stdout = '', stderr = '', killTimer;
      const timer = setTimeout(() => { child.kill(); killTimer = setTimeout(() => child.kill('SIGKILL'), 1000); bad(new Error(`${label}: timeout`)); }, 300000);
      child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
      child.once('error', error => { clearTimeout(timer); clearTimeout(killTimer); bad(error); });
      child.once('close', code => { clearTimeout(timer); clearTimeout(killTimer); ok({ code, stdout, stderr }); });
    }); } catch (error) { entry.status = 'failed'; entry.failure = safeError(error); try { await save(); } catch (saveError) { (report.evidenceErrors ??= []).push(safeError(saveError)); } throw error; }
    entry.exitCode = result.code; entry.status = result.code === 0 ? 'passed' : 'failed';
    if (result.code !== 0) {
      let primary; try { assert.equal(result.code, 0, `${label} failed`); } catch (error) { primary = error; }
      try { await save(); } catch (saveError) { (report.evidenceErrors ??= []).push(safeError(saveError)); }
      throw primary;
    }
    await save();
    return json ? JSON.parse(result.stdout) : result.stdout;
  }
  let browser, studio, observer;
  const app = join(workspace, 'node_modules/agent-motion-studio'), cli = join(app, 'dist/cli.js');
  const cliRun = (args, label) => run([cli, ...args, '--json'], `agent-motion-studio ${label}`);
  const openStudio = (file, label) => openKitStudio({ cli, workspace, file, report, label });
  async function navigate(page, label, expectedExports) {
    report.stage = label;
    observer = observeKitPage(page, report, label, { expectedExports }); await save();
    await observeKitStudioHealth(studio.url, report, `${label}-before-navigation`);
    try { await page.goto(studio.url, { waitUntil: 'networkidle0' }); }
    catch (error) {
      await observer.snapshot({ failure: true });
      await observeKitStudioHealth(studio.url, report, `${label}-navigation-failed`);
      throw error;
    }
  }
  await runWithCleanup({ report, save, cleanups: [
    { label: 'final UI snapshot', run: async () => { await observer?.snapshot(); observer?.detach(); } },
    { label: 'browser close', run: async () => { await browser?.close(); } },
    { label: 'studio close', run: async () => { await studio?.close(); } },
  ], run: async () => {
    await run([npm, 'init', '-y'], 'npm init -y', { json: false });
    await run([npm, 'install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', join('..', manifest.runtime.file)], `npm install --ignore-scripts --omit=dev --no-audit --no-fund ../${manifest.runtime.file}`, { json: false });
    const appWithin = relative(consumer, await realpath(app)); assert.ok(!appWithin.startsWith('..') && !isAbsolute(appWithin));
    const doctor = await cliRun(['doctor'], 'doctor --json'); assert.equal(doctor.ready, true);
    await checkpoint('doctor', { doctor: true });
    report.environment = { os: doctor.os, node: doctor.node.version, browser: doctor.browser.version, canvas: doctor.browser.canvas, ffmpeg: doctor.ffmpeg.version.trim(), ffprobe: doctor.ffprobe.version.trim(), lowMemory: process.env.AMS_LOW_MEMORY === '1' };
    const installed = await run([join(app, 'scripts/install-agent-skill.mjs'), '--client', 'codex', '--scope', 'project'], 'node node_modules/agent-motion-studio/scripts/install-agent-skill.mjs --client codex --scope project');
    assert.equal(installed.installs[0].status, 'installed');
    assert.deepEqual(await readFile(join(workspace, '.agents/skills/agent-motion-studio/SKILL.md')), await readFile(join(app, 'skills/agent-motion-studio/SKILL.md')));
    await checkpoint('skill', { skillFiles: installed.installs[0].files });
    await cliRun(['init', 'coffee-ritual', '--dir', 'film'], 'init coffee-ritual --dir film');
    const file = join(workspace, 'film/project.json'), initial = await cliRun(['state', file], 'state film/project.json --json'), before = await readFile(file);
    const sources = async () => Object.fromEntries(await Promise.all(Object.entries(initial.manifest.assets).map(async ([id, asset]) => [id, sha256(await readFile(join(workspace, 'film', asset.path)))])));
    const initialSources = await sources();
    const credits = await readFile(join(workspace, 'film/CREDITS.md'));
    assert.deepEqual(credits, await readFile(join(delivered, 'CREDITS.md')));
    await checkpoint('project', { projectFromInstalledRuntime: true, initialRevision: initial.manifest.revision, sourceHashes: initialSources });
    const baseline = await cliRun(['render', file, '--out', 'baseline', '--no-cache'], 'render film/project.json --out baseline --no-cache --json');
    assert.equal(baseline.totalFrames, 600); assert.equal(baseline.studioExport.status, 'registered');
    const baselineBytes = await readFile(join(workspace, 'baseline/output.mp4'));
    await checkpoint('baseline', { baselineFrames: 600 });
    const { launchBrowser, findTools, runProcess } = await import(pathToFileURL(join(app, 'dist/runtime.js')));
    browser = await launchBrowser(findTools().chrome); studio = await openStudio(file, 'first-open');
    const page = await browser.newPage(), errors = []; page.on('pageerror', () => errors.push('pageerror'));
    await page.evaluateOnNewDocument(() => localStorage.setItem('ams-language', 'ru'));
    await navigate(page, 'first-open', 1);
    assert.equal(await page.$eval('#project-title', node => node.textContent), 'film');
    assert.equal(await page.$eval('#exports', node => node.options.length), 1);
    await observer.snapshot(); await checkpoint('first-open', { studioFirstOpenExports: 1 });
    const action = { type: 'edit-scene', sceneId: 'first-pour', patch: { durationFrames: 180 } };
    await writeFile(join(workspace, 'change.json'), JSON.stringify(action));
    const preview = await cliRun(['preview', file, '--action', 'change.json', '--if-match', initial.etag, '--out', 'preview'], 'preview film/project.json --action change.json --if-match CURRENT_ETAG --out preview --json');
    assert.equal(preview.totalFrames, 180); assert.equal(preview.stale, false); assert.deepEqual(await readFile(file), before);
    await checkpoint('preview', { previewFrames: 180, previewAcceptedBytesUnchanged: true });
    await cliRun(['edit', file, '--action', 'change.json', '--if-match', preview.projectHash], 'edit film/project.json --action change.json --if-match PREVIEW_HASH --json');
    const edited = await cliRun(['state', file], 'state film/project.json --json');
    assert.deepEqual(edited.manifest.history.at(-1).scenes, initial.manifest.scenes);
    const changed = await cliRun(['render', file, '--out', 'changed', '--no-cache'], 'render film/project.json --out changed --no-cache --json');
    assert.equal(changed.totalFrames, 570); assert.equal(changed.studioExport.status, 'registered');
    const changedBytes = await readFile(join(workspace, 'changed/output.mp4'));
    await checkpoint('changed', { changedFrames: 570 });
    await page.waitForFunction(() => document.querySelector('#exports').options.length === 2, { timeout: 15000 });
    await writeFile(join(workspace, 'restore.json'), JSON.stringify({ type: 'restore', revisionId: initial.manifest.revision }));
    await cliRun(['edit', file, '--action', 'restore.json', '--if-match', edited.etag], 'edit film/project.json --action restore.json --if-match CURRENT_ETAG --json');
    const restoredState = await cliRun(['state', file], 'state film/project.json --json');
    assert.deepEqual(restoredState.manifest.scenes, initial.manifest.scenes); assert.deepEqual(await sources(), initialSources);
    assert.deepEqual(await readFile(join(workspace, 'film/CREDITS.md')), credits);
    await checkpoint('restore', { sourcesPreserved: true, creditsPreserved: true, historySnapshots: restoredState.manifest.history.length });
    const restored = await cliRun(['render', file, '--out', 'restored', '--no-cache'], 'render film/project.json --out restored --no-cache --json');
    assert.equal(restored.totalFrames, 600); assert.equal(restored.verification.audio.codec, 'aac');
    await checkpoint('restored render', { restoredFrames: 600 });
    await observer.snapshot(); observer.detach();
    report.stage = 'idle stop / restart'; await save();
    await studio.close(); studio = await openStudio(file, 'reopen');
    await navigate(page, 'reopen', 3);
    assert.equal(await page.$eval('#project-title', node => node.textContent), 'film');
    assert.equal(await page.$eval('#exports', node => node.options.length), 3);
    assert.equal(await page.$eval('#export-state', node => node.textContent), 'Текущая версия');
    await observer.snapshot(); await checkpoint('reopen', { studioReopenedExports: 3, studioReopenedCurrentVersion: true });
    report.stage = 'preservation'; await save();
    assert.deepEqual(await readFile(join(workspace, 'baseline/output.mp4')), baselineBytes);
    assert.deepEqual(await readFile(join(workspace, 'changed/output.mp4')), changedBytes);
    for (const [rendered, bytes] of [[baseline, baselineBytes], [changed, changedBytes]]) assert.deepEqual(await readFile(join(workspace, 'film', rendered.studioExport.path)), bytes);
    await checkpoint('preservation', { earlierMp4sPreserved: true });
    report.stage = 'decode'; await save();
    const decode = async path => (await runProcess(findTools().ffmpeg, ['-v', 'error', '-threads', '1', '-i', path, '-map', '0:v:0', '-f', 'framemd5', '-'])).stdout;
    const originalFrames = await decode(join(workspace, 'baseline/output.mp4')), restoredFrames = await decode(join(workspace, 'restored/output.mp4'));
    assert.equal(originalFrames, restoredFrames); assert.equal(restoredFrames.split('\n').filter(line => /^0,/.test(line)).length, 600);
    await checkpoint('decode', { restoredAllDecodedFramesEqual: true });
    assert.deepEqual(errors, []); assert.deepEqual(await readFile(join(delivered, 'RESULTS_BLANK_RU.md')), blank);
    report.status = 'self-run-passed';
    Object.assign(report.checks, { humanProtocolBlank: true, studioStop: 'controlled SIGINT; native console NOT RUN' });
    report.mp4 = { baseline: sha256(baselineBytes), changed: sha256(changedBytes), restored: sha256(await readFile(join(workspace, 'restored/output.mp4'))) };
    report.stage = 'complete';
  } });
  return { status: report.status, gitSha: report.gitSha, runtimeSha256: report.runtimeSha256, checks: report.checks, consumer };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const latest = JSON.parse(await readFile(join(root, 'artifacts/release/latest.json'), 'utf8'));
  const result = await verifyFirstUserKit({ kit: latest.userKit, npm: process.env.npm_execpath, evidence: join(latest.directory, 'first-user-kit-check') });
  // The retained private consumer path stays local, outside the distributable report.
  console.log(JSON.stringify({ ...result, consumer: '[retained OS temporary workspace]' }, null, 2));
}
