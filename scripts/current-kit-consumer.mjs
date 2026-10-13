import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,cp,readdir,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute,sep,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {openKitStudio} from './kit-studio-process.mjs';
import {safeError} from './kit-ui-observer.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const omitted=part=>['.cache','.studio','.git','node_modules','.agents','.claude','.render.lock'].includes(part)||part.endsWith('.edit-lock')||part.startsWith('.session')||part.startsWith('.tmp-');
async function inventory(directory){
  const result={};
  async function walk(folder){for(const entry of await readdir(folder,{withFileTypes:true})){
    if(omitted(entry.name))continue;
    const path=join(folder,entry.name);assert.equal(entry.isSymbolicLink(),false);
    if(entry.isDirectory())await walk(path);else if(entry.isFile())result[relative(directory,path).split(sep).join('/')]=hash(await readFile(path));
  }}
  await walk(directory);return result;
}

/** Minimal final route in the already installed kit consumer. No npm/model/provider run. */
export async function verifyCurrentKitWorkflow({app,workspace,evidence,cliRun,page}){
  await mkdir(evidence,{recursive:true});
  const report={status:'running',sourceCheckoutImports:0,outsideCheckout:true,spaceAndCyrillicPath:true,productionNetworkRequests:0,modelSessions:0,humanArtisticAcceptance:'NOT RUN',commands:[]};
  const save=()=>writeFile(join(evidence,'verification.json'),JSON.stringify(report,null,2)+'\n');
  let studio,primaryError;
  const errors=[],onError=()=>errors.push('pageerror');page.on('pageerror',onError);
  try{
  const packagePath=await realpath(app),workspacePath=await realpath(workspace),inside=relative(workspacePath,packagePath);
  assert.ok(inside&&!inside.startsWith('..')&&!isAbsolute(inside));assert.match(workspacePath,/ /);assert.match(workspacePath,/[А-Яа-я]/);
  const load=name=>import(pathToFileURL(join(packagePath,'dist',`${name}.js`)));
  const {createProject,readProject,editProject,importMedia,acceptGeneratedTake,generatedTakeRequestHash}=await load('project');
  const {findTools,runProcess}=await load('runtime');
  const tools=findTools(),cli=join(packagePath,'dist/cli.js'),film=join(workspace,'Новый фильм E3 E4');
  const file=(await createProject(film,{aspect:'16:9',title:'Own synthetic transfer fixture'})).project;
  const source=join(film,'own-synthetic.mp4');
  await runProcess(tools.ffmpeg,['-v','error','-f','lavfi','-i','color=c=0x285678:s=320x180:r=30:d=2','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
  await writeFile(join(film,'CREDITS.md'),'# Own synthetic fixture\n\nColor frames and sine tone generated locally with FFmpeg for technical verification. No external media, model, provider or human performance. Original project fixture.\n',{flag:'wx'});
  const imported=await importMedia(file,'own-synthetic.mp4',await readFile(source)),asset=imported.importedId;
  await editProject(file,{type:'batch',actions:[{type:'remove-scene',sceneId:'opening'},{type:'add-scene',scene:{id:'source',type:'video',asset,durationFrames:30,trimStartSeconds:0,fit:'contain',sourceAudio:{enabled:true,gainDb:-12}}},{type:'music',provider:'procedural',gainDb:-12}]});
  const beforeReceipt=await readProject(file),draft={sceneId:'source',candidateSha256:hash(await readFile(source)),baseEtag:beforeReceipt.etag,trimStartSeconds:0,fit:'contain',focalPoint:{x:.5,y:.5}};
  const acceptedReceipt=await acceptGeneratedTake(file,{...draft,operationId:'synthetic-transfer-receipt',requestHash:generatedTakeRequestHash(draft),candidatePath:'own-synthetic.mp4'},beforeReceipt.etag);
  assert.equal(acceptedReceipt.manifest.operationReceipts.length,1);
  report.receiptFixture='Native accepted receipt for a locally generated controlled clip; no model/provider invocation';
  const baseline=await cliRun(['render',file,'--out','current-baseline','--no-cache'],'current baseline render');assert.equal(baseline.totalFrames,30);assert.equal(baseline.studioExport.status,'registered');
  const before=await readProject(file),beforeBytes=await readFile(file),sceneId=`composition-${randomUUID()}`,objectId=`object-${randomUUID()}`;
  const request={styleId:'editorial',version:1,mode:'create',sceneId,objectId,text:'Новый текст',groups:['layout','typography','motion'],roles:{[objectId]:'headline'}};
  const requestPath=join(workspace,'current-style-request.json');await writeFile(requestPath,JSON.stringify(request,null,2)+'\n',{flag:'wx'});
  const catalog=await cliRun(['styles'],'current styles catalog');assert.deepEqual(catalog.packages.map(item=>item.id),['calm-product','kinetic-poster','editorial']);
  const compiled=await cliRun(['style-compile',file,'--request',requestPath,'--if-match',before.etag,'--out','current-style-action.json'],'current style compile');
  const preview=await cliRun(['style-preview',file,'--request',requestPath,'--if-match',before.etag,'--out','current-style-preview'],'current style preview');
  assert.equal(preview.stale,false);assert.equal(preview.totalFrames,120);assert.equal(preview.verification.audio.codec,'aac');assert.deepEqual(preview.action,compiled.action);assert.deepEqual(await readFile(file),beforeBytes);
  const created=await cliRun(['edit',file,'--action',preview.actionFile,'--if-match',preview.projectHash],'current style native apply');assert.equal(created.manifest.history.length,before.manifest.history.length+1);assert.deepEqual(created.manifest.operationReceipts,before.manifest.operationReceipts);
    studio=await openKitStudio({cli,workspace,file,report,label:'current-style-open'});
    await page.goto(studio.url,{waitUntil:'networkidle0'});await page.waitForSelector(`[data-scene-id="${sceneId}"]`);await page.click(`[data-scene-id="${sceneId}"]`);
    const ready=()=>page.waitForFunction(()=>!document.querySelector('#object-editor').hidden&&!document.querySelector('#visual-x').disabled&&document.querySelector('#stage').dataset.rendered===document.querySelector('#stage').dataset.renderRequest);
    await ready();const beforeRestyle=await readProject(file);
    await page.click('#style-restyle');await page.waitForSelector('#style-dialog[open]');await page.select('#style-choice','kinetic-poster');
    await page.select(`[data-style-object="${objectId}"] [data-style-role]`,'headline');await page.click('[data-style-group=""][value="typography"]');
    await page.click('#style-preview');await page.waitForFunction(()=>!document.querySelector('#style-apply').disabled,{timeout:90000});await page.click('#style-apply');await ready();
    const restyled=await readProject(file);assert.equal(restyled.manifest.history.length,beforeRestyle.manifest.history.length+1);assert.deepEqual(restyled.manifest.operationReceipts,before.manifest.operationReceipts);
    const styledScene=structuredClone(restyled.manifest.scenes.find(scene=>scene.id===sceneId));
    await page.$eval('#visual-text',node=>{node.value='Installed point edit';node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));});
    await page.click('#preview-scene');await page.waitForFunction(()=>!document.querySelector('#save-scene').disabled);await page.click('#save-scene');await ready();
    assert.equal((await readProject(file)).manifest.scenes.find(scene=>scene.id===sceneId).objects[0].text,'Installed point edit');
    const exported=await cliRun(['render',file,'--out','current-changed','--no-cache'],'current changed export');assert.equal(exported.totalFrames,150);assert.equal(exported.verification.audio.codec,'aac');assert.equal(exported.studioExport.status,'registered');
    await editProject(file,{type:'restore-scene',sceneId,revisionId:restyled.manifest.revision},(await readProject(file)).etag);assert.deepEqual((await readProject(file)).manifest.scenes.find(scene=>scene.id===sceneId),styledScene);
    const retained=await readProject(file),retainedID=retained.manifest.revision;
    for(let index=0;index<20;index++){
      const state=await readProject(file),scene=state.manifest.scenes.find(scene=>scene.id===sceneId),objects=structuredClone(scene.objects);objects[0].fontSize=86+index%2;
      await editProject(file,{type:'edit-scene',sceneId,patch:{objects}},state.etag);
    }
    const movedState=await readProject(file);assert.equal(movedState.manifest.history.some(revision=>revision.id===retainedID),false,'chosen retained revision must be evicted from inline cache');
    const snapshotPath=`.history/${retainedID}.json`,snapshot=await readFile(join(film,snapshotPath));assert.equal(JSON.parse(snapshot).id,retainedID);
    const originalInventory=await inventory(film);assert.ok(Object.keys(originalInventory).some(name=>name.startsWith('exports/')));assert.ok(Object.keys(originalInventory).some(name=>name.startsWith('assets/')));assert.ok(originalInventory['CREDITS.md']);assert.ok(originalInventory[snapshotPath]);
    const beforeTransfer=await readFile(file);assert.equal(hash(beforeTransfer),originalInventory['project.json']);assert.equal(hash(beforeTransfer),movedState.etag);
    await writeFile(join(evidence,'before-transfer-project.json'),beforeTransfer,{flag:'wx'});
    report.beforeTransfer={file:'before-transfer-project.json',sha256:hash(beforeTransfer),etag:movedState.etag,retainedRevisionId:retainedID,absentInline:true};
    const transfer=join(workspace,'Перенос полного проекта');await cp(film,transfer,{recursive:true,errorOnExist:true,force:false,filter:path=>!relative(film,path).split(sep).some(omitted)});
    assert.deepEqual(await inventory(transfer),originalInventory);const transferredFile=join(transfer,'project.json');
    assert.equal((await readProject(transferredFile)).etag,movedState.etag);assert.equal((await readProject(transferredFile)).manifest.history.some(revision=>revision.id===retainedID),false);
    const restored=await editProject(transferredFile,{type:'restore',revisionId:retainedID},movedState.etag);assert.deepEqual(restored.manifest.scenes,retained.manifest.scenes);assert.deepEqual(restored.manifest.operationReceipts,retained.manifest.operationReceipts);
    const transferredInventory=await inventory(transfer);
    for(const [name,sha] of Object.entries(originalInventory))if(name.startsWith('assets/')||name.startsWith('exports/')||name.startsWith('.history/')||name==='own-synthetic.mp4'||name==='CREDITS.md')assert.equal(transferredInventory[name],sha,name);
    assert.equal(hash(await readFile(join(transfer,snapshotPath))),hash(snapshot));
    await studio.close();studio=await openKitStudio({cli,workspace,file:transferredFile,report,label:'current-transferred-reopen'});await page.goto(studio.url,{waitUntil:'networkidle0'});await page.waitForFunction(()=>document.querySelector('#exports').options.length===2);
    assert.equal((await readProject(transferredFile)).etag,restored.etag);assert.deepEqual(errors,[]);
    assert.deepEqual(await inventory(film),originalInventory,'original private project retained unchanged');
    await cp(transfer,join(evidence,'transferred-project'),{recursive:true,errorOnExist:true,force:false,filter:path=>!relative(transfer,path).split(sep).some(omitted)});
    await cp(join(workspace,'current-style-preview'),join(evidence,'style-preview'),{recursive:true,errorOnExist:true,force:false});
    await page.screenshot({path:join(evidence,'transferred-reopen.png')});
    Object.assign(report,{status:'PASS',installedStyleCompilePreviewNativeApply:true,styleStudioRestyle:true,ordinaryObjectPointEdit:true,audioPreviewAndExport:true,nativeRestoreNewSessionReopen:true,acceptedExportCount:2,externalHistory:{revisionId:retainedID,absentInline:true,snapshotSHA256:hash(snapshot),restoredAfterTransfer:true},originalPrivateProjectPreserved:true,receipts:restored.manifest.operationReceipts,sourceAndExportHashes:Object.fromEntries(Object.entries(originalInventory).filter(([name])=>name.startsWith('assets/')||name.startsWith('exports/')||name==='CREDITS.md')),originalFiles:originalInventory,transferredBeforeRestoreFiles:originalInventory});
  }catch(error){primaryError=error;report.status='FAIL';report.error=safeError(error);}
  finally{
    page.off('pageerror',onError);
    try{await studio?.close();}catch(error){report.status='FAIL';report.cleanupError=safeError(error);primaryError??=error;}
    try{await save();}catch(error){primaryError??=error;}
  }
  if(primaryError)throw primaryError;
  return report;
}
