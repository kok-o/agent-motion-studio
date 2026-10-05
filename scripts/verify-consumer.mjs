import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const kineticOnly = process.argv.includes('--kinetic-only');
const fullExamples = process.argv.includes('--full-examples');
const artifactsOption = process.argv.indexOf('--artifacts');
const artifacts = artifactsOption >= 0 ? path.resolve(process.argv[artifactsOption + 1]) : path.join(root, 'artifacts', ...(kineticOnly ? ['quality-v2'] : []));
const consumer = path.join(os.homedir(), 'Documents', 'Codex', '2026-10-05', 'agent-motion-studio-consumer', `Проверка с пробелом ${randomUUID()}`);
const npmCli = process.env.NPM_CLI || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const commands = [];
async function command(args, cwd, name) {
  const started = performance.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, shell: false, windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${name}: timeout`)); }, 180000);
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ stdout, stderr, code }); });
  });
  await writeFile(path.join(artifacts, `consumer-${name}.log`), `${result.stdout}\n${result.stderr}`);
  commands.push({ name, command: [process.execPath, ...args], cwd, exitCode: result.code, elapsedSeconds: (performance.now() - started) / 1000 });
  if (result.code !== 0) throw new Error(`${name} exited ${result.code}: ${result.stderr.slice(-3000)} ${result.stdout.slice(-3000)}`);
  return result;
}
try {
  await mkdir(artifacts, { recursive: true });
  const packed = JSON.parse((await command([npmCli, 'pack', '--json', '--pack-destination', artifacts], root, 'pack')).stdout)[0];
  const bad = packed.files.filter(file => /^(references|\.agents|artifacts|node_modules)\//.test(file.path) || file.path.split('/').includes('.cache') || /(^|\/)\.env/.test(file.path));
  if (bad.length) throw new Error(`Unexpected package contents: ${bad.slice(0, 5).map(file => file.path).join(', ')}`);
  const tarball = path.join(artifacts, packed.filename);
  const tarballHash = createHash('sha256').update(await readFile(tarball)).digest('hex');
  await mkdir(consumer, { recursive: true });
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ name: 'motion-studio-consumer', version: '1.0.0', private: true }));
  await command([npmCli, 'install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', tarball], consumer, 'install');
  const packagePath = path.join(consumer, 'node_modules', 'agent-motion-studio');
  for (const file of ['dist/cli.js', 'dist/renderer/entry.js', 'schemas/manifest.schema.json', 'assets/fonts/OFL.txt', 'assets/fonts/OFL-Oswald.txt', 'assets/fonts/oswald-cyrillic-700-normal.woff2', 'skills/agent-motion-studio/SKILL.md', 'examples/repo-promo/assets/studio.png', 'examples/feature-explainer/assets/voice.wav', 'examples/kinetic-promo/assets/studio.png']) await stat(path.join(packagePath, file));
  for (const excluded of ['references', '.agents', 'src']) {
    let found = false; try { await stat(path.join(packagePath, excluded)); found = true; } catch {}
    if (found) throw new Error(`Unexpected source dependency in consumer: ${excluded}`);
  }
  const cli = path.join(packagePath, 'dist/cli.js');
  const doctor = JSON.parse((await command([cli, 'doctor', '--json'], consumer, 'doctor')).stdout);
  await command([npmCli, 'exec', '--offline', '--no', '--', 'agent-motion-studio', 'doctor', '--json'], consumer, 'bin-doctor');
  const renderResults = [];
  for (const template of kineticOnly ? ['kinetic-promo'] : ['repo-promo', 'product-ad', 'feature-explainer']) {
    const project = path.join(consumer, `Проект ${template}`);
    await command([cli, 'init', template, '--dir', project, '--json'], consumer, `init-${template}`);
    const manifest = path.join(project, 'manifest.json');
    if (template === 'repo-promo' && !fullExamples) {
      const input = JSON.parse(await readFile(manifest, 'utf8'));
      input.scenes = [input.scenes[0]]; input.scenes[0].durationFrames = 120;
      input.scenes[0].text = 'Новый ролик\nиз пакета'; delete input.scenes[0].highlight;
      input.audio.music.provider = 'none'; input.assets = {};
      await writeFile(manifest, JSON.stringify(input, null, 2));
    }
    await command([cli, 'validate', manifest, '--json'], consumer, `validate-${template}`);
    const out = path.join(consumer, `Результат ${template}`);
    const rendered = JSON.parse((await command([cli, 'render', manifest, '--out', out, '--json'], consumer, `render-${template}`)).stdout);
    await command([cli, 'verify', path.join(out, 'output.mp4'), '--json'], consumer, `verify-${template}`);
    renderResults.push({ template, output: path.join(out, 'output.mp4'), totalFrames: rendered.verification.totalFrames, verification: rendered.verification, audio: rendered.audio });
  }
  const report = { status: 'passed', consumerDirectory: consumer, packagePath, tarball, tarballHash, packageBytes: packed.size, packageFileCount: packed.files.length, forbiddenFiles: bad, doctor, commands, renders: renderResults, scope: 'Installed runtime outside source checkout; existing Windows tools; paths with spaces and Cyrillic. Not a clean OS installation.' };
  await writeFile(path.join(artifacts, 'consumer-verification.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify({ status: report.status, consumerDirectory: consumer, tarballHash, packageBytes: packed.size, renders: renderResults.map(item => ({ template: item.template, frames: item.totalFrames })) }));
} catch (error) {
  await writeFile(path.join(artifacts, 'consumer-verification.json'), JSON.stringify({ status: 'failed', consumerDirectory: consumer, commands, error: String(error) }, null, 2));
  process.stderr.write(String(error)); process.exitCode = 1;
}
