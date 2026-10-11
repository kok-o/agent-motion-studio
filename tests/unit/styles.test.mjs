import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareStyle,validateStyleRequest} from '../../dist/style-layout.js';
import {StyleTickets} from '../../dist/styles.js';
import {sampleObject} from '../../dist/composition.js';
const pack=JSON.parse(await readFile('styles/calm-product.json','utf8'));
const manifest=()=>({schemaVersion:2,id:'styles',seed:7,video:{aspectRatio:'16:9',fps:30},brand:{theme:'dark',background:'#10171C',foreground:'#F4F1E9',accent:'#D9EE86',font:'builtin-sans'},assets:{},audio:{narration:{provider:'none'},music:{provider:'none'}},scenes:[{id:'shot',type:'composition',durationFrames:180,objects:[{id:'text',type:'text',text:'Exact accepted copy',x:300,y:300,width:600,height:200,fontSize:48,keyframes:[{frame:60,y:400,easing:'linear'}]}]}]});
const request=()=>({styleId:'calm-product',version:1,mode:'restyle',sceneId:'shot',groups:['layout','typography','motion'],roles:{text:'headline'}});

test('editorial uses real role-specific native 400/700 hierarchy without rewriting copy',async()=>{
  const editorial=JSON.parse(await readFile('styles/editorial.json','utf8')),original=manifest();
  original.scenes[0].objects=[...['headline','proof','body'].map((id,index)=>({id,type:'text',text:['Exact headline','42%','Exact body'][index],x:300,y:300+index*200,width:600,height:180,fontSize:48}))];
  const draft=prepareStyle(original,{...request(),styleId:'editorial',groups:['typography'],roles:{headline:'headline',proof:'proof',body:'body'}},editorial);
  assert.deepEqual(draft.scene.objects.map(item=>item.weight),[400,700,400]);
  assert.deepEqual(draft.scene.objects.map(item=>item.text),original.scenes[0].objects.map(item=>item.text));
});

test('authoring styles reject unsupported metadata and require explicit allowed groups and exact role mappings',()=>{
  for(const patch of [{version:2},{styleId:'arbitrary'},{groups:[]},{groups:['layout','layout']},{groups:['font-family']},{asset:'other'},{durationFrames:90},{protected:{text:['asset']}},{replaceTracks:'yes'},{motion:'spring'}])assert.throws(()=>validateStyleRequest({...request(),...patch}),error=>error.code==='STYLE_INPUT');
  assert.throws(()=>prepareStyle(manifest(),{...request(),roles:{other:'headline'}},pack),error=>error.code==='STYLE_INPUT');
});

test('preserved motion retains frame0 values; protected animated channels override explicit replacement',()=>{
  const original=manifest(),bytes=JSON.stringify(original),object=original.scenes[0].objects[0];
  assert.throws(()=>prepareStyle(original,request(),pack),error=>error.code==='STYLE_LOCK_CONFLICT'&&error.message.includes('frame0'));
  assert.throws(()=>prepareStyle(original,{...request(),replaceTracks:true,protected:{text:['y']}},pack),error=>error.code==='STYLE_LOCK_CONFLICT'&&error.message.includes('protected animated'));
  const draft=prepareStyle(original,{...request(),groups:['typography','motion'],protected:{text:['x','y','width','height']}},pack);
  assert.deepEqual(draft.scene.objects[0].keyframes,object.keyframes);
  for(const frame of [0,1,30,60,179])assert.equal(sampleObject(draft.scene.objects[0],frame).y,sampleObject(object,frame).y);
  assert.equal(JSON.stringify(original),bytes);
});

test('scene style tickets bind exact selection/version/roles/locks/parameters/action and are consumed once',()=>{
  const tickets=new StyleTickets(),action={type:'edit-scene',sceneId:'shot',patch:{objects:manifest().scenes[0].objects}},original=request(),etag='a'.repeat(64);
  tickets.add('preview',etag,original,action);
  for(const changed of [{sceneId:'other'},{version:2},{styleId:'editorial'},{groups:['typography']},{protected:{text:['y']}},{replaceTracks:true},{motion:'reduced'},{roles:{text:'body'}}])assert.throws(()=>tickets.consume('preview',etag,{...original,...changed},action),error=>error.code==='STYLE_PREVIEW_REQUIRED');
  assert.throws(()=>tickets.consume('preview',etag,original,{...action,patch:{objects:[]}}),error=>error.code==='STYLE_PREVIEW_REQUIRED');
  tickets.consume('preview',etag,original,action);assert.throws(()=>tickets.consume('preview',etag,original,action),error=>error.code==='STYLE_PREVIEW_REQUIRED');
  tickets.add('old',etag,original,action);tickets.add('new',etag,original,action);assert.throws(()=>tickets.consume('old',etag,original,action),error=>error.code==='STYLE_PREVIEW_REQUIRED');
  tickets.clear();assert.throws(()=>tickets.consume('new',etag,original,action),error=>error.code==='STYLE_PREVIEW_REQUIRED');
});
