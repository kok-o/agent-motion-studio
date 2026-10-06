import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { launchBrowser, findTools } from '../dist/runtime.js';

const root = resolve('artifacts/v0.2/visual-expression');
await mkdir(join(root, 'storyboard'), { recursive: true });
// Preserve the incoming dirty source state before implementation. Never reset it.
const paths = execFileSync('git', ['status', '--porcelain', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean).map(line => line.slice(3));
const backup = [];
for (const path of paths) {
  if (path.endsWith('/') || path.startsWith('artifacts/')) continue;
  try { const bytes = await readFile(path); const dest = join(root, 'incoming-source', path); await mkdir(resolve(dest, '..'), { recursive: true }); await cp(path, dest); backup.push({ path, sha256: createHash('sha256').update(bytes).digest('hex') }); } catch (e) { if (e.code !== 'EISDIR') throw e; }
}
await writeFile(join(root, 'incoming-source.json'), JSON.stringify(backup, null, 2));
await writeFile(join(root, 'storyboard/STORYBOARD.md'), `# fastgrep: от множества файлов к одной строке

18 секунд / 540 кадров / 1080×1920 / 30 fps. Вымышленная CLI-утилита, команды — иллюстрация, не предложение реального npm-пакета. Музыка: собственный локальный 120 BPM трек, действия на четвертях и восьмых. Только авторские формы, текст и локальный рисунок; никаких внешних вызовов.

| Время | Кадры | Композиция и действие | Текст и удержание |
| --- | --- | --- | --- |
| 0–3 | 0–89 | Вертикальный веер файлов: карточки собираются с разных сторон, выбранный файл остаётся в фокусе | «Где эта строка?»; 2.3 s чтения |
| 3–7 | 90–209 | Крупный терминал, запрос печатается по символам; файловый контекст остаётся подписью | fastgrep "timeout" src/; полный запрос держится >2 s |
| 7–10 | 210–299 | Крупный фрагмент кода: плашка охватывает timeout, остальные строки спокойнее | «Совпадение.»; подсветка привязана к конкретному слову |
| 10–13 | 300–389 | Светлый результат: путь, большой номер 42 и найденная строка; без ложных метрик | src/config.ts : 42 / timeout: 5000,; 2.5 s |
| 13–18 | 390–539 | Широкая командная плашка и отдельная финальная типографика; курсор превращается в указатель | npm i -g fastgrep / «Попробуй на своём проекте.»; >3 s |

Иерархия: крупный вопрос → читаемая команда → слово → строка → действие. Планы меняются, сцены не получают общий вращающийся знак/сетку/прогресс. Жёсткие смысловые монтажные стыки на музыкальных тактах; движение объектов продолжается/заканчивается в соответствии с действием. Светлый результат отделяет решение от поиска.

## Второй пример

12 секунд, 16:9, спокойный 80 BPM трек. 3 s — документ с исходной таблицей; 4.5 s — документ остаётся на месте, строки по очереди становятся проверенными, полосы прогресса строятся слева направо; 4.5 s — та же форма превращается в отчёт с графиком, выводом и отметкой «Готово». Другая композиция и темп, та же общая сцена composition. Данные примера вымышлены.

Три концептуальных ключевых кадра сохранены до реализации движка. Это раскадровка, а не заявление о готовом рендере.
`);
const esc = s => s.replaceAll('&', '&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const txt = (s,x,y,size,color='#F4F1E9',weight=700) => `<text x="${x}" y="${y}" font-family="Arial" font-weight="${weight}" font-size="${size}" fill="${color}">${esc(s)}</text>`;
const rect = (x,y,w,h,c,r=18) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${c}"/>`;
const frame = (bg,body) => `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">${rect(0,0,1080,1920,bg,0)}${body}</svg>`;
let files = txt('fastgrep',90,130,42,'#D9EE86') + txt('Где эта',90,325,112)+txt('строка?',90,455,112);
['README.md','src/router.ts','src/config.ts','src/index.ts','tests/search.ts'].forEach((s,i)=>{ const x=100+(i%2)*90,y=640+i*156; files+=rect(x,y,780,130,i===2?'#D9EE86':'#203036')+txt(s,x+42,y+80,42,i===2?'#10171C':'#F4F1E9',400); });
files += txt('Начни с запроса.',90,1700,42,'#A8B9B8',400);
const query = txt('Ищи по содержимому.',90,160,42,'#D9EE86')+txt('Один запрос.',90,430,90)+rect(90,670,900,570,'#203036')+txt('TERMINAL · src/',130,750,30,'#A8B9B8',400)+txt('> fastgrep "timeout"',130,940,52)+txt('  src/',130,1030,52)+rect(130,1100,28,60,'#D9EE86',0)+txt('Слово. Папка. Enter.',90,1600,48,'#A8B9B8',400);
const result = txt('НАЙДЕНО',90,150,38,'#285A36')+rect(90,400,760,90,'#10171C')+txt('src/config.ts',130,462,44)+txt('42',90,835,280,'#10171C')+txt('timeout: 5000,',90,1060,90,'#10171C')+rect(90,1130,750,7,'#285A36',0)+txt('Путь. Строка. Контекст.',90,1510,48,'#285A36',400);
const browser = await launchBrowser(findTools().chrome);
try { const page = await browser.newPage(); await page.setViewport({width:1080,height:1920}); for (const [name,svg] of [['01-files',frame('#10171C',files)],['02-query',frame('#10171C',query)],['03-result',frame('#D9EE86',result)]]) { await writeFile(join(root,'storyboard',name+'.svg'),svg); await page.setContent(svg); await page.screenshot({path:join(root,'storyboard',name+'.png')}); } } finally { await browser.close(); }
console.log(root);
