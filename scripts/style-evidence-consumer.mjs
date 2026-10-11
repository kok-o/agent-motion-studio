import assert from 'node:assert/strict';
import {mkdir,readdir,readFile,writeFile,copyFile,lstat,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const producers=['style-matrix','style-ui','style-audit-negatives','style-failure-contract','style-server'];
const excluded=name=>['.cache','.studio','.git','node_modules','.agents','.claude','exports'].includes(name)||name.startsWith('.session')||name.endsWith('.edit-lock')||name.startsWith('.tmp-');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function styleRunIdentity(root){
  const names=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,windowsHide:true}).toString().split('\0').filter(name=>/^(?:src\/|renderer\/|studio\/|styles\/|scripts\/|tests\/|schemas\/manifest\.schema\.json$|examples\/authoring-styles\/cases\.json$|package(?:-lock)?\.json$|tsconfig\.json$)/.test(name));
  const source={};for(const name of [...new Set(names)].sort())source[name]=digest(await readFile(join(root,name)));
  const runtime={};
  async function walk(folder){for(const item of (await readdir(join(root,folder),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    assert.equal(item.isSymbolicLink(),false);const name=`${folder}/${item.name}`;
    if(item.isDirectory())await walk(name);else if(item.isFile())runtime[name]=digest(await readFile(join(root,name)));
  }}
  await walk('dist');await walk('assets/fonts');
  return {source,runtime,sourceSHA256:digest(JSON.stringify(source)),runtimeSHA256:digest(JSON.stringify(runtime))};
}

export async function styleRunScenarios(root,runId){
  assert.match(runId,/^[a-f0-9-]{36}$/);const scenarios=[];
  async function discover(folder,producer){
    assert.equal((await lstat(folder)).isSymbolicLink(),false);
    const entries=await readdir(folder,{withFileTypes:true});
    if(entries.some(entry=>entry.name==='verification.json'&&entry.isFile())){
      const bytes=await readFile(join(folder,'verification.json')),proof=JSON.parse(bytes);
      assert.equal(proof.status,'PASS');assert.equal(proof.humanArtisticAcceptance,'NOT RUN');
      if(producer==='style-matrix')assert.equal(proof.cases,72);
      scenarios.push({producer,path:relative(root,folder).split(sep).join('/'),verificationSHA256:digest(bytes),style:proof.style??null,aspect:proof.aspect??null,reconciliation:proof.newSessionReopen===true});return;
    }
    for(const entry of entries)if(entry.isDirectory()&&!excluded(entry.name))await discover(join(folder,entry.name),producer);
  }
  for(const producer of producers){const before=scenarios.length;await discover(join(root,'artifacts',producer,runId),producer);assert.equal(scenarios.length-before,producer==='style-ui'?7:1,`Incomplete ${producer} run`);}
  assert.deepEqual(scenarios.filter(item=>item.producer==='style-ui'&&!item.reconciliation).map(item=>`${item.style}/${item.aspect}`).sort(),['calm-product','kinetic-poster','editorial'].flatMap(style=>['16:9','9:16'].map(aspect=>`${style}/${aspect}`)).sort());
  assert.equal(scenarios.filter(item=>item.reconciliation).length,1);return scenarios;
}
/** Retain completed controlled integration proofs; no rendering or QA rerun. */
export async function retainStyleEvidence(root,destination){
  const base=await realpath(root);await mkdir(destination);
  const pointer=JSON.parse(await readFile(join(base,'artifacts/style-runs/latest.json'),'utf8'));
  assert.match(pointer.runId,/^[a-f0-9-]{36}$/);
  const runPath=join(base,'artifacts/style-runs',pointer.runId,'verification.json');assert.equal((await lstat(runPath)).isSymbolicLink(),false);
  const runBytes=await readFile(runPath),run=JSON.parse(runBytes);assert.equal(run.status,'PASS');assert.equal(run.runId,pointer.runId);assert.deepEqual(run.identity,await styleRunIdentity(base),'Source/runtime changed since the selected completed run');
  const scenarios=await styleRunScenarios(base,run.runId);assert.deepEqual(scenarios,run.scenarios);
  const files=new Map();
  async function collect(folder){
    for(const entry of await readdir(folder,{withFileTypes:true})){
      if(excluded(entry.name))continue;
      const source=join(folder,entry.name);assert.equal(entry.isSymbolicLink(),false);
      if(entry.isDirectory()){await collect(source);continue;}
      if(!entry.isFile()||! /\.(?:json|png|wav|mp4|md)$/.test(entry.name))continue;
      const path=relative(base,source);assert.ok(path&&!path.startsWith('..')&&!isAbsolute(path));
      const name=path.split(sep).join('/'),bytes=await readFile(source),target=join(destination,name);if(files.has(name))continue;
      await mkdir(dirname(target),{recursive:true});await copyFile(source,target);assert.equal(digest(await readFile(target)),digest(bytes));
      files.set(name,{file:name,bytes:bytes.length,sha256:digest(bytes)});
    }
  }
  for(const scenario of scenarios)await collect(join(base,scenario.path));
  await writeFile(join(destination,'RUN_SET.json'),runBytes,{flag:'wx'});
  const result={status:'PASS',collectionOnly:true,mediaRerun:false,runId:run.runId,runSetSHA256:digest(runBytes),sourceSHA256:run.identity.sourceSHA256,runtimeSHA256:run.identity.runtimeSHA256,scenarios,files:[...files.values()].sort((a,b)=>a.file.localeCompare(b.file)),derivedRGB:'Native PNGs and measured pixel reports retained; large derived RGB files omitted',humanArtisticAcceptance:'NOT RUN'};
  await writeFile(join(destination,'RAW_MANIFEST.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
}
