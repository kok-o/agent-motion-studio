import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createProject, readProject, editProject } from '../../dist/project.js';
import { loadManifest } from '../../dist/spec.js';
import { findTools } from '../../dist/runtime.js';
import { openRenderer } from '../../dist/browser.js';
import { previewScene } from '../../dist/preview.js';
import { render } from '../../dist/engine.js';
import { runProcess } from '../../dist/runtime.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('composition pixels, unsaved preview, accepted edit, shortening and restore use the same renderer',async()=>{
  const root=resolve('.cache/tests',randomUUID()),file=join(root,'project.json');
  await createProject(root,{aspect:'9:16'}); let renderer;
  try {
    let state=await readProject(file);
    state=await editProject(file,{type:'batch',actions:[{type:'remove-scene',sceneId:'opening'},{type:'add-scene',scene:{id:'shot',type:'composition',durationFrames:60,objects:[
      {id:'panel',type:'shape',shape:'rect',x:80,y:600,width:800,height:300,color:'accent',keyframes:[{frame:15,x:120}]},
      {id:'copy',type:'text',text:'Найденная строка',x:130,y:690,width:700,height:100,fontSize:50,color:'background'}
    ]}}]},state.etag);
    const baseline=state.manifest.revision, bytes=await readFile(file);
    renderer=await openRenderer(await loadManifest(file),findTools().chrome);
    const samples=new Map(); for(const n of [0,10,29]) samples.set(n,hash(await renderer.frame(n)));
    for(const n of [29,0,10]) assert.equal(hash(await renderer.frame(n)),samples.get(n));
    assert.notEqual(samples.get(0),samples.get(29)); await renderer.finish(); renderer=undefined;
    const objects=structuredClone(state.manifest.scenes[0].objects); objects[1].text='Текст после правки';
    const action={type:'edit-scene',sceneId:'shot',patch:{objects}};
    const out=join(root,'preview'); await mkdir(out);
    const preview=await previewScene(file,action,state.etag,out);
    assert.equal(preview.stale,false); assert.deepEqual(await readFile(file),bytes);
    state=await editProject(file,action,preview.projectHash);
    await render(file,join(root,'accepted'));
    const tools=findTools();
    const decoded=async path=>(await runProcess(tools.ffmpeg,['-v','error','-i',path,'-map','0:v:0','-f','framemd5','-'])).stdout.split('\n').filter(s=>!s.startsWith('#')&&s.trim()).map(s=>s.split(',').at(-1).trim());
    assert.deepEqual(await decoded(join(out,'output.mp4')),await decoded(join(root,'accepted/output.mp4')));
    await assert.rejects(editProject(file,{type:'edit-scene',sceneId:'shot',patch:{objects:[objects[0],objects[0]]}},state.etag),/duplicate/i);
    assert.equal((await readProject(file)).etag,state.etag);
    state=await editProject(file,{type:'edit-scene',sceneId:'shot',patch:{durationFrames:30,objects:objects.map(o=>o.id==='panel'?{...o,keyframes:[{frame:40,x:240}]}:o)}},state.etag);
    assert.equal(state.manifest.scenes[0].durationFrames,30);
    state=await editProject(file,{type:'restore',revisionId:baseline},state.etag);
    assert.equal(state.manifest.scenes[0].durationFrames,60);
    assert.deepEqual(state.manifest.scenes[0].objects,JSON.parse(bytes).scenes[0].objects);
    renderer=await openRenderer(await loadManifest(file),tools.chrome);
    for(const n of [0,10,29]) assert.equal(hash(await renderer.frame(n)),samples.get(n)); await renderer.finish(); renderer=undefined;
    const bad=structuredClone(state.manifest);bad.scenes[0].objects[1].width=10;
    const invalid=join(root,'invalid.json');await writeFile(invalid,JSON.stringify(bad));
    await assert.rejects(openRenderer(await loadManifest(invalid),tools.chrome),/TEXT_OVERFLOW/);
    // Same composition primitives also render at the second supported aspect.
    state=await editProject(file,{type:'composition',video:{aspectRatio:'16:9',fps:30,style:'studio'}},state.etag);
    renderer=await openRenderer(await loadManifest(file),tools.chrome); assert.ok((await renderer.frame(10)).length>1000);
  } finally {await renderer?.finish();await rm(root,{recursive:true,force:true});}
});
