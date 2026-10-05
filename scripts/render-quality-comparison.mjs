import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { findTools } from '../dist/runtime.js';

const root = process.cwd(), output = path.resolve('artifacts/quality-v2');
await mkdir(output, { recursive: true });
const commands = [];
async function command(name, executable, args) {
  const started = performance.now();
  const result = await new Promise((resolve, reject) => {
    const process = spawn(executable, args, { cwd: root, shell: false, windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { process.kill(); reject(new Error(`${name} timed out`)); }, 300000);
    process.stdout.on('data', data => { stdout += data; }); process.stderr.on('data', data => { stderr += data; });
    process.once('error', error => { clearTimeout(timer); reject(error); });
    process.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  commands.push({ name, executable, args, cwd: root, exitCode: result.code, elapsedSeconds: (performance.now() - started) / 1000 });
  await writeFile(path.join(output, `${name}.stdout.log`), result.stdout);
  await writeFile(path.join(output, `${name}.stderr.log`), result.stderr);
  await writeFile(path.join(output, 'commands.json'), JSON.stringify(commands, null, 2));
  if (result.code !== 0) throw new Error(`${name} exited ${result.code}: ${result.stdout.slice(-1500)} ${result.stderr.slice(-1500)}`);
  console.log(`${name}: exit 0`); return result;
}
const original = JSON.parse(await readFile('examples/kinetic-promo/manifest.json', 'utf8'));
const projects = {};
for (const name of ['baseline', 'landscape']) {
  const project = path.join(output, 'projects', name); await mkdir(path.join(project, 'assets'), { recursive: true });
  const manifest = structuredClone(original);
  if (name === 'baseline') manifest.video.style = 'studio';
  else manifest.video.aspectRatio = '16:9';
  await copyFile('examples/kinetic-promo/assets/studio.png', path.join(project, 'assets/studio.png'));
  projects[name] = path.join(project, 'manifest.json');
  await writeFile(projects[name], JSON.stringify(manifest, null, 2));
}
const tools = findTools();
const renders = [];
for (const [name, manifest] of [['portrait', 'examples/kinetic-promo/manifest.json'], ['baseline', projects.baseline], ['landscape', projects.landscape]]) {
  await command(`render-${name}`, process.execPath, ['dist/cli.js', 'render', manifest, '--out', path.join(output, name), '--overwrite', '--no-cache', '--json']);
  const report = JSON.parse(await readFile(path.join(output, name, 'render-report.json'), 'utf8'));
  const file = path.join(output, name, 'output.mp4');
  const probe = await command(`probe-${name}`, tools.ffprobe, ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,codec_type,width,height,avg_frame_rate,nb_read_frames,pix_fmt,duration,sample_rate,channels:format=duration', '-of', 'json', file]);
  await command(`decode-${name}`, tools.ffmpeg, ['-v', 'error', '-xerror', '-threads', '1', '-i', file, '-f', 'null', '-']);
  renders.push({ name, file, report, independentProbe: JSON.parse(probe.stdout) });
}
await command('comparison', tools.ffmpeg, ['-y', '-v', 'error', '-threads', '1', '-i', path.join(output, 'baseline/output.mp4'), '-threads', '1', '-i', path.join(output, 'portrait/output.mp4'), '-filter_complex_threads', '1', '-filter_complex', '[0:v]scale=540:960:flags=lanczos[left];[1:v]scale=540:960:flags=lanczos[right];[left][right]hstack=inputs=2[v]', '-map', '[v]', '-map', '1:a:0', '-c:v', 'libx264', '-threads', '2', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-t', '13', '-movflags', '+faststart', path.join(output, 'comparison.mp4')]);
await command('decode-comparison', tools.ffmpeg, ['-v', 'error', '-xerror', '-threads', '1', '-i', path.join(output, 'comparison.mp4'), '-f', 'null', '-']);
const loudness = await command('loudness-final', tools.ffmpeg, ['-hide_banner', '-i', path.join(output, 'portrait/output.mp4'), '-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=9:print_format=json', '-f', 'null', '-']);
const match = /\{\s*"input_i"[\s\S]*?\}/.exec(loudness.stderr);
await writeFile(path.join(output, 'verification.json'), JSON.stringify({ status: 'passed', renders, commands, audioMeasurement: match ? JSON.parse(match[0]) : null, comparison: { file: path.join(output, 'comparison.mp4'), left: 'studio', right: 'kinetic', audio: 'kinetic', scope: 'Same copy, scene IDs, timing, palette, image and explicit gain; style changes include the procedural arrangement.' }, visualReview: { sheets: 'inspected before final encode', fullResolution: 'pending final review', audioListening: 'not performed', parityWithUpstream: 'not established' } }, null, 2));
console.log('Quality comparison verified.');
