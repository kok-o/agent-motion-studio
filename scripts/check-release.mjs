import assert from 'node:assert/strict';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const root = fileURLToPath(new URL('../', import.meta.url));
const slash = p => p.replaceAll('\\', '/');
export const excluded = p => /(^|\/)(node_modules|\.git|\.agents|\.cache|artifacts|exports|projects)(\/|$)/.test(p)
  || /^(references|dist)\//.test(p) || /(^|\/)(\.env(?:\..+)?|[^/]+\.(?:pem|key|log|tgz)|\.preview-[^/]+|[^/]+\.edit-lock|\.render\.lock)$/.test(p);
export async function sourceFiles() {
  const git = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 4e6 });
  assert.equal(git.status, 0, 'Use a Git checkout, or run git init -b main after extracting the source ZIP.');
  return [...new Set(git.stdout.split('\0').filter(Boolean))].sort();
}
export async function audit(files, base = root, { runtime = false } = {}) {
  const issues = [], names = new Set(files.map(slash)); let bytes = 0, links = 0;
  const fail = (p, reason) => issues.push(`${p}: ${reason}`);
  for (const p of files) {
    const name = slash(p);
    const blocked = excluded(runtime && name.startsWith('dist/') ? name.slice(5) : name);
    if (name.includes('..') || isAbsolute(p) || blocked) { fail(p, 'excluded or unsafe path'); continue; }
    const file = resolve(base, p), info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) { fail(p, 'only regular files are distributed'); continue; }
    const actual = relative(await realpath(base), await realpath(file));
    if (actual.startsWith('..') || isAbsolute(actual)) { fail(p, 'path escapes distribution'); continue; }
    bytes += info.size;
    if (info.size > 50 * 1024 * 1024) fail(p, 'file exceeds 50 MiB source policy');
    if (!/\.(?:md|json|ya?ml|[mc]?js|ts|html|css|txt|ps1|py)$/.test(p) && !/^(LICENSE|\.gitignore|\.npmignore)$/.test(p)) continue;
    const body = await readFile(file, 'utf8');
    // Report filenames/categories only; never echo a matched secret.
    if (/[A-Z]:[\\/]Users[\\/][^\s/\\]+|\/Users\/[^\s/]+|\/home\/[^\s/]+/.test(body)) fail(p, 'personal home path');
    if (/127\.0\.0\.1:\d+\/#[a-f0-9]{32,}/i.test(body)) fail(p, 'live-looking session link');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{35,}/.test(body)) fail(p, 'credential-like value');
    if (!p.endsWith('.md')) continue;
    for (const match of body.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const href = match[1].replace(/^<|>$/g, '');
      if (/^(?:https?:|mailto:|#)/.test(href)) continue;
      const destination = decodeURIComponent(href.split('#')[0]);
      if (!destination) continue;
      const target = slash(relative(base, resolve(dirname(file), destination)));
      links++;
      if (!names.has(target) && ![...names].some(n => n.startsWith(`${target}/`))) fail(p, `link target not distributed: ${href}`);
    }
  }
  assert.deepEqual(issues, [], `Distribution audit failed:\n${issues.join('\n')}`);
  return { files: files.length, bytes, localLinks: links, checks: 'paths, file sizes, limited credential patterns, local Markdown destinations; not a comprehensive security audit' };
}
export async function checkRelease() {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.version, lock.version); assert.equal(pkg.version, lock.packages[''].version);
  assert.equal(pkg.name, lock.name); assert.equal(pkg.private, true, '0.1 distribution is GitHub/local archives only');
  const files = await sourceFiles();
  for (const required of ['README.md', 'CONTRIBUTING.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'ROADMAP.md', 'SECURITY.md', 'package-lock.json', '.github/workflows/verify.yml', `docs/releases/v${pkg.version}.md`]) assert.ok(files.includes(required), `Missing ${required}`);
  return { version: pkg.version, ...await audit(files), sourceFiles: files };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { sourceFiles: files, ...result } = await checkRelease(); console.log(JSON.stringify(result, null, 2));
}
