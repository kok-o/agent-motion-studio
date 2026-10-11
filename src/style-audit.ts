import type { CompositionObject, Manifest, ObjectState, ResolvedSpec } from './types.js';
import type { StyleAudit, StylePackage, StyleTextFit } from './style-types.js';
import type { StyleDraft } from './style-layout.js';
import { sampleObject } from './composition.js';
import { openRenderer } from './browser.js';
import { StudioError } from './errors.js';

function fail(message:string,code='STYLE_READABILITY'):never{throw new StudioError(code,'style',message,2);}
interface Bounds {left:number;top:number;right:number;bottom:number}
function bounds(state:ObjectState):Bounds{
  const theta=state.rotation*Math.PI/180,c=Math.abs(Math.cos(theta)),s=Math.abs(Math.sin(theta)),width=c*state.width+s*state.height,height=s*state.width+c*state.height;
  const cx=state.x+state.width/2,cy=state.y+state.height/2;return {left:cx-width/2,top:cy-height/2,right:cx+width/2,bottom:cy+height/2};
}
const overlaps=(a:Bounds,b:Bounds)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>.01&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.01;
const contains=(outer:Bounds,inner:Bounds)=>outer.left<=inner.left&&outer.top<=inner.top&&outer.right>=inner.right&&outer.bottom>=inner.bottom;
const stable=(a:ObjectState,b:ObjectState)=>['x','y','width','height','rotation'].every(key=>Math.abs(a[key as keyof ObjectState]-b[key as keyof ObjectState])<=.25);
type RGB=[number,number,number];
function rgb(value:string):RGB {if(!/^#[a-f0-9]{6}$/i.test(value))fail(`Unsupported contrast color ${value}. Use a native #RRGGBB or brand role.`);return [1,3,5].map(index=>parseInt(value.slice(index,index+2),16)/255) as RGB;}
const blend=(foreground:RGB,background:RGB,alpha:number):RGB=>foreground.map((channel,index)=>channel*alpha+background[index]*(1-alpha)) as RGB;
function luminance(value:RGB){const [r,g,b]=value.map(channel=>channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b;}
function contrast(a:RGB,b:RGB){const first=luminance(a),second=luminance(b);return (Math.max(first,second)+.05)/(Math.min(first,second)+.05);}
function color(manifest:Manifest,value:string|undefined){return value&&['foreground','background','accent'].includes(value)?manifest.brand[value as 'foreground'|'background'|'accent']:value??manifest.brand.foreground;}

/** Actual native font setup and wrapping; no media render/export or accepted write. */
export async function measureStyleText(spec:ResolvedSpec,draft:StyleDraft,chrome:string):Promise<StyleTextFit[]>{
  const neutral:ResolvedSpec={...structuredClone(spec),totalFrames:1,scenes:[{id:'style-font-audit',type:'composition',durationFrames:1,startFrame:0,endFrame:1,objects:[]}]};
  const renderer=await openRenderer(neutral,chrome);
  // Native fitStyleText checks the smallest base/keyframe box, exactly like
  // validateCompositionLayout, including retained future width/height keys.
  try{return await renderer.fitStyleText(draft.fitInputs);}
  finally{await renderer.finish();}
}

export function auditStyle(manifest:Manifest,draft:StyleDraft,pack:StylePackage,fits:StyleTextFit[]):StyleAudit{
  const scene=draft.scene,objects=scene.objects!,width=manifest.video.aspectRatio==='16:9'?1920:1080,height=manifest.video.aspectRatio==='16:9'?1080:1920,margin=width*(manifest.video.safeArea??.09);
  const safe:Bounds={left:margin,top:margin,right:width-margin,bottom:height-margin};
  const warnings=new Set<string>(),text=objects.filter(item=>item.type==='text'),background=rgb(color(manifest,scene.background??'background'));
  const records=new Map(text.map(item=>[item.id,{hold:0,longest:0,prior:undefined as ObjectState|undefined,minimumContrast:Infinity,unknown:false}]));
  for(const item of text){
    if(!item.text?.trim())fail(`Object ${item.id} has no readable copy. Supply its intended content explicitly.`);
    if((item.fontSize??48)<pack.typography.minimum)fail(`Object ${item.id}: ${item.fontSize??48}px is below this style's ${pack.typography.minimum}px floor. Allow typography or revise locks.`, 'STYLE_LOCK_CONFLICT');
  }
  for(let frame=0;frame<scene.durationFrames;frame++){
    const sampled=objects.map(item=>({item,state:sampleObject(item,frame),box:bounds(sampleObject(item,frame))}));
    for(const {item,state,box}of sampled){if(state.opacity>.001&&!contains(safe,box))fail(`Object ${item.id} leaves the safe area at frame${frame}. Allow layout/motion or revise the relevant locks.`, 'STYLE_BOUNDS');}
    for(const item of text){
      const index=objects.indexOf(item),current=sampled[index],record=records.get(item.id)!;
      const readable=current.state.opacity>=.95&&current.state.reveal>=.999;
      record.hold=readable?record.prior&&stable(record.prior,current.state)?record.hold+1:1:0;
      record.longest=Math.max(record.longest,record.hold);record.prior=current.state;
      if(!readable)continue;
      let backdrop=background,known=true;
      for(const [otherIndex,other]of sampled.entries()){
        if(otherIndex===index||other.state.opacity<=.001||!overlaps(current.box,other.box))continue;
        if(other.item.type==='text'&&other.state.opacity>=.95&&other.state.reveal>=.999)fail(`Text ${item.id} overlaps ${other.item.id} at frame${frame}. Allow layout or revise locks.`, 'STYLE_OVERLAP');
        if(other.item.type==='image') {
          if(otherIndex>index)fail(`Image ${other.item.id} paints over text ${item.id} at frame${frame}; object order is preserved. Revise layout/locks explicitly.`, 'STYLE_OCCLUSION');
          known=false;warnings.add(`Contrast for ${item.id} against background image ${other.item.id} is UNKNOWN; inspect the preview.`);continue;
        }
        if(other.item.type!=='shape'||!other.item.color)continue;
        if(otherIndex>index)fail(`Shape ${other.item.id} paints over text ${item.id} at frame${frame}; object order is preserved. Change locks/layout explicitly.`, 'STYLE_OCCLUSION');
        if(other.item.shape==='rect'&&(other.item.radius??0)===0&&other.state.rotation===0&&contains(other.box,current.box))backdrop=blend(rgb(color(manifest,other.item.color)),backdrop,other.state.opacity);
        else {known=false;warnings.add(`Partial/rounded shape backdrop for ${item.id}: contrast UNKNOWN; inspect the preview.`);}
      }
      if(known)record.minimumContrast=Math.min(record.minimumContrast,contrast(blend(rgb(color(manifest,item.color)),backdrop,current.state.opacity),backdrop));else record.unknown=true;
    }
  }
  const audited=text.map(item=>{
    const record=records.get(item.id)!,words=item.text!.trim().split(/\s+/).length,requiredHoldFrames=Math.max(pack.readability.minimumHoldFrames,18+pack.readability.framesPerWord*words,Math.ceil([...item.text!].length*pack.readability.framesPerCharacter));
    if(record.longest<requiredHoldFrames)fail(`Object ${item.id} has ${record.longest} stable readable frames; needs ${requiredHoldFrames}. Duration/copy/tracks were preserved. Choose reduced motion, allow track replacement, or explicitly revise the scene.`, 'STYLE_HOLD');
    if(Number.isFinite(record.minimumContrast)&&record.minimumContrast+1e-6<pack.readability.contrast)fail(`Object ${item.id} contrast ${record.minimumContrast.toFixed(2)} is below ${pack.readability.contrast}. Revise brand/colors or allowed typography explicitly.`, 'STYLE_CONTRAST');
    const fit=fits.find(value=>value.objectId===item.id);if(!fit)fail(`Missing actual font fit for ${item.id}.`);
    return {...fit,holdFrames:record.longest,requiredHoldFrames,contrast:record.unknown?'UNKNOWN' as const:record.minimumContrast};
  });
  return {status:warnings.size?'PASS_WITH_WARNINGS':'PASS',font:'Actual bundled StudioSans 400/700, native Canvas wrapping',layoutFamily:draft.layoutFamily,checkedFrames:scene.durationFrames,text:audited,warnings:[...warnings],preservedTracks:draft.preservedTracks,humanArtisticAcceptance:'NOT RUN'};
}
