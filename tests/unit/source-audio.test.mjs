import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from '../../dist/spec.js';
import { patchScene } from '../../dist/project.js';
import { validateSourceAudioPackets } from '../../dist/media.js';
import { sourceAudioValues, sourceAudioPatch, mergeSourceAudioConflict } from '../../dist/studio/source-audio.js';

const video = () => ({id:'shot',type:'video',asset:'source',durationFrames:30});
const manifest = scene => ({schemaVersion:2,id:'sound',seed:7,video:{aspectRatio:'16:9',fps:30},brand:{theme:'dark',background:'#10171C',foreground:'#F4F1E9',accent:'#D9EE86',font:'builtin-sans'},assets:{source:{type:'video',path:'source.mp4'}},audio:{narration:{provider:'none'},music:{provider:'none'}},scenes:[scene]});

test('native source audio is strict, optional, video-only, with whole-object patch and null removal',()=>{
  for(const value of [undefined,{enabled:false},{enabled:false,gainDb:-60},{enabled:true},{enabled:true,gainDb:0}])assert.doesNotThrow(()=>validateManifest(manifest({...video(),...(value?{sourceAudio:value}:{})})));
  for(const value of [{},{gainDb:-12},{enabled:'true'},{enabled:1},{enabled:true,gainDb:1},{enabled:true,gainDb:-61},{enabled:true,extra:0},null])assert.throws(()=>validateManifest(manifest({...video(),sourceAudio:value})),error=>error.code==='INVALID_MANIFEST');
  assert.throws(()=>validateManifest(manifest({id:'title',type:'kinetic_title',text:'Title',durationFrames:30,sourceAudio:{enabled:false}})));
  assert.throws(()=>validateManifest({...manifest(video()),schemaVersion:1}));
  const scene={...video(),sourceAudio:{enabled:true,gainDb:-12}};
  assert.deepEqual(patchScene(scene,{sourceAudio:{enabled:true}}).sourceAudio,{enabled:true});
  assert.equal(Object.hasOwn(patchScene(scene,{sourceAudio:null}),'sourceAudio'),false);
  assert.throws(()=>patchScene(scene,{sourceAudio:{gainDb:-6}}));
});

test('source clock validation rejects absent/backward/invalid packet timestamps and permits genuine gaps',()=>{
  assert.doesNotThrow(()=>validateSourceAudioPackets([{pts_time:'-0.02',duration_time:'0.02'},{pts_time:'0',duration_time:'0.02'},{pts_time:'0.5',duration_time:'0.02'}]));
  for(const packets of [[],[{}],[{pts_time:'0',duration_time:'0'}],[{pts_time:'0.5',duration_time:'0.02'},{pts_time:'0.4',duration_time:'0.02'}]])assert.throws(()=>validateSourceAudioPackets(packets),error=>error.code==='SOURCE_AUDIO_CLOCK_UNSUPPORTED'&&error.stage==='validate');
});

test('typed source audio inspector leaves absent fields absent, including older session drafts',()=>{
  const scene=video(),base=sourceAudioValues(scene);
  assert.equal(sourceAudioPatch(scene,base,{...base,duration:'2'}),undefined);
  assert.equal(sourceAudioPatch(scene,{},{}),undefined);
  assert.deepEqual(sourceAudioPatch(scene,base,{...base,'source-audio-enabled':'on'}),{enabled:true,gainDb:0});
  assert.deepEqual(sourceAudioPatch(scene,base,{...base,'source-audio-gain':'-9'}),{enabled:false,gainDb:-9});
  assert.throws(()=>sourceAudioPatch(scene,base,{...base,'source-audio-gain':'1'}));
});

test('typed source audio conflict retains external gain on local switch and external switch on local gain',()=>{
  const scene={...video(),sourceAudio:{enabled:false,gainDb:-6}},base=sourceAudioValues(scene);
  const external={...scene,sourceAudio:{enabled:false,gainDb:-18}};
  const localSwitch={...base,'source-audio-enabled':'on'};
  assert.deepEqual(mergeSourceAudioConflict({enabled:true,gainDb:-6},base,localSwitch,external),{enabled:true,gainDb:-18});
  const localGain={...base,'source-audio-gain':'-9'};
  assert.deepEqual(mergeSourceAudioConflict({enabled:false,gainDb:-9},base,localGain,{...scene,sourceAudio:{enabled:true,gainDb:-6}}),{enabled:true,gainDb:-9});
  assert.deepEqual(mergeSourceAudioConflict({enabled:true,gainDb:-6},base,localSwitch,video()),{enabled:true,gainDb:0});
});
