import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import filesystem, { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import { verifyMusicPreview, loopFixture } from '../../scripts/verify-music-preview.mjs';
import { createProject, editProject, readProject, importMedia } from '../../dist/project.js';
import { previewScene } from '../../dist/preview.js';
import { prepareSceneAudio } from '../../dist/audio.js';
import { loadManifest, hashBytes } from '../../dist/spec.js';
import { findTools, runProcess } from '../../dist/runtime.js';

test('music preview cuts the full patched timeline at exact sample boundaries, with independent tones, seed, accents, gain and fades', { timeout: 180000 }, async () => {
  await verifyMusicPreview(resolve('.'), resolve('artifacts/music-preview', randomUUID()), { comprehensive: true });
});

test('music preview preserves prior output and accepted state through stale edits, audio/source failures, independent cleanup failures and narration guards', { timeout: 180000 }, async () => {
  const root = resolve('artifacts/music-preview/lifecycle', randomUUID()); await mkdir(root, { recursive:true });
  const file = (await createProject(root)).project, output = join(root,'preview');
  await editProject(file,{type:'edit-scene',sceneId:'opening',patch:{durationFrames:30}});
  await editProject(file,{type:'music',provider:'procedural',gainDb:-9});
  let state = await readProject(file); const initialBytes = await readFile(file);
  const action = {type:'edit-scene',sceneId:'opening',patch:{text:'UNSAVED MUSIC PREVIEW'}};
  await previewScene(file,action,state.etag,output);
  let priorOutput = await readFile(join(output,'output.mp4'));
  const originalRead = filesystem.readFile, originalRM = filesystem.rm;
  const attemptedCleanup = []; let primary, lockedManifest;
  filesystem.readFile = async (...args) => {
    if (basename(String(args[0])) === 'mixed.wav') {primary = Object.assign(new Error('Controlled full-mix read failure'),{code:'EIO'});throw primary;}
    return originalRead(...args);
  };
  filesystem.rm = async (path, options) => {
    if (String(path).includes('.preview-')) attemptedCleanup.push(String(path));
    if (basename(String(path)).startsWith('.preview-') && !basename(String(path)).startsWith('.preview-work-')) {lockedManifest=path;throw Object.assign(new Error('Controlled temporary manifest lock'),{code:'EPERM'});}
    return originalRM(path,options);
  };
  syncBuiltinESMExports();
  try { await assert.rejects(previewScene(file,action,state.etag,output),error=>error===primary&&error.code==='EIO'&&error.cause instanceof AggregateError); }
  finally {filesystem.readFile=originalRead;filesystem.rm=originalRM;syncBuiltinESMExports();}
  assert.equal(attemptedCleanup.length,2); assert.ok(attemptedCleanup.some(path=>basename(path).startsWith('.preview-work-')));
  assert.deepEqual(await readdir(output),['output.mp4'],'work cleanup attempted despite manifest EPERM'); await rm(lockedManifest);
  assert.ok((await readFile(join(output,'output.mp4'))).equals(priorOutput)); assert.ok((await readFile(file)).equals(initialBytes));

  let externalBytes, externalState, externalEdits=0;
  filesystem.readFile = async (...args) => {
    if (basename(String(args[0]))==='mixed.wav' && externalEdits===0) {
      externalEdits++; externalState=await editProject(file,{type:'edit-scene',sceneId:'opening',patch:{text:'EXTERNAL ACCEPTED'}},state.etag);externalBytes=await originalRead(file);
    }
    return originalRead(...args);
  };
  syncBuiltinESMExports(); let stale;
  try {stale=await previewScene(file,action,state.etag,output);}
  finally {filesystem.readFile=originalRead;syncBuiltinESMExports();}
  assert.equal(externalEdits,1);assert.equal(stale.stale,true);assert.equal(stale.projectHash,state.etag);
  assert.ok((await readFile(file)).equals(externalBytes));assert.deepEqual(await readProject(file),externalState);

  const imported = await importMedia(file,'four-tones.wav',loopFixture());
  await editProject(file,{type:'music',asset:imported.importedId,gainDb:-9});state=await readProject(file);
  const sourcePath=join(root,state.manifest.assets[imported.importedId].path), sourceBytes=await readFile(sourcePath), before=await readFile(file);
  priorOutput=await readFile(join(output,'output.mp4'));let sourceReads=0;
  filesystem.readFile = async (...args) => {
    if (resolve(String(args[0]))===resolve(sourcePath) && ++sourceReads===2) await writeFile(sourcePath,Buffer.concat([sourceBytes,Buffer.from('controlled-source-mutation')]));
    return originalRead(...args);
  };
  syncBuiltinESMExports();
  try {await assert.rejects(previewScene(file,action,state.etag,output),/Source changed while preparing preview/);}
  finally {filesystem.readFile=originalRead;syncBuiltinESMExports();await writeFile(sourcePath,sourceBytes);}
  assert.equal(sourceReads,2);assert.ok((await readFile(file)).equals(before));assert.deepEqual(await readProject(file),state);
  assert.ok((await readFile(join(output,'output.mp4'))).equals(priorOutput));assert.equal(hashBytes(await readFile(sourcePath)),hashBytes(sourceBytes));
  assert.deepEqual(await readdir(output),['output.mp4']);assert.equal((await readdir(root)).some(name=>name.startsWith('.preview-')),false);

  // Fresh, never-accepted native Edge fixtures; no API for changing the global
  // narration provider exists, so do not rewrite the accepted lifecycle project.
  let writes=0, cacheReads=0, providerCalls=0;const originalWrite=filesystem.writeFile, originalSpawn=childProcess.spawn;
  const guards=[];
  for(const voiceScene of ['opening','other']) for(const warm of [false,true]) {
    const dir=join(root,`edge-${voiceScene}-${warm}`);await mkdir(dir,{recursive:true});
    const fixture=structuredClone(state.manifest);fixture.assets={};fixture.audio={narration:{provider:'edge'},music:{provider:'none'}};delete fixture.history;delete fixture.revision;delete fixture.operationReceipts;
    fixture.scenes=[{id:'opening',type:'kinetic_title',text:'Selected',durationFrames:30},{id:'other',type:'kinetic_title',text:'Other',durationFrames:30}];
    fixture.scenes.find(scene=>scene.id===voiceScene).narration={text:'MUST NOT CONTACT SPEECH'};
    const guardFile=join(dir,'project.json');await writeFile(guardFile,JSON.stringify(fixture));
    const cache=join(dir,'.cache','agent-motion-studio','audio');
    let cacheHashes;
    if(warm){
      await mkdir(cache,{recursive:true});const providerVersion='controlled-test-1';
      const fingerprint=hashBytes(JSON.stringify({text:'MUST NOT CONTACT SPEECH',voice:'ru-RU-SvetlanaNeural',rate:'+0%',pitch:'+0Hz',providerVersion,version:'1'}));
      const source=join(dir,'voice.wav'),mp3=join(cache,`${fingerprint}.mp3`);await writeFile(source,loopFixture());
      await runProcess(findTools().ffmpeg,['-y','-v','error','-i',source,'-t','0.2',mp3]);
      await writeFile(join(cache,`${fingerprint}.json`),JSON.stringify({fingerprint,hash:hashBytes(await readFile(mp3)),captions:[{startMs:0,endMs:100,text:'NO REQUEST'}],providerVersion}));
      cacheHashes=Object.fromEntries(await Promise.all((await readdir(cache)).map(async name=>[name,hashBytes(await readFile(join(cache,name)))])));
    }
    const guardState=await readProject(guardFile),guardBytes=await readFile(guardFile),spec=await loadManifest(guardFile);
    filesystem.writeFile=async (...args)=>{writes++;return originalWrite(...args);};
    filesystem.readFile=async (...args)=>{if(String(args[0]).includes('.cache'))cacheReads++;return originalRead(...args);};
    childProcess.spawn=(...args)=>{if(args[1]?.includes('edge_tts')){providerCalls++;throw new Error('Speech must never be invoked');}return originalSpawn(...args);};syncBuiltinESMExports();
    const rejected=error=>error.code==='ONLINE_PREVIEW_UNSUPPORTED'&&error.stage==='preview'&&error.exitCode===2;
    try {
      await assert.rejects(previewScene(guardFile,{type:'edit-scene',sceneId:'opening',patch:{text:'DRAFT'}},guardState.etag,join(dir,'preview')),rejected);
      await assert.rejects(prepareSceneAudio(spec,spec.scenes[0],join(dir,'audio'),findTools()),rejected);
    } finally {filesystem.writeFile=originalWrite;filesystem.readFile=originalRead;childProcess.spawn=originalSpawn;syncBuiltinESMExports();}
    assert.ok((await readFile(guardFile)).equals(guardBytes));assert.equal((await readdir(dir)).some(name=>name.startsWith('.preview-')),false);
    if(warm)assert.deepEqual(Object.fromEntries(await Promise.all((await readdir(cache)).map(async name=>[name,hashBytes(await readFile(join(cache,name)))]))),cacheHashes);
    guards.push({voiceScene,warm,code:'ONLINE_PREVIEW_UNSUPPORTED'});
  }
  assert.equal(writes,0,'guard must run before temporary/mix/speech/cache writes');assert.equal(cacheReads,0);assert.equal(providerCalls,0);assert.ok((await readFile(file)).equals(before));
  await writeFile(join(root,'verification.json'),JSON.stringify({status:'PASS',audioFailurePrimaryRetained:true,cleanupAttempts:attemptedCleanup.map(path=>basename(path)),cleanupEPERMDoesNotSkipWork:true,priorMP4Preserved:true,externalEdits,stale:stale.stale,acceptedBytesHistoryAssetsAndETagPreserved:true,sourceMutationRejectedAndRestored:true,narrationGuardBeforeAudio:true,speechOrCacheWrites:0,humanSoundQuality:'NOT RUN'},null,2));
});
