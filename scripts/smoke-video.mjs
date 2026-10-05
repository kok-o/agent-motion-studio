import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createProject, importMedia, editProject } from '../dist/project.js';
import { runProcess, findTools } from '../dist/runtime.js';
import { readFile } from 'node:fs/promises';
import { proceduralWav } from '../dist/audio.js';
import { render } from '../dist/engine.js';
const dir = resolve('artifacts/prototype/cli-smoke'); await mkdir(dir, { recursive: true });
const file = join(dir, 'project.json');
try { await createProject(dir); } catch (error) { if (error.code !== 'EEXIST') throw error; }
await runProcess(findTools().ffmpeg, ['-y','-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=24:duration=4','-c:v','libx264','-threads','2','-pix_fmt','yuv420p',join(dir,'input.mp4')]);
const video = await importMedia(file, 'input.mp4', await readFile(join(dir, 'input.mp4')));
const music = await importMedia(file, 'score.wav', proceduralWav(4, 7));
await editProject(file, { type: 'edit-scene', sceneId: 'opening', patch: { durationFrames: 30, text: 'Video import' } });
await editProject(file, { type: 'add-scene', scene: { id: 'video', type: 'video', asset: video.importedId, durationFrames: 60, trimStartSeconds: 1, fit: 'cover' } });
await editProject(file, { type: 'music', asset: music.importedId });
const report = await render(file, join(dir, 'export'), { noCache: true, overwrite: true, progress: console.error });
await writeFile(join(dir, 'smoke-result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: report.status, verification: report.verification, elapsedSeconds: report.elapsedSeconds }));
