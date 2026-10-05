import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = process.cwd(), npm = process.env.npm_execpath; assert.ok(npm, 'Run through npm run verify:package');
const latest = process.argv[2] ? null : JSON.parse(await readFile('artifacts/release/latest.json', 'utf8'));
const archive = resolve(process.argv[2] || latest.runtime);
const out = join(root, 'artifacts/release', `package-check-${Date.now()}`); await mkdir(out, { recursive: true });
const consumer = await mkdtemp(join(tmpdir(), 'ams-package-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { status: 'running', consumer, archive, sha256: hash(await readFile(archive)), checks: {}, limitations: 'Existing system tools; new npm consumer on this host, not a clean OS. Temporary consumer retained for inspection.' };
const save = () => writeFile(join(out, 'verification.json'), JSON.stringify(report, null, 2));
async function run(args, label) {
  const result = await new Promise((ok, bad) => {
    const p = spawn(process.execPath, args, { cwd: consumer, windowsHide: true }); let stdout = '', stderr = '';
    const timer = setTimeout(() => { p.kill(); bad(new Error(`${label}: timeout`)); }, 300000);
    p.stdout.on('data', d => stdout += d); p.stderr.on('data', d => stderr += d);
    p.once('error', e => { clearTimeout(timer); bad(e); }); p.once('close', code => { clearTimeout(timer); ok({ code, stdout, stderr }); });
  });
  await writeFile(join(out, `${label}.log`), JSON.stringify(result, null, 2));
  assert.equal(result.code, 0, `${label}: ${result.stderr}`); report.checks[label] = { exitCode: result.code }; await save(); return result.stdout;
}
try {
  if (latest) {
    const candidate = JSON.parse(await readFile(join(latest.directory, 'candidate.json'), 'utf8'));
    assert.equal(report.sha256, candidate.archives.find(a => a.file.endsWith('.tgz')).sha256);
  }
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'ams-release-consumer', version: '1.0.0', private: true }));
  await run([npm, 'install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', archive], 'install');
  const app = join(consumer, 'node_modules/agent-motion-studio'), cli = join(app, 'dist/cli.js');
  const cliRun = async (args, label) => JSON.parse(await run([cli, ...args, '--json'], label));
  const doctor = await cliRun(['doctor'], 'doctor'); assert.ok(doctor.ready); report.environment = doctor;
  await run([npm, 'exec', '--offline', '--no', '--', 'agent-motion-studio', 'doctor', '--json'], 'bin');
  const film = join(consumer, 'film'), file = join(film, 'project.json');
  await cliRun(['init', 'coffee-ritual', '--dir', film], 'init'); await cliRun(['validate', file], 'validate');
  const { readProject, editProject } = await import(pathToFileURL(join(app, 'dist/project.js')));
  const { previewScene } = await import(pathToFileURL(join(app, 'dist/preview.js')));
  const initial = await readProject(file), before = await readFile(file);
  const alternate = Object.entries(initial.manifest.assets).find(([, a]) => a.name === 'first-drops.mp4')[0];
  const sources = async () => Object.fromEntries(await Promise.all(Object.entries(initial.manifest.assets).map(async ([id, a]) => [id, hash(await readFile(join(film, a.path)))])));
  const initialHashes = await sources();
  const action = { type: 'edit-scene', sceneId: 'first-pour', patch: { asset: alternate } };
  const preview = await previewScene(file, action, initial.etag, join(consumer, 'preview'));
  assert.ok((await readFile(file)).equals(before)); assert.equal(preview.verification.totalFrames, 210);
  await editProject(file, action, initial.etag);
  const edited = await readProject(file); assert.equal(edited.manifest.scenes[1].asset, alternate);
  assert.deepEqual(edited.manifest.scenes.filter((_, i) => i !== 1), initial.manifest.scenes.filter((_, i) => i !== 1));
  await editProject(file, { type: 'restore-scene', sceneId: 'first-pour', revisionId: edited.manifest.history.at(-1).id }, edited.etag);
  assert.deepEqual((await readProject(file)).manifest.scenes, initial.manifest.scenes); assert.deepEqual(await sources(), initialHashes);
  report.checks.previewAndRestore = { previewFrames: 210, draftNotSaved: true, otherScenesPreserved: true, sources: initialHashes }; await save();
  const rendered = await cliRun(['render', file, '--out', join(consumer, 'export'), '--no-cache'], 'render');
  assert.equal(rendered.verification.totalFrames, 600); assert.equal(rendered.verification.audio.codec, 'aac');
  await cliRun(['verify', join(consumer, 'export/output.mp4')], 'verify');
  report.checks.render.media = { frames: 600, seconds: 20, audio: 'AAC', elapsedSeconds: rendered.elapsedSeconds };
  report.status = 'passed'; await save(); console.log(JSON.stringify({ status: report.status, evidence: out, sha256: report.sha256 }, null, 2));
} catch (error) { report.status = 'failed'; report.failure = error.stack; await save(); throw error; }
