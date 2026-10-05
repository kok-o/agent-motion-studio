import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { proceduralWav, kineticGrooveWav, resolveCaptions, parseSrt, normalizeEdgeCaptions } from '../../dist/audio.js';

test('kinetic groove is deterministic stereo PCM with exact duration, non-silent signal and no clipping', () => {
  const duration = 13 / 30, wav = kineticGrooveWav(duration, 7, [0, 6]);
  assert.deepEqual(wav, kineticGrooveWav(duration, 7, [0, 6]));
  assert.notDeepEqual(wav, kineticGrooveWav(duration, 8, [0, 6]));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt16LE(22), 2);
  assert.equal(wav.readUInt32LE(24), 48000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.length, 44 + 13 * 1600 * 4);
  assert.equal(wav.readUInt32LE(40), wav.length - 44);
  assert.equal(wav.readInt16LE(44), 0);
  assert.equal(wav.readInt16LE(wav.length - 2), 0);
  let peak = 0, maxStep = 0, energy = 0;
  for (let offset = 44; offset < wav.length; offset += 4) {
    const sample = wav.readInt16LE(offset); peak = Math.max(peak, Math.abs(sample)); energy += sample * sample;
    if (offset > 44) maxStep = Math.max(maxStep, Math.abs(sample - wav.readInt16LE(offset - 4)));
  }
  assert.ok(peak > 1000 && peak < 32767);
  assert.ok(energy > 0);
  assert.ok(maxStep < 12000, 'brief envelope boundaries should not produce large discontinuities');
});

test('scene accents change samples only at their declared frame interval', () => {
  const baseline = kineticGrooveWav(2, 7);
  const accented = kineticGrooveWav(2, 7, [30]);
  const offset = 44 + 30 * 1600 * 4;
  assert.deepEqual(accented.subarray(0, offset), baseline.subarray(0, offset));
  assert.notDeepEqual(accented.subarray(offset, offset + 4800 * 4), baseline.subarray(offset, offset + 4800 * 4));
  const end = offset + Math.round(0.38 * 48000) * 4;
  assert.deepEqual(accented.subarray(end), baseline.subarray(end));
  assert.throws(() => kineticGrooveWav(NaN, 7), /finite duration/);
  assert.throws(() => kineticGrooveWav(1, 7, [-1]), /frame indices/);
});

test('procedural score repeats in the same environment and changes with seed', () => {
  const one = proceduralWav(0.2, 7);
  const repeated = proceduralWav(0.2, 7);
  const edited = proceduralWav(0.2, 8);
  assert.deepEqual(one, repeated);
  assert.notEqual(createHash('sha256').update(one).digest('hex'), createHash('sha256').update(edited).digest('hex'));
  let peak = 0;
  for (let i = 44; i < one.length; i += 2) peak = Math.max(peak, Math.abs(one.readInt16LE(i)));
  assert.ok(peak > 0 && peak < 32767, 'score must be audible without PCM clipping');
});

test('caption rounding preserves adjacent cue order and accounts for scene start/lead-in', () => {
  const scene = { id: 'product', startFrame: 90, endFrame: 330 };
  const cues = resolveCaptions(scene, [
    { startMs: 0, endMs: 1201, text: 'Первая фраза' },
    { startMs: 1201, endMs: 2500, text: 'Вторая фраза' },
  ], 2.5);
  assert.equal(cues[0].startFrame, 94);
  assert.equal(cues[0].endFrame, cues[1].startFrame);
  assert.ok(cues[1].endFrame <= scene.endFrame);
});

test('captions reject overlapping cues, cues beyond speech, and cues beyond the scene', () => {
  const scene = { id: 'speech', startFrame: 0, endFrame: 30 };
  assert.throws(() => resolveCaptions(scene, [{ startMs: 0, endMs: 950, text: 'Too long' }], 1), /does not fit/);
  assert.throws(() => resolveCaptions(scene, [{ startMs: 0, endMs: 1002, text: 'Past speech' }], 1), /beyond/);
  assert.throws(() => resolveCaptions({ ...scene, endFrame: 100 }, [
    { startMs: 0, endMs: 500, text: 'One' }, { startMs: 499, endMs: 800, text: 'Two' },
  ], 1), /overlaps/);
});

test('Edge subtitle parser accepts CRLF and rejects corrupt timestamp blocks', () => {
  assert.deepEqual(parseSrt('1\r\n00:00:00,000 --> 00:00:01,250\r\nHello\r\nworld\r\n'), [
    { startMs: 0, endMs: 1250, text: 'Hello world' },
  ]);
  assert.throws(() => parseSrt('1\n00:00:75,000 --> 00:01:20,000\nInvalid'), /invalid subtitle timestamps/);
  assert.throws(() => parseSrt('1\ninvalid --> timestamp\nNope'), /invalid subtitle timestamps/);
});

test('observed Edge sentence padding is normalized without accepting bad supplied captions', () => {
  const raw = [
    { startMs: 100, endMs: 2912, text: 'Измените текст в JSON.' },
    { startMs: 2862, endMs: 5700, text: 'Движок соберёт новый ролик.' },
  ];
  const normalized = normalizeEdgeCaptions(raw, 5.712);
  assert.equal(normalized[0].endMs, normalized[1].startMs);
  assert.equal(raw[0].endMs, 2912, 'do not mutate raw provider evidence');
  assert.doesNotThrow(() => resolveCaptions({ id: 'speech', startFrame: 0, endFrame: 240 }, normalized, 5.712));
  assert.throws(() => resolveCaptions({ id: 'speech', startFrame: 0, endFrame: 240 }, raw, 5.712), /overlaps/);
  assert.throws(() => normalizeEdgeCaptions([{ startMs: 0, endMs: 3000, text: 'Bad' }], 1), /do not match/);
});
