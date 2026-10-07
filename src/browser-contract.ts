import { basename } from 'node:path';
import type { Page } from 'puppeteer-core';
import { StudioError } from './errors.js';

const recovery = 'Use Chrome, Chromium or Edge for rendering and set CHROME_PATH to that executable. Keep browser privacy settings and the sandbox enabled. You can still open the studio UI in your usual browser.';
function unsupported(reason: string): never {
  throw new StudioError('BROWSER_UNSUPPORTED', 'doctor', `${reason} ${recovery}`, 3);
}

export function assertBrowserExecutable(executable: string) {
  if (/^(?:brave|brave-browser|brave browser)(?:\.exe)?$/i.test(basename(executable))) {
    unsupported('Brave is not supported as the renderer: its Canvas fingerprinting protection can change pixels between browser sessions.');
  }
}

// Version strings alone are insufficient: privacy browsers can identify as
// Chrome and return altered Canvas pixels. Probe only our isolated page.
export async function assertRendererPage(page: Page) {
  const result = await page.evaluate(async () => {
    const brave = (navigator as Navigator & { brave?: { isBrave(): Promise<boolean> } }).brave;
    if (brave && await brave.isBrave()) return 'Brave Canvas fingerprinting protection can change pixels between browser sessions.';
    try {
      const width = 128, height = 128, canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return 'Canvas 2D is unavailable.';
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < pixels.length; i += 4) {
        const n = i / 4;
        pixels[i] = (n * 17 + 13) & 255; pixels[i + 1] = (n * 29 + 71) & 255;
        pixels[i + 2] = (n * 43 + 191) & 255; pixels[i + 3] = 255;
      }
      context.putImageData(new ImageData(pixels, width, height), 0, 0);
      const equal = (data: Uint8ClampedArray) => data.length === pixels.length && data.every((value, index) => value === pixels[index]);
      if (!equal(context.getImageData(0, 0, width, height).data)) return 'Canvas readback changed known pixels; repeatable rendering is unavailable.';
      const png = canvas.toDataURL('image/png');
      if (png !== canvas.toDataURL('image/png')) return 'Canvas PNG readback changed between calls.';
      const image = new Image();
      await new Promise<void>((ok, bad) => { image.onload = () => ok(); image.onerror = () => bad(new Error('Canvas PNG could not be decoded.')); image.src = png; });
      if (image.width !== width || image.height !== height) return 'Canvas PNG dimensions changed.';
      context.clearRect(0, 0, width, height); context.drawImage(image, 0, 0);
      if (!equal(context.getImageData(0, 0, width, height).data)) return 'Canvas PNG readback changed known pixels; repeatable rendering is unavailable.';
      return null;
    } catch (error) { return `Canvas compatibility check failed: ${error instanceof Error ? error.message : String(error)}`; }
  });
  if (result) unsupported(result);
}
