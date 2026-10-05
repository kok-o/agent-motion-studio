import { mkdir, readFile, writeFile, readdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadManifest } from '../dist/spec.js';
import { prepareAudio } from '../dist/audio.js';
import { findTools } from '../dist/runtime.js';

const root = process.cwd(), out = path.resolve('artifacts/acceptance/edge');
await mkdir(out, { recursive: true });
const commands = [], report = { status: 'running', date: new Date().toISOString(), commands, limits: { simulatedProviderOutage: true, actualMicrosoftOutage: 'not observed', liveRequests: 'at most one new voice request; reruns may use saved cache', listening: 'not performed' } };
const save = () => writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
async function command(name, args, env = {}) {
  const started = performance.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, shell: false, windowsHide: true, env: { ...process.env, ...env } });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill(), 180000);
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  await writeFile(path.join(out, `${name}.stdout.log`), result.stdout);
  await writeFile(path.join(out, `${name}.stderr.log`), result.stderr);
  commands.push({ name, executable: process.execPath, args, cwd: root, exitCode: result.code, elapsedSeconds: (performance.now() - started) / 1000 });
  await save();
  return result;
}
const expect = (condition, message) => { if (!condition) throw new Error(message); };
try {
  const failed = await command('controlled-outage-regression', ['--test', 'tests/integration/edge.test.mjs']);
  expect(failed.code === 0, 'Controlled outage regression failed.');
  report.controlledFailure = { passed: true, attempts: 2, partialSpeechRemoved: true, localProceduralAudioAfterFailure: true, source: 'tests/integration/edge.test.mjs', transport: 'Python fixture; no real Microsoft outage' };

  const core = await command('core-after-provider-failure', ['dist/cli.js', 'render', 'examples/smoke/manifest.json', '--out', path.join(out, 'core'), '--overwrite', '--no-cache', '--json']);
  expect(core.code === 0, 'Core render failed after provider regression.');
  report.core = JSON.parse(core.stdout);
  const project = path.join(out, 'voices');
  await mkdir(project, { recursive: true });
  const originalCache = path.resolve('examples/edge-speech/.cache/agent-motion-studio/audio');
  const targetCache = path.join(project, '.cache/agent-motion-studio/audio');
  await cp(originalCache, targetCache, { recursive: true, force: false });
  const input = JSON.parse(await readFile('examples/edge-speech/manifest.json', 'utf8'));
  const file = path.join(project, 'manifest.json');
  process.env.PYTHON_PATH = path.resolve('.cache/edge-addon/Scripts/python.exe');
  const tools = findTools();
  await writeFile(file, JSON.stringify(input, null, 2));
  await mkdir(path.join(out, 'baseline-audio'), { recursive: true });
  const before = await prepareAudio(await loadManifest(file), path.join(out, 'baseline-audio'), tools);
  expect(before.report.voices[0].cache === 'hit', 'Baseline did not reuse the saved genuine speech.');
  report.originalVoice = { voice: input.audio.narration.voice, audio: before };
  await save();

  input.audio.narration.voice = 'ru-RU-DmitryNeural';
  input.video.style = 'kinetic';
  input.scenes[0].text = 'Твой продукт\nв движении';
  await writeFile(file, JSON.stringify(input, null, 2));
  const changed = await command('different-live-voice', ['dist/cli.js', 'render', file, '--out', path.join(out, 'different-voice'), '--overwrite', '--no-cache', '--json'], { PYTHON_PATH: process.env.PYTHON_PATH });
  expect(changed.code === 0, 'Different live voice render failed.');
  const result = JSON.parse(changed.stdout);
  expect(result.audio.voices[0].hash !== before.report.voices[0].hash, 'Voice change reused the original fingerprint.');
  report.changedVoice = { voice: input.audio.narration.voice, result, differentFingerprint: true };
  expect((await readdir(targetCache)).filter(name => name.endsWith('.mp3')).length === 2, 'Expected two distinct saved speech files.');

  await mkdir(path.join(out, 'cached-repeat'), { recursive: true });
  const repeated = await prepareAudio(await loadManifest(file), path.join(out, 'cached-repeat'), tools);
  expect(repeated.report.voices[0].cache === 'hit', 'Changed voice did not use its own cache on repeat.');
  report.changedVoiceRepeat = repeated.report;
  input.scenes[0].durationFrames = 30;
  await writeFile(path.join(project, 'too-short.json'), JSON.stringify(input, null, 2));
  const tooLong = await command('cached-voice-too-long', ['dist/cli.js', 'render', path.join(project, 'too-short.json'), '--out', path.join(out, 'too-long-output'), '--json'], { PYTHON_PATH: process.env.PYTHON_PATH });
  expect(tooLong.code === 2 && JSON.parse(tooLong.stdout).error.code === 'VOICE_TOO_LONG', 'Overlong cached voice was not rejected.');
  report.tooLongVoice = { expectedExitCode: 2, actualExitCode: tooLong.code, result: JSON.parse(tooLong.stdout) };
  report.status = 'passed'; await save(); console.log(JSON.stringify({ status: report.status, report: path.join(out, 'report.json'), changedVoiceOutput: result.outputFile }));
} catch (error) { report.status = 'failed'; report.error = error.message; await save(); throw error; }
