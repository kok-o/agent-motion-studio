import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readProject } from '../dist/project.js';
import { startStudio } from '../dist/server.js';
import { findTools, launchBrowser, runProcess } from '../dist/runtime.js';
import { kineticGrooveWav } from '../dist/audio.js';
import { safeError } from './kit-ui-observer.mjs';

// Records the real local editor, not a mock interface or an invented model chat.
// Accepted projects are created/changed only through the normal CLI/UI APIs.
const root=resolve('.'), out=resolve('artifacts/launch-demo',randomUUID());
await mkdir(out,{recursive:true});
const report={status:'running',scope:'Local CLI and Studio recording; no live model session',commands:[],checks:{},limitations:{humanListening:'NOT RUN',independentUser:'NOT RUN',cleanOS:'NOT RUN',liveModel:'NOT RUN'},recording:{addressBar:'not captured',projectPath:'visually redacted',captions:'recording annotations; not product UI'}};
const save=()=>writeFile(join(out,'REPORT.json'),JSON.stringify(report,null,2)+'\n');
const hash=b=>createHash('sha256').update(b).digest('hex');
async function cli(args,label){
  const result=await new Promise((ok,bad)=>{const p=spawn(process.execPath,[join(root,'dist/cli.js'),...args,'--json'],{cwd:root,windowsHide:true,env:process.env});let stdout='',stderr='';const timer=setTimeout(()=>{p.kill();bad(new Error('CLI deadline'));},240000);p.stdout.on('data',d=>stdout+=d);p.stderr.on('data',d=>stderr+=d);p.once('error',e=>{clearTimeout(timer);bad(e)});p.once('close',code=>{clearTimeout(timer);ok({code,stdout,stderr})});});
  report.commands.push({command:label,exitCode:result.code});await save();assert.equal(result.code,0,label);return JSON.parse(result.stdout);
}
let browser,studio,recorder;
try{
  browser=await launchBrowser(findTools().chrome);
  const art=await browser.newPage();await art.setViewport({width:1200,height:800});
  await art.setContent(`<html><style>html,body{margin:0;width:1200px;height:800px;background:#18272a}svg{display:block}</style><svg width="1200" height="800" xmlns="http://www.w3.org/2000/svg"><rect x="140" y="100" width="920" height="600" rx="48" fill="#d9ee86"/><circle cx="430" cy="365" r="160" fill="#214845"/><circle cx="755" cy="365" r="160" fill="#608478"/><path d="M350 580h500" stroke="#214845" stroke-width="24" stroke-linecap="round"/></svg></html>`);
  const poster=join(out,'poster.png');await art.screenshot({path:poster});await art.close();
  const film=join(out,'Launch Demo');await cli(['new','--dir',film,'--aspect','16:9','--title','MAKE IT\nYOUR OWN'],'new launch film');
  const file=join(film,'project.json');let state=await readProject(file);
  const imported=await cli(['import',file,'--file',poster,'--if-match',state.etag],'import original procedural poster');state=await readProject(file);
  const assembly={type:'batch',label:'Original launch demonstration',actions:[
    {type:'brand',patch:{theme:'dark',background:'#101820',foreground:'#f4f1e9',accent:'#d9ee86'}},
    {type:'edit-scene',sceneId:'opening',patch:{text:'MAKE IT\nYOUR OWN',highlight:'YOUR OWN',durationFrames:120,fontSize:114}},
    {type:'add-scene',scene:{id:'take',type:'product_zoom',asset:imported.importedId,caption:'KEEP YOUR\nTAKES',durationFrames:120,fit:'contain',focalPoint:{x:.5,y:.5}}},
    {type:'add-scene',scene:{id:'closing',type:'cta',text:'YOUR AGENT.\nYOUR PROJECT.',label:'Agent Motion Studio · developer preview',durationFrames:120,fontSize:92}},
    {type:'music',provider:'procedural',gainDb:-18},
  ]};
  const action=join(out,'assembly.json');await writeFile(action,JSON.stringify(assembly));await cli(['edit',file,'--action',action,'--if-match',state.etag],'assemble three scenes through batch');
  state=await readProject(file);const before=await readFile(file),revision=state.manifest.revision,source=await readFile(join(film,state.manifest.assets[imported.importedId].path));
  const baseline=await cli(['render',file,'--out',join(out,'baseline'),'--no-cache'],'render original MP4');assert.equal(baseline.totalFrames,360);assert.equal(baseline.studioExport.status,'registered');
  studio=await startStudio(file,0);const page=await browser.newPage();await page.setViewport({width:1600,height:1000});await page.evaluateOnNewDocument(()=>{
    localStorage.setItem('ams-language','en');
    // Redact the private disk path before paint, including after reload.
    const hide=()=>{const n=document.getElementById('project-path');if(n)n.style.display='none';};
    new MutationObserver(hide).observe(document,{childList:true,subtree:true});
    document.addEventListener('DOMContentLoaded',hide,{once:true});
  });
  const errors=[];page.on('pageerror',()=>errors.push('pageerror'));await page.goto(studio.url,{waitUntil:'networkidle0'});
  await page.evaluate(()=>{
    const e=document.createElement('div');e.id='recording-note';e.textContent='LOCAL CLI + STUDIO DEMO · recording captions added';
    Object.assign(e.style,{position:'fixed',bottom:'14px',left:'18px',zIndex:'9999',background:'#101820e8',border:'1px solid #51605f',color:'#e8eddb',padding:'8px 12px',font:'13px sans-serif',borderRadius:'8px',pointerEvents:'none'});
    document.body.append(e);
  });
  await page.waitForFunction(()=>document.querySelector('#player').readyState>=2);
  await page.$eval('#player',async v=>{v.muted=true;v.currentTime=1.7;});await delay(500);
  await page.screenshot({path:join(out,'studio.png')});
  // Each run has a new UUID directory. Puppeteer 25 treats overwrite:false as
  // mkdir(recursive:false), which rejects this already-created output directory.
  report.stage='recording';await save();
  recorder=await page.screencast({path:join(out,'studio-recording.webm'),ffmpegPath:findTools().ffmpeg,fps:30,quality:20});
  const mark=performance.now(),markers=[];
  async function note(name){markers.push({name,seconds:(performance.now()-mark)/1000});await page.$eval('#recording-note',(n,text)=>n.textContent=text,name);await delay(800)}
  await note('01 · A real MP4, made locally');await page.$eval('#player',async v=>{v.currentTime=0;await v.play()});await delay(4000);await page.$eval('#player',v=>v.pause());
  await note('02 · Change one scene');await page.click('[data-scene-id="take"]');await page.click('#scene-caption');await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.type('KEEP YOUR\nSOURCES',{delay:90});
  await note('03 · Preview the draft before saving · render time accelerated');await page.click('#preview-scene');await page.waitForFunction(()=>!document.querySelector('#scene-preview').hidden&&document.querySelector('#scene-preview').readyState>=2,{timeout:180000});
  assert.deepEqual(await readFile(file),before);report.checks.previewDidNotSave=true;await page.$eval('#scene-preview',async v=>{await v.play()});await delay(2200);await page.$eval('#scene-preview',v=>v.pause());
  await note('04 · Accept the scene and export a new version · render time accelerated');await page.click('#save-scene');await page.waitForFunction(()=>!document.querySelector('#save-scene').disabled);await delay(500);state=await readProject(file);assert.equal(state.manifest.scenes[1].caption,'KEEP YOUR\nSOURCES');await page.click('#export');await page.waitForFunction(()=>document.querySelector('#exports').options.length===2&&!document.querySelector('#export').disabled,{timeout:180000});
  await page.$eval('#player',async v=>{v.muted=true;v.currentTime=4.7;await v.play()});await delay(2200);await page.$eval('#player',v=>v.pause());
  await note('05 · Restore a take; keep the original sources');await page.click('#restore-scene');await delay(600);state=await readProject(file);assert.equal(state.manifest.scenes[1].caption,'KEEP YOUR\nTAKES');assert.deepEqual(await readFile(join(film,state.manifest.assets[imported.importedId].path)),source);await page.click('#export');await page.waitForFunction(()=>document.querySelector('#exports').options.length===3&&!document.querySelector('#export').disabled,{timeout:180000});
  await note('06 · Reopen the editable project');await page.reload({waitUntil:'networkidle0'});assert.equal(await page.$eval('#exports',n=>n.options.length),3);await delay(2500);
  await recorder.stop();recorder=undefined;
  state=await readProject(file);assert.deepEqual(state.manifest.scenes,(await readProject(file)).manifest.history.find(x=>x.id===revision).scenes);assert.deepEqual(errors,[]);
  report.checks={...report.checks,threeExports:true,restoredScene:true,sourceHash:hash(source),sourcesPreserved:true,reopened:true,baselineFrames:baseline.totalFrames,historySnapshots:state.manifest.history.length};
  report.markers=markers;report.film={project:'Launch Demo/project.json',source:'Original procedural poster and music; MIT',baselineRevision:revision};
  await page.screenshot({path:join(out,'reopened.png')});
  const card=await browser.newPage();const screen=(await readFile(join(out,'studio.png'))).toString('base64');const font=(await readFile(join(root,'assets/fonts/noto-sans-latin-700-normal.woff2'))).toString('base64');
  async function titleCard(path,width,height,end=false){await card.setViewport({width,height});await card.setContent(`<html><style>@font-face{font-family:Noto;src:url(data:font/woff2;base64,${font})}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#101820;color:#f4f1e9;font-family:Noto,sans-serif}.copy{position:absolute;left:5%;top:15%;width:43%;z-index:2}.label{color:#d9ee86;font-size:${width/45}px;letter-spacing:2px}.title{font-size:${width/21}px;line-height:1.07;margin:24px 0}.small{font-size:${width/61}px;line-height:1.5;color:#b7c4bf}.screen{position:absolute;width:59%;right:-5%;top:12%;border:2px solid #465653;border-radius:14px;box-shadow:0 28px 90px #0009;transform:rotate(-3deg)}.link{position:absolute;bottom:8%;left:5%;font-size:${width/58}px;color:#d9ee86}</style><div class="copy"><div class="label">AGENT MOTION STUDIO</div><div class="title">${end?'Make it.<br>Then make it yours.':'Your agent.<br>Your film.<br>Your next take.'}</div><div class="small">Local MP4s. Editable projects.<br>Experimental developer preview.</div></div><img class="screen" src="data:image/png;base64,${screen}"><div class="link">github.com/kok-o/agent-motion-studio</div></html>`);await card.evaluate(()=>document.fonts.ready);await card.screenshot({path});}
  await titleCard(join(out,'social-preview.png'),1280,640);await titleCard(join(out,'intro.png'),1920,1080);await titleCard(join(out,'outro.png'),1920,1080,true);await card.close();
  // A streamed WebM does not necessarily have a container Duration element.
  // Count real video frames and use its declared constant frame rate instead.
  const rawInfo=JSON.parse((await runProcess(findTools().ffprobe,['-v','error','-count_frames','-show_entries','stream=codec_name,nb_read_frames,r_frame_rate:format=duration','-of','json',join(out,'studio-recording.webm')])).stdout);
  const rawVideo=rawInfo.streams.find(x=>x.codec_name==='vp9'),rate=rawVideo.r_frame_rate.split('/').map(Number);
  const seconds=Number(rawInfo.format.duration)||Number(rawVideo.nb_read_frames)/(rate[0]/rate[1]);assert.ok(seconds>10);
  const total=37,body=31;await writeFile(join(out,'music.wav'),kineticGrooveWav(total,7,[0,75,1005]));
  const filters=`[0:v]fps=30,scale=1920:1080,setsar=1,trim=duration=2.5,setpts=PTS-STARTPTS[a];[1:v]setpts=${body/seconds}*(PTS-STARTPTS),fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x101820,setsar=1,trim=duration=${body}[b];[2:v]fps=30,scale=1920:1080,setsar=1,trim=duration=3.5,setpts=PTS-STARTPTS[c];[a][b][c]concat=n=3:v=1:a=0[v];[3:a]volume=0.35,afade=t=in:d=0.4,afade=t=out:st=35:d=2[audio]`;
  await runProcess(findTools().ffmpeg,['-v','error','-y','-loop','1','-i',join(out,'intro.png'),'-i',join(out,'studio-recording.webm'),'-loop','1','-i',join(out,'outro.png'),'-i',join(out,'music.wav'),'-filter_complex',filters,'-map','[v]','-map','[audio]','-t',String(total),'-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','192k','-movflags','+faststart',join(out,'agent-motion-studio-demo.mp4')]);
  const final=JSON.parse((await runProcess(findTools().ffprobe,['-v','error','-count_frames','-show_entries','stream=codec_name,width,height,nb_read_frames:format=duration','-of','json',join(out,'agent-motion-studio-demo.mp4')])).stdout);assert.equal(Number(final.streams.find(x=>x.codec_name==='h264').nb_read_frames),total*30);assert.equal(final.streams.find(x=>x.codec_name==='aac').codec_name,'aac');
  await runProcess(findTools().ffmpeg,['-v','error','-i',join(out,'agent-motion-studio-demo.mp4'),'-f','null','-']);
  report.status='passed';report.video={seconds:total,frames:total*30,width:1920,height:1080,audio:'AAC',recordingSeconds:seconds,playbackSpeed:seconds/body,decode:'passed'};
  await save();console.log(JSON.stringify({status:report.status,evidence:out,video:report.video,checks:report.checks},null,2));
}catch(error){report.status='failed';report.failure=safeError(error);await save();console.error(JSON.stringify(report.failure));process.exitCode=1}
finally{await recorder?.stop();await browser?.close();await studio?.close();}
