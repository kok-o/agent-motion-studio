import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createProject, readProject, editProject } from '../../dist/project.js';
import { loadManifest, hashBytes } from '../../dist/spec.js';
import { openRenderer } from '../../dist/browser.js';
import { findTools } from '../../dist/runtime.js';
import { previewScene } from '../../dist/preview.js';

test('v2 titles preserve exact casing, show labels, and unchanged local frames survive duration/reorder edits in both formats',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ams-visual-')),file=(await createProject(root)).project,chrome=findTools().chrome;
  for(const aspect of ['16:9','9:16']){
    await editProject(file,{type:'composition',video:{aspectRatio:aspect,fps:30,style:'kinetic'}});
    if((await readProject(file)).manifest.scenes.length===1)await editProject(file,{type:'batch',actions:[{type:'edit-scene',sceneId:'opening',patch:{text:'npm i -g fastgrep',label:'Одна команда',durationFrames:60}},{type:'add-scene',scene:{id:'two',type:'kinetic_title',text:'Вторая',durationFrames:60}},{type:'add-scene',scene:{id:'three',type:'cta',text:'Готово',label:'Попробуйте',durationFrames:60}}]});
    const baseline=await readProject(file),spec=await loadManifest(file);let renderer=await openRenderer(spec,chrome),frames=new Map();
    try{
      assert.equal(renderer.spec.scenes[0].layout.lines.join(' '),'npm i -g fastgrep');assert.equal(renderer.spec.scenes[0].labelLayout.lines.join(' '),'Одна команда');
      for(const scene of renderer.spec.scenes)for(const local of [0,1,10,30,59]){const bytes=await renderer.frame(scene.startFrame+local);frames.set(`${scene.id}:${local}`,hashBytes(bytes));if(local===30)await writeFile(join(root,`${aspect.replace(':','-')}-${scene.id}.png`),bytes);}
    }finally{await renderer.finish();}
    await editProject(file,{type:'edit-scene',sceneId:'two',patch:{durationFrames:30}});
    await editProject(file,{type:'move-scene',sceneId:'three',index:1});
    renderer=await openRenderer(await loadManifest(file),chrome);
    try{for(const scene of renderer.spec.scenes.filter(s=>s.id!=='two'))for(const local of [0,1,10,30,59])assert.equal(hashBytes(await renderer.frame(scene.startFrame+local)),frames.get(`${scene.id}:${local}`),'unchanged scene pixels at local time');}finally{await renderer.finish();}
    await editProject(file,{type:'restore',revisionId:baseline.manifest.revision});
    await editProject(file,{type:'edit-scene',sceneId:'opening',patch:{label:'Другая подпись'}});
    renderer=await openRenderer(await loadManifest(file),chrome);try{assert.notEqual(hashBytes(await renderer.frame(30)),frames.get('opening:30'),'supporting copy must change actual pixels');}finally{await renderer.finish();}
    const before=await readProject(file),bytes=await readFile(file);
    await assert.rejects(previewScene(file,{type:'edit-scene',sceneId:'opening',patch:{text:'W'.repeat(300)}},before.etag,join(root,`overflow-${aspect.replace(':','-')}`)),e=>e.code==='TEXT_OVERFLOW');assert.ok((await readFile(file)).equals(bytes));
    await editProject(file,{type:'restore',revisionId:baseline.manifest.revision});
  }
  console.log(`Visual evidence: ${root}`);
});
