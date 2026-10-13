import type { CompositionObject, Manifest, Scene } from './types.js';
import { StudioError } from './errors.js';
import { styleIDs, styleGroups, styleRoles, type StyleRequest, type StylePackage, type StyleField, type StyleAction, type StyleTextInput, type StyleRole } from './style-types.js';
import { validateManifest } from './spec.js';

const fields: StyleField[] = ['x','y','width','height','fontSize','weight','align','color','opacity','reveal','rotation','keyframes'];
function fail(message: string, code = 'STYLE_INPUT'): never { throw new StudioError(code,'style',message,2); }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value);
export function validateStyleRequest(input: unknown): StyleRequest {
  if (!object(input) || Object.keys(input).some(key => !['styleId','version','mode','sceneId','objectId','text','groups','roles','protected','replaceTracks','motion'].includes(key))) fail('Expected a narrow authoring style request.');
  if (!styleIDs.includes(input.styleId as never) || input.version !== 1 || !['create','restyle'].includes(String(input.mode)) || !id(input.sceneId)) fail('Select a supported style/version, mode and scene ID.');
  if (!Array.isArray(input.groups) || !input.groups.length || new Set(input.groups).size !== input.groups.length || input.groups.some(group => !styleGroups.includes(group as never))) fail('Explicitly select allowed layout, typography and/or motion groups.');
  if (!object(input.roles) || Object.entries(input.roles).some(([key,role]) => !id(key) || !styleRoles.includes(role as never))) fail('Map every object to an explicit supported role.');
  if (input.replaceTracks !== undefined && typeof input.replaceTracks !== 'boolean') fail('replaceTracks must be boolean.');
  if (input.motion !== undefined && !['standard','reduced'].includes(String(input.motion))) fail('Supported motion settings: standard/reduced.');
  if (input.protected !== undefined && (!object(input.protected) || Object.entries(input.protected).some(([key,value]) => !id(key) || !Array.isArray(value) || new Set(value).size !== value.length || value.some(field => field !== '*' && !fields.includes(field as never))))) fail('Protected fields must name existing objects and supported fields, or *.');
  if (input.mode === 'create') {
    if (!id(input.objectId) || !['Новый текст','New text'].includes(String(input.text)) || input.groups.length !== 3 || !styleGroups.every(group => (input.groups as unknown[]).includes(group))) fail('Styled creation uses one new neutral text, stable IDs and all three default style groups.');
    if (Object.keys(input.roles).length !== 1 || input.roles[input.objectId] !== 'headline' || input.protected !== undefined || input.replaceTracks === true) fail('Creation requires the single neutral headline role, without restyle locks.');
  } else if (input.objectId !== undefined || input.text !== undefined) fail('Restyle preserves all existing object IDs and text.');
  return structuredClone(input) as unknown as StyleRequest;
}
export function isStyleProtected(request: StyleRequest, objectId: string, field: StyleField): boolean {
  const protectedFields = request.protected?.[objectId] ?? [];
  return protectedFields.includes('*') || protectedFields.includes(field);
}
type Box = Pick<CompositionObject,'x'|'y'|'width'|'height'>;
export interface StyleDraft { request: StyleRequest; scene: Scene; action: StyleAction; layoutFamily: string; preservedTracks: string[]; fitInputs: StyleTextInput[] }
export function styleAction(request: StyleRequest, scene: Scene): StyleAction {
  return request.mode === 'create' ? {type:'add-scene',scene:structuredClone(scene)} : {type:'edit-scene',sceneId:scene.id,patch:{objects:structuredClone(scene.objects!)}};
}

