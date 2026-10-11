import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile, readdir, lstat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { platform, arch } from 'node:os';
import { audit } from './check-release.mjs';
import { command, zipDirectory } from './zip-archive.mjs';
export { command, zipDirectory } from './zip-archive.mjs';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function sourceStamp(root) {
  const gitSha = command('git', ['rev-parse', 'HEAD'], root).trim();
  const dirty = command('git', ['status', '--porcelain', '--untracked-files=normal'], root).trim() !== '';
  return { gitSha, dirty };
}
export const kitDocuments = {
  'docs/CURRENT_KIT_START_HERE_RU.md': 'START_HERE_RU.md',
  'docs/USER_TRIAL_RESULTS_RU.md': 'RESULTS_BLANK_RU.md',
  'docs/GETTING_STARTED.md': 'GETTING_STARTED.md',
  'docs/AGENT_WORKFLOW_RU.md': 'AGENT_WORKFLOW_RU.md',
  'docs/STATUS.md': 'STATUS.md',
  'docs/COMPOSITION.md': 'COMPOSITION.md',
  'docs/AUTHORING_STYLES.md': 'AUTHORING_STYLES.md',
  'skills/agent-motion-studio/references/brief-to-film.md': 'BRIEF_TO_FILM.md',
  'skills/agent-motion-studio/references/composition.md': 'OBJECT_COMPOSITION.md'
};
const payload = [...Object.values(kitDocuments), 'coffee-original.mp4', 'CREDITS.md', 'MEDIA_LICENSE.md', 'LICENSE', 'FONTS_OFL.txt'];
// v1 and the accepted v2 entry prework predate the required style guide.
const payloadFor = version => version < 3 ? payload.filter(name => name !== 'AUTHORING_STYLES.md') : payload;
const kitName = ({ version, source }) => `agent-motion-studio-first-user-${version}-${source.gitSha.slice(0, 12)}${source.dirty ? '-dirty' : ''}`;
const kitIdentity = manifest => [
  '| Identity этого комплекта | Значение |',
  '| --- | --- |',
  `| ZIP (хеш проверяется снаружи) | \`${kitName(manifest)}.zip\` |`,
  `| Package | \`${manifest.version}\` — experimental developer preview |`,
  `| Source Git SHA | \`${manifest.source.gitSha}\` |`,
  `| Source dirty | \`${manifest.source.dirty}\` |`,
  `| Runtime | \`${manifest.runtime.file}\` |`,
  `| Runtime SHA-256 | \`${manifest.runtime.sha256}\` |`
].join('\n');
export function renderKitStartHere(template, manifest) {
  const values = {
    KIT_IDENTITY: kitIdentity(manifest),
    DIRTY_NOTICE: manifest.source.dirty ? '**Только локальная подготовка: исходники изменены относительно указанного SHA. Не выдавать за проверенный коммит.**\n' : '',
    RUNTIME_FILE: manifest.runtime.file
  };
  for (const [key, value] of Object.entries(values)) {
    const token = `{{${key}}}`;
    assert.ok(template.includes(token), `START_HERE template is missing ${token}`);
    template = template.replaceAll(token, value);
  }
  assert.doesNotMatch(template, /\{\{[A-Z0-9_]+\}\}/, 'Unresolved START_HERE placeholder');
  return template;
}
export async function sealKit(directory, manifest) {
  const names = [...payloadFor(manifest.formatVersion), manifest.runtime.file];
  if (manifest.verification.status === 'self-run-passed') names.push('SELF_RUN.json');
  assert.deepEqual((await readdir(directory)).filter(name => !['KIT_MANIFEST.json', 'SHA256SUMS.txt'].includes(name)).sort(), names.sort(), 'Unexpected kit files');
  // The same source audit protects regular files, portable paths, links and secrets.
  // tgz is a deliberately allowed archive, audited separately during release:prepare.
  await audit(names.filter(name => !name.endsWith('.tgz')), directory);
  assert.ok((await lstat(join(directory, manifest.runtime.file))).isFile());
  assert.ok(!(await lstat(join(directory, manifest.runtime.file))).isSymbolicLink());
  manifest.files = await Promise.all(names.map(async file => { const bytes = await readFile(join(directory, file)); return { file, bytes: bytes.length, sha256: sha256(bytes) }; }));
  assert.equal(manifest.files.find(item => item.file === manifest.runtime.file).sha256, manifest.runtime.sha256);
  await writeFile(join(directory, 'KIT_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  const files = [...manifest.files, { file: 'KIT_MANIFEST.json', sha256: sha256(await readFile(join(directory, 'KIT_MANIFEST.json'))) }];
  await writeFile(join(directory, 'SHA256SUMS.txt'), files.map(item => `${item.sha256}  ${item.file}\n`).join(''));
  return manifest;
}
export async function verifyKit(directory, { requireClean = true } = {}) {
  const manifest = JSON.parse(await readFile(join(directory, 'KIT_MANIFEST.json'), 'utf8'));
  assert.ok([1, 2, 3].includes(manifest.formatVersion), 'Unsupported kit manifest format');
  assert.match(manifest.source.gitSha, /^[a-f0-9]{40}$/);
  assert.equal(typeof manifest.source.dirty, 'boolean');
  if (requireClean) assert.equal(manifest.source.dirty, false, 'A dirty kit is preparation only, not a verified commit');
  assert.equal(manifest.runtime.file, `agent-motion-studio-${manifest.version}.tgz`);
  const names = [...payloadFor(manifest.formatVersion), manifest.runtime.file, 'KIT_MANIFEST.json', 'SHA256SUMS.txt', ...(manifest.verification.status === 'self-run-passed' ? ['SELF_RUN.json'] : [])];
  assert.deepEqual((await readdir(directory)).sort(), names.sort());
  assert.deepEqual(manifest.files.map(item => item.file).sort(), names.filter(name => !['KIT_MANIFEST.json', 'SHA256SUMS.txt'].includes(name)).sort());
  for (const item of manifest.files) {
    assert.ok((await lstat(join(directory, item.file))).isFile() && !(await lstat(join(directory, item.file))).isSymbolicLink());
    const bytes = await readFile(join(directory, item.file));
    assert.equal(bytes.length, item.bytes); assert.equal(sha256(bytes), item.sha256, item.file);
  }
  const checksumNames = [];
  for (const line of (await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n')) {
    const match = /^([a-f0-9]{64})  ([a-zA-Z0-9_.-]+)$/.exec(line); assert.ok(match, 'Invalid checksum path');
    checksumNames.push(match[2]); assert.equal(sha256(await readFile(join(directory, match[2]))), match[1]);
  }
  assert.deepEqual(checksumNames.sort(), names.filter(name => name !== 'SHA256SUMS.txt').sort());
  assert.equal(manifest.runtime.sha256, manifest.files.find(item => item.file === manifest.runtime.file).sha256);
  if (manifest.formatVersion >= 2) {
    const startHere = await readFile(join(directory, 'START_HERE_RU.md'), 'utf8');
    assert.ok(startHere.includes(kitIdentity(manifest)), 'START_HERE identity differs from KIT_MANIFEST.json');
    assert.doesNotMatch(startHere, /\{\{[A-Z0-9_]+\}\}/, 'Unresolved START_HERE placeholder');
  }
  await audit(names.filter(name => !name.endsWith('.tgz')), directory);
  return manifest;
}
export async function prepareUserKit({ root, out, staging, version, runtime, source }) {
  const name = kitName({ version, source });
  const directory = join(out, name), archive = join(out, `${name}.zip`);
  await mkdir(directory);
  for (const [from, to] of [
    [runtime, basename(runtime)],
    [join(root, 'docs/media/coffee-original.mp4'), 'coffee-original.mp4'],
    [join(root, 'examples/coffee-ritual/CREDITS.md'), 'CREDITS.md'],
    [join(root, 'examples/coffee-ritual/LICENSE.md'), 'MEDIA_LICENSE.md'],
    [join(root, 'LICENSE'), 'LICENSE'], [join(root, 'assets/fonts/OFL.txt'), 'FONTS_OFL.txt']
  ]) await copyFile(from, join(directory, to));
  const manifest = { formatVersion: 3, version, source, preparedOn: { platform: platform(), arch: arch(), node: process.version }, runtime: { file: basename(runtime), sha256: sha256(await readFile(join(directory, basename(runtime)))) }, verification: { status: 'not-run', scope: 'Kit preparation only; independent human/model session NOT RUN' }, files: [] };
  // Generate the current entry from this kit's identity, never the historical trial.
  // Essential documents are readable before npm install.
  // Only additional source references require optional GitHub access.
  for (const [from, to] of Object.entries(kitDocuments)) {
    const template = await readFile(join(root, from), 'utf8');
    const guide = (to === 'START_HERE_RU.md' ? renderKitStartHere(template, manifest) : template).replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, label, href) => {
      if (/^(https?:|mailto:|#)/.test(href)) return whole;
      const [target, fragment] = href.split('#');
      const sourcePath = resolve(root, dirname(from), target);
      const bundled = Object.entries(kitDocuments).find(([path]) => resolve(root, path) === sourcePath);
      if (bundled) return `[${label}](${bundled[1]}${fragment ? `#${fragment}` : ''})`;
      const path = new URL(href, `https://github.com/kok-o/agent-motion-studio/blob/${source.gitSha}/${from}`).href;
      return `[${label} (optional GitHub reference; access required)](${path})`;
    });
    await writeFile(join(directory, to), guide);
  }
  await sealKit(directory, manifest);
  await verifyKit(directory, { requireClean: false });
  zipDirectory(out, archive, name);
  return { name, directory, archive };
}
export async function recordKitSmoke({ kit, report }) {
  const manifest = await verifyKit(kit.directory);
  assert.equal(report.gitSha, manifest.source.gitSha); assert.equal(report.runtimeSha256, manifest.runtime.sha256);
  assert.equal(report.status, 'self-run-passed');
  await writeFile(join(kit.directory, 'SELF_RUN.json'), JSON.stringify(report, null, 2) + '\n');
  manifest.verification = { status: report.status, environment: report.environment, scope: 'Technical self-run; independent human/model session NOT RUN' };
  await sealKit(kit.directory, manifest); await verifyKit(kit.directory);
  zipDirectory(join(kit.directory, '..'), kit.archive, kit.name);
}
