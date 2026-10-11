#!/usr/bin/env node
// Read an existing preview; write only a new proof directory. No project edits.
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { mkdir, lstat, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const usage = 'node extract-motion-proof.mjs VIDEO --out NEW_DIR --frames 0,24,57,90,149 --total-frames 150';

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    out: { type: 'string' }, frames: { type: 'string' }, 'total-frames': { type: 'string' },
  } });
  if (positionals.length !== 1 || !values.out || !values.frames || !/^[1-9]\d*$/.test(values['total-frames'] ?? '')) throw new Error(usage);
  const totalFrames = Number(values['total-frames']);
  if (!Number.isSafeInteger(totalFrames) || totalFrames > 1800) throw new Error('Expected 1–1800 total frames.');
  const parts = values.frames.split(',');
  if (parts.length > 64 || parts.some(part => !/^(0|[1-9]\d*)$/.test(part))) throw new Error('Use 1–64 comma-separated integer frame indices.');
  const frames = parts.map(Number);
  if (frames.some((n, i) => n >= totalFrames || (i > 0 && n <= frames[i - 1]))) throw new Error('Frame indices must increase, without duplicates, in 0..total-frames-1.');
  const video = resolve(positionals[0]), output = resolve(values.out);
  if (!(await lstat(video)).isFile()) throw new Error('Preview must be an existing regular video file.');
  try { await lstat(output); throw new Error('Proof output exists; choose a new directory. Existing files were kept.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  const run = (executable, args) => {
    const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    if (result.error) throw result.error;
    return { executable, args, exit: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
  };
  const probe = run(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames,avg_frame_rate,width,height', '-of', 'json', video]);
  if (probe.exit !== 0) throw new Error(`ffprobe failed (${probe.exit}): ${probe.stderr}`);
  const stream = JSON.parse(probe.stdout).streams?.[0];
  const [num, den] = (stream?.avg_frame_rate || '').split('/').map(Number);
  if (Number(stream?.nb_read_frames) !== totalFrames || !den || num / den !== 30) throw new Error('Preview must decode to the declared total frames at 30 fps; no proof was extracted.');

  await mkdir(output); // Non-recursive and exclusive: never reuse/overwrite a proof set.
  const filter = `select=${frames.map(n => `eq(n\\,${n})`).join('+')}`;
  const extract = run(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-xerror', '-i', video, '-map', '0:v:0', '-vf', filter, '-fps_mode', 'vfr', '-start_number', '0', '-c:v', 'png', '-n', join(output, 'proof-%03d.png')]);
  const expected = frames.map((frame, index) => ({ frame, file: `proof-${String(index).padStart(3, '0')}.png` }));
  const actual = (await readdir(output)).filter(name => name.endsWith('.png')).sort();
  const complete = extract.exit === 0 && actual.length === expected.length && actual.every((name, i) => name === expected[i].file);
  const report = { complete, video, totalFrames, fps: 30, width: stream.width, height: stream.height, frames: expected, probe, extract };
  await writeFile(join(output, 'proof.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  if (!complete) throw new Error('Incomplete proof set or FFmpeg failure; see proof.json. Keep it as failed evidence and choose a new directory after diagnosis.');
  console.log(JSON.stringify({ complete, output, frames: expected, report: join(output, 'proof.json') }));
}

try { await main(); }
catch (error) { console.error(JSON.stringify({ complete: false, error: error.message })); process.exitCode = 1; }
