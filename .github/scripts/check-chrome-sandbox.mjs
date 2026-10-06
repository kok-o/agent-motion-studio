import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launchBrowser } from '../../dist/runtime.js';

// CI-only verification. The application neither installs this policy nor
// changes its browser arguments for CI or for end users.
assert.equal(process.platform, 'linux');
assert.equal((await readFile('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8')).trim(), '1',
  'The runner-wide AppArmor user-namespace restriction must remain enabled');
assert.ok(process.env.CHROME_PATH, 'CI must select the exact downloaded browser');
const browser = await launchBrowser(process.env.CHROME_PATH);
try {
  const disabled = ['--no-sandbox', '--disable-namespace-sandbox', '--disable-setuid-sandbox', '--disable-seccomp-filter-sandbox'];
  assert.equal(browser.process().spawnargs.some(argument => disabled.includes(argument.split('=')[0])), false);
  const page = await browser.newPage();
  await page.goto('chrome://sandbox');
  const status = await page.$eval('body', body => body.innerText);
  console.log(status);
  const compact = status.replace(/\s+/g, ' ');
  assert.match(compact, /You are adequately sandboxed\./);
  assert.match(compact, /(?:Layer 1 Sandbox Namespace|Namespace sandbox Yes)/);
  assert.match(compact, /Seccomp-BPF sandbox Yes/);
} finally { await browser.close(); }
