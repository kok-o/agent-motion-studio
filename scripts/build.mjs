import { build } from 'esbuild';
import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const checked = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit'], { stdio: 'inherit' });
if (checked.status !== 0) process.exit(checked.status ?? 1);
await mkdir('dist/renderer', { recursive: true });
await mkdir('assets/fonts', { recursive: true });
const entries = (await readdir('src')).filter(f => f.endsWith('.ts')).map(f => `src/${f}`);
await build({ entryPoints: entries, outdir: 'dist', platform: 'node', format: 'esm', target: 'node22', bundle: false });
await build({ entryPoints: ['renderer/entry.ts'], outfile: 'dist/renderer/entry.js', platform: 'browser', format: 'iife', target: 'chrome120', bundle: true });
await copyFile('renderer/index.html', 'dist/renderer/index.html');
await mkdir('dist/studio', { recursive: true });
for (const file of ['index.html', 'app.js', 'i18n.js', 'generation-ui.js', 'style.css', 'native-fonts.css']) await copyFile(`studio/${file}`, `dist/studio/${file}`);
for (const subset of ['latin', 'cyrillic', 'cyrillic-ext']) for (const weight of [400, 700]) {
  const file = `noto-sans-${subset}-${weight}-normal.woff2`;
  await copyFile(`node_modules/@fontsource/noto-sans/files/${file}`, `assets/fonts/${file}`);
}
await copyFile('node_modules/@fontsource/noto-sans/LICENSE', 'assets/fonts/OFL.txt');
for (const subset of ['latin', 'cyrillic', 'cyrillic-ext']) {
  const file = `oswald-${subset}-700-normal.woff2`;
  await copyFile(`node_modules/@fontsource/oswald/files/${file}`, `assets/fonts/${file}`);
}
await copyFile('node_modules/@fontsource/oswald/LICENSE', 'assets/fonts/OFL-Oswald.txt');

const editor = await build({ entryPoints: ['studio/object-editor.ts'], outfile: 'dist/studio/object-editor.js', platform: 'browser', format: 'esm', target: 'chrome120', bundle: true, external: ['./i18n.js'], metafile: true });
assert.deepEqual(Object.keys(editor.metafile.inputs).sort(), ['src/composition.ts', 'studio/object-caption.ts', 'studio/object-editor-geometry.ts', 'studio/object-editor.ts'], 'The editor bundle must contain only browser code; contracts are type-only.');
const entry = await build({ entryPoints: ['studio/composition-entry.ts'], outfile: 'dist/studio/composition-entry.js', platform: 'browser', format: 'esm', target: 'chrome120', bundle: true, external: ['./i18n.js'], metafile: true });
assert.deepEqual(Object.keys(entry.metafile.inputs), ['studio/composition-entry.ts'], 'Composition entry must contain only browser code; native contracts are type-only.');
const sourceAudio = await build({ entryPoints: ['studio/source-audio.ts'], outfile: 'dist/studio/source-audio.js', platform: 'browser', format: 'esm', target: 'chrome120', bundle: true, metafile: true });
assert.deepEqual(Object.keys(sourceAudio.metafile.inputs), ['studio/source-audio.ts'], 'Source audio inspector must contain only browser code; native contracts are type-only.');
const styleUI = await build({ entryPoints: ['studio/style-ui.ts'], outfile: 'dist/studio/style-ui.js', platform: 'browser', format: 'esm', target: 'chrome120', bundle: true, external: ['./i18n.js'], metafile: true });
assert.deepEqual(Object.keys(styleUI.metafile.inputs), ['studio/style-ui.ts'], 'Style UI must contain only browser code; native contracts are type-only.');
