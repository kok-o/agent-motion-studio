import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import filesystem from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createProject,editProject,readProject} from '../../dist/project.js';
import {startStudio} from '../../dist/server.js';
import {findTools,launchBrowser,runProcess} from '../../dist/runtime.js';
import {openKitStudio} from '../../scripts/kit-studio-process.mjs';

const root=resolve('artifacts/style-ui',process.env.AMS_STYLE_RUN_ID||randomUUID());await mkdir(root,{recursive:true});
const tools=findTools(),cli=resolve('dist/cli.js'),styles=['calm-product','kinetic-poster','editorial'];
async function fixture(aspect){
  const dir=join(root,`${aspect.replace(':','-')}-${randomUUID()}`);await mkdir(dir);
  const file=(await createProject(join(dir,'film'),{aspect,title:'Preserved neighbour'})).project;
  await editProject(file,{type:'edit-scene',sceneId:'opening',patch:{durationFrames:30}});
  return {dir,file};
}
const ready=page=>page.waitForFunction(()=>!document.querySelector('#object-editor').hidden&&!document.querySelector('#visual-x').disabled&&document.querySelector('#stage').dataset.rendered===document.querySelector('#stage').dataset.renderRequest);
const styleReady=page=>page.waitForFunction(()=>!document.querySelector('#style-player').hidden&&!document.querySelector('#style-apply').disabled,{timeout:90000});
async function field(page,selector,value){await page.$eval(selector,(node,value)=>{node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},String(value));}
async function createIntent(page,style){await page.click('#style-create');await page.waitForSelector('#style-dialog[open]');await page.select('#style-choice',style);return page.$eval('#style-dialog',node=>({...node.dataset}));}
async function restyleOptions(page,style,objectId){
  await page.click('#style-restyle');await page.waitForSelector('#style-dialog[open]');await page.select('#style-choice',style);
  await page.select(`[data-style-object="${objectId}"] [data-style-role]`,'headline');
  for(const group of ['layout','typography','motion'])await page.click(`[data-style-group=""][value="${group}"]`);
  await page.click('#style-replace-tracks');
  await page.select(`[data-style-object="${objectId}"] [data-style-locks]`,'color');
}
for(const aspect of ['16:9','9:16'])for(const [index,style] of styles.entries())test(`real Studio styled create/restyle, cancel, point edit, restore/reopen: ${style} ${aspect}`,{timeout:240000},async()=>{
  const {dir,file}=await fixture(aspect),studio=await startStudio(file,0),browser=await launchBrowser(tools.chrome),page=await browser.newPage(),errors=[],posts=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{const path=new URL(request.url()).pathname;if(request.method()==='POST'&&['/api/styles/apply','/api/edit','/api/visual/apply'].includes(path))posts.push({path,body:JSON.parse(request.postData())});});
  try{
    await page.setViewport({width:1440,height:1200});await page.evaluateOnNewDocument(value=>localStorage.setItem('ams-language',value),aspect==='16:9'?'ru':'en');
    await page.goto(studio.url,{waitUntil:'networkidle0'});await page.waitForFunction(()=>!document.querySelector('#style-create').disabled);
    assert.equal(await page.$eval('#style-create',node=>node.textContent),aspect==='16:9'?'+ Композиция со стилем':'+ Styled composition');
    const before=await readProject(file),bytes=await readFile(file),cancelled=await createIntent(page,style);
    await page.click('#style-preview');await styleReady(page);assert.ok((await readFile(file)).equals(bytes));await page.click('#style-cancel');assert.ok((await readFile(file)).equals(bytes));assert.equal(posts.length,0);
    const intent=await createIntent(page,style);assert.notEqual(intent.sceneId,cancelled.sceneId);await page.click('#style-preview');await styleReady(page);
    // Any parameter change removes Apply permission until a fresh preview.
    await page.select('#style-motion','reduced');assert.equal(await page.$eval('#style-apply',node=>node.disabled),true);
    await page.click('#style-preview');await styleReady(page);await page.click('#style-apply');await ready(page);
    const created=await readProject(file),scene=created.manifest.scenes.at(-1),createdBytes=await readFile(file);
    assert.equal(scene.id,intent.sceneId);assert.equal(scene.objects[0].id,intent.objectId);assert.equal(scene.durationFrames,120);assert.equal(scene.objects[0].text,aspect==='16:9'?'Новый текст':'New text');
    assert.equal(created.manifest.history.length,before.manifest.history.length+1);assert.deepEqual(created.manifest.scenes.slice(0,-1),before.manifest.scenes);
    for(const key of ['assets','brand','audio','video','operationReceipts'])assert.deepEqual(created.manifest[key],before.manifest[key]);
    await restyleOptions(page,styles[(index+1)%3],intent.objectId);await page.click('#style-preview');await styleReady(page);assert.ok((await readFile(file)).equals(createdBytes));await page.click('#style-cancel');assert.ok((await readFile(file)).equals(createdBytes));
    await restyleOptions(page,styles[(index+1)%3],intent.objectId);await page.click('#style-preview');await styleReady(page);
    await page.screenshot({path:join(dir,'restyle-preview.png')});await page.click('#style-apply');await ready(page);
    const styled=await readProject(file),styledScene=styled.manifest.scenes.at(-1);
    assert.equal(styled.manifest.history.length,created.manifest.history.length+1);assert.equal(styledScene.id,scene.id);assert.equal(styledScene.objects[0].id,scene.objects[0].id);assert.equal(styledScene.objects[0].color,scene.objects[0].color);assert.equal(styledScene.objects[0].text,scene.objects[0].text);assert.equal(styledScene.durationFrames,scene.durationFrames);
    assert.deepEqual(styled.manifest.scenes.slice(0,-1),before.manifest.scenes);for(const key of ['assets','brand','audio','video','operationReceipts'])assert.deepEqual(styled.manifest[key],created.manifest[key]);assert.deepEqual(styled.manifest.history.at(-1).scenes,created.manifest.scenes);
    const portraitPoster=aspect==='9:16'&&style==='calm-product';
    if(portraitPoster){
      const accepted=await readFile(file);await field(page,'#visual-text','Exact subsequent point edit');await page.click('#preview-scene');
      await page.waitForFunction(()=>document.querySelector('#visual-status').textContent.includes('TEXT_OVERFLOW'));
      assert.equal(await page.$eval('#save-scene',node=>node.disabled),true);assert.deepEqual(await readFile(file),accepted);
    }
    const pointText=portraitPoster?'Point edit':'Exact subsequent point edit';
    await field(page,'#visual-text',pointText);await ready(page);await page.click('#preview-scene');await page.waitForFunction(()=>!document.querySelector('#save-scene').disabled);await page.click('#save-scene');await ready(page);
    assert.equal((await readProject(file)).manifest.scenes.at(-1).objects[0].text,pointText);
    await page.click('#restore-scene');await page.waitForFunction(value=>document.querySelector('#visual-text').value!==value,{},pointText);await ready(page);assert.deepEqual((await readProject(file)).manifest.scenes.at(-1),styledScene);
    await page.click('#reload');await ready(page);assert.deepEqual((await readProject(file)).manifest.scenes.at(-1),styledScene);
    assert.equal(posts.filter(item=>item.path==='/api/styles/apply').length,2);assert.deepEqual(errors,[]);
    await writeFile(join(dir,'verification.json'),JSON.stringify({status:'PASS',style,aspect,createdStyle:style,restyledStyle:styles[(index+1)%3],createCancelNoWrites:true,restyleCancelNoWrites:true,parameterInvalidation:true,oneRevisionPerApply:true,pointEditRestoreReopen:true,pointEditText:pointText,oversizedTokenRefused:portraitPoster,posts,humanArtisticAcceptance:'NOT RUN'},null,2)+'\n');
  }catch(error){await writeFile(join(dir,'failure.json'),JSON.stringify({status:'FAIL',error:error.message,notice:await page.$eval('#notice',node=>node.textContent),visual:await page.$eval('#visual-status',node=>node.textContent),preview:await page.$eval('#preview-status',node=>node.textContent)},null,2)+'\n');await page.screenshot({path:join(dir,'failure.png')});throw error;}
  finally{await browser.close();await studio.close();}
});