/** Original content-dependent 2D layouts. No mandatory scene array or copy rewriting. */
export function prepareStyle(manifest: Manifest, input: unknown, pack: StylePackage): StyleDraft {
  const request = validateStyleRequest(input);
  if (request.styleId !== pack.id || request.version !== pack.version) fail('Style package/version mismatch.');
  if (manifest.schemaVersion !== 2) fail('Styles require a v2 object composition.');
  let scene: Scene;
  if (request.mode === 'create') {
    if (manifest.scenes.some(item => item.id === request.sceneId) || manifest.scenes.some(item => item.objects?.some(item => item.id === request.objectId))) fail('Use fresh scene/object IDs.');
    scene = {id:request.sceneId,type:'composition',durationFrames:120,objects:[{id:request.objectId!,type:'text',text:request.text!,x:200,y:200,width:600,height:300,color:'foreground',fontSize:48}]};
  } else {
    const selected = manifest.scenes.find(item => item.id === request.sceneId);
    if (selected?.type !== 'composition') fail('Select one existing object composition.');
    scene = structuredClone(selected);
  }
  if (scene.captions?.length) fail('Authoring style audit does not support compositions with captions yet. Captions, copy and duration were kept; ordinary object editing and scene preview remain available.', 'STYLE_CAPABILITY');
  const objects = scene.objects!, ids = objects.map(item => item.id);
  if (Object.keys(request.roles).length !== ids.length || ids.some(id => !request.roles[id]) || Object.keys(request.roles).some(id => !ids.includes(id)) || Object.keys(request.protected ?? {}).some(id => !ids.includes(id))) fail('Roles/locks must match the exact selected scene object set.');
  for (const item of objects) {
    const role = request.roles[item.id];
    if ((item.type === 'text' && !['headline','body','proof'].includes(role)) || (item.type === 'image' && role !== 'media') || (item.type === 'shape' && role !== 'accent')) fail(`Role ${role} is incompatible with ${item.type} ${item.id}.`);
  }
  const text = objects.filter(item => item.type === 'text'), media = objects.filter(item => item.type === 'image'), accents = objects.filter(item => item.type === 'shape');
  if (!text.length || text.length > 5 || media.length > 1 || accents.length > 2) fail('This bounded style slice supports 1–5 text objects, at most1 image and2 existing accents. Reduce the selected scope explicitly.', 'STYLE_CAPABILITY');
  if (text.filter(item => request.roles[item.id] === 'headline').length > 1 || text.filter(item => request.roles[item.id] === 'proof').length > 1) fail('Use at most one headline and one proof; map supporting text as body.');
  const landscape = manifest.video.aspectRatio === '16:9', width = landscape ? 1920 : 1080, height = landscape ? 1080 : 1920;
  const margin = Math.ceil(width * (manifest.video.safeArea ?? .09)) + 40, gap = Math.round(width * .025);
  const area: Box = {x:margin,y:margin,width:width-margin*2,height:height-margin*2-32};
  const boxes = new Map<string,Box>();
  const ranked = [...text].sort((a,b) => ['headline','proof','body'].indexOf(request.roles[a.id]) - ['headline','proof','body'].indexOf(request.roles[b.id]));
  const longCopy = text.reduce((sum,item) => sum + [...item.text!].length,0) > 100;
  let layoutFamily: string, textArea = {...area};
  if (pack.id === 'calm-product') {
    layoutFamily = media.length ? landscape ? 'product-side' : 'product-stack' : ranked.some(item => request.roles[item.id] === 'proof') ? 'proof-band' : 'quiet-copy';
    if (media[0]) {
      if (landscape) { textArea.width = Math.round((area.width-gap)*.39); boxes.set(media[0].id,{x:area.x+textArea.width+gap,y:area.y,width:area.width-textArea.width-gap,height:area.height}); }
      else { textArea.height = Math.round((area.height-gap)*(longCopy ? .52 : .39)); boxes.set(media[0].id,{x:area.x,y:area.y+textArea.height+gap,width:area.width,height:area.height-textArea.height-gap}); }
    }
    stack(ranked,textArea,boxes,request.roles,gap,false);
  } else if (pack.id === 'kinetic-poster') {
    layoutFamily = media.length ? 'poster-media' : !landscape ? 'poster-stack' : ranked.some(item => request.roles[item.id] === 'proof') ? 'poster-proof' : 'poster-pair';
    if (media[0]) { textArea.height = Math.round((area.height-gap)*.63); boxes.set(media[0].id,{x:area.x+Math.round(area.width*.15),y:area.y+textArea.height+gap,width:Math.round(area.width*.7),height:area.height-textArea.height-gap}); }
    if (landscape && !media.length && ranked.length === 2 && !longCopy) {
      const half = Math.floor((area.width-gap)/2);
      boxes.set(ranked[0].id,{x:area.x,y:area.y,width:half,height:area.height});boxes.set(ranked[1].id,{x:area.x+half+gap,y:area.y+Math.round(area.height*.18),width:area.width-half-gap,height:Math.round(area.height*.72)});
    } else stack(ranked,textArea,boxes,request.roles,gap,true);
  } else {
    layoutFamily = media.length ? landscape ? 'editorial-image' : 'editorial-tall' : ranked.length > 1 ? 'editorial-columns' : 'editorial-statement';
    if (media[0]) {
      if (landscape) { const imageWidth = Math.round((area.width-gap)*.37); boxes.set(media[0].id,{x:area.x,y:area.y+Math.round(area.height*.1),width:imageWidth,height:Math.round(area.height*.8)});textArea={x:area.x+imageWidth+gap,y:area.y,width:area.width-imageWidth-gap,height:area.height}; }
      else { const imageHeight = Math.round((area.height-gap)*.32); boxes.set(media[0].id,{x:area.x,y:area.y,width:Math.round(area.width*.8),height:imageHeight});textArea={x:area.x,y:area.y+imageHeight+gap,width:area.width,height:area.height-imageHeight-gap}; }
      stack(ranked,textArea,boxes,request.roles,gap,false);
    } else if (landscape && ranked.length > 1) {
      const left = Math.floor((area.width-gap)*.58);
      boxes.set(ranked[0].id,{x:area.x,y:area.y,width:left,height:area.height});
      stack(ranked.slice(1),{x:area.x+left+gap,y:area.y+Math.round(area.height*.19),width:area.width-left-gap,height:Math.round(area.height*.81)},boxes,request.roles,gap,false);
    } else {
      textArea.x += Math.round(area.width*.08);textArea.width-=Math.round(area.width*.08);stack(ranked,textArea,boxes,request.roles,gap,false);
    }
  }
  accents.forEach((item,index) => boxes.set(item.id,{x:area.x+index*(gap+16),y:height-margin-16,width:Math.min(180,area.width*.2),height:6}));
  const preservedTracks: string[] = [];
  objects.forEach(item => {
    const canReplaceTracks=request.groups.includes('motion')&&request.replaceTracks===true&&!isStyleProtected(request,item.id,'keyframes');
    const tracked=fields.filter(field=>field!=='keyframes'&&item.keyframes?.some(key=>key[field as keyof typeof key]!==undefined));
    if(canReplaceTracks&&tracked.some(field=>isStyleProtected(request,item.id,field)))fail(`Object ${item.id}: track replacement conflicts with protected animated channels. Keep the tracks or revise those locks explicitly.`, 'STYLE_LOCK_CONFLICT');
    if(request.groups.includes('layout')&&!canReplaceTracks)for(const [field,value]of Object.entries(boxes.get(item.id)!)){
      if(tracked.includes(field as StyleField)&&!isStyleProtected(request,item.id,field as StyleField)&&item[field as keyof Box]!==value)fail(`Object ${item.id}: changing base ${field} changes its preserved frame0 track. Allow explicit track replacement or protect this layout field.`, 'STYLE_LOCK_CONFLICT');
    }
    const set = <Key extends StyleField>(key: Key, value: CompositionObject[Key]) => {if(!isStyleProtected(request,item.id,key)) (item[key] as CompositionObject[Key])=value;};
    if(request.groups.includes('layout'))for(const [key,value]of Object.entries(boxes.get(item.id)!))set(key as keyof Box,value);
    if(item.type==='text'&&request.groups.includes('typography')){
      const role=request.roles[item.id] as 'headline'|'proof'|'body';set('fontSize',pack.typography[role]);set('weight',pack.typography.weights[role]);set('align',pack.typography.align);set('color','foreground');
    }
    if(!request.groups.includes('motion'))return;
    if(isStyleProtected(request,item.id,'keyframes')||((item.keyframes?.length??0)>0&&!request.replaceTracks)){preservedTracks.push(item.id);return;}
    const rank=ranked.findIndex(text=>text.id===item.id),delay=request.motion==='reduced'?0:Math.max(0,rank)*pack.motion.stagger,arrival=request.motion==='reduced'?6:pack.motion.arrival;
    const frames=new Map<number,NonNullable<CompositionObject['keyframes']>[number]>();
    const key=(frame:number)=>{let point=frames.get(frame);if(!point){point={frame,easing:pack.motion.easing};frames.set(frame,point);}return point;};
    set('keyframes',[]);
    if(!isStyleProtected(request,item.id,'opacity')){set('opacity',0);key(Math.max(1,delay)).opacity=0;key(delay+arrival).opacity=1;}
    if(item.type==='text'&&request.motion!=='reduced'&&!isStyleProtected(request,item.id,'y')){const final=item.y;set('y',final+pack.motion.distance);key(Math.max(1,delay)).y=item.y;key(delay+arrival).y=final;}
    const shortProof=item.type==='text'&&request.roles[item.id]==='proof'&&[...item.text!].length<=22;
    if(shortProof&&pack.motion.revealShortProof&&request.motion!=='reduced'&&!isStyleProtected(request,item.id,'reveal')){set('reveal',0);key(Math.max(1,delay)).reveal=0;key(delay+arrival+4).reveal=1;}
    set('keyframes',[...frames.values()].sort((a,b)=>a.frame-b.frame));
  });
  const fitInputs=text.map(item=>{const adjustable=request.groups.includes('typography')&&!isStyleProtected(request,item.id,'fontSize');return {object:structuredClone(item),minimum:adjustable?pack.typography.minimum:item.fontSize??48,maximum:item.fontSize??48};});
  const action=styleAction(request,scene),next=structuredClone(manifest);
  if(action.type==='add-scene')next.scenes.push(action.scene);else next.scenes[next.scenes.findIndex(item=>item.id===scene.id)]=scene;
  validateManifest(next);
  return {request,scene,action,layoutFamily,preservedTracks,fitInputs};
}
function stack(objects: CompositionObject[],area:Box,boxes:Map<string,Box>,roles:Record<string,StyleRole>,gap:number,poster:boolean){
  const weights=objects.map(item=>(roles[item.id]==='body'?1:poster?1.65:1.35)*Math.max(.8,Math.min(1.8,Math.sqrt([...item.text!].length/36)))),sum=weights.reduce((a,b)=>a+b,0),available=area.height-gap*(objects.length-1);
  let y=area.y;
  objects.forEach((item,index)=>{const height=Math.floor(available*weights[index]/sum);boxes.set(item.id,{x:area.x,y,width:area.width,height});y+=height+gap;});
}
