#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';

const skillName = 'agent-motion-studio';
const skillSource = fileURLToPath(new URL('../skills/agent-motion-studio/', import.meta.url));
const usage = 'node scripts/install-agent-skill.mjs --client codex|claude|both [--scope project|user] [--dir EXISTING_WORKSPACE] [--dry-run]';
const locations = { codex: '.agents', claude: '.claude' };

async function info(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

async function skillFiles(source, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(source, prefix), { withFileTypes: true })) {
    const name = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await skillFiles(source, name));
    else if (entry.isFile()) files.push({ name, content: await readFile(join(source, name)) });
    else throw new Error('Skill source must contain only regular files and directories.');
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

async function safeParents(base, segments, create) {
  let current = base;
  for (const segment of segments) {
    current = join(current, segment);
    const existing = await info(current);
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('Installation parent must be a regular directory, without symlinks.');
    if (!existing && create) await mkdir(current);
  }
}

/** Offline installation only. It never changes client login/configuration or replaces a skill. */
export async function installAgentSkill({ client = 'both', scope = 'project', directory = process.cwd(), dryRun = false, source = skillSource, userHome = homedir() } = {}) {
  if (!['codex', 'claude', 'both'].includes(client)) throw new Error('--client must be codex, claude or both.');
  if (!['project', 'user'].includes(scope)) throw new Error('--scope must be project or user.');
  const base = await realpath(resolve(scope === 'user' ? userHome : directory));
  if (!(await lstat(base)).isDirectory()) throw new Error('Choose an existing workspace directory.');
  const files = await skillFiles(source);
  if (!files.some(file => file.name === 'SKILL.md')) throw new Error('Bundled SKILL.md is missing.');
  const fingerprint = createHash('sha256');
  for (const file of files) fingerprint.update(file.name.replaceAll('\\', '/')).update('\0').update(file.content).update('\0');
  const clients = client === 'both' ? ['codex', 'claude'] : [client], installs = [];

  // Inspect both destinations before writing either: a conflicting existing skill is preserved.
  for (const name of clients) {
    await safeParents(base, [locations[name], 'skills'], false);
    const target = join(base, locations[name], 'skills', skillName), existing = await info(target);
    if (existing) {
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error(`Existing ${name} skill is not a regular directory; it was kept.`);
      for (const file of files) {
        await safeParents(target, file.name.split(/[\\/]/).slice(0, -1), false);
        const destination = join(target, file.name), saved = await info(destination);
        if (!saved?.isFile() || saved.isSymbolicLink() || !(await readFile(destination)).equals(file.content)) {
          throw new Error(`Existing ${name} skill differs; it was kept. Back it up outside the skills directory before installing an update.`);
        }
      }
    }
    installs.push({ client: name, directory: target, status: existing ? 'unchanged' : dryRun ? 'would-install' : 'installed', files: files.length });
  }
  if (!dryRun) for (const install of installs) {
    if (install.status === 'unchanged') continue;
    await safeParents(base, [locations[install.client], 'skills'], true);
    const parent = dirname(install.directory), staging = join(parent, `._motion-install-${randomUUID()}`);
    await mkdir(staging);
    try {
      for (const file of files) {
        await mkdir(dirname(join(staging, file.name)), { recursive: true });
        await writeFile(join(staging, file.name), file.content, { flag: 'wx' });
      }
      if (await info(install.directory)) throw new Error('Installation destination appeared during copying; it was kept. Retry after inspecting it.');
      await rename(staging, install.directory);
    } finally {
      // Remove only this invocation's private staging directory, after checking its resolved scope.
      const within = relative(parent, staging);
      if (!isAbsolute(within) && !within.startsWith('..') && dirname(staging) === parent) await rm(staging, { recursive: true, force: true });
    }
  }
  return { scope, dryRun, sha256: fingerprint.digest('hex'), installs, network: false, clientStarted: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { client: { type: 'string' }, scope: { type: 'string' }, dir: { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
    if (values.help) console.log(usage);
    else {
      if (values.scope === 'user' && values.dir) throw new Error('--dir is only for project scope. User scope uses the current home directory.');
      console.log(JSON.stringify(await installAgentSkill({ client: values.client, scope: values.scope, directory: values.dir, dryRun: values['dry-run'] }), null, 2));
    }
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
