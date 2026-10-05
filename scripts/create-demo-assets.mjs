// Original synthetic demo materials. No third-party screenshots or media.
import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const demos = [
  { folder: 'repo-promo', file: 'studio.png', title: 'Agent Motion Studio', accent: '#8878FF', mode: 'studio' },
  { folder: 'product-ad', file: 'planner.png', title: 'План на сегодня', accent: '#19BDA6', mode: 'planner' },
  { folder: 'feature-explainer', file: 'timeline.png', title: 'От JSON к видео', accent: '#F3B45A', mode: 'timeline' },
];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
  for (const demo of demos) {
    await page.setContent('<html><body style="margin:0"><canvas width="1400" height="900"></canvas></body></html>');
    await page.evaluate(demo => {
      const ctx = document.querySelector('canvas').getContext('2d');
      const box = (x, y, w, h, color, radius = 16) => {
        ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill();
      };
      const text = (value, x, y, size = 30, color = '#EAF0FA', weight = 500) => {
        ctx.fillStyle = color; ctx.font = `${weight} ${size}px Arial`; ctx.fillText(value, x, y);
      };
      box(0, 0, 1400, 900, '#0B1324', 0);
      box(28, 28, 1344, 844, '#141F32', 28);
      box(28, 28, 1344, 86, '#1A2840', 28);
      text(demo.title, 72, 82, 30, '#EDF2FC', 700);
      text('ДЕМО · СИНТЕТИЧЕСКИЙ МАТЕРИАЛ', 834, 78, 18, '#9BAAC3');
      if (demo.mode === 'studio') {
        box(60, 146, 390, 648, '#0B1324');
        text('manifest.json', 90, 194, 24, demo.accent);
        const lines = ['{', '  "schemaVersion": 1,', '  "video": {', '    "aspectRatio": "9:16",', '    "fps": 30', '  },', '  "scenes": [', '    "kinetic_title",', '    "product_zoom",', '    "cta"', '  ]', '}'];
        lines.forEach((line, i) => text(line, 90, 252 + i * 38, 22, '#B8C7DE'));
        box(486, 146, 854, 492, '#0B1324');
        box(654, 174, 508, 422, '#1D2846', 22);
        text('Твой продукт', 709, 335, 48, '#EDF2FC', 700);
        text('в движении', 709, 398, 48, demo.accent, 700);
        box(710, 437, 251, 7, demo.accent, 3);
        text('РЕНДЕР · 30 FPS', 709, 544, 20, '#A5B3CE');
        ['Заголовок', 'Продукт', 'Призыв'].forEach((label, i) => {
          box(488 + i * 287, 674, 266, 120, ['#343362', '#254A56', '#504235'][i]);
          text(label, 512 + i * 287, 744, 24);
        });
      } else if (demo.mode === 'planner') {
        text('Меньше шума. Больше ясности.', 78, 201, 46, '#EDF2FC', 700);
        ['Сегодня', 'В работе', 'Готово'].forEach((label, i) => {
          const x = 66 + i * 431;
          text(label, x + 20, 291, 26, '#C2CDE0', 700);
          const labels = [['Проверить идею', 'Собрать материалы', 'Написать сценарий'], ['Сделать ролик', 'Посмотреть кадры'], ['Сохранить результат']][i];
          labels.forEach((line, j) => {
            box(x, 326 + j * 148, 400, 124, '#23334B');
            box(x + 22, 348 + j * 148, 8, 80, demo.accent, 4);
            text(line, x + 51, 396 + j * 148, 25);
            text('Локальный демопроект', x + 51, 428 + j * 148, 17, '#95A8C3');
          });
        });
      } else {
        text('Три сцены. Один manifest.', 76, 205, 48, '#EDF2FC', 700);
        ['Текст', 'Изображение', 'MP4'].forEach((label, i) => {
          const x = 76 + i * 440;
          box(x, 288, 371, 282, '#24344C');
          text(`0${i + 1}`, x + 28, 345, 24, demo.accent);
          text(label, x + 28, 429, 44, '#EDF2FC', 700);
          text(['Параметры в JSON', 'Анимация по кадрам', 'Проверка декодирования'][i], x + 28, 512, 21, '#A9BAD3');
        });
        text('0 с', 77, 650, 24, '#B0BED4'); text('15 с', 1263, 650, 24, '#B0BED4');
        box(76, 687, 1248, 22, '#35475E', 10);
        box(76, 687, 250, 22, demo.accent, 10);
        box(345, 687, 620, 22, '#6376C6', 10);
        box(984, 687, 340, 22, '#3BA691', 10);
        text('kinetic_title', 76, 765, 24); text('product_zoom', 507, 765, 24); text('cta', 1109, 765, 24);
      }
      text('Оригинальный тестовый материал · Agent Motion Studio', 72, 842, 18, '#8598B6');
    }, demo);
    const target = path.join(root, 'examples', demo.folder, 'assets');
    await mkdir(target, { recursive: true });
    await page.screenshot({ path: path.join(target, demo.file), type: 'png' });
    process.stdout.write(`${demo.folder}/assets/${demo.file}\n`);
  }
} finally {
  await browser.close();
}
