import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {packageRoot,loadManifest,validateManifest,hashBytes} from './spec.js';
import {readProject} from './project.js';
import {findTools} from './runtime.js';
import {StudioError} from './errors.js';
import {prepareStyle,styleAction,isStyleProtected} from './style-layout.js';
import {auditStyle,measureStyleText} from './style-audit.js';
import {styleIDs,type StylePackage,type CompiledStyle,type StyleRequest,type StyleAction} from './style-types.js';

function fail(message:string,code='STYLE_INPUT'):never{throw new StudioError(code,'style',message,2);}
function validatePackage(value:unknown):StylePackage{
  if(!value||typeof value!=='object'||Array.isArray(value))fail('Invalid distributed style package.');
  const item=value as StylePackage;
  if(item.schemaVersion!==1||!styleIDs.includes(item.id)||item.version!==1||typeof item.label!=='string'||typeof item.instruction!=='string'||!Array.isArray(item.families)||!item.families.length||!item.typography||!item.motion||!item.readability||!Array.isArray(item.provenance))fail('Unsupported style package schema/capabilities.');
  const numeric=[...['headline','proof','body','minimum'].map(key=>item.typography[key as 'headline']),item.motion.arrival,item.motion.stagger,item.motion.distance,item.readability.minimumHoldFrames,item.readability.framesPerWord,item.readability.framesPerCharacter,item.readability.contrast];
   if(numeric.some(value=>!Number.isFinite(value)||value<0)||['headline','proof','body','minimum'].some(key=>item.typography[key as 'headline']<18||item.typography[key as 'headline']>300)||!['outCubic','inOutCubic'].includes(item.motion.easing)||!item.typography.weights||Object.keys(item.typography.weights).length!==3||(['headline','proof','body'] as const).some(role=>![400,700].includes(item.typography.weights[role]))||!['left','center','right'].includes(item.typography.align)||!Number.isInteger(item.motion.arrival)||item.motion.arrival<1||!Number.isInteger(item.motion.stagger)||typeof item.motion.revealShortProof!=='boolean')fail('Unsupported native style parameters.');
  return structuredClone(item);
}
export async function listStylePackages():Promise<StylePackage[]>{
  const packs=[];for(const id of styleIDs){const pack=validatePackage(JSON.parse(await readFile(join(packageRoot,'styles',`${id}.json`),'utf8')));if(pack.id!==id)fail('Style identity mismatch.');packs.push(pack);}return packs;
}
export async function compileStyleForProject(file:string,input:unknown,expectedETag?:string):Promise<CompiledStyle&{etag:string}>{
  const state=await readProject(file);if(expectedETag!==undefined&&state.etag!==expectedETag)fail('Project changed. Explicitly reread and compile a new style request.','PROJECT_CONFLICT');
  const packages=await listStylePackages(),candidate=input as Partial<StyleRequest>,pack=packages.find(item=>item.id===candidate?.styleId);if(!pack)fail('Select a supported authoring style.');
  const draft=prepareStyle(state.manifest,input,pack),spec=await loadManifest(file);
  // Read the actual bundled font coverage, rather than accepting fallback glyphs.
  const css=await readFile(join(packageRoot,'dist/studio/native-fonts.css'),'utf8');
  const ranges=css.split('\n').filter(line=>line.includes('font-family:StudioSans')).flatMap(line=>[...line.matchAll(/U\+([a-f0-9]+)(?:-([a-f0-9]+))?/gi)].map(match=>[parseInt(match[1],16),parseInt(match[2]??match[1],16)]));
  for(const item of draft.fitInputs)for(const char of item.object.text!){const point=char.codePointAt(0)!;if((point<32&&!['\n','\t','\r'].includes(char))||!ranges.some(([start,end])=>point>=start&&point<=end))fail(`Object ${item.object.id} contains a glyph outside bundled StudioSans coverage (U+${point.toString(16).toUpperCase()}). Revise the material/font policy explicitly; no font is downloaded.`, 'STYLE_GLYPH_UNSUPPORTED');}
  let fits;
  try{fits=await measureStyleText(spec,draft,findTools().chrome);}
  catch(error){if(error instanceof Error&&error.message.includes('TEXT_OVERFLOW'))fail(error.message,'STYLE_TEXT_OVERFLOW');throw error;}
  for(const fit of fits){const item=draft.scene.objects!.find(item=>item.id===fit.objectId)!;if(draft.request.groups.includes('typography')&&!isStyleProtected(draft.request,item.id,'fontSize'))item.fontSize=fit.fontSize;}
  if(draft.request.mode==='restyle'&&isDeepStrictEqual(draft.scene.objects,state.manifest.scenes.find(item=>item.id===draft.scene.id)!.objects))fail('No permitted style field changes. Revise allowed groups/locks explicitly.','STYLE_NO_CHANGES');
  const audit=auditStyle(state.manifest,draft,pack,fits),action=styleAction(draft.request,draft.scene),next=structuredClone(state.manifest);
  if(action.type==='add-scene')next.scenes.push(action.scene);else next.scenes[next.scenes.findIndex(item=>item.id===action.sceneId)]=draft.scene;
  validateManifest(next);
  if((await readProject(file)).etag!==state.etag)fail('Project changed during style compilation. Reread and preview explicitly.','PROJECT_CONFLICT');
  return {request:draft.request,action,scene:draft.scene,audit,package:pack,etag:state.etag};
}
function hash(request:StyleRequest,action:StyleAction){return hashBytes(Buffer.from(JSON.stringify({request,action})));}
/** Separate scene-style tickets; existing single-object visual guards remain unchanged. */
export class StyleTickets{
  private tickets=new Map<string,{etag:string;hash:string}>();
  clear(){this.tickets.clear();}
  add(id:string,etag:string,request:StyleRequest,action:StyleAction){this.tickets.clear();this.tickets.set(id,{etag,hash:hash(request,action)});}
  consume(id:unknown,etag:string,request:StyleRequest,action:StyleAction){const ticket=typeof id==='string'?this.tickets.get(id):undefined;if(!ticket||ticket.etag!==etag||ticket.hash!==hash(request,action))fail('Preview this exact style/version, selected scene, groups, roles, locks, parameters and action before Apply.','STYLE_PREVIEW_REQUIRED');this.tickets.clear();}
}
export function assertStyleAction(actual:unknown,compiled:StyleAction){if(!isDeepStrictEqual(actual,compiled))fail('Apply must contain the exact compiled native style action.');}
