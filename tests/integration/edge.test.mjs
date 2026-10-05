import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { loadManifest } from '../../dist/spec.js';
import { findTools } from '../../dist/runtime.js';
import { prepareAudio, audioDuration } from '../../dist/audio.js';

const fixturePython = process.env.EDGE_TEST_PYTHON || path.resolve('.cache/edge-addon/Scripts/python.exe');
test('controlled Edge provider failure makes exactly two attempts, clears partial speech, and leaves local music usable', {
  timeout: 30000,
  skip: !process.env.EDGE_TEST_PYTHON && !existsSync(fixturePython) ? 'Controlled provider fixture needs Python; set EDGE_TEST_PYTHON to its interpreter.' : false,
}, async () => {
  const project = path.resolve('.cache/tests', `edge-outage-${randomUUID()}`);
  const environment = Object.fromEntries(['PYTHON_PATH', 'PYTHONPATH', 'PYTHONDONTWRITEBYTECODE'].map(key => [key, process.env[key]]));
  await mkdir(project, { recursive: true });
  try {
    const modulePath = path.join(project, 'edge_tts.py');
    // A controlled provider process, not an assertion that Microsoft was unavailable.
    await writeFile(modulePath, [
      'import sys, json, pathlib',
      "if '--version' in sys.argv:",
      "    print('controlled-edge-outage-fixture-v1'); sys.exit(0)",
      "with pathlib.Path(__file__).with_name('attempts.jsonl').open('a', encoding='utf8') as log:",
      '    log.write(json.dumps(sys.argv[1:]) + "\\n")',
      "media = pathlib.Path(sys.argv[sys.argv.index('--write-media') + 1])",
      "media.write_bytes(b'incomplete provider media')",
      "sys.stderr.write('Controlled provider connection failure\\n')",
      'sys.exit(7)',
    ].join('\n'));
    process.env.PYTHON_PATH = fixturePython;
    process.env.PYTHONPATH = project;
    process.env.PYTHONDONTWRITEBYTECODE = '1';
    const input = JSON.parse(await readFile('examples/edge-speech/manifest.json', 'utf8'));
    const file = path.join(project, 'manifest.json');
    await writeFile(file, JSON.stringify(input));
    await assert.rejects(prepareAudio(await loadManifest(file), project, findTools()), error => error.code === 'EDGE_FAILED' && error.exitCode === 5);
    const attempts = (await readFile(path.join(project, 'attempts.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(attempts.length, 2);
    assert.ok(attempts.every(args => args.includes('ru-RU-SvetlanaNeural')));
    assert.deepEqual(await readdir(path.join(project, '.cache/agent-motion-studio/audio')), []);
    input.audio = { narration: { provider: 'none' }, music: { provider: 'procedural' } };
    delete input.scenes[0].narration;
    input.scenes[0].durationFrames = 30;
    await writeFile(file, JSON.stringify(input));
    const local = await prepareAudio(await loadManifest(file), project, findTools());
    assert.equal(await audioDuration(local.path, findTools()), 1);
    assert.equal(local.report.narration, 'none');
    assert.equal((await readFile(path.join(project, 'attempts.jsonl'), 'utf8')).trim().split('\n').length, 2);
  } finally {
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(project, { recursive: true, force: true });
  }
});
