import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createProject,editProject,readProject,importMedia} from '../../dist/project.js';
import {compileStyleForProject} from '../../dist/styles.js';
import {loadManifest,hashBytes} from '../../dist/spec.js';
import {findTools,runProcess} from '../../dist/runtime.js';
import {openRenderer} from '../../dist/browser.js';
import {sampleObject} from '../../dist/composition.js';

const styles=['calm-product','kinetic-poster','editorial'];
const {copy}=JSON.parse(await readFile('examples/authoring-styles/cases.json','utf8'));
test('three executable styles: material/aspect/RU-EN/short-long matrix, native frames and preserved accepted state',{timeout:600000},async()=>{
  const root=resolve('artifacts/style-matrix',process.env.AMS_STYLE_RUN_ID||randomUUID());await mkdir(root,{recursive:true});
  const tools=findTools(),image=join(root,'own-product.png');
  await runProcess(tools.ffmpeg,['-v','error','-f','lavfi','-i','color=c=0x284964:s=160x100','-vf','drawbox=x=12:y=12:w=136:h=12:color=0x90d0bd:t=fill,drawbox=x=12:y=36:w=80:h=48:color=0xe1e8ec:t=fill','-frames:v','1','-threads','1',image]);
  const reports=[];
  for(const aspect of ['16:9','9:16'])for(const material of ['product','proof','explanation'])for(const language of ['ru','en'])for(const length of ['short','long']){
    const key=`${aspect.replace(':','-')}-${material}-${language}-${length}`,dir=join(root,key);await mkdir(dir);
    const file=(await createProject(join(dir,'film'),{aspect,title:'Untouched neighbour'})).project;
    const imported=await importMedia(file,'own-product.png',await readFile(image)),asset=imported.importedId;
    const words=copy[language][length],object=(id,text,y)=>({id,type:'text',text,x:240,y,width:600,height:240,fontSize:48,color:'foreground'});
    const objects=[object('headline',words[0],240)],roles={headline:'headline'};
    if(material==='proof'){objects.push(object('proof',words[1],500));roles.proof='proof';}
    objects.push(object('body',words[2],760));roles.body='body';
    if(material==='product'){objects.push({id:'media',type:'image',asset,x:800,y:240,width:300,height:400,fit:'contain',focalPoint:{x:.4,y:.6}});roles.media='media';}
    objects.push({id:'accent',type:'shape',shape:'rect',x:240,y:900,width:100,height:6,color:'accent'});roles.accent='accent';
    await editProject(file,{type:'add-scene',scene:{id:'selected',type:'composition',durationFrames:240,objects}});
    await editProject(file,{type:'music',provider:'procedural',gainDb:-12});
    const initial=await readProject(file),bytes=await readFile(file),assetHash=hashBytes(await readFile(join(file,'..',initial.manifest.assets[asset].path)));
    const signatures=new Set(),compiledStyles=[];
    for(const styleId of styles){
      const request={styleId,version:1,mode:'restyle',sceneId:'selected',groups:['layout','typography','motion'],roles};
      const compiled=await compileStyleForProject(file,request,initial.etag),action=compiled.action;
      assert.equal(action.type,'edit-scene');assert.deepEqual(Object.keys(action.patch),['objects']);
      assert.ok((await readFile(file)).equals(bytes));assert.deepEqual((await readProject(file)).manifest,initial.manifest);
      assert.equal(hashBytes(await readFile(join(file,'..',initial.manifest.assets[asset].path))),assetHash);
      for(let index=0;index<objects.length;index++){
        const before=objects[index],after=action.patch.objects[index];
        for(const field of ['id','type','text','asset','fit','focalPoint','shape','stroke','strokeWidth','radius'])assert.deepEqual(after[field],before[field],`${key}/${styleId}/${field}`);
        for(const frame of [0,24,57,90,149,239]){
          const state=sampleObject(after,frame),margin=(aspect==='16:9'?1920:1080)*.09;
          if(state.opacity>.001){assert.ok(state.x>=margin-.01&&state.y>=margin-.01);assert.ok(state.x+state.width<=(aspect==='16:9'?1920:1080)-margin+.01);assert.ok(state.y+state.height<=(aspect==='16:9'?1080:1920)-margin+.01);}
        }
      }
      for(const fit of compiled.audit.text){assert.ok(fit.fontSize>=36);assert.ok(fit.lines.length*fit.lineHeight<=action.patch.objects.find(item=>item.id===fit.objectId).height);assert.ok(fit.holdFrames>=fit.requiredHoldFrames);assert.ok(typeof fit.contrast==='number'&&fit.contrast>=4.5);}
      assert.equal(compiled.audit.humanArtisticAcceptance,'NOT RUN');
      signatures.add(JSON.stringify(action.patch.objects.map(item=>({x:item.x,y:item.y,width:item.width,height:item.height,fontSize:item.fontSize,weight:item.weight,align:item.align,keyframes:item.keyframes}))));
      if(material==='proof'&&length==='long')assert.deepEqual((await compileStyleForProject(file,request,initial.etag)).action,action);
      const metadata={key,styleId,layoutFamily:compiled.audit.layoutFamily,audit:compiled.audit,action};compiledStyles.push(metadata);reports.push(metadata);
    }
    assert.equal(signatures.size,3,`${key}: same palette still produces different layout/rhythm/hierarchy`);
    // A small actual-frame set spans all styles/aspects and three materials.
    if(language==='en'&&length==='short'){
        const {styleId,action}=compiledStyles[['product','proof','explanation'].indexOf(material)];
        const accepted=await editProject(file,action,initial.etag),spec=await loadManifest(file),renderer=await openRenderer(spec,tools.chrome);
        try{for(const frame of [0,24,57,90,149])await writeFile(join(dir,`${styleId}-frame-${frame}.png`),await renderer.frame(120+frame));}finally{await renderer.finish();}
        const rgbFile=join(dir,`${styleId}-frame-57.rgb`);
        await runProcess(tools.ffmpeg,['-v','error','-i',join(dir,`${styleId}-frame-57.png`),'-pix_fmt','rgb24','-f','rawvideo',rgbFile]);
        const rgb=await readFile(rgbFile),width=aspect==='16:9'?1920:1080,height=aspect==='16:9'?1080:1920,margin=width*.09;
        let pixels=0,left=width,right=0,top=height,bottom=0;
        for(let position=0;position<rgb.length;position+=3)if(rgb[position]>235&&rgb[position+1]>235&&rgb[position+2]>220){const pixel=position/3,x=pixel%width,y=Math.floor(pixel/width);pixels++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
        assert.ok(pixels>100,'decoded actual pixels contain readable foreground glyphs');assert.ok(left>=margin&&top>=margin&&right<width-margin&&bottom<height-margin,'independent foreground pixel bounds stay inside the safe area');
        await writeFile(join(dir,'pixel-proof.json'),JSON.stringify({frame:57,foregroundPixels:pixels,bounds:{left,right,top,bottom},safeMargin:margin,nativeFrameFile:`${styleId}-frame-57.png`,notOnlyRendererEquality:true},null,2)+'\n');
        assert.deepEqual(accepted.manifest.scenes[0],initial.manifest.scenes[0]);assert.deepEqual(accepted.manifest.assets,initial.manifest.assets);
        assert.deepEqual(accepted.manifest.brand,initial.manifest.brand);assert.deepEqual(accepted.manifest.audio,initial.manifest.audio);assert.deepEqual(accepted.manifest.operationReceipts,initial.manifest.operationReceipts);
        assert.deepEqual(accepted.manifest.history.at(-1).scenes,initial.manifest.scenes);
        await editProject(file,{type:'restore',revisionId:initial.manifest.revision},accepted.etag);
        // Restoring uses a new revision. Subsequent compilation stays anchored
        // to a separate untouched native fixture rather than rewriting history.
        assert.deepEqual((await readProject(file)).manifest.scenes,initial.manifest.scenes);
    }
    await writeFile(join(dir,'compiled.json'),JSON.stringify(compiledStyles,null,2)+'\n');
  }
  assert.equal(reports.length,72);
  await writeFile(join(root,'verification.json'),JSON.stringify({status:'PASS',cases:reports.length,reports,humanArtisticAcceptance:'NOT RUN'},null,2)+'\n');
});
