import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createProject,importMedia,readProject,editProject} from '../../dist/project.js';
import {loadManifest,validateManifest} from '../../dist/spec.js';
import {findTools,runProcess} from '../../dist/runtime.js';
import {openRenderer} from '../../dist/browser.js';
import {compileStyleForProject} from '../../dist/styles.js';

test('style audit rejects an actual opaque image above text, preserves background uncertainty, CRLF and caption refusal', {timeout:120000},async()=>{
  const root=resolve('artifacts/style-audit-negatives',process.env.AMS_STYLE_RUN_ID||randomUUID());await mkdir(root,{recursive:true});
  const tools=findTools(),image=join(root,'opaque.png');
  await runProcess(tools.ffmpeg,['-y','-v','error','-f','lavfi','-i','color=c=red:s=32x32','-frames:v','1',image]);
  const file=(await createProject(join(root,'film'))).project,asset=await importMedia(file,'opaque.png',await readFile(image));
  const text={id:'text',type:'text',text:'Visible words',x:300,y:300,width:600,height:200,fontSize:48,color:'foreground'},picture={id:'image',type:'image',asset:asset.importedId,x:300,y:300,width:600,height:200,fit:'cover'};
  await editProject(file,{type:'batch',actions:[{type:'remove-scene',sceneId:'opening'},{type:'add-scene',scene:{id:'shot',type:'composition',durationFrames:180,objects:[text,picture]}}]});
  const request={styleId:'calm-product',version:1,mode:'restyle',sceneId:'shot',groups:['typography'],roles:{text:'headline',image:'media'}};
  async function pixels(name){
    const renderer=await openRenderer(await loadManifest(file),tools.chrome);let png;
    try{png=await renderer.frame(57);}finally{await renderer.finish();}
    const path=join(root,`${name}.png`),raw=join(root,`${name}.rgb`);await writeFile(path,png);
    await runProcess(tools.ffmpeg,['-y','-v','error','-i',path,'-vf','crop=600:200:300:300','-pix_fmt','rgb24','-f','rawvideo',raw]);
    const rgb=await readFile(raw);let red=0;for(let index=0;index<rgb.length;index+=3)if(rgb[index]>200&&rgb[index+1]<30&&rgb[index+2]<30)red++;
    return {pixels:rgb.length/3,red,nonRed:rgb.length/3-red,path};
  }
  const above=await pixels('opaque-above');assert.ok(above.nonRed<5,'actual later opaque image covers all text pixels');
  let bytes=await readFile(file);await assert.rejects(compileStyleForProject(file,request),error=>error.code==='STYLE_OCCLUSION');assert.ok((await readFile(file)).equals(bytes));
  await editProject(file,{type:'edit-scene',sceneId:'shot',patch:{objects:[picture,text]}});
  const below=await pixels('background-below');assert.ok(below.nonRed>200,'actual earlier image leaves native text visible');
  bytes=await readFile(file);const compiled=await compileStyleForProject(file,request);assert.equal(compiled.audit.status,'PASS_WITH_WARNINGS');assert.equal(compiled.audit.text[0].contrast,'UNKNOWN');assert.ok((await readFile(file)).equals(bytes));
  const crlf='Exact first line\r\nТочная вторая строка';await editProject(file,{type:'edit-scene',sceneId:'shot',patch:{objects:[{...text,text:crlf,width:900,height:300}]}});
  const crlfRequest={...request,roles:{text:'headline'}};const crlfResult=await compileStyleForProject(file,crlfRequest);assert.equal(crlfResult.action.patch.objects[0].text,crlf);
  // Real supported stroke-only shapes; compare independently decoded native pixels.
  const strokeText={...text,text:'MMMMM',fontSize:84,weight:700,align:'right'};
  await editProject(file,{type:'edit-scene',sceneId:'shot',patch:{objects:[strokeText]}});
  await pixels('stroke-control');const controlRGB=await readFile(join(root,'stroke-control.rgb'));
  const strokeBase={id:'stroke',type:'shape',shape:'rect',x:300,y:328,width:600,height:2,stroke:'#FF0000',strokeWidth:30};
  const strokeRequest={...request,roles:{text:'headline',stroke:'accent'},protected:{text:['align']}};
  const strokeReports=[];
  for(const [label,shape]of [
    ['rect-later',strokeBase],['ellipse-later',{...strokeBase,shape:'ellipse'}],
    ['rotated-rect-later',{...strokeBase,rotation:17}],
    ['paint-expansion-later',{...strokeBase,x:905,y:300,width:20,height:200}]
  ]){
    await editProject(file,{type:'edit-scene',sceneId:'shot',patch:{objects:[strokeText,shape]}});
    const native=await pixels(label),paintRGB=await readFile(join(root,`${label}.rgb`));let overwritten=0;
    for(let offset=0;offset<controlRGB.length;offset+=3)if(controlRGB[offset]>230&&controlRGB[offset+1]>220&&controlRGB[offset+2]>210&&paintRGB[offset]>200&&paintRGB[offset+1]<30&&paintRGB[offset+2]<30)overwritten++;
    assert.ok(overwritten>20,`${label}: actual stroke replaces native foreground pixels`);
    bytes=await readFile(file);await assert.rejects(compileStyleForProject(file,strokeRequest),error=>error.code==='STYLE_OCCLUSION');assert.deepEqual(await readFile(file),bytes);
    strokeReports.push({label,shape,overwrittenForegroundPixels:overwritten,native,code:'STYLE_OCCLUSION',acceptedBytesUnchanged:true});
  }
  // Both an unrotated border and a rotated painted border exceed the safe area,
  // although their geometric bounds remain inside. No duration/copy change.
  for(const [label,shape]of [
    ['paint-safe-bound',{...strokeBase,x:174,y:700,width:100,height:40}],
    ['rotated-paint-safe-bound',{...strokeBase,x:168.22640687119285,y:750,width:100,height:20,rotation:45}]
  ]){
    await editProject(file,{type:'edit-scene',sceneId:'shot',patch:{objects:[strokeText,shape]}});
    bytes=await readFile(file);await assert.rejects(compileStyleForProject(file,strokeRequest),error=>error.code==='STYLE_BOUNDS');assert.deepEqual(await readFile(file),bytes);
    strokeReports.push({label,shape,code:'STYLE_BOUNDS',acceptedBytesUnchanged:true});
  }
  await editProject(file,{type:'edit-scene',sceneId:'shot',patch:{objects:[strokeBase,strokeText]}});
  await pixels('stroke-earlier');const earlierRGB=await readFile(join(root,'stroke-earlier.rgb'));let retainedForeground=0;
  for(let offset=0;offset<controlRGB.length;offset+=3)if(controlRGB[offset]>230&&controlRGB[offset+1]>220&&controlRGB[offset+2]>210&&earlierRGB[offset]>230&&earlierRGB[offset+1]>220&&earlierRGB[offset+2]>210)retainedForeground++;
  assert.ok(retainedForeground>200);bytes=await readFile(file);const earlierStyle=await compileStyleForProject(file,strokeRequest);assert.equal(earlierStyle.audit.text[0].contrast,'UNKNOWN');assert.deepEqual(await readFile(file),bytes);
  strokeReports.push({label:'stroke-earlier',contrast:'UNKNOWN',retainedForegroundPixels:retainedForeground,acceptedBytesUnchanged:true});
  await writeFile(join(root,'stroke-proof.json'),JSON.stringify({strokeReports,humanArtisticAcceptance:'NOT RUN'},null,2)+'\n');
  const voice=join(root,'voice.wav');await runProcess(tools.ffmpeg,['-y','-v','error','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','1',voice]);const narration=await importMedia(file,'voice.wav',await readFile(voice));
  // Controlled NEW fixtures only: the native editor intentionally has no action
  // for switching narration providers. Never rewrite the accepted lifecycle film.
  const fixture=structuredClone((await readProject(file)).manifest);delete fixture.history;delete fixture.revision;delete fixture.operationReceipts;
  fixture.video.aspectRatio='9:16';fixture.audio={narration:{provider:'file'},music:{provider:'procedural',gainDb:-9}};
  fixture.scenes=[{id:'shot',type:'composition',durationFrames:180,objects:[{...text,x:100,y:1600,width:800,height:180}],narration:{asset:narration.importedId},captions:[{startMs:0,endMs:500,text:'Existing caption'}]}];
  const captionFile=join(root,'film','caption-fixture.json');await writeFile(captionFile,JSON.stringify(validateManifest(fixture),null,2)+'\n',{flag:'wx'});
  bytes=await readFile(captionFile);await assert.rejects(compileStyleForProject(captionFile,crlfRequest),error=>error.code==='STYLE_CAPABILITY'&&error.message.includes('captions'));assert.ok((await readFile(captionFile)).equals(bytes));
  delete fixture.scenes[0].captions;const voiceFile=join(root,'film','voice-no-captions-fixture.json');await writeFile(voiceFile,JSON.stringify(validateManifest(fixture),null,2)+'\n',{flag:'wx'});
  const voiceBytes=await readFile(voiceFile),voiceStyle=await compileStyleForProject(voiceFile,crlfRequest);assert.equal(voiceStyle.audit.status,'PASS');assert.ok((await readFile(voiceFile)).equals(voiceBytes));assert.deepEqual(voiceStyle.scene.narration,fixture.scenes[0].narration);
  await writeFile(join(root,'verification.json'),JSON.stringify({status:'PASS',above,below,actualOpaqueImageAboveRefused:true,backgroundContrast:'UNKNOWN',exactCRLF:crlf,captionRefusalBeforeMutation:true,humanArtisticAcceptance:'NOT RUN'},null,2)+'\n');
});

