import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleObject } from '../../dist/composition.js';
import { validateManifest } from '../../dist/spec.js';
const object = {id:'label',type:'text',text:'Поиск',x:10,y:20,width:300,height:80,fontSize:40};
const manifest = objects => ({schemaVersion:2,id:'comp',seed:7,video:{aspectRatio:'9:16',fps:30},brand:{theme:'dark',background:'#10171C',foreground:'#F4F1E9',accent:'#D9EE86',font:'builtin-sans'},assets:{},audio:{narration:{provider:'none'},music:{provider:'none'}},scenes:[{id:'shot',type:'composition',durationFrames:30,objects}]});
test('independent tracks hold, interpolate and clip without accumulating state',()=>{
  const animated = {...object,opacity:0,keyframes:[{frame:10,opacity:1},{frame:20,x:210},{frame:40,x:410,easing:'step'}]};
  assert.equal(sampleObject(animated,5).opacity,.5);
  assert.equal(sampleObject(animated,5).x,60);
  assert.equal(sampleObject(animated,30).x,210);
  assert.equal(sampleObject(animated,40).x,410);
  assert.deepEqual(sampleObject(animated,5),sampleObject(animated,5));
  assert.equal(sampleObject({...object,keyframes:[{frame:20,x:210,easing:'outCubic'}]},10).x,185);
  validateManifest(manifest([animated])); // Shorter scene clips later movement.
});
test('composition rejects code, duplicate IDs, invalid tracks, references and v1',()=>{
  for (const objects of [[{...object,script:'alert(1)'}],[object,object],[{...object,keyframes:[{frame:20,x:0},{frame:10,x:1}]}],[{...object,keyframes:[{frame:10,x:0},{frame:10,y:0}]}],[{...object,width:0}],[{id:'img',type:'image',asset:'missing',x:0,y:0,width:10,height:10}]]) assert.throws(()=>validateManifest(manifest(objects)));
  assert.throws(()=>validateManifest({...manifest([object]),schemaVersion:1}));
  const old = manifest([object]); old.scenes=[{id:'old',type:'kinetic_title',text:'Старый титр',durationFrames:30,objects:[object]}];
  assert.throws(()=>validateManifest(old));
});
