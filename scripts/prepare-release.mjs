import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile, stat, cp } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { checkRelease, audit, root } from './check-release.mjs';

function run(bin, args, cwd = root) {
  const r = spawnSync(bin, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 8e6 });
  assert.equal(r.status, 0, `${bin} ${args[0]} failed: ${r.stderr || r.error || r.stdout}`); return r.stdout;
}
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run npm run release:prepare so npm_execpath identifies this npm installation.');
run(process.execPath, ['scripts/build.mjs']);
const checked = await checkRelease();
const id = `${checked.version}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const out = join(root, 'artifacts/release', id), sourceName = `agent-motion-studio-${checked.version}-source`;
const staging = join(out, 'staging'), source = join(staging, sourceName); await mkdir(source, { recursive: true });
for (const name of checked.sourceFiles) { await mkdir(dirname(join(source, name)), { recursive: true }); await copyFile(join(root, name), join(source, name)); }
const sourceZip = `${sourceName}.zip`;
// tar is provided by Windows and the GitHub Linux runner; no shell interpolation.
// ZIP support is provided by bsdtar on Windows; Linux uses the standard zip CLI.
if (process.platform === 'win32') run('tar', ['-a', '-cf', join(out, sourceZip), '-C', staging, sourceName]);
else run('zip', ['-q', '-r', join(out, sourceZip), sourceName], staging);
const pack = JSON.parse(run(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', out]))[0];
const names = pack.files.map(f => f.path);
await audit(names, root, { runtime: true });
for (const needed of ['dist/cli.js', 'dist/server.js', 'dist/preview.js', 'dist/renderer/entry.js', 'dist/studio/app.js', 'assets/fonts/OFL.txt', 'examples/coffee-ritual/CREDITS.md', 'examples/coffee-ritual/LICENSE.md']) assert.ok(names.includes(needed), `Runtime missing ${needed}`);
const project = join(staging, 'coffee-ritual-project');
await mkdir(project);
// Only distribute this template's accepted manifest, assets and credits, never its exports/cache.
for (const name of ['project.json', 'assets', 'CREDITS.md', 'LICENSE.md', 'README.md', 'provenance.json']) await cp(join(root, 'examples/coffee-ritual', name), join(project, name), { recursive: true });
const projectZip = 'coffee-ritual-project.zip';
if (process.platform === 'win32') run('tar', ['-a', '-cf', join(out, projectZip), '-C', staging, 'coffee-ritual-project']);
else run('zip', ['-q', '-r', join(out, projectZip), 'coffee-ritual-project'], staging);
const archives = [];
for (const name of [sourceZip, pack.filename, projectZip]) archives.push({ file: name, bytes: (await stat(join(out, name))).size, sha256: createHash('sha256').update(await readFile(join(out, name))).digest('hex') });
await writeFile(join(out, 'SHA256SUMS.txt'), archives.map(a => `${a.sha256}  ${a.file}\n`).join(''));
await copyFile(join(root, `docs/releases/v${checked.version}.md`), join(out, 'RELEASE_NOTES.md'));
const report = { version: checked.version, preparedAt: new Date().toISOString(), published: false, source: checked, runtimeFiles: names, archives, verification: 'Content audit only. Run the test suite and verify:package before publication.' };
await writeFile(join(out, 'candidate.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(join(root, 'artifacts/release/latest.json'), JSON.stringify({ directory: out, runtime: join(out, pack.filename) }, null, 2) + '\n');
console.log(JSON.stringify({ directory: out, archives, published: false }, null, 2));