test('style failures preserve exact accepted bytes for overflow, short hold, contrast, bounds, glyphs and native retained box tracks',{timeout:120000},async()=>{
  const root=resolve('artifacts/style-failure-contract',process.env.AMS_STYLE_RUN_ID||randomUUID());await mkdir(root,{recursive:true});
  const file=(await createProject(join(root,'film'))).project;
  const base={id:'text',type:'text',text:'Exact supplied copy',x:300,y:300,width:900,height:300,fontSize:48,color:'foreground'};
  await editProject(file,{type:'add-scene',scene:{id:'selected',type:'composition',durationFrames:240,objects:[base]}});
  const request={styleId:'calm-product',version:1,mode:'restyle',sceneId:'selected',groups:['typography'],roles:{text:'headline'}};
  const reports=[];
  async function reject(label,code,input=request){const bytes=await readFile(file);await assert.rejects(compileStyleForProject(file,input),error=>error.code===code,`${label}: ${code}`);assert.ok((await readFile(file)).equals(bytes));reports.push({label,code,acceptedBytesUnchanged:true});}
  const glyphBytes=await readFile(file);await assert.rejects(editProject(file,{type:'edit-scene',sceneId:'selected',patch:{objects:[{...base,text:'😀'}]}}),error=>error.code==='UNSUPPORTED_CHARACTER');assert.ok((await readFile(file)).equals(glyphBytes));reports.push({label:'native unsupported glyph rejected before acceptance',code:'UNSUPPORTED_CHARACTER',acceptedBytesUnchanged:true});
  await editProject(file,{type:'edit-scene',sceneId:'selected',patch:{objects:[{...base,text:'W'.repeat(500)}]}});await reject('unbroken token at style font floor','STYLE_TEXT_OVERFLOW');
  await editProject(file,{type:'edit-scene',sceneId:'selected',patch:{durationFrames:30,objects:[base]}});await reject('duration is not lengthened to satisfy hold','STYLE_HOLD');
  await editProject(file,{type:'batch',actions:[{type:'edit-scene',sceneId:'selected',patch:{durationFrames:240}},{type:'brand',patch:{foreground:'#10171C'}}]});await reject('computable low contrast','STYLE_CONTRAST');
  await editProject(file,{type:'batch',actions:[{type:'brand',patch:{foreground:'#F4F1E9'}},{type:'edit-scene',sceneId:'selected',patch:{objects:[{...base,x:-50}]}}]});await reject('protected unsafe position','STYLE_BOUNDS',{...request,groups:['layout','typography'],protected:{text:['x']}});
  await editProject(file,{type:'edit-scene',sceneId:'selected',patch:{objects:[{...base,keyframes:[{frame:100,width:40,easing:'linear'}]}]}});await reject('retained future width track uses actual native minimum box','STYLE_TEXT_OVERFLOW');
  await editProject(file,{type:'edit-scene',sceneId:'selected',patch:{objects:[base]}});await reject('whole object protection permits no hidden change','STYLE_NO_CHANGES',{...request,groups:['layout','typography','motion'],protected:{text:['*']}});
  await reject('unsupported engine capability','STYLE_INPUT',{...request,motion:'spring'});
  await writeFile(join(root,'verification.json'),JSON.stringify({status:'PASS',reports,humanArtisticAcceptance:'NOT RUN'},null,2)+'\n');
});
