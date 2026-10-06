import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

function diagnose(overrides) {
  const result = spawnSync(process.execPath, ['dist/cli.js', 'doctor', '--json'], {
    encoding: 'utf8', timeout: 60000, windowsHide: true, env: { ...process.env, ...overrides }
  });
  assert.equal(result.status, 3, result.stderr);
  return JSON.parse(result.stdout);
}

test('doctor still checks real FFmpeg/ffprobe when the browser is absent', () => {
  const report = diagnose({ CHROME_PATH: resolve('.cache', `absent-browser-${randomUUID()}`) });
  assert.equal(report.browser.ready, false);
  assert.equal(report.ffmpeg.ready, true, report.ffmpeg.error);
  assert.equal(report.ffprobe.ready, true, report.ffprobe.error);
});

test('doctor still launches the real browser and checks ffprobe when FFmpeg is absent', () => {
  const report = diagnose({ FFMPEG_PATH: resolve('.cache', `absent-ffmpeg-${randomUUID()}`) });
  assert.equal(report.ffmpeg.ready, false);
  assert.equal(report.browser.ready, true, report.browser.error);
  assert.equal(report.ffprobe.ready, true, report.ffprobe.error);
});
