import assert from 'node:assert/strict';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir, platform, arch, release } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { root } from './check-release.mjs';
import { sha256, verifyKit } from './first-user-kit.mjs';
import { openKitStudio, observeKitStudioHealth } from './kit-studio-process.mjs';
import { observeKitPage, safeError } from './kit-ui-observer.mjs';

// This focused installed-runtime probe reuses the permitted delivered coffee
// MP4. It verifies the real bytes and registers them through the same API used
// by render(). It does not render, edit accepted JSON, create mock responses,
// seal the kit, or claim the full first-user self-run passed.
export async function probeInstalledKitReopen({ kit, evidence, npm = process.env.npm_execpath }) {
  const report = {
    status: 'running', testedAt: new Date().toISOString(),
    scope: 'One installed coffee UI open, controlled idle stop, and natural reopen; existing verified media, no new render',
    originalCiCause: 'UNKNOWN', naturalReopen: 'NOT RUN',
    environment: { platform: platform(), arch: arch(), release: release(), node: process.version },
    commands: [], stages: [], checks: {}, cleanupErrors: [],
    diagnosticErrors: [],
    limitations: { fullFirstUserSelfRun: 'NOT RUN', originalLinuxFailure: 'NOT RUN on the original Linux runner', newRender: 'NOT RUN', independentHuman: 'NOT RUN', cleanOS: 'NOT RUN', liveModel: 'NOT RUN' },
  };
  await mkdir(evidence, { recursive: true });
  const save = () => writeFile(join(evidence, 'reopen-probe.json'), JSON.stringify(report, null, 2) + '\n');
  let browser, studio, primaryError;
  const observers = [];
  async function stage(label, operation) {
    const entry = { label, status: 'running' }; report.stages.push(entry); await save();
    const started = performance.now();
    try {
      const result = await operation(); entry.status = 'passed'; entry.elapsedMs = Math.round(performance.now() - started); await save(); return result;
    } catch (error) {
      entry.status = 'failed'; entry.elapsedMs = Math.round(performance.now() - started); entry.failure = safeError(error); throw error;
    }
  }
  try {
    const consumer = await realpath(await mkdtemp(join(tmpdir(), 'ams Reopen проверка ')));
    const within = relative(await realpath(root), consumer);
    assert.ok(within.startsWith('..') || isAbsolute(within), 'Consumer must be outside checkout');
    report.consumer = { outsideCheckout: true, spaceAndCyrillicPath: / /.test(consumer) && /[А-Яа-я]/.test(consumer), retained: true };
    const delivered = join(consumer, 'delivered'), workspace = join(consumer, 'workspace');
    await mkdir(delivered); await mkdir(workspace);
    const manifest = await stage('verify-delivered-kit', async () => {
      // Copy only sealed payload, so a previously used delivered kit may retain
      // its separate workspace without changing the sealed kit under test.
      const source = JSON.parse(await readFile(join(kit, 'KIT_MANIFEST.json'), 'utf8'));
      const names = [...source.files.map(item => item.file), 'KIT_MANIFEST.json', 'SHA256SUMS.txt'];
      assert.equal(new Set(names).size, names.length);
      for (const name of names) {
        assert.match(name, /^[a-zA-Z0-9_.-]+$/); assert.ok(!name.includes('..'));
        const info = await lstat(join(kit, name)); assert.ok(info.isFile() && !info.isSymbolicLink());
        await copyFile(join(kit, name), join(delivered, name));
      }
      const verified = await verifyKit(delivered);
      report.kit = { source: verified.source, runtimeSha256: verified.runtime.sha256, verification: verified.verification.status };
      return verified;
    });
    async function run(args, label, { json = true, executable = process.execPath } = {}) {
      const entry = { command: label, status: 'running' }; report.commands.push(entry);
      const result = await new Promise((resolve, reject) => {
        const child = spawn(executable, args, { cwd: workspace, windowsHide: true, env: process.env });
        let stdout = '', timer, killTimer, hardTimer, timedOut = false, settled = false;
        const clear = () => { clearTimeout(timer); clearTimeout(killTimer); clearTimeout(hardTimer); };
        const finish = (exitCode, signal, exitObserved) => {
          if (settled) return; settled = true; clear();
          Object.assign(entry, { exitCode, signal, exitObserved, timedOut, status: timedOut || exitCode !== 0 ? 'failed' : 'passed' });
          resolve({ stdout, exitCode, timedOut });
        };
        child.stdout.on('data', data => { stdout += data; });
        // Consume but do not retain output that can contain private paths.
        child.stderr.resume();
        timer = setTimeout(() => {
          timedOut = true; child.kill();
          killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
          // A descendant retaining a pipe must not make diagnostic cleanup
          // unbounded. Unknown exit remains explicit and cannot pass.
          hardTimer = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(null, null, false); }, 2000);
        }, 300000);
        child.once('error', error => { if (settled) return; settled = true; clear(); reject(error); });
        child.once('close', (exitCode, signal) => finish(exitCode, signal, true));
      }).catch(error => { entry.status = 'failed'; entry.failure = safeError(error); throw error; });
      assert.equal(result.timedOut, false, `${label}: command timeout`); assert.equal(result.exitCode, 0, `${label}: command failed`);
      return json ? JSON.parse(result.stdout) : result.stdout;
    }
    await stage('install-runtime', async () => {
      await writeFile(join(workspace, 'package.json'), JSON.stringify({ name: 'ams-reopen-consumer', version: '1.0.0', private: true }));
      const args = ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', join(delivered, manifest.runtime.file)];
      // npm_execpath is the portable npm CLI when invoked through npm. POSIX
      // direct invocation may use the existing npm executable on PATH.
      if (npm) await run([npm, ...args], 'npm install --ignore-scripts --omit=dev --no-audit --no-fund delivered-runtime', { json: false });
      else {
        assert.notEqual(process.platform, 'win32', 'On Windows invoke through npm or provide --npm npm-cli.js');
        await run(args, 'npm install --ignore-scripts --omit=dev --no-audit --no-fund delivered-runtime', { json: false, executable: 'npm' });
      }
    });
    const app = join(workspace, 'node_modules/agent-motion-studio'), cli = join(app, 'dist/cli.js');
    const appWithin = relative(consumer, await realpath(app)); assert.ok(!appWithin.startsWith('..') && !isAbsolute(appWithin));
    const cliRun = (args, label) => run([cli, ...args, '--json'], `agent-motion-studio ${label}`);
    const doctor = await stage('installed-doctor', () => cliRun(['doctor'], 'doctor --json'));
    assert.equal(doctor.ready, true);
    Object.assign(report.environment, { browser: doctor.browser.version, canvas: doctor.browser.canvas, ffmpeg: doctor.ffmpeg.version.trim(), ffprobe: doctor.ffprobe.version.trim() });
    await stage('initialize-coffee', () => cliRun(['init', 'coffee-ritual', '--dir', 'film'], 'init coffee-ritual --dir film'));
    const file = join(workspace, 'film/project.json'), initial = await cliRun(['state', file], 'state film/project.json --json');
    const projectBefore = await readFile(file), creditsBefore = await readFile(join(workspace, 'film/CREDITS.md'));
    const sourceHashes = async () => Object.fromEntries(await Promise.all(Object.entries(initial.manifest.assets).map(async ([id, asset]) => [id, sha256(await readFile(join(workspace, 'film', asset.path)))])));
    const sourcesBefore = await sourceHashes();
    const { launchBrowser, findTools } = await import(pathToFileURL(join(app, 'dist/runtime.js')));
    const { verifyVideo } = await import(pathToFileURL(join(app, 'dist/media.js')));
    const { registerExport } = await import(pathToFileURL(join(app, 'dist/export-library.js')));
    const fixture = join(workspace, 'verified-coffee'); await mkdir(fixture);
    await copyFile(join(delivered, 'coffee-original.mp4'), join(fixture, 'output.mp4'));
    const coffeeBytes = await readFile(join(fixture, 'output.mp4')), coffeeHash = sha256(coffeeBytes);
    const registration = await stage('verify-and-register-existing-coffee', async () => {
      assert.equal(coffeeHash, manifest.files.find(item => item.file === 'coffee-original.mp4').sha256);
      const verified = await verifyVideo(join(fixture, 'output.mp4'), findTools(), { width: 1920, height: 1080, fps: 30, totalFrames: 600, audio: true });
      const registered = await registerExport(file, fixture, projectBefore, verified); assert.equal(registered.status, 'registered');
      report.fixture = { mediaSha256: coffeeHash, totalFrames: verified.totalFrames, durationSeconds: verified.durationSeconds, decodeExitCode: verified.decode.exitCode, audio: verified.audio.codec, registration: registered.status, acceptedProjectWrittenByProbe: false, historyWrittenByProbe: false, source: 'sealed delivered coffee-original.mp4', simplification: 'One existing real MP4 is verified and registered through installed API; no baseline/change/restore render sequence. Navigation only, not fresh-render provenance.' };
      return registered;
    });
    browser = await stage('launch-installed-browser', () => launchBrowser(findTools().chrome));
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => localStorage.setItem('ams-language', 'ru'));
    async function navigate(label) {
      const observer = observeKitPage(page, report, label, { expectedTitle: 'film', expectedExports: 1 }); observers.push(observer);
      let navigationError;
      await observeKitStudioHealth(studio.url, report, `${label}-before-navigation`);
      try {
        await stage(label, async () => {
          // Preserve the existing verification gate, including its deadline.
          await page.goto(studio.url, { waitUntil: 'networkidle0', timeout: 30000 });
          assert.equal(await page.$eval('#project-title', node => node.textContent), 'film');
          assert.equal(await page.$eval('#exports', node => node.options.length), 1);
          assert.equal(await page.$eval('#export-state', node => node.textContent), 'Текущая версия');
        });
      } catch (error) {
        navigationError = error;
        await observer.snapshot({ failure: true });
        await observeKitStudioHealth(studio.url, report, `${label}-after-navigation-failure`);
        throw error;
      }
      finally {
        try { await observer.snapshot(); } catch (error) { report.diagnosticErrors.push({ label: 'snapshot', failure: safeError(error) }); }
        observer.detach();
        try { await save(); }
        catch (error) {
          report.diagnosticErrors.push({ label: 'save-after-navigation', failure: safeError(error) });
          if (!navigationError) throw error;
        }
      }
    }
    studio = await stage('start-first-studio', () => openKitStudio({ cli, workspace, file, report, label: 'first-open' }));
    await navigate('first-open');
    await stage('idle-stop-first-studio', () => studio.close()); studio = undefined;
    studio = await stage('start-reopened-studio', () => openKitStudio({ cli, workspace, file, report, label: 'reopen' }));
    await navigate('reopen');
    report.naturalReopen = 'NOT REPRODUCED';
    await stage('preservation', async () => {
      assert.deepEqual(await readFile(file), projectBefore);
      assert.deepEqual(await sourceHashes(), sourcesBefore);
      assert.deepEqual(await readFile(join(workspace, 'film/CREDITS.md')), creditsBefore);
      assert.equal(sha256(await readFile(join(fixture, 'output.mp4'))), coffeeHash);
      assert.equal(sha256(await readFile(join(workspace, 'film', registration.path))), coffeeHash);
      const sealedAfter = await verifyKit(delivered);
      assert.equal(sealedAfter.runtime.sha256, manifest.runtime.sha256);
      report.checks = { installedRuntime: true, firstOpen: true, naturalReopen: true, title: 'film', exports: 1, currentVersion: true, acceptedProjectSha256: sha256(projectBefore), acceptedProjectBytesPreserved: true, sources: sourcesBefore, sourceBytesPreserved: true, creditsPreserved: true, outputBytesPreserved: true, libraryBytesPreserved: true, deliveredKitUnchanged: true };
    });
    report.status = 'probe-passed';
  } catch (error) {
    primaryError = error; report.status = 'failed'; report.failure = safeError(error);
    if (report.stages.some(item => item.label === 'reopen' && item.status === 'failed')) report.naturalReopen = 'FAILED; cause requires trace interpretation';
  } finally {
    for (const observer of observers) observer.detach();
    // Cleanup has separate evidence and cannot replace the first failure.
    for (const [label, operation] of [['browser-close', () => browser?.close()], ['studio-close', () => studio?.close()]]) {
      try { await operation(); }
      catch (error) { report.cleanupErrors.push({ label, failure: safeError(error) }); if (!primaryError) { primaryError = error; report.status = 'failed'; report.failure = safeError(error); } }
    }
    try { await save(); }
    catch (error) {
      report.diagnosticErrors.push({ label: 'save-final-report', failure: safeError(error) });
      if (!primaryError) { primaryError = error; report.status = 'failed'; report.failure = safeError(error); }
    }
  }
  if (primaryError) throw primaryError;
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { kit: { type: 'string' }, evidence: { type: 'string' }, npm: { type: 'string' } } });
    assert.ok(values.kit && values.evidence, 'Use --kit delivered-directory --evidence report-directory');
    const result = await probeInstalledKitReopen({ kit: resolve(values.kit), evidence: resolve(values.evidence), npm: values.npm });
    console.log(JSON.stringify({ status: result.status, naturalReopen: result.naturalReopen, originalCiCause: result.originalCiCause, commands: result.commands.map(({ command, exitCode }) => ({ command, exitCode })) }, null, 2));
  } catch (error) { console.error(JSON.stringify(safeError(error))); process.exitCode = 1; }
}
