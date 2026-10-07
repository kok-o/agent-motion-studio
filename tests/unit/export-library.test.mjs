import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { registerExport } from '../../dist/export-library.js';

async function fixture() {
  const parent = resolve('.cache/tests'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'export-library-'));
  const project = join(root, 'project'), output = join(root, 'external');
  await mkdir(project); await mkdir(output);
  const file = join(project, 'project.json'), manifest = Buffer.from('{"history":["kept"]}\n');
  await writeFile(file, manifest); await writeFile(join(output, 'output.mp4'), 'verified-output-fixture');
  return { root, project, output, file, manifest };
}
const summary = { durationSeconds: 1, totalFrames: 30 };

test('registered exports are independent portable copies and keep earlier versions and accepted bytes', async () => {
  const f = await fixture();
  try {
    const first = await registerExport(f.file, f.output, f.manifest, summary);
    assert.equal(first.status, 'registered');
    assert.equal(await readFile(join(f.project, first.path), 'utf8'), 'verified-output-fixture');
    await writeFile(join(f.output, 'output.mp4'), 'next-output-fixture');
    const second = await registerExport(f.file, f.output, f.manifest, summary);
    assert.equal(second.status, 'registered'); assert.notEqual(first.id, second.id);
    await rm(f.output, { recursive: true });
    assert.equal(await readFile(join(f.project, first.path), 'utf8'), 'verified-output-fixture');
    assert.equal(await readFile(join(f.project, second.path), 'utf8'), 'next-output-fixture');
    assert.deepEqual(await readFile(f.file), f.manifest);
    assert.deepEqual(await readFile(join(f.project, 'exports', first.id, 'manifest.json')), f.manifest);
    assert.deepEqual((await readdir(join(f.project, 'exports'))).sort(), [first.id, second.id].sort());
    const report = await readFile(join(f.project, 'exports', first.id, 'render-report.json'), 'utf8');
    assert.equal(JSON.parse(report).status, 'verified'); assert.ok(!report.includes(f.output));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('an export already in the project library is not duplicated', async () => {
  const f = await fixture();
  try {
    const output = join(f.project, 'exports', 'existing-export'); await mkdir(output, { recursive: true });
    await writeFile(join(output, 'output.mp4'), 'existing');
    const result = await registerExport(f.file, output, f.manifest, summary);
    assert.equal(result.status, 'in-library'); assert.equal(result.id, 'existing-export');
    assert.deepEqual(await readdir(join(f.project, 'exports')), ['existing-export']);
    assert.equal(await readFile(join(output, 'output.mp4'), 'utf8'), 'existing');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('a linked exports directory cannot redirect registration outside the project', async () => {
  const f = await fixture();
  try {
    const outside = join(f.root, 'outside'); await mkdir(outside);
    await symlink(outside, join(f.project, 'exports'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = await registerExport(f.file, f.output, f.manifest, summary);
    assert.equal(result.status, 'unavailable'); assert.match(result.message, /regular directory inside the project/);
    assert.deepEqual(await readdir(outside), []); assert.deepEqual(await readFile(f.file), f.manifest);
    assert.equal(await readFile(join(f.output, 'output.mp4'), 'utf8'), 'verified-output-fixture');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
