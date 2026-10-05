import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createProject, importMedia, editProject, readProject } from '../../dist/project.js';
import { startStudio } from '../../dist/server.js';
import { launchBrowser, findTools, runProcess } from '../../dist/runtime.js';
import { render } from '../../dist/engine.js';

test('unsaved UI scene previews match full export frames for trim, crop, contain and motion', { timeout: 240000 }, async () => {
  const root = resolve('artifacts/iteration-2/preview', String(Date.now())); await mkdir(root, { recursive: true });
  const file = (await createProject(root)).project, tools = findTools(), cases = [], errors = [];
  await runProcess(tools.ffmpeg, ['-y','-v','error',...['red','green','blue'].flatMap(c => ['-f','lavfi','-i',`color=c=${c}:s=160x90:r=24:d=1`]),'-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-color_range','tv','-colorspace','bt470bg',join(root,'colors.mp4')]);
  await runProcess(tools.ffmpeg, ['-y','-v','error','-f','lavfi','-i','color=c=red:s=200x100:r=25:d=1,drawbox=x=100:y=0:w=100:h=100:color=blue:t=fill','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-color_range','tv','-colorspace','bt470bg',join(root,'split.mp4')]);
  const colors = await importMedia(file, 'colors.mp4', await readFile(join(root,'colors.mp4'))), split = await importMedia(file, 'split.mp4', await readFile(join(root,'split.mp4')));
  await editProject(file, { type:'edit-scene',sceneId:'opening',patch:{durationFrames:30} });
  await editProject(file, { type:'add-scene',scene:{id:'trim-test',type:'video',asset:colors.importedId,durationFrames:60,trimStartSeconds:0} });
  await editProject(file, { type:'add-scene',scene:{id:'crop-test',type:'video',asset:split.importedId,durationFrames:30,fit:'cover'} });
  const studio = await startStudio(file, 0), browser = await launchBrowser(tools.chrome), page = await browser.newPage(); let closed = false;
  const idle = () => page.waitForFunction(() => !document.querySelector('#reload').disabled);
  const fill = (id, value) => page.$eval(`#${id}`, (n,v) => {n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));},String(value));
  const hashes = async path => { const r = await runProcess(tools.ffmpeg,['-v','error','-threads','1','-i',path,'-map','0:v:0','-f','framemd5','-']); return r.stdout.split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>l.split(',').at(-1).trim()); };
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setViewport({width:1440,height:1100}); await page.goto(studio.url,{waitUntil:'networkidle0'});
    async function preview(name,sceneId,start,count) {
      const before = await readFile(file); await page.click('#preview-scene');
      await page.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('Предпросмотр готов')||document.querySelector('#notice').classList.contains('error'),{timeout:90000}); await idle();
      assert.match(await page.$eval('#notice',n=>n.textContent),/^Предпросмотр готов/);
      assert.ok((await readFile(file)).equals(before),'preview must not write accepted project or history');
      const url = await page.$eval('#scene-preview',n=>n.src), cookies=await page.cookies();
      const bytes = await fetch(url,{headers:{Cookie:cookies.map(c=>`${c.name}=${c.value}`).join('; ')}}); assert.equal(bytes.status,200);
      const output=join(root,`${name}-preview.mp4`); await writeFile(output,Buffer.from(await bytes.arrayBuffer()));
      await page.$eval('#scene-preview',async n=>{n.currentTime=.3;await n.play();}); await page.waitForFunction(()=>document.querySelector('#scene-preview').currentTime>.5); await page.$eval('#scene-preview',n=>n.pause());
      await page.screenshot({path:join(root,`${name}-ui.png`)});
      await page.click('#save-scene'); await page.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('Сохранено')); await idle();
      const manifest=join(root,`${name}-project.json`);await copyFile(file,manifest); cases.push({name,sceneId,start,count,output,manifest});
    }
    await page.click('[data-scene-id="trim-test"]');await idle();await fill('trim',1);await preview('trim','trim-test',30,60);
    await editProject(file,{type:'composition',video:{aspectRatio:'9:16',fps:30,style:'kinetic'}});await page.click('#reload');await idle();
    await page.click('[data-scene-id="crop-test"]');await idle();await fill('focal-x',1);await preview('cover','crop-test',90,30);
    await page.select('#fit','contain');await preview('contain','crop-test',90,30);
    await page.click('[data-scene-id="opening"]');await idle();await fill('scene-text','PREVIEW');await preview('motion','opening',0,30);
    // A stale preview must enter the same conflict flow without rendering/writing.
    await fill('duration',2);await editProject(file,{type:'edit-scene',sceneId:'opening',patch:{text:'EXTERNAL'}});await page.click('#preview-scene');await page.waitForFunction(()=>document.querySelector('#conflict-dialog').open);await idle();
    assert.equal((await readProject(file)).manifest.scenes[0].text,'EXTERNAL');await page.click('#conflict-external');await idle();
    assert.deepEqual(errors,[]);await browser.close();closed=true;
    for (const item of cases) { const out=join(root,`${item.name}-export`);await render(item.manifest,out,{noCache:true});const clip=await hashes(item.output),full=await hashes(join(out,'output.mp4'));assert.equal(clip.length,item.count);assert.deepEqual(clip,full.slice(item.start,item.start+item.count));item.exactDecodedFrameMatches=clip.length;
      const chosen=await runProcess(tools.ffmpeg,['-v','error','-threads','1','-i',join(out,'output.mp4'),'-vf','select=eq(n\\,15)+eq(n\\,45)+eq(n\\,105)','-fps_mode','vfr','-an','-f','framemd5','-']);
      const chosenHashes=chosen.stdout.split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>l.split(',').at(-1).trim());assert.deepEqual(chosenHashes,[full[15],full[45],full[105]],'frame selection must not reset on motion/video boundaries');
    }
    // Independent colour assertions prevent two identically wrong paths passing.
    const trimRaw=join(root,'trim.rgb');await runProcess(tools.ffmpeg,['-y','-v','error','-i',cases[0].output,'-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo',trimRaw]);const rgb=await readFile(trimRaw);
    for(let i=0;i<60;i++){const [r,g,b]=rgb.subarray(i*3,i*3+3);assert.ok(i<30?g>110&&r<15&&b<15:b>235&&r<15&&g<15);}
    assert.equal((await readdir(root)).some(n=>n.startsWith('.preview-')),false);
    await writeFile(join(root,'verification.json'),JSON.stringify({passed:true,cases,checks:['no accepted writes from preview','same full-resolution decoded frames','30 green then 30 blue frames','real muted browser playback','stale preview conflict','temporary manifests cleaned'],errors},null,2));
  } finally {if(!closed) await browser.close();await studio.close();}
});
