import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function present(file) { try { await stat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
  child.on('error', reject); child.on('close', exitCode => resolve({ command: [command, ...args], cwd, exitCode, stdout, stderr }));
});

export async function verifyWindowsCancellation(directory = path.join(root, 'artifacts/acceptance/cancellation', `run-${randomUUID()}`)) {
  if (process.platform !== 'win32') throw new Error('Windows console verification requires Windows.');
  directory = path.resolve(directory);
  await mkdir(directory, { recursive: true });
  const project = path.join(directory, 'Проект с пробелом'); await mkdir(project);
  const manifest = { schemaVersion: 1, id: 'cancellation-check', seed: 17, video: { aspectRatio: '9:16', fps: 30 },
    brand: { theme: 'dark', background: '#101110', foreground: '#F1EEE6', accent: '#DDF53D', font: 'builtin-sans' },
    assets: {}, audio: { narration: { provider: 'none' }, music: { provider: 'none' } },
    scenes: [{ id: 'title', type: 'kinetic_title', durationFrames: 120, text: 'Проверка отмены' }] };
  const file = path.join(project, 'manifest.json');
  await writeFile(file, JSON.stringify(manifest, null, 2));
  const report = { status: 'running', platform: process.platform, node: process.version, directory,
    method: 'GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0) in a fresh hidden console',
    limitations: ['Programmatic Win32 console Ctrl+C event; not a physical keyboard gesture.', 'Existing Windows/Chrome/FFmpeg/Python installation; not a clean OS.'],
    commands: [], cases: [], sourceHashes: {} };
  for (const name of ['src/runtime.ts', 'src/cli.ts', 'src/browser.ts', 'src/engine.ts', 'scripts/windows-cancel-console.py']) report.sourceHashes[name] = sha(await readFile(path.join(root, name)));
  await writeFile(path.join(directory, 'request.json'), JSON.stringify({ goal: 'Ctrl+C cleanup and transactional output preservation', manifest }, null, 2));
  const persist = () => writeFile(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  const cli = path.join(root, 'dist/cli.js');
  const checkClean = async out => {
    const entries = await readdir(out);
    const leftovers = entries.filter(name => name === '.render.lock' || name.startsWith('.job-') || name.startsWith('.previous-'));
    assert.deepEqual(leftovers, [], 'cancelled job must release its output lock/staging/rollback directory');
    return { entries, leftovers };
  };
  const execute = async (name, out, phase, overwrite = false) => {
    const config = { command: [process.execPath, cli, 'render', file, '--out', out, '--no-cache', ...(overwrite ? ['--overwrite'] : []), '--json'], cwd: root, out, phase, totalFrames: manifest.scenes[0].durationFrames,
      reportPath: path.join(directory, `${name}.console.json`), readinessTimeoutSeconds: 90, completionTimeoutSeconds: 120 };
    const configPath = path.join(directory, `${name}.config.json`); await writeFile(configPath, JSON.stringify(config, null, 2));
    const result = await run(process.env.PYTHON_TEST_PATH || 'python', [path.join(root, 'scripts/windows-cancel-console.py'), '--config', configPath], root);
    report.commands.push({ name, ...result }); await persist();
    assert.equal(result.exitCode, 0, `Ctrl+C helper failed: ${result.stderr}`);
    const consoleReport = JSON.parse(await readFile(config.reportPath, 'utf8'));
    assert.equal(consoleReport.harnessError, undefined);
    assert.deepEqual(consoleReport.emergencyCleanup, [], 'forced termination cannot count as graceful cancellation acceptance');
    if (phase !== 'none') {
      assert.equal(consoleReport.readinessReached, true); assert.equal(consoleReport.eventGenerated, true);
      assert.equal(consoleReport.exitCode, 130); assert.equal(JSON.parse(consoleReport.stdout).error.code, 'CANCELLED');
      assert.deepEqual(consoleReport.ownedAfter, [], 'all command-owned process handles must be signaled');
      assert.deepEqual(consoleReport.loopbackAfter, [], 'the render server must stop listening');
      const failures = await readdir(path.join(out, 'failures'));
      const failure = JSON.parse(await readFile(path.join(out, 'failures', failures.at(-1), 'failure-report.json'), 'utf8'));
      assert.equal(failure.error.code, 'CANCELLED'); assert.equal(failure.exitCode, 130);
    } else {
      assert.equal(consoleReport.exitCode, 0); const output = JSON.parse(consoleReport.stdout);
      assert.equal(output.status, 'verified'); assert.equal(output.verification.decode.exitCode, 0);
      assert.equal(output.verification.totalFrames, manifest.scenes[0].durationFrames);
    }
    return { consoleReport, cleanup: await checkClean(out) };
  };
  try {
    const empty = path.join(directory, 'Новый результат');
    const frameCancelled = await execute('cancel-frames', empty, 'frames');
    assert.equal(await present(path.join(empty, 'output.mp4')), false);
    assert.equal(await present(path.join(empty, 'render-report.json')), false);
    report.cases.push({ name: 'empty output cancelled while recording real frames', ...frameCancelled, noSuccessfulPartialOutput: true }); await persist();

    manifest.scenes[0].durationFrames = 30; await writeFile(file, JSON.stringify(manifest, null, 2));
    const restart = await execute('rerender-after-frames', empty, 'none');
    report.cases.push({ name: 'rerender same empty-output path succeeds', ...restart }); await persist();

    const previous = path.join(directory, 'Существующий результат');
    const baseline = await execute('prior-success', previous, 'none');
    const before = Object.fromEntries(await Promise.all(['output.mp4', 'render-report.json', 'contact-sheet.jpg'].map(async name => [name, sha(await readFile(path.join(previous, name)))])));
    report.cases.push({ name: 'prior successful output', ...baseline, hashes: before }); await persist();

    manifest.scenes[0].durationFrames = 120; await writeFile(file, JSON.stringify(manifest, null, 2));
    const encoderCancelled = await execute('cancel-encoder', previous, 'encode', true);
    assert(encoderCancelled.consoleReport.ownedBefore.some(process => process.name.toLowerCase() === 'ffmpeg.exe'));
    assert(!encoderCancelled.consoleReport.ownedBefore.some(process => process.name.toLowerCase() === 'chrome.exe'), 'browser should be released before encoding');
    assert.deepEqual(encoderCancelled.consoleReport.loopbackBefore, [], 'completed frame generation must release the server before encoding');
    const after = Object.fromEntries(await Promise.all(Object.keys(before).map(async name => [name, sha(await readFile(path.join(previous, name)))])));
    assert.deepEqual(after, before, 'cancellation must preserve the prior successful output/report/sheet byte for byte');
    report.cases.push({ name: 'encoder cancellation preserves prior successful output', ...encoderCancelled, before, after, priorOutputPreserved: true }); await persist();

    manifest.scenes[0].durationFrames = 30; await writeFile(file, JSON.stringify(manifest, null, 2));
    const overwrite = await execute('rerender-after-encoder', previous, 'none', true);
    report.cases.push({ name: 'rerender same previous-output path succeeds', ...overwrite });
    report.status = 'passed'; await persist(); return report;
  } catch (error) {
    report.status = 'failed'; report.error = error.stack || String(error); await persist(); throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await verifyWindowsCancellation(process.argv[2]);
  console.log(JSON.stringify({ status: report.status, evidence: path.join(report.directory, 'verification.json'), cases: report.cases.length }));
}
