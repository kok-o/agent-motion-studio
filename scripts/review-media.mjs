import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { findTools, runProcess } from '../dist/runtime.js';

const finalDemos = process.argv.includes('--final-demos');
const output = path.resolve(`artifacts/acceptance/${finalDemos ? 'final-media-review' : 'media-review'}`);
await mkdir(output, { recursive: true });
const tools = findTools(), reports = [];
const videos = finalDemos ? [
  ['repo-promo', 'artifacts/acceptance/demos/repo-promo/output.mp4'],
  ['product-ad', 'artifacts/acceptance/demos/product-ad/output.mp4'],
  ['feature-explainer', 'artifacts/acceptance/demos/feature-explainer/output.mp4'],
] : [
  ['kinetic', 'artifacts/quality-v2/final-portrait/output.mp4'],
  ['landscape', 'artifacts/quality-v2/landscape/output.mp4'],
  ['file-speech', 'artifacts/feature-explainer/output.mp4'],
  ['edge-speech', 'artifacts/edge-online/output.mp4'],
];
const additional = finalDemos ? undefined : process.argv[2];
if (additional) videos.push(['new-voice', additional]);
for (const [name, relative] of videos) {
  const file = path.resolve(relative), sha256 = createHash('sha256').update(await readFile(file)).digest('hex');
  const probeArgs = ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,sample_rate,channels', '-of', 'json', file];
  const probe = await runProcess(tools.ffprobe, probeArgs, { logPath: path.join(output, `${name}-probe.log`) });
  const metadata = JSON.parse(probe.stdout), duration = Number(metadata.format.duration);
  const video = metadata.streams.find(stream => stream.codec_type === 'video');
  const rows = Math.ceil(Math.ceil(duration * 3) / 10), width = video.width < video.height ? 216 : 384;
  const sheet = path.join(output, `${name}-sequence.jpg`);
  const sheetArgs = ['-y', '-v', 'error', '-threads', '1', '-i', file, '-an', '-vf', `fps=3,scale=${width}:-2:flags=lanczos,tile=10x${rows}`, '-frames:v', '1', '-threads', '1', sheet];
  await runProcess(tools.ffmpeg, sheetArgs, { logPath: path.join(output, `${name}-sequence.log`) });
  const loudnessArgs = ['-hide_banner', '-threads', '1', '-i', file, '-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=9:print_format=json', '-f', 'null', '-'];
  const loudness = await runProcess(tools.ffmpeg, loudnessArgs, { logPath: path.join(output, `${name}-loudness.log`) });
  const match = /\{\s*"input_i"[\s\S]*?\}/.exec(loudness.stderr);
  if (!match) throw new Error(`No loudness measurement for ${name}.`);
  const values = JSON.parse(match[0]);
  reports.push({ name, file, sha256, durationSeconds: duration, streams: metadata.streams, sequence: { path: sheet, samplingFps: 3, purpose: 'encoded-frame motion sequence; separate full-resolution frames check readability' }, measuredAudio: { integratedLufs: Number(values.input_i), truePeakDbTp: Number(values.input_tp), loudnessRangeLu: Number(values.input_lra) }, commands: [probeArgs, sheetArgs, loudnessArgs].map(args => ({ executable: args === probeArgs ? tools.ffprobe : tools.ffmpeg, args, cwd: process.cwd(), exitCode: 0 })) });
  console.log(`${name}: sequence exported and audio measured`);
}
await writeFile(path.join(output, 'report.json'), JSON.stringify({ status: 'measured', reports, review: { frameSequences: 'pending image inspection', continuousVisualReview: 'not asserted by extraction', subjectiveListening: 'not performed; browser playback is not an audio perception capability', aestheticApproval: 'not established' } }, null, 2));
