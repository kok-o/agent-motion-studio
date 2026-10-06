import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchBrowser, findTools } from '../dist/runtime.js';

const root = resolve('artifacts/v0.2/visual-expression');
const source = join(root,'authored-sources'); await mkdir(source,{recursive:true});
const dark='#10171C', ink='#F4F1E9', lime='#D9EE86', muted='#A8B9B8', panel='#203036';
const text=(id,value,x,y,width,height,fontSize=48,color=ink,extra={})=>({id,type:'text',text:value,x,y,width,height,fontSize,color,...extra});
const shape=(id,x,y,width,height,color,extra={})=>({id,type:'shape',shape:'rect',x,y,width,height,color,...extra});
const image=(id,asset,x,y,width,height,extra={})=>({id,type:'image',asset,x,y,width,height,fit:'contain',...extra});
const appear=(object,delay=0,dx=0,dy=0,length=15)=>({...object,x:object.x+dx,y:object.y+dy,opacity:0,keyframes:[{frame:delay,x:object.x+dx,y:object.y+dy,opacity:0},{frame:delay+length,x:object.x,y:object.y,opacity:1,easing:'outCubic'}]});
const scene=(id,durationFrames,objects,background=dark)=>({id,type:'composition',durationFrames,background,objects});
// Original local raster drawing, imported through the immutable-source API.
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320"><path d="M20 8 H160 L220 70 V305 H20 Z" fill="#F4F1E9"/><path d="M160 8 V70 H220" fill="#D9EE86"/><path d="M50 115 H185 M50 150 H165 M50 185 H185 M50 220 H135" stroke="#8EAAA8" stroke-width="12"/></svg>`;
await writeFile(join(source,'document.svg'),svg);
const browser=await launchBrowser(findTools().chrome);
let caretTrack;
try {const page=await browser.newPage();await page.setViewport({width:240,height:320});await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg}`);await page.screenshot({path:join(source,'document.png'),omitBackground:true});
  const font=(await readFile('assets/fonts/noto-sans-latin-400-normal.woff2')).toString('base64');
  await page.setContent(`<style>@font-face{font-family:StudioSans;src:url(data:font/woff2;base64,${font})}</style>`);
  caretTrack=await page.evaluate(async()=>{await document.fonts.load('400 46px StudioSans');const ctx=document.createElement('canvas').getContext('2d');ctx.font='400 46px StudioSans';const command='fastgrep "timeout" src/';return Array.from({length:command.length+1},(_,i)=>({frame:12+Math.ceil(i/command.length*45),x:150+ctx.measureText(command.slice(0,i)).width+4,easing:'step'}));});
} finally {await browser.close();}

// Deterministic original PCM: no model, media provider, recording or sample pack.
async function music(name,seconds,bpm,quiet=false) {
  const rate=48000,count=seconds*rate,buf=Buffer.alloc(44+count*4);buf.write('RIFF');buf.writeUInt32LE(buf.length-8,4);buf.write('WAVEfmt ',8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(2,22);buf.writeUInt32LE(rate,24);buf.writeUInt32LE(rate*4,28);buf.writeUInt16LE(4,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(count*4,40);
  const beat=60/bpm,notes=quiet?[261.626,329.628,391.995,329.628]:[220,261.626,329.628,293.665];let rng=314159;
  for(let n=0;n<count;n++){const t=n/rate,b=t/beat,k=Math.floor(b),p=(b-k)*beat,eighth=(b*2-Math.floor(b*2))*beat/2;
    rng=(Math.imul(rng,1664525)+1013904223)>>>0;const noise=rng/4294967296*2-1;
    const kick=(quiet?.1:.22)*Math.exp(-p*28)*Math.sin(2*Math.PI*(48*p+1.8*(1-Math.exp(-p*28))));
    const hat=(quiet?.018:.028)*noise*Math.exp(-eighth*95);
    const snare=k%4===2?(quiet?.022:.07)*noise*Math.exp(-p*23):0;
    const freq=notes[Math.floor(k/4)%notes.length]/(quiet?1:2),pluck=.12*Math.exp(-p*(quiet?3.5:7))*(Math.sin(2*Math.PI*freq*t)+.25*Math.sin(2*Math.PI*freq*2*t));
    const fade=Math.min(1,t/.08,(seconds-t)/.45),v=(kick+hat+snare+pluck)*fade;
    for(let ch=0;ch<2;ch++)buf.writeInt16LE(Math.round(Math.max(-.95,Math.min(.95,v*(ch? .96:1)))*32767),44+n*4+ch*2);
  }
  await writeFile(join(source,name),buf);
}
await music('fastgrep-120bpm.wav',18,120);await music('report-80bpm.wav',12,80,true);
const log=[];
function cli(args){const r=spawnSync(process.execPath,['dist/cli.js',...args,'--json'],{encoding:'utf8',windowsHide:true,maxBuffer:20e6});log.push({args,exit:r.status,result:r.stdout,stderr:r.stderr});if(r.status!==0)throw new Error(r.stdout||r.stderr);return JSON.parse(r.stdout);}
async function project(name,aspect,track,build){const dir=join(root,name);cli(['new','--dir',dir,'--aspect',aspect,'--title',name]);const file=join(dir,'project.json');let state=cli(['state',file]);const icon=cli(['import',file,'--file',join(source,'document.png'),'--if-match',state.etag]);state=cli(['state',file]);const music=cli(['import',file,'--file',join(source,track),'--if-match',state.etag]);state=cli(['state',file]);const scenes=build(icon.importedId);
  const action={type:'batch',label:'Authored visual composition',actions:[{type:'brand',patch:{background:dark,foreground:ink,accent:lime}},{type:'composition',video:{aspectRatio:aspect,fps:30,style:'studio'}},{type:'remove-scene',sceneId:'opening'},...scenes.map(scene=>({type:'add-scene',scene})),{type:'music',asset:music.importedId,gainDb:-5}]};await writeFile(join(dir,'assembly.action.json'),JSON.stringify(action,null,2));state=cli(['edit',file,'--action',join(dir,'assembly.action.json'),'--if-match',state.etag]);
  await writeFile(join(dir,'CREDITS.md'),`# Original local demonstration\n\nFictional product/data. Text, composition, document drawing and ${track} are authored locally for this iteration. Music is deterministic PCM synthesis (${name==='fastgrep'?120:80} BPM), not model-generated or sampled. Project/media: MIT. Bundled Noto Sans: SIL OFL. No remote media or speed measurements. Keep assets, history and this file with project.json.\n`);
  await writeFile(join(dir,'baseline-revision.json'),JSON.stringify({revision:state.manifest.revision,etag:state.etag},null,2));cli(['validate',file]);return file;
}
function fastgrep(icon){
  const files=[text('brand','fastgrep',90,95,800,70,44,lime),text('question','Где эта\nстрока?',90,245,900,290,108),text('prompt','Начни с запроса.',90,1650,900,70,42,muted,{weight:400})];
  ['README.md','src/router.ts','src/config.ts','src/index.ts','tests/search.ts'].forEach((name,i)=>{const x=i%2?170:90,y=650+i*154;const selected=i===2;const extras={rotation:selected?-3:(i%2?3:-2)};const card=shape('file-'+i,x,y,800,126,selected?lime:panel,{radius:14,...extras});const label=text('filename-'+i,name,x+115,y+32,650,65,40,selected?dark:ink,{weight:400,...extras});const glyph=image('file-icon-'+i,icon,x+22,y+18,65,86,extras);[card,glyph,label].forEach(o=>files.push(i===2?o:appear(o,i*4,i%2?190:-190,0,24)));});
  const query=[text('query-label','Ищи по содержимому.',90,100,900,65,40,lime),text('query-heading','Один запрос.',90,310,900,145,88),shape('terminal',90,650,900,600,panel,{radius:20}),text('terminal-label','TERMINAL / src/',130,705,810,55,30,muted,{weight:400}),shape('terminal-rule',130,792,810,2,'#405359'),text('command','fastgrep "timeout" src/',150,910,780,80,46,ink,{weight:400,reveal:0,keyframes:[{frame:12,reveal:0},{frame:57,reveal:1}]}),text('shell-prompt','>',120,910,40,70,46,lime),shape('caret',154,915,4,54,lime,{keyframes:[...caretTrack,{frame:66,opacity:0,easing:'step'}]}),appear(shape('enter-key',750,1110,170,74,lime,{radius:12}),65,0,10,8),appear(text('enter-label','Enter',774,1120,135,55,34,dark),65,0,10,8),text('query-footer','Слово. Папка. Enter.',90,1580,900,90,44,muted,{weight:400})];
  const match=[text('match-label','ПОИСК В src/',90,95,900,60,38,lime),text('match-heading','Совпадение.',90,260,900,150,94),shape('code',80,650,920,700,panel,{radius:18}),text('path','src/config.ts',125,705,800,65,36,muted,{weight:400}),text('line-40','40',118,835,75,70,34,muted,{weight:400}),text('code-40','export const config = {',210,827,720,85,42),text('line-41','41',118,926,75,70,34,muted,{weight:400}),text('code-41','retries: 3,',210,920,720,80,42,muted,{weight:400}),shape('match-band',196,1030,1,82,lime,{radius:8,keyframes:[{frame:8,width:1},{frame:23,width:276,easing:'outCubic'}]}),text('line-number','42',118,1040,75,70,34,lime,{weight:400}),text('match-word','timeout',210,1034,268,75,50,ink),text('match-word-dark','timeout',210,1034,268,75,50,dark,{opacity:0,keyframes:[{frame:19,opacity:0},{frame:23,opacity:1}]}),text('match-value',': 5000,',492,1034,460,75,50),text('line-43','43',118,1150,75,70,34,muted,{weight:400}),text('code-43','};',210,1146,700,70,42,muted,{weight:400}),text('match-footer','Нужное слово — в контексте.',90,1580,900,120,40,muted,{weight:400})];
  const result=[text('found-label','НАЙДЕНО',90,95,900,65,38,'#285A36'),shape('path-pill',90,360,760,105,dark,{radius:12}),text('found-path','src/config.ts',130,379,710,75,44),appear(text('found-number','42',85,600,850,360,272,dark),0,-70,0,12),text('found-code','timeout: 5000,',90,1010,900,145,84,dark),shape('result-rule',90,1180,1,7,'#285A36',{keyframes:[{frame:15,width:1},{frame:30,width:820,easing:'outCubic'}]}),text('result-footer','Путь. Строка. Контекст.',90,1480,900,100,46,'#285A36',{weight:400})];
  const install=[text('install-brand','fastgrep',90,100,900,100,66,lime),text('install-heading','От запроса\nк ответу.',90,310,900,270,94),shape('install-box',90,850,900,180,lime,{radius:14}),text('install-command','npm i -g fastgrep',130,900,830,85,58,dark,{weight:400}),appear(text('try','Попробуй\nна своём проекте.',90,1220,900,230,78),12,0,25,15),text('fiction','Вымышленная утилита.\nКоманда показана для демонстрации.',90,1690,900,120,28,muted,{weight:400})];
  return [scene('files',90,files),scene('query',120,query),scene('match',90,match),scene('result',90,result,lime),scene('install',150,install)];
}
function report(icon){
  const bg='#EEECE5',fg='#203F3B',gray='#637774',blue='#316C83';
  const document=(title)=>[shape('paper-shadow',1016,136,705,806,'#D7DAD3',{radius:15}),shape('paper',1000,120,705,806,'#FFFFFF',{radius:12}),image('document-symbol',icon,1040,160,55,74),text('document-title',title,1120,165,530,70,42,fg),shape('paper-rule',1040,255,615,2,'#DDE3DE')];
  const input=[text('input-kicker','01 / ИСХОДНЫЙ ФАЙЛ',125,135,770,55,30,gray,{weight:400}),text('input-heading','Из файла —\nв ясный отчёт.',120,280,830,230,80,fg),text('input-copy','Загрузите таблицу.\nСохраните исходник.',125,650,760,150,38,gray,{weight:400}),...document('sales.csv')];
  ['Месяц','Апрель','Май','Июнь'].forEach((s,i)=>input.push(text('table-'+i,s,1040,340+i*100,350,75,36,i?gray:fg,{weight:400}),text('value-'+i,['Доход','120','150','180'][i],1470,340+i*100,180,75,36,i?gray:fg,{weight:400,align:'right'})));
  input.push(shape('raw-status',1040,805,610,68,'#E8ECE7',{radius:8}),text('raw-label','Исходные данные',1060,815,575,50,28,gray,{weight:400}));
  const processing=[text('process-kicker','02 / ОБРАБОТКА',125,135,780,55,30,gray,{weight:400}),text('process-heading','Проверяем.\nСобираем.',120,280,820,230,80,fg),text('process-copy','Строки становятся\nструктурой отчёта.',125,650,790,150,38,gray,{weight:400}),...document('sales.csv')];
  ['Данные прочитаны','Строки проверены','Итоги собраны'].forEach((s,i)=>{const y=340+i*125;processing.push(text('stage-'+i,s,1040,y,600,62,34,fg,{weight:400}),shape('stage-track-'+i,1040,y+65,610,14,'#E8ECE7',{radius:7}),shape('stage-fill-'+i,1040,y+65,1,14,blue,{radius:7,keyframes:[{frame:i*30,width:1},{frame:i*30+30,width:610,easing:'inOutCubic'}]}));});
  processing.push(shape('status-box',1040,805,610,68,'#E8ECE7',{radius:8}),text('processing-status','Идёт обработка',1060,815,575,50,28,gray,{weight:400,opacity:1,keyframes:[{frame:104,opacity:1},{frame:105,opacity:0,easing:'step'}]}),text('checked-status','Проверено',1060,815,575,50,28,fg,{opacity:0,keyframes:[{frame:104,opacity:0},{frame:105,opacity:1,easing:'step'}]}));
  const ready=[text('ready-kicker','03 / ГОТОВО',125,135,780,55,30,gray,{weight:400}),text('ready-heading','Теперь видно\nглавное.',120,280,820,230,80,fg),text('ready-copy','Отчёт готов.\nИсходник сохранён.',125,650,790,150,38,gray,{weight:400}),...document('Отчёт / sales.csv'),text('chart-label','Доход по месяцам',1040,307,615,60,32,fg,{weight:400})];
  const bars=[{x:1090,h:155,label:'Апр'},{x:1280,h:200,label:'Май'},{x:1470,h:248,label:'Июн'}];
  bars.forEach((b,i)=>ready.push(shape('bar-'+i,b.x,677-1,105,1,blue,{radius:8,keyframes:[{frame:10+i*4,height:1,y:676},{frame:40+i*4,height:b.h,y:677-b.h,easing:'outCubic'}]}),text('month-'+i,b.label,b.x,694,145,50,28,gray,{weight:400})));
  ready.push(text('insight','Рост каждый месяц.',1040,770,620,55,32,fg),shape('ready-badge',1410,840,225,52,fg,{radius:26}),text('ready-label','Готово',1445,845,160,42,28,'#FFFFFF'),text('disclaimer','Учебный пример. Данные вымышлены.',125,980,1550,50,26,gray,{weight:400}));
  return [scene('file',90,input,bg),scene('processing',135,processing,bg),scene('report',135,ready,bg)];
}
try {const fast=await project('fastgrep','9:16','fastgrep-120bpm.wav',fastgrep);const second=await project('document-report','16:9','report-80bpm.wav',report);await writeFile(join(root,'projects.json'),JSON.stringify({fastgrep:fast,report:second},null,2));}
finally {await writeFile(join(root,'assembly-log.json'),JSON.stringify(log,null,2));}
