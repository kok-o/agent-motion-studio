import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generatedTakeRequestHash } from '../../dist/project.js';
import { validateManifest } from '../../dist/spec.js';

const draft = { sceneId: 'shot', candidateSha256: 'a'.repeat(64), baseEtag: 'b'.repeat(64), trimStartSeconds: 0, fit: 'cover', focalPoint: { x: 0.5, y: 0.5 } };
test('generated take fingerprints bind candidate, trim, crop and accepted render context', () => {
  const hash = generatedTakeRequestHash(draft);
  assert.equal(generatedTakeRequestHash({ ...draft, focalPoint: { y: 0.5, x: 0.5 } }), hash);
  for (const changes of [{ candidateSha256: 'c'.repeat(64) }, { baseEtag: 'd'.repeat(64) }, { trimStartSeconds: 0.1 }, { fit: 'contain' }, { focalPoint: { x: 0.25, y: 0.5 } }]) {
    assert.notEqual(generatedTakeRequestHash({ ...draft, ...changes }), hash);
  }
  for (const changes of [{ trimStartSeconds: NaN }, { focalPoint: { x: Infinity, y: 0.5 } }, { focalPoint: { x: 0.5, y: 0.5, command: 'ignored' } }]) {
    assert.throws(() => generatedTakeRequestHash({ ...draft, ...changes }), /Invalid generated take/);
  }
});

test('accepted receipts validate independently of bounded scene history and reject duplicates', async () => {
  const manifest = JSON.parse(await readFile('examples/smoke/manifest.json', 'utf8'));
  manifest.schemaVersion = 2;
  manifest.operationReceipts = [{ operationId: 'accept-1', requestHash: 'a'.repeat(64), revisionId: 'no-longer-in-history' }];
  assert.equal(validateManifest(manifest).operationReceipts.length, 1);
  const duplicate = structuredClone(manifest); duplicate.operationReceipts.push(duplicate.operationReceipts[0]);
  assert.throws(() => validateManifest(duplicate), /operation IDs must be unique/);
  const v1 = structuredClone(manifest); v1.schemaVersion = 1;
  assert.throws(() => validateManifest(v1), /must NOT be valid/);
  const unknown = structuredClone(manifest); unknown.operationReceipts[0].url = 'https://provider.invalid/private';
  assert.throws(() => validateManifest(unknown), /additional properties/);
});
