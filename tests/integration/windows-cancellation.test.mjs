import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyWindowsCancellation } from '../../scripts/verify-windows-cancellation.mjs';

test('Windows console Ctrl+C cleans owned processes, lock/staging and preserves prior output', { timeout: 360000, skip: process.platform !== 'win32' ? 'Windows console event only' : false }, async () => {
  const result = await verifyWindowsCancellation();
  assert.equal(result.status, 'passed'); assert.equal(result.cases.length, 5);
});
