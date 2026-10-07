import test from 'node:test';
import assert from 'node:assert/strict';
import { findTools, launchBrowser } from '../../dist/runtime.js';
import { assertRendererPage } from '../../dist/browser-contract.js';

test('the real isolated browser passes Canvas/PNG checks; controlled privacy readbacks fail clearly', { timeout: 60000 }, async () => {
  const browser = await launchBrowser(findTools().chrome);
  const incompatible = error => error.code === 'BROWSER_UNSUPPORTED' && error.exitCode === 3 && /CHROME_PATH.*sandbox/s.test(error.message);
  try {
    let page = await browser.newPage();
    await assertRendererPage(page); await page.close();
    page = await browser.newPage();
    await page.evaluate(() => Object.defineProperty(navigator, 'brave', { value: { isBrave: async () => true } }));
    await assert.rejects(assertRendererPage(page), incompatible); await page.close();
    page = await browser.newPage();
    await page.evaluate(() => {
      const original = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function (...args) { const result = original.apply(this, args); result.data[0] ^= 1; return result; };
    });
    await assert.rejects(assertRendererPage(page), incompatible); await page.close();
    page = await browser.newPage();
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (...args) {
        const copy = document.createElement('canvas'); copy.width = this.width; copy.height = this.height;
        copy.getContext('2d').drawImage(this, 0, 0); copy.getContext('2d').fillRect(0, 0, 1, 1);
        return original.apply(copy, args);
      };
    });
    await assert.rejects(assertRendererPage(page), incompatible); await page.close();
  } finally { await browser.close(); }
});
