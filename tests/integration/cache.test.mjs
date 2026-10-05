import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, copyFile, appendFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function cli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['dist/cli.js', ...args, '--json'], { shell: false, env: { ...process.env, ...env } });
    let stdout = '', stderr = ''; child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.on('error', reject); child.on('close', code => resolve({ code, result: JSON.parse(stdout), stderr }));
  });
}
test('cache integrity, same-path image edit, duration edit and failed encoder preserve observable behavior', { timeout: 180000 }, async () => {
  const project = path.resolve('.cache/tests', `Проверка с пробелом ${randomUUID()}`); const output = path.join(project, 'готовое видео');
  await mkdir(project, { recursive: true });
  const input = JSON.parse(await readFile('examples/repo-promo/manifest.json', 'utf8'));
  // The acceptance fixture needs one of each type; demo storyboards may evolve.
  input.scenes = ['kinetic_title', 'product_zoom', 'cta'].map(type => input.scenes.find(scene => scene.type === type));
  input.assets.product.path = './картинка.png'; input.audio.music.provider = 'none';
  input.scenes.forEach(scene => scene.durationFrames = 30);
  const file = path.join(project, 'manifest.json');
  try {
    await copyFile('examples/repo-promo/assets/studio.png', path.join(project, 'картинка.png')); await writeFile(file, JSON.stringify(input));
    const initial = await cli(['render', file, '--out', output]); assert.equal(initial.code, 0); assert.equal(initial.result.verification.totalFrames, 90);
    const frameBefore = sha(await readFile(path.join(output, 'frames/f00045.png')));
    const repeat = await cli(['render', file, '--out', output, '--overwrite']); assert.equal(repeat.code, 0); assert.equal(repeat.result.cache.status, 'hit');
    await appendFile(path.join(initial.result.cache.directory, 'output.mp4'), 'damaged');
    const damaged = await cli(['render', file, '--out', output, '--overwrite']); assert.equal(damaged.code, 0, JSON.stringify(damaged)); assert.equal(damaged.result.cache.status, 'miss');
    await copyFile('examples/product-ad/assets/planner.png', path.join(project, 'картинка.png'));
    const edit = await cli(['render', file, '--out', output, '--overwrite']); assert.equal(edit.code, 0); assert.notEqual(edit.result.fingerprint, initial.result.fingerprint); assert.notEqual(sha(await readFile(path.join(output, 'frames/f00045.png'))), frameBefore);
    input.scenes[2].durationFrames = 1; await writeFile(file, JSON.stringify(input));
    const shortened = await cli(['render', file, '--out', output, '--overwrite']); assert.equal(shortened.code, 0); assert.equal(shortened.result.verification.totalFrames, 61); assert.equal((await readdir(path.join(output, 'frames'))).length, 61);
    const previous = sha(await readFile(path.join(output, 'output.mp4'))); const previousReport = sha(await readFile(path.join(output, 'render-report.json')));
    const failed = await cli(['render', file, '--out', output, '--overwrite'], { FFMPEG_PATH: process.env.FFPROBE_PATH || 'ffprobe' });
    assert.equal(failed.code, 4); assert.equal(failed.result.error.code, 'PROCESS_FAILED'); assert.equal(failed.result.outputFile, undefined);
    assert.equal(sha(await readFile(path.join(output, 'output.mp4'))), previous); assert.equal(sha(await readFile(path.join(output, 'render-report.json'))), previousReport);
    await assert.rejects(stat(path.join(output, '.render.lock')), /ENOENT/);
    await writeFile(path.join(output, '.render.lock'), 'fixture lock'); const locked = await cli(['render', file, '--out', output, '--overwrite']); assert.equal(locked.code, 2); assert.equal(locked.result.error.code, 'OUTPUT_LOCKED');
  } finally { await rm(project, { recursive: true, force: true }); }
});
