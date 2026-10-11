import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

// Actual compiled controller with a minimal DOM/host and deferred renderer.
// Proves state-machine interleaving, not browser timing, pixels or persistence.
test('pending render cannot unlock invalid styles; other edits preserve errors until correction or Cancel', async () => {
  const original = readFileSync(process.env.AMS_EDITOR_TEST_MODULE || resolve('dist/studio/object-editor.js'), 'utf8');
  assert.equal(original.split('import { t } from "./i18n.js";').length - 1, 1);
  const code = original.replace('import { t } from "./i18n.js";', 'const t = value => value;').replace(/export \{\s*initObjectEditor\s*\};/, 'globalThis.editorInit = initObjectEditor;');
  const nodes = new Map();
  class Element {
    constructor() { this.value=''; this.disabled=false; this.hidden=false; this.dataset={}; this.attrs={}; this.children=[]; this.style={}; this.classList={add(){}}; this.validity={badInput:false}; this.validationMessage=''; }
    setCustomValidity(value) { this.validationMessage=value; }
    setAttribute(key,value) { this.attrs[key]=value; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children=children; }
    querySelectorAll() { return [...nodes.values()].filter(n=>n instanceof Input||n instanceof Button||n instanceof Select||n instanceof Textarea); }
    getBoundingClientRect() { return {width:540,left:0,top:0}; }
    pause() {}
    showModal() { this.open=true; }
    close() { this.open=false; }
  }
  class Input extends Element {} class Button extends Element {} class Select extends Element {} class Textarea extends Element {}
  class Video extends Element {} class Canvas extends Element {} class SVG extends Element {} class Dialog extends Element {}
  const inputs=['visual-x','visual-y','visual-width','visual-height','visual-frame','duration','visual-color','visual-font-size','visual-stroke','visual-stroke-width','visual-radius'];
  const buttons=['save-scene','preview-scene','visual-cancel','reload','visual-dialog-apply','visual-dialog-discard','visual-dialog-stay','visual-layer-up','visual-layer-down','visual-add-text','visual-add-rect','visual-add-ellipse','visual-add-image','visual-image-add','visual-image-cancel'];
  const selects=['visual-mode','visual-weight','visual-align','visual-image-asset'];
  function node(id) {
    if(!nodes.has(id)) { const C=inputs.includes(id)?Input:buttons.includes(id)?Button:selects.includes(id)?Select:id==='visual-text'?Textarea:id==='scene-preview'?Video:id==='stage'?Canvas:id==='visual-overlay'?SVG:['visual-dialog','visual-image-dialog'].includes(id)?Dialog:Element;nodes.set(id,new C()); }
    return nodes.get(id);
  }
  node('visual-stage-space').clientWidth=540;
  let hold=false,release,initializeCalls=0;
  const context={structuredClone,Promise,Error,Number,String,Boolean,Math,Set,Map,Array,Object,JSON,
    HTMLInputElement:Input,HTMLButtonElement:Button,HTMLSelectElement:Select,HTMLTextAreaElement:Textarea,HTMLVideoElement:Video,HTMLCanvasElement:Canvas,SVGSVGElement:SVG,SVGElement:SVG,HTMLDialogElement:Dialog,HTMLElement:Element,
    ResizeObserver:class {observe(){}},document:{getElementById:node,querySelectorAll(){return[];},createElementNS(){return new SVG();},createElement(){return new Element();},head:{append(script){script.onload();}}},
    window:{addEventListener(){},studio:{async initialize(){initializeCalls++;if(hold)await new Promise(resolve=>{release=resolve;});},renderFrame(){}}}};
  vm.createContext(context);vm.runInContext(code,context);
  const object={id:'title',type:'text',text:'Title',x:40,y:40,width:600,height:180,fontSize:32};
  const scene={id:'objects',type:'composition',durationFrames:30,objects:[object]},tag='a'.repeat(64),writes=[];
  let dirty=false,editor;
  const host={getScene:()=>scene,getManifest:()=>({scenes:[scene]}),getPatch:()=>({durationFrames:30}),validatePatch:()=>({durationFrames:30}),isDirty:()=>dirty,isBusy:()=>false,changed:()=>{dirty=true;},setDirty:value=>{dirty=value;},notice(){},task:async operation=>operation(),discard(){},accepted(){},
    reopen(){dirty=false;editor.reset();editor.sync(scene,{etag:tag});},
    async api(path,options){if(path.startsWith('/api/visual/state'))return{etag:tag,spec:{width:1920,height:1080,scenes:[{...scene,startFrame:0,endFrame:30}],totalFrames:30}};writes.push({path,options});return{projectHash:tag,previewId:'synthetic-preview',url:'/synthetic.mp4'};}};
  async function flush(){for(let index=0;index<30;index++)await Promise.resolve();}
  function change(id,value){node(id).value=value;node(id).onchange();}
  editor=context.editorInit(host);editor.sync(scene,{etag:tag});await flush();
  assert.equal(node('preview-scene').disabled,false);
  hold=true;change('visual-color','#123456');await flush();assert.equal(typeof release,'function');
  change('visual-font-size','301');assert.notEqual(node('visual-font-size').validationMessage,'');assert.equal(node('preview-scene').disabled,true);
  hold=false;release();await flush();
  assert.equal(node('visual-font-size').value,'301');assert.notEqual(node('visual-font-size').validationMessage,'');assert.equal(node('preview-scene').disabled,true,'stale renderer must not unlock invalid raw input');
  await editor.preview();assert.equal(await editor.apply(),false);assert.equal(writes.length,0,'direct controller calls cannot bypass invalid draft');
  change('visual-weight','700');change('visual-x','60');await flush();
  assert.equal(node('visual-font-size').value,'301');assert.notEqual(node('visual-font-size').validationMessage,'');assert.equal(node('preview-scene').disabled,true);
  change('visual-color','red');change('visual-font-size','40');await flush();
  assert.equal(node('visual-color').value,'red');assert.notEqual(node('visual-color').validationMessage,'');assert.equal(node('visual-font-size').validationMessage,'');assert.equal(node('preview-scene').disabled,true,'fixing one error preserves another');
  await editor.preview();assert.equal(writes.length,0);
  change('visual-color','#d834aa');await flush();assert.equal(node('preview-scene').disabled,false);
  await editor.preview();assert.equal(writes.length,1);
  const outgoing=JSON.parse(writes[0].options.body).patch.objects[0];assert.deepEqual([outgoing.color,outgoing.fontSize,outgoing.weight,outgoing.x],['#d834aa',40,700,60]);
  change('visual-font-size','301');assert.equal(await editor.apply(),false);assert.equal(writes.length,1,'invalidating a preview also blocks Apply');
  const cancel=editor.reopen();await flush();node('visual-dialog-discard').onclick();await cancel;await flush();
  assert.equal(node('visual-font-size').value,'32');assert.equal(node('visual-font-size').validationMessage,'');assert.equal(node('visual-color').value,'');assert.equal(node('preview-scene').disabled,false);assert.equal(object.fontSize,32);assert.equal(initializeCalls>=3,true);
});
