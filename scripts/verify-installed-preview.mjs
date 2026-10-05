// Copy this harness into the external consumer before execution. No checkout imports.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile,writeFile,mkdir,copyFile,readdir } from 'node:fs/promises';
import { join,resolve,dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root=process.cwd(), film=join(root,`film-${Date.now()}`), app=join(root,'node_modules/agent-motion-studio'), cli=join(app,'dist/cli.js'), evidence=join(root,'evidence');await mkdir(evidence,{recursive:true});
const require=createRequire(join(app,'package.json')), puppeteer=require('puppeteer-core');
const hash=b=>createHash('sha256').update(b).digest('hex');
const run=(bin,args,options={})=>new Promise((ok,bad)=>{const child=spawn(bin,args,{cwd:root,windowsHide:true,...options});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',bad);child.on('exit',code=>code===0?ok({stdout,stderr,code}):bad(new Error(`${bin} exit ${code}: ${stderr}\n${stdout}`)));});
let permissions=[];
const cliRun=async(args,label)=>{const r=await run(process.execPath,[...permissions,cli,...args,'--json']);await writeFile(join(evidence,`${label}.log`),r.stdout+'\n'+r.stderr);return JSON.parse(r.stdout.trim());};
const report={status:'running',root,checks:{},systemDependencies:'Node, Chrome and FFmpeg already installed on this Windows host; npm dependencies installed into a new external directory',consoleErrors:[]};
const record=async(name,value=true)=>{report.checks[name]=value;await writeFile(join(evidence,'verification.json'),JSON.stringify(report,null,2));console.log(`PASS ${name}`);};
let browser,server;
try{
  const doctor=await cliRun(['doctor'],'doctor');assert.ok(doctor.ready);
  // fs.cp checks ancestor metadata outside its source/destination; initialize normally.
  // The installed app's doctor/studio/render then run with checkout reads denied.
  await cliRun(['init','coffee-ritual','--dir',film],'init');
  permissions=['--experimental-permission',`--allow-fs-read=${root}`,`--allow-fs-write=${root}`,`--allow-fs-read=${tmpdir()}`,`--allow-fs-write=${tmpdir()}`,`--allow-fs-read=${dirname(doctor.browser.path)}`,'--allow-child-process'];
  // The installed Node app can read its consumer and temp directories, not the checkout.
  const denied=await run(process.execPath,[...permissions,'--input-type=module','-e',"import{readFile}from'node:fs/promises';try{await readFile(process.env.AMS_FORBIDDEN_CHECKOUT+'/package.json');process.exit(1)}catch(e){if(e.code!=='ERR_ACCESS_DENIED')throw e;console.log(e.code)}"]);
  assert.match(denied.stdout,/ERR_ACCESS_DENIED/);await record('checkout_read_denied_by_node_permission_model',{permissionArgs:permissions,probe:denied.stdout.trim(),limitation:'Permissions cover Node filesystem calls, not OS-level isolation of Chrome/FFmpeg child processes.'});
  await cliRun(['doctor'],'doctor-restricted');
  const file=join(film,'project.json'),disk=async()=>JSON.parse(await readFile(file,'utf8'));
  const sources=async()=>Object.fromEntries(await Promise.all(Object.entries((await disk()).assets).map(async([id,a])=>[id,hash(await readFile(join(film,a.path)))])));
  const initial=await disk(),beforeHashes=await sources();assert.equal(Object.keys(beforeHashes).length,5);assert.ok(!(await readdir(film)).includes('exports'));await record('installed_cli_doctor_init',{doctor,project:file,assets:beforeHashes});
  server=spawn(process.execPath,[...permissions,cli,'studio',file,'--port','0'],{cwd:root,windowsHide:true});
  let serverLog='';const url=await new Promise((ok,bad)=>{const timer=setTimeout(()=>bad(new Error('studio startup timeout')),30000);server.stdout.on('data',d=>{serverLog+=d;const m=serverLog.match(/http:\/\/127\.0\.0\.1:\d+\/#[a-f0-9]+/);if(m){clearTimeout(timer);ok(m[0]);}});server.stderr.on('data',d=>serverLog+=d);server.once('error',bad);server.once('exit',code=>{clearTimeout(timer);bad(new Error(`studio exited ${code}: ${serverLog}`));});});
  browser=await puppeteer.launch({executablePath:doctor.browser.path,headless:true,args:['--disable-dev-shm-usage']});const page=await browser.newPage();page.on('pageerror',e=>report.consoleErrors.push(e.message));await page.setViewport({width:1440,height:1100});await page.goto(url,{waitUntil:'networkidle0'});
  const idle=()=>page.waitForFunction(()=>!document.querySelector('#reload').disabled);
  async function exportUI(label){await page.click('#export');await page.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('MP4 готов')||document.querySelector('#notice').classList.contains('error'),{timeout:300000});assert.match(await page.$eval('#notice',n=>n.textContent),/^MP4 готов/);await idle();const id=await page.$eval('#exports',n=>n.value),out=join(film,'exports',id);await copyFile(join(out,'output.mp4'),join(evidence,`${label}.mp4`));await copyFile(join(out,'contact-sheet.jpg'),join(evidence,`${label}-contact.jpg`));await page.$eval('#player',async n=>{n.muted=true;n.currentTime=5;await n.play();});await page.waitForFunction(()=>document.querySelector('#player').currentTime>5.3);await page.$eval('#player',n=>n.pause());await page.screenshot({path:join(evidence,`${label}-ui.png`)});const r=JSON.parse(await readFile(join(out,'render-report.json'),'utf8'));assert.equal(r.totalFrames,600);await record(`export_${label}`,{exportId:id,elapsedSeconds:r.elapsedSeconds,verification:r.verification,engineHash:r.software.engineHash});return out;}
  await page.click('[data-scene-id="first-pour"]');await idle();const original=await exportUI('original');
  const alternate=Object.entries(initial.assets).find(([,a])=>a.name==='first-drops.mp4')[0];await page.select('#scene-asset',alternate);const beforePreview=await readFile(file);
  await page.click('#preview-scene');await page.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('Предпросмотр готов')||document.querySelector('#notice').classList.contains('error'),{timeout:120000});await idle();assert.match(await page.$eval('#notice',n=>n.textContent),/^Предпросмотр готов/);assert.ok((await readFile(file)).equals(beforePreview));await page.$eval('#scene-preview',async n=>{await n.play();});await page.waitForFunction(()=>document.querySelector('#scene-preview').currentTime>.3);await page.$eval('#scene-preview',n=>n.pause());await record('installed_unsaved_preview_plays');
  await page.click('#save-scene');await page.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('Сохранено'));await idle();const changed=await exportUI('changed');
  assert.equal((await disk()).scenes[1].asset,alternate);assert.deepEqual(await sources(),beforeHashes);
  await page.click('#restore-scene');await page.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('Сохранено'));await idle();const restored=await exportUI('restored');assert.equal((await disk()).scenes[1].asset,initial.scenes[1].asset);assert.deepEqual(await sources(),beforeHashes);
  await browser.close();browser=undefined;server.kill();server=undefined;
  const frames=[];for(const label of ['original','changed','restored']){const video=join(evidence,`${label}.mp4`);await cliRun(['verify',video],`verify-${label}`);const r=await run(doctor.ffmpeg.path,['-v','error','-threads','1','-i',video,'-map','0:v:0','-f','framemd5','-']);await writeFile(join(evidence,`${label}.framemd5`),r.stdout);frames.push(r.stdout.split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>l.split(',').at(-1).trim()));}
  assert.equal(frames[0].length,600);assert.deepEqual(frames[0],frames[2]);const changedIndices=frames[0].flatMap((v,i)=>v===frames[1][i]?[]:[i]);assert.deepEqual(changedIndices,Array.from({length:210},(_,i)=>i+90));await record('full_resolution_frame_hashes',{changedScene2:210,otherFramesIdentical:390,restoredFramesIdentical:600});await record('all_sources_preserved',beforeHashes);
  const selected=await run(doctor.ffmpeg.path,['-v','error','-threads','1','-filter_threads','1','-i',join(evidence,'original.mp4'),'-vf','select=eq(n\\,45)+eq(n\\,195)+eq(n\\,390)+eq(n\\,540)','-fps_mode','vfr','-an','-f','framemd5','-']);
  const selectedHashes=selected.stdout.split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>l.split(',').at(-1).trim());assert.deepEqual(selectedHashes,[45,195,390,540].map(i=>frames[0][i]));await record('real_footage_global_frame_selection',{frames:[45,195,390,540],matched:true});
  // Verify portable relative paths; exported sources do not point back to a checkout.
  for(const asset of Object.values(await disk().then(m=>m.assets)))assert.ok(asset.path.startsWith('assets/')&&!asset.path.includes('..'));
  assert.deepEqual(report.consoleErrors,[]);await record('installed_ui_no_uncaught_errors');
  await writeFile(join(evidence,'exports.json'),JSON.stringify({original,changed,restored,project:file},null,2));
  report.status='passed';await writeFile(join(evidence,'verification.json'),JSON.stringify(report,null,2));
}catch(error){report.status='failed';report.failure=error.stack;await writeFile(join(evidence,'verification.json'),JSON.stringify(report,null,2));throw error;}
finally{await browser?.close();server?.kill();}
