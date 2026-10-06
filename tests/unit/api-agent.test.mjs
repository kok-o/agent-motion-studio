import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProject, readProject } from '../../dist/project.js';
import { runApiAgent, createStudioTool, requestReserveUsd, pricing } from '../../scripts/api-agent.mjs';

async function fixture() {
  const output = await mkdtemp(join(tmpdir(), 'ams-api-test-'));
  return { output, project: (await createProject(join(output, 'project'))).project };
}
const args = (operation, extra = {}) => ({ operation, action: null, etag: null, label: null, previewToken: null, ...extra });

test('API initial mode accepts brand/composition/batch; existing mode cannot disable its batch-preview guard', async () => {
  const { output, project } = await fixture(); const before = await readProject(project);
  const initial = await createStudioTool(project, output, { requirePreview: false });
  const action = { type: 'batch', actions: [{ type: 'brand', patch: { theme: 'light', accent: '#123456' } }, { type: 'composition', video: { aspectRatio: '9:16', fps: 30 } }, { type: 'edit-scene', sceneId: 'opening', patch: { text: 'NEW API FILM', durationFrames: 30 } }, ...['two', 'three', 'four'].map(id => ({ type: 'add-scene', scene: { id, type: 'kinetic_title', text: id, durationFrames: 30 } }))] };
  const accepted = await initial.execute(args('edit', { etag: before.etag, action: JSON.stringify(action) }));
  assert.equal(accepted.manifest.scenes.length, 4); assert.equal(accepted.manifest.history.length, 1); assert.equal(accepted.manifest.video.aspectRatio, '9:16'); assert.equal(accepted.manifest.brand.accent, '#123456');
  const existing = await createStudioTool(project, output), bytes = await readFile(project);
  await assert.rejects(existing.execute(args('edit', { etag: accepted.etag, action: JSON.stringify(action) })), /Batch is unavailable/);
  await assert.rejects(existing.execute({ ...args('edit', { etag: accepted.etag, action: JSON.stringify(action) }), requirePreview: false }), /Invalid tool arguments/);
  assert.ok((await readFile(project)).equals(bytes));
  const brand = await existing.execute(args('edit', { etag: accepted.etag, action: JSON.stringify({ type: 'brand', patch: { background: '#FFFFFF' } }) }));
  assert.equal(brand.manifest.brand.background, '#FFFFFF'); assert.equal(brand.manifest.brand.accent, '#123456');
});

test('API tool calls mutate through shared project operations; a final message cannot claim an unexported film', async () => {
  const { output, project } = await fixture(); let requests = 0;
  const apiKey = 'unit-test-credential-never-publish', before = await readProject(project);
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(options.redirect, 'error');
    const payload = JSON.parse(options.body); assert.equal(payload.model, pricing.model); assert.equal(payload.store, false);
    assert.equal(payload.parallel_tool_calls, false); assert.equal(payload.max_output_tokens, 4096);
    assert.equal(options.headers.Authorization, `Bearer ${apiKey}`);
    const call = requests++ === 0 ? args('state') : requests === 2 ? args('edit', { etag: before.etag, action: JSON.stringify({ type: 'edit-scene', sceneId: 'opening', patch: { text: 'AUTHORED BY TEST MODEL' } }) }) : null;
    return { ok: true, json: async () => ({ id: `test-${requests}`, status: 'completed', usage: { input_tokens: 100, output_tokens: 40 }, output: call ? [{ type: 'function_call', name: 'studio', call_id: `call-${requests}`, arguments: JSON.stringify(call) }] : [{ type: 'message', content: [{ type: 'output_text', text: 'Done' }] }] }) };
  };
  await assert.rejects(runApiAgent({ output, project, apiKey, brief: 'Make a local title film', budgetUsd: 1, requirePreview: false, fetchImpl }), /without exporting/);
  const after = await readProject(project); assert.equal(after.manifest.scenes[0].text, 'AUTHORED BY TEST MODEL');
  assert.deepEqual(after.manifest.history.at(-1).scenes, before.manifest.scenes);
  const log = await readFile(join(output, 'api-report.json'), 'utf8'); assert.ok(!log.includes(apiKey));
  const report = JSON.parse(log); assert.equal(report.status, 'stopped'); assert.equal(report.tools.length, 2);
  assert.equal(report.reservedUnknownUsd, 0); assert.ok(report.chargedEstimateUsd > 0); assert.equal(report.exports.length, 0);
});

test('unknown network outcome retains a budget reserve, never retries, and leaves the project unchanged', async () => {
  const { output, project } = await fixture(), before = await readFile(project); let calls = 0;
  await assert.rejects(runApiAgent({ output, project, apiKey: 'test-key', brief: 'Make a film', budgetUsd: 1, fetchImpl: async () => { calls++; throw new Error('Possible remote acceptance with sensitive body'); } }), /outcome unknown; no retry/);
  assert.equal(calls, 1); assert.ok((await readFile(project)).equals(before));
  const report = JSON.parse(await readFile(join(output, 'api-report.json')));
  assert.equal(report.reservedUnknownUsd, requestReserveUsd); assert.equal(report.requests[0].status, 'network-outcome-unknown');
  assert.ok(!JSON.stringify(report).includes('sensitive body'));
  let smallCalls = 0;
  await assert.rejects(runApiAgent({ output, project, apiKey: 'test-key', brief: 'Make a film', budgetUsd: 0.01, fetchImpl: async () => { smallCalls++; } }), /Budget must cover/);
  assert.equal(smallCalls, 0);
});

test('existing-project API edits require exact preview context and tool output cannot traverse to accepted files', async () => {
  const { output, project } = await fixture(), before = await readProject(project), bytes = await readFile(project);
  const tools = await createStudioTool(project, output);
  await assert.rejects(tools.execute(args('edit', { etag: before.etag, action: JSON.stringify({ type: 'edit-scene', sceneId: 'opening', patch: { text: 'UNPREVIEWED' } }) })), /Preview the exact action/);
  await assert.rejects(tools.execute(args('render', { etag: before.etag, label: '../project' })), /simple fresh output label/);
  await assert.rejects(tools.execute(args('render', { etag: '0'.repeat(64), label: 'stale' })), /PROJECT_CONFLICT/);
  await assert.rejects(tools.execute({ ...args('state'), shell: 'arbitrary code' }), /Invalid tool arguments/);
  assert.ok((await readFile(project)).equals(bytes)); assert.equal(tools.exports.length, 0);
});