test('style intent survives external CLI, lost reply and known postcommit failure with one POST and explicit new-session reconciliation',{timeout:240000},async()=>{
  const {dir,file}=await fixture('16:9'),browser=await launchBrowser(tools.chrome),page=await browser.newPage(),processReport={},errors=[];
  let studio=await startStudio(file,0),applyPosts=0;
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/styles/apply')applyPosts++;});
  const originalRead=filesystem.readFile,originalRename=filesystem.rename;
  try{
    await page.goto(studio.url,{waitUntil:'networkidle0'});await page.waitForFunction(()=>!document.querySelector('#style-create').disabled);
    const externalIntent=await createIntent(page,'calm-product');await page.click('#style-preview');await styleReady(page);
    const actionFile=join(dir,'external-action.json');await writeFile(actionFile,JSON.stringify({type:'edit-scene',sceneId:'opening',patch:{text:'Actual external CLI'}}));
    await runProcess(process.execPath,[cli,'edit',file,'--action',actionFile,'--if-match',(await readProject(file)).etag,'--json']);
    await page.waitForFunction(()=>!document.querySelector('#style-read').hidden);assert.equal(await page.$eval('#style-apply',node=>node.disabled),true);assert.equal(applyPosts,0);
    await page.click('#style-read');await page.waitForFunction(()=>!document.querySelector('#style-dialog').open);assert.equal((await readProject(file)).manifest.scenes.some(scene=>scene.id===externalIntent.sceneId),false);
    const lostIntent=await createIntent(page,'editorial');await page.click('#style-preview');await styleReady(page);
    let forwarded=0;await page.setRequestInterception(true);
    const interceptor=async request=>{
      if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/styles/apply'){
        forwarded++;const reply=await fetch(request.url(),{method:'POST',headers:request.headers(),body:request.postData()});assert.equal(reply.status,200);await reply.arrayBuffer();await request.abort('failed');
      }else await request.continue();
    };
    page.on('request',interceptor);
    await page.click('#style-apply');await page.waitForFunction(()=>!document.querySelector('#style-read').hidden&&!document.querySelector('#style-read').disabled);
    assert.equal(forwarded,1);assert.equal(applyPosts,1);assert.ok((await readProject(file)).manifest.scenes.some(scene=>scene.id===lostIntent.sceneId));assert.equal(await page.$eval('#style-apply',node=>node.disabled),true);
    page.off('request',interceptor);await page.setRequestInterception(false);await page.click('#style-read');await ready(page);assert.equal(applyPosts,1);
    const knownIntent=await createIntent(page,'kinetic-poster');await page.click('#style-preview');await styleReady(page);
    let committed=false,failures=0;
    filesystem.rename=async(...args)=>{const result=await originalRename(...args);if(resolve(args[1])===resolve(file))committed=true;return result;};
    filesystem.readFile=async(...args)=>{if(committed&&resolve(String(args[0]))===resolve(file)&&failures++===0)throw new Error('Controlled read failure after atomic commit');return originalRead(...args);};syncBuiltinESMExports();
    await page.click('#style-apply');await page.waitForFunction(()=>!document.querySelector('#style-read').hidden&&!document.querySelector('#style-read').disabled);
    filesystem.readFile=originalRead;filesystem.rename=originalRename;syncBuiltinESMExports();assert.equal(applyPosts,2);assert.equal(failures,1);
    const accepted=await readProject(file);assert.ok(accepted.manifest.scenes.some(scene=>scene.id===knownIntent.sceneId));
    await page.click('#style-read');await ready(page);assert.equal(applyPosts,2);
    await studio.close();studio=await openKitStudio({cli,workspace:dir,file,report:processReport,label:'style-reopen'});await page.goto(studio.url,{waitUntil:'networkidle0'});await page.waitForFunction(()=>!document.querySelector('#style-create').disabled);
    assert.equal((await readProject(file)).etag,accepted.etag);assert.equal(applyPosts,2);assert.deepEqual(errors,[]);
    await writeFile(join(dir,'verification.json'),JSON.stringify({status:'PASS',externalCLI:true,externalCancelledScene:externalIntent.sceneId,lostReplyScene:lostIntent.sceneId,knownPostcommitScene:knownIntent.sceneId,applyPosts,forwarded,newSessionReopen:true,processReport,humanArtisticAcceptance:'NOT RUN'},null,2)+'\n');
  }finally{filesystem.readFile=originalRead;filesystem.rename=originalRename;syncBuiltinESMExports();await browser.close();await studio.close();}
});
