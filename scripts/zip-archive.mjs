import assert from 'node:assert/strict';
import { basename, isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';

export function command(bin, args, cwd) {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 8e6 });
  assert.equal(result.status, 0, `${basename(bin)} ${args[0]} failed: ${result.stderr || result.error || result.stdout}`);
  return result.stdout;
}

// GNU tar from Git Bash cannot create ZIPs and treats native C: paths as remote.
// Never resolve tar through PATH on Windows, including extraction and resealing.
export function windowsZipTool({ env = process.env } = {}) {
  const systemRoot = env.SystemRoot || env.SYSTEMROOT;
  assert.ok(systemRoot && isAbsolute(systemRoot), 'Windows ZIP support requires an absolute SystemRoot and the built-in bsdtar tar.exe; PATH tar is not used.');
  const systemDirectory = process.arch === 'ia32' && env.PROCESSOR_ARCHITEW6432 ? 'Sysnative' : 'System32';
  const bin = join(systemRoot, systemDirectory, 'tar.exe');
  const result = spawnSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true });
  assert.ok(result.status === 0 && /^bsdtar\s/m.test(result.stdout || ''), `Windows ZIP support requires built-in bsdtar at ${bin}. Restore/install Windows tar.exe; PATH tar is not used.`);
  return bin;
}

export function zipDirectory(directory, archive, name) {
  if (process.platform === 'win32') {
    // Older Windows bsdtar builds convert argv paths using the system code page.
    // Node opens the Unicode archive path; CreateProcess receives a Unicode cwd.
    // Inherit a regular file descriptor: ZIP extraction needs seekable input.
    const bin = windowsZipTool(), fd = openSync(archive, 'w');
    try {
      const result = spawnSync(bin, ['--format=zip', '-cf', '-', name], { cwd: directory, stdio: ['ignore', fd, 'pipe'], encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, `Windows ZIP creation failed: ${result.stderr || result.error}`);
    } finally { closeSync(fd); }
  } else command('zip', ['-q', '-r', archive, name], directory);
}

export function extractZip(archive, directory) {
  if (process.platform === 'win32') {
    const bin = windowsZipTool(), fd = openSync(archive, 'r');
    try {
      const result = spawnSync(bin, ['-xf', '-'], { cwd: directory, stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, `Windows ZIP extraction failed: ${result.stderr || result.error}`);
    } finally { closeSync(fd); }
  } else command('unzip', ['-q', archive, '-d', directory]);
}
