import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyFirstUserKit } from './verify-first-user-kit.mjs';
import { safeError } from './kit-ui-observer.mjs';

async function main() {
const root = process.cwd(), npm = process.env.npm_execpath; assert.ok(npm, 'Run through npm run verify:package');
const latest = process.argv[2] ? null : JSON.parse(await readFile('artifacts/release/latest.json', 'utf8'));
const archive = resolve(process.argv[2] || latest.runtime);
const out = join(root, 'artifacts/release', `package-check-${Date.now()}`); await mkdir(out, { recursive: true });
const consumer = await mkdtemp(join(tmpdir(), 'ams-package-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { status: 'running', consumer: '[retained OS temporary workspace]', archive: basename(archive), sha256: hash(await readFile(archive)), checks: {}, limitations: 'Existing system tools; new npm consumer on this host, not a clean OS. Temporary consumer retained for inspection.' };
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
  assert.ok((await readFile(join(app, 'dist/studio/i18n.js'), 'utf8')).includes('initializeI18n'));
  assert.ok((await readFile(join(app, 'dist/studio/index.html'), 'utf8')).includes('id="language"'));
  assert.ok((await readFile(join(app, 'skills/agent-motion-studio/references/edits.md'), 'utf8')).includes('E8'));
  const cliRun = async (args, label) => JSON.parse(await run([cli, ...args, '--json'], label));
  const doctor = await cliRun(['doctor'], 'doctor'); assert.ok(doctor.ready);
  report.environment = { os: doctor.os, node: doctor.node.version, browser: doctor.browser.version, canvas: doctor.browser.canvas, ffmpeg: doctor.ffmpeg.version.trim(), ffprobe: doctor.ffprobe.version.trim() };
  await run([npm, 'exec', '--offline', '--no', '--', 'agent-motion-studio', 'doctor', '--json'], 'bin');
  const installedSkill = JSON.parse(await run([join(app, 'scripts/install-agent-skill.mjs'), '--client', 'both', '--scope', 'project'], 'agent-skill-install'));
  assert.deepEqual(installedSkill.installs.map(item => item.status), ['installed', 'installed']);
  for (const location of ['.agents', '.claude']) assert.ok((await readFile(join(consumer, location, 'skills/agent-motion-studio/references/brief-to-film.md'), 'utf8')).includes('restore-scene'));
  const briefFile = join(consumer, 'brief.txt'); await writeFile(briefFile, 'Create a local motion film. No external calls authorized.');
  const dryApi = JSON.parse(await run([join(app, 'scripts/api-agent.mjs'), '--brief', briefFile, '--out', join(consumer, 'api-film'), '--dry-run'], 'api-agent-dry-run'));
  assert.equal(dryApi.network, false); assert.equal(dryApi.clientStarted, false);
  const fresh = await cliRun(['new', '--dir', join(consumer, 'new-film')], 'new-project');
  const freshState = await cliRun(['state', fresh.project], 'new-state');
  const ordinaryAction = join(consumer, 'ordinary-draft.json'); await writeFile(ordinaryAction, JSON.stringify({ type: 'edit-scene', sceneId: 'opening', patch: { text: 'INSTALLED PREVIEW', durationFrames: 30 } }));
  const freshBytes = await readFile(fresh.project);
  const ordinaryPreview = await cliRun(['preview', fresh.project, '--action', ordinaryAction, '--if-match', freshState.etag, '--out', join(consumer, 'ordinary-preview')], 'ordinary-cli-preview');
  assert.equal(ordinaryPreview.stale, false); assert.equal(ordinaryPreview.totalFrames, 30); assert.ok((await readFile(fresh.project)).equals(freshBytes));
  await cliRun(['edit', fresh.project, '--action', ordinaryAction, '--if-match', ordinaryPreview.projectHash], 'ordinary-cli-accept');
  const ordinaryAccepted = await cliRun(['state', fresh.project], 'ordinary-accepted-state');
  assert.equal(ordinaryAccepted.manifest.scenes[0].text, 'INSTALLED PREVIEW'); assert.deepEqual(ordinaryAccepted.manifest.history.at(-1).scenes, freshState.manifest.scenes);
  const { createStudioTool } = await import(pathToFileURL(join(app, 'scripts/api-agent.mjs')));
  const apiLocal = await createStudioTool(fresh.project, consumer), apiAction = { type: 'edit-scene', sceneId: 'opening', patch: { text: 'API TOOL ACCEPTED', durationFrames: 30 } };
  const apiArgs = { operation: 'preview', action: JSON.stringify(apiAction), etag: ordinaryAccepted.etag, label: 'api-tool-preview', previewToken: null };
  const apiPreview = await apiLocal.execute(apiArgs);
  await assert.rejects(apiLocal.execute({ ...apiArgs, operation: 'edit', previewToken: apiPreview.previewToken, action: JSON.stringify({ ...apiAction, patch: { text: 'DIFFERENT DRAFT' } }) }), /Preview the exact action/);
  const apiAccepted = await apiLocal.execute({ ...apiArgs, operation: 'edit', previewToken: apiPreview.previewToken });
  assert.equal(apiAccepted.manifest.scenes[0].text, 'API TOOL ACCEPTED');
  report.checks.agentWorkflow = { installedSkillFiles: installedSkill.installs.map(item => item.files), apiDryRunNoNetwork: true, newProject: true, previewNoMutation: true, previewFrames: 30, acceptedThroughCli: true, historyPreserved: true, apiPreviewBindsExactAction: true, apiExactPreviewAccepted: true, realClientDiscovery: 'NOT RUN in this consumer' }; await save();
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
  const referencePath = join(consumer, 'small-reference.png');
  await writeFile(referencePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
  const reference = await cliRun(['import', file, '--file', referencePath], 'generation-reference-import');
  const requestPath = join(consumer, 'generation-request.json');
  await writeFile(requestPath, JSON.stringify({ intentId: 'installed-consumer-local-intent', sceneId: 'first-pour', prompt: 'Local package validation only; do not submit.', referenceAssetId: reference.importedId, durationSeconds: 7.5625, resolution: '480p' }));
  const generationBefore = await readFile(file);
  const capabilities = await cliRun(['generation', 'capabilities'], 'generation-capabilities'); assert.equal(capabilities.model, 'wan-video/wan-2.2-i2v-fast');
  const prepared = await cliRun(['generation', 'prepare', file, '--request', requestPath], 'generation-prepare'); assert.equal(prepared.status, 'prepared'); assert.equal(prepared.submissions, 0);
  const repeated = await cliRun(['generation', 'prepare', file, '--request', requestPath], 'generation-repeat-prepare'); assert.equal(prepared.id, repeated.id);
  const status = await cliRun(['generation', 'status', file, '--job', prepared.id], 'generation-status'); assert.equal(status.submissions, 0);
  const listed = await cliRun(['generation', 'list', file], 'generation-list'); assert.equal(listed.length, 1);
  assert.ok((await readFile(file)).equals(generationBefore));
  report.checks.generation = { installedModules: true, localPrepareStatusList: true, duplicateIntentRetained: true, acceptedProjectUnchanged: true, submissions: 0, liveProvider: 'NOT RUN' };
  const { GenerationService } = await import(pathToFileURL(join(app, 'dist/generation.js')));
  const { replicateCapabilities } = await import(pathToFileURL(join(app, 'dist/generation-provider.js')));
  let controlledSubmissions = 0, controlledDownloads = 0;
  const controlledProvider = {
    capabilities: () => replicateCapabilities(true),
    submit: async () => { controlledSubmissions++; return { remoteId: 'installed-controlled-job', status: 'output_ready' }; },
    status: async remoteId => ({ remoteId, status: 'output_ready' }),
    download: async (_remoteId, destination) => { controlledDownloads++; await writeFile(destination, await readFile(join(consumer, 'export/output.mp4')), { flag: 'wx' }); },
  };
  // Explicit test-only dependency injection. No installed production provider request is made.
  const generation = new GenerationService(file, controlledProvider), beforeTake = await readProject(file);
  await generation.submit(prepared.id, { requestHash: prepared.requestHash, maxSubmissions: 1, maxCostUsd: prepared.estimate.usd, uploadReference: true });
  await generation.download(prepared.id); assert.equal(controlledSubmissions, 1); assert.equal(controlledDownloads, 1);
  const draft = { trimStartSeconds: 0, fit: 'cover', focalPoint: { x: .5, y: .5 } };
  const candidatePreview = await generation.preview(prepared.id, draft, beforeTake.etag, join(consumer, 'generation-preview'));
  assert.ok((await readFile(file)).equals(generationBefore));
  const candidateAccepted = await generation.accept(prepared.id, draft, candidatePreview.previewId, candidatePreview.projectHash, 'installed-candidate-accept');
  const acceptedBytes = await readFile(file);
  await generation.accept(prepared.id, draft, candidatePreview.previewId, candidatePreview.projectHash, 'installed-candidate-accept');
  assert.ok((await readFile(file)).equals(acceptedBytes));
  assert.equal(candidateAccepted.manifest.scenes[1].durationFrames, beforeTake.manifest.scenes[1].durationFrames);
  assert.deepEqual(candidateAccepted.manifest.scenes.filter((_, i) => i !== 1), beforeTake.manifest.scenes.filter((_, i) => i !== 1));
  await editProject(file, { type: 'restore-scene', sceneId: 'first-pour', revisionId: beforeTake.manifest.revision }, candidateAccepted.etag);
  assert.deepEqual((await readProject(file)).manifest.scenes, beforeTake.manifest.scenes); assert.deepEqual(await sources(), initialHashes);
  report.checks.generation.candidateWorkflow = { controlledSubmissions, controlledDownloads, previewFrames: candidatePreview.totalFrames, acceptedOnce: true, replayNoMutation: true, priorSceneRestored: true, sourcesPreserved: true, productionNetworkRequests: 0 };
  const restoredBytes = await readFile(file);
  const bound = await cliRun(['generation', 'bind-store', file], 'generation-bind-store'); assert.equal(bound.bound, true);
  controlledProvider.submit = async () => { controlledSubmissions++; throw new Error('Controlled lost submission response'); };
  const uncertain = await generation.prepare({ ...JSON.parse(await readFile(requestPath, 'utf8')), intentId: 'installed-unknown-intent' });
  assert.equal((await generation.submit(uncertain.id, { requestHash: uncertain.requestHash, maxSubmissions: 1, maxCostUsd: uncertain.estimate.usd, uploadReference: true })).status, 'submission_unknown');
  const resolutionPath = join(consumer, 'resolution.json');
  await writeFile(resolutionPath, JSON.stringify({ requestHash: uncertain.requestHash, accountChecked: true, acknowledgePossibleCharge: true }));
  const acknowledged = await cliRun(['generation', 'resolve-unknown', file, '--job', uncertain.id, '--resolution', resolutionPath], 'generation-resolve-unknown');
  assert.equal(acknowledged.status, 'submission_unknown'); assert.equal(acknowledged.submissions, 1); assert.equal(acknowledged.unknownResolution.kind, 'user_acknowledged');
  assert.equal(controlledSubmissions, 2); assert.ok((await readFile(file)).equals(restoredBytes));
  report.checks.generation.recoveryCommands = { bindStore: true, resolveUnknown: true, oldUnknownRetained: true, acceptedProjectUnchanged: true, controlledSubmissionsTotal: controlledSubmissions, productionNetworkRequests: 0 };
  if (latest?.userKit) {
    report.checks.firstUserKit = { status: 'running', evidence: 'first-user-kit/SELF_RUN.json' }; await save();
    let kitResult;
    try { kitResult = await verifyFirstUserKit({ kit: latest.userKit, npm, evidence: join(out, 'first-user-kit') }); }
    catch (error) {
      // Child failure is evidence, never a successful kit smoke or a reseal.
      report.checks.firstUserKit = { status: 'failed', evidence: 'first-user-kit/SELF_RUN.json', failure: safeError(error) };
      try { report.checks.firstUserKit.partial = JSON.parse(await readFile(join(out, 'first-user-kit/SELF_RUN.json'), 'utf8')); }
      catch (probeError) { report.checks.firstUserKit.evidenceUnavailable = safeError(probeError); }
      throw error;
    }
    report.checks.firstUserKit = { ...kitResult, consumer: '[retained OS temporary workspace]' };
  }
  report.status = 'passed'; await save(); console.log(JSON.stringify({ status: report.status, evidence: out, sha256: report.sha256 }, null, 2));
} catch (error) { report.status = 'failed'; report.failure = safeError(error); try { await save(); } catch { /* Preserve the primary failure if evidence storage is unavailable. */ } throw error; }
}

// Puppeteer connection errors may include a complete private session URL.
// Preserve Error identity inside the verifier; print only portable data at CLI.
try { await main(); }
catch (error) { console.error(JSON.stringify(safeError(error))); process.exitCode = 1; }
