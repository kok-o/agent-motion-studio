import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createProject,readProject} from '../../dist/project.js';
import {startStudio} from '../../dist/server.js';
import {request as httpRequest} from 'node:http';

test('style routes keep session/Origin/Host/ETag and exact action/ticket guards separate from visual edits',{timeout:120000},async()=>{
  const root=resolve('artifacts/style-server',process.env.AMS_STYLE_RUN_ID||randomUUID());await mkdir(root,{recursive:true});
  const file=(await createProject(join(root,'film'))).project,studio=await startStudio(file,0),url=new URL(studio.url),origin=url.origin;
  let cookie;const state=await readProject(file),before=await readFile(file),request={styleId:'editorial',version:1,mode:'create',sceneId:'created-style',objectId:'created-text',text:'New text',groups:['layout','typography','motion'],roles:{'created-text':'headline'}};
  const post=(path,value,extra={})=>fetch(new URL(path,origin),{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','If-Match':state.etag,...(cookie?{Cookie:cookie}:{}),...extra},body:JSON.stringify(value)});
  const failures=[];
  async function rejected(path,value,extra,code){const result=await post(path,value,extra);assert.ok(result.status>=400);const body=await result.json();if(code)assert.equal(body.error.code,code);assert.ok((await readFile(file)).equals(before));failures.push({path,status:result.status,code:body.error?.code??'access boundary'});}
  try{
    assert.equal((await fetch(new URL('/api/styles',origin))).status,401);await rejected('/api/styles/preview',{request},{});
    const auth=await post('/api/session',{token:url.hash.slice(1)});assert.equal(auth.status,200);cookie=auth.headers.get('set-cookie').split(';')[0];
    await rejected('/api/styles/preview',{request},{Origin:'https://invalid.example'});
    const rejectedHost=await new Promise((resolve,reject)=>{const call=httpRequest(new URL('/api/styles/preview',origin),{method:'POST',headers:{Origin:origin,Host:'invalid.example',Cookie:cookie,'Content-Type':'application/json','If-Match':state.etag}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});call.on('error',reject);call.end(JSON.stringify({request}));});
    assert.equal(rejectedHost,403);assert.ok((await readFile(file)).equals(before));failures.push({path:'/api/styles/preview',status:403,code:'Host access boundary'});
    await rejected('/api/styles/preview',{request},{'If-Match':'bad'},'VISUAL_INPUT');await rejected('/api/styles/preview',{request},{'If-Match':'a'.repeat(64)},'PROJECT_CONFLICT');
    await rejected('/api/styles/preview',{request,extra:true},{},'STYLE_INPUT');await rejected('/api/styles/preview',{request:{...request,version:2}},{},'STYLE_INPUT');
    const reply=await post('/api/styles/preview',{request});assert.equal(reply.status,200);const preview=await reply.json();assert.equal(preview.stale,false);assert.ok(preview.previewId);assert.ok((await readFile(file)).equals(before));
    await rejected('/api/styles/apply',{previewId:preview.previewId,request,action:{...preview.action,scene:{...preview.action.scene,durationFrames:121}}},{},'STYLE_INPUT');
    await rejected('/api/styles/apply',{previewId:'missing',request,action:preview.action},{},'STYLE_PREVIEW_REQUIRED');
    await rejected('/api/styles/apply',{previewId:preview.previewId,request:{...request,motion:'reduced'},action:preview.action},{},'STYLE_INPUT');
    // The old visual endpoint never gains arbitrary scene-style permissions.
    await rejected('/api/visual/apply',preview.action,{},'VISUAL_INPUT');
    const accepted=await post('/api/styles/apply',{previewId:preview.previewId,request,action:preview.action});assert.equal(accepted.status,200);const result=await accepted.json();assert.equal(result.committed,true);assert.equal(result.manifest.history.length,state.manifest.history.length+1);
    const acceptedBytes=await readFile(file),again=await post('/api/styles/apply',{previewId:preview.previewId,request,action:preview.action},{'If-Match':result.etag});assert.ok(again.status>=400);assert.ok((await readFile(file)).equals(acceptedBytes));
    await writeFile(join(root,'verification.json'),JSON.stringify({status:'PASS',failures,acceptedOnce:true,repeatNoMutation:true,singleObjectVisualGuardPreserved:true,humanArtisticAcceptance:'NOT RUN'},null,2)+'\n');
  }finally{await studio.close();}
});
