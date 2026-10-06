import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installAgentSkill } from '../../scripts/install-agent-skill.mjs';

test('offline installer puts a complete skill in both official project discovery directories and repeats unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'motion-skill-'));
  try {
    await mkdir(join(root, '.claude')); await writeFile(join(root, '.claude', 'settings.json'), '{"keep":true}');
    const dry = await installAgentSkill({ directory: root, dryRun: true });
    assert.deepEqual(dry.installs.map(item => item.status), ['would-install', 'would-install']);
    assert.deepEqual(await readdir(root), ['.claude']);
    const installed = await installAgentSkill({ directory: root });
    assert.equal(installed.network, false); assert.equal(installed.clientStarted, false);
    for (const client of ['.agents', '.claude']) {
      const skill = join(root, client, 'skills', 'agent-motion-studio');
      assert.match(await readFile(join(skill, 'SKILL.md'), 'utf8'), /brief/);
      assert.match(await readFile(join(skill, 'references', 'brief-to-film.md'), 'utf8'), /restore-scene/);
      assert.doesNotMatch(await readFile(join(skill, 'references', 'generation.md'), 'utf8'), /\.\.\/\.\.\/\.\.\/docs/);
    }
    assert.equal(await readFile(join(root, '.claude', 'settings.json'), 'utf8'), '{"keep":true}');
    const again = await installAgentSkill({ directory: root });
    assert.equal(again.sha256, installed.sha256);
    assert.deepEqual(again.installs.map(item => item.status), ['unchanged', 'unchanged']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('existing edited skill blocks both destinations without replacing user files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'motion-skill-'));
  try {
    const old = join(root, '.claude', 'skills', 'agent-motion-studio');
    await mkdir(old, { recursive: true }); await writeFile(join(old, 'SKILL.md'), 'User skill');
    await assert.rejects(installAgentSkill({ directory: root }), /differs; it was kept/);
    assert.equal(await readFile(join(old, 'SKILL.md'), 'utf8'), 'User skill');
    assert.deepEqual(await readdir(root), ['.claude']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('user scope follows current official home locations and rejects unsupported clients', async () => {
  const root = await mkdtemp(join(tmpdir(), 'motion-skill-home-'));
  try {
    // Windows runners can expose tmpdir through an 8.3 alias (RUNNER~1).
    // The installer deliberately returns the canonical home, not that spelling.
    const canonicalHome = await realpath(root);
    const installed = await installAgentSkill({ scope: 'user', userHome: root });
    assert.equal(installed.installs[0].directory, join(canonicalHome, '.agents', 'skills', 'agent-motion-studio'));
    assert.equal(installed.installs[1].directory, join(canonicalHome, '.claude', 'skills', 'agent-motion-studio'));
    await assert.rejects(installAgentSkill({ client: 'other', directory: root }), /codex, claude or both/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('user scope resolves a home alias and does not install into the project workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'motion-skill-home-alias-'));
  try {
    const home = join(root, 'home'), alias = join(root, 'home-alias'), workspace = join(root, 'workspace');
    await mkdir(home); await mkdir(workspace);
    await symlink(home, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const canonicalHome = await realpath(home);
    const installed = await installAgentSkill({ scope: 'user', userHome: alias, directory: workspace });
    for (const [index, client] of ['.agents', '.claude'].entries()) {
      const expected = join(canonicalHome, client, 'skills', 'agent-motion-studio');
      assert.equal(installed.installs[index].directory, expected);
      assert.equal(await realpath(installed.installs[index].directory), expected);
      assert.match(await readFile(join(expected, 'SKILL.md'), 'utf8'), /brief/);
    }
    assert.deepEqual(await readdir(workspace), [], 'user scope must not write into the project workspace');
  } finally { await rm(root, { recursive: true, force: true }); }
});
