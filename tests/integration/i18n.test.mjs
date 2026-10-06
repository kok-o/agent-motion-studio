import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProject, editProject, readProject } from '../../dist/project.js';
import { startStudio } from '../../dist/server.js';
import { findTools, launchBrowser } from '../../dist/runtime.js';

test('RU/EN UI saves preference, preserves drafts on language switch and completes preview/edit/export/restore', {timeout:180000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'ams-i18n-')),file=(await createProject(root)).project;
  await editProject(file,{type:'edit-scene',sceneId:'opening',patch:{durationFrames:30,text:'Original',label:'Исходная подпись'}});
  const studio=await startStudio(file,0),browser=await launchBrowser(findTools().chrome),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(studio.url);await page.waitForSelector('.scene-card');
    const bytes=await readFile(file);
    await page.$eval('#scene-text',e=>{e.value='DRAFT';e.dispatchEvent(new Event('input',{bubbles:true}));});
    for(const language of ['ru','en']){
      await Promise.all([page.waitForNavigation(),page.select('#language',language)]);await page.waitForSelector('.scene-card');
      assert.equal(await page.$eval('html',e=>e.lang),language);assert.equal(await page.$eval('#language',e=>e.value),language);
      assert.equal(await page.$eval('#scene-text',e=>e.value),'DRAFT');assert.ok((await readFile(file)).equals(bytes));
      assert.equal(await page.$eval('#save-scene',e=>e.textContent),language==='ru'?'Сохранить сцену':'Save scene');
      assert.match(await page.$eval('#stats',e=>e.textContent),language==='ru'?/сцены/:/scenes/);
      assert.equal(await page.$eval('#draft-status',e=>e.textContent),language==='ru'?'Есть несохранённые изменения':'Unsaved changes');
      await page.screenshot({path:join(root,`${language}.png`)});
    }
    page.once('dialog',dialog=>dialog.accept());await page.reload();await page.waitForSelector('.scene-card');assert.equal(await page.$eval('html',e=>e.lang),'en');
    await page.click('#preview-scene');await page.waitForFunction(()=>!document.querySelector('#scene-preview').hidden&&!document.querySelector('#save-scene').disabled);assert.ok((await readFile(file)).equals(bytes));
    assert.match(await page.$eval('#preview-status',e=>e.textContent),/Preview ready/);
    await page.click('#save-scene');await page.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('Saved to'));assert.equal((await readProject(file)).manifest.scenes[0].text,'DRAFT');
    await page.click('#export');await page.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('MP4 ready'),{timeout:90000});
    assert.match(await page.$eval('#download',e=>e.textContent),/Download MP4/);
    await page.click('#restore-scene');await page.waitForFunction(()=>document.querySelector('#scene-text').value==='Original');
    await Promise.all([page.waitForNavigation(),page.select('#language','ru')]);await page.waitForSelector('.scene-card');
    await page.$eval('#scene-text',e=>{e.value='Новая сцена';e.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.click('#preview-scene');await page.waitForFunction(()=>!document.querySelector('#scene-preview').hidden&&!document.querySelector('#save-scene').disabled);
    assert.match(await page.$eval('#preview-status',e=>e.textContent),/Предпросмотр готов/);
    await page.click('#save-scene');await page.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('Сохранено'));
    await page.click('#export');await page.waitForFunction(()=>document.querySelector('#notice').textContent.startsWith('MP4 готов'),{timeout:90000});
    await page.click('#restore-scene');await page.waitForFunction(()=>document.querySelector('#scene-text').value==='Original');
    assert.deepEqual(errors,[]);console.log(`RU/EN evidence: ${root}`);
  }finally{await browser.close();await studio.close();}
});
