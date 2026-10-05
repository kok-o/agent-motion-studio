import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateManifest, loadManifest } from '../../dist/spec.js';
const baseline = JSON.parse(await readFile('examples/smoke/manifest.json', 'utf8'));
const fresh = () => structuredClone(baseline);
test('schema rejects executable and unknown fields; supported markup remains literal text', () => {
  const unsafe = fresh(); unsafe.scenes[0].command = 'anything';
  assert.throws(() => validateManifest(unsafe), /additional properties/);
  const literal = fresh(); literal.scenes[0].text = '<script>alert(1)<\/script>'; delete literal.scenes[0].highlight;
  assert.equal(validateManifest(literal).scenes[0].text, literal.scenes[0].text);
});
test('unknown scenes, duplicate IDs, timing limits and unsupported glyphs produce input errors', () => {
  const unknown = fresh(); unknown.scenes[0].type = 'javascript'; assert.throws(() => validateManifest(unknown), /allowed values/);
  const duplicate = fresh(); duplicate.scenes.push(structuredClone(duplicate.scenes[0])); assert.throws(() => validateManifest(duplicate), /duplicate id/);
  const short = fresh(); short.scenes[0].durationFrames = 1; assert.throws(() => validateManifest(short), /Total duration/);
  const emoji = fresh(); emoji.scenes[0].text = 'Hi 😀'; delete emoji.scenes[0].highlight; assert.throws(() => validateManifest(emoji), /unsupported symbols/);
  const blank = fresh(); blank.scenes[0].text = ' \n\t '; delete blank.scenes[0].highlight; assert.throws(() => validateManifest(blank), /visible text/);
});
test('asset paths resolve relative to manifest and cannot escape it; timeline uses half-open frames', async () => {
  const project = path.resolve('.cache/tests', randomUUID()); await mkdir(project, { recursive: true });
  try {
    const input = fresh(); input.scenes.push({ id: 'cta', type: 'cta', durationFrames: 30, text: 'Текст', label: 'Ссылка' });
    const file = path.join(project, 'manifest.json'); await writeFile(file, JSON.stringify(input));
    const resolved = await loadManifest(file);
    assert.equal(resolved.totalFrames, 150); assert.equal(resolved.scenes[1].startFrame, 120); assert.equal(resolved.scenes[1].endFrame, 150);
    input.assets.bad = { type: 'image', path: '../../../examples/repo-promo/assets/studio.png' };
    await writeFile(file, JSON.stringify(input)); await assert.rejects(loadManifest(file), /outside the project/);
    input.assets.bad.path = 'https://example.com/a.png'; await writeFile(file, JSON.stringify(input)); await assert.rejects(loadManifest(file), /local relative path/);
  } finally { await rm(project, { recursive: true, force: true }); }
});
