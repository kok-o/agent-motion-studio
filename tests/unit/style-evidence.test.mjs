import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {retainStyleEvidence,styleRunIdentity,styleRunScenarios} from '../../scripts/style-evidence-consumer.mjs';

test('collection selects one completed source/runtime-bound run and retains older roots',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ams-style-evidence-'));
  execFileSync('git',['init'],{cwd:root,windowsHide:true,stdio:'ignore'});
  for(const folder of ['src','dist','assets/fonts','schemas','examples/authoring-styles','artifacts/style-runs'])await mkdir(join(root,folder),{recursive:true});
  await writeFile(join(root,'src/style.ts'),'controlled source');await writeFile(join(root,'dist/style.js'),'controlled runtime');
  await writeFile(join(root,'schemas/manifest.schema.json'),'controlled schema');await writeFile(join(root,'examples/authoring-styles/cases.json'),'controlled cases');
  async function run(){
    const runId=randomUUID();
    for(const producer of ['style-matrix','style-ui','style-audit-negatives','style-failure-contract','style-server']){
      const cases=producer==='style-ui'?[...['calm-product','kinetic-poster','editorial'].flatMap(style=>['16:9','9:16'].map(aspect=>({style,aspect}))),{newSessionReopen:true}]:[{}];
      for(const [index,proof]of cases.entries()){
        const folder=join(root,'artifacts',producer,runId,...(producer==='style-ui'?[String(index)]:[]));await mkdir(folder,{recursive:true});
        await writeFile(join(folder,'verification.json'),JSON.stringify({status:'PASS',humanArtisticAcceptance:'NOT RUN',cases:72,...proof}));
      }
    }
    const report={runId,status:'PASS',identity:await styleRunIdentity(root),scenarios:await styleRunScenarios(root,runId)};
    await mkdir(join(root,'artifacts/style-runs',runId));await writeFile(join(root,'artifacts/style-runs',runId,'verification.json'),JSON.stringify(report));
    return report;
  }
  const old=await run(),current=await run();
  await writeFile(join(root,'artifacts/style-runs/latest.json'),JSON.stringify({runId:current.runId}));
  const collected=await retainStyleEvidence(root,join(root,'collected'));
  assert.equal(collected.scenarios.length,11);assert.equal(collected.runId,current.runId);
  assert.ok(collected.files.every(item=>!item.file.includes(old.runId)));
  assert.equal(JSON.parse(await readFile(join(root,'artifacts/style-runs',old.runId,'verification.json'))).status,'PASS');
  await writeFile(join(root,'dist/style.js'),'changed runtime');
  await assert.rejects(retainStyleEvidence(root,join(root,'changed')),/changed since/);
  await writeFile(join(root,'dist/style.js'),'controlled runtime');
  for(const [index,name]of ['schemas/manifest.schema.json','examples/authoring-styles/cases.json'].entries()){
    const before=await readFile(join(root,name));await writeFile(join(root,name),'changed data');
    await assert.rejects(retainStyleEvidence(root,join(root,`changed-data-${index}`)),/changed since/);
    await writeFile(join(root,name),before);
  }
  await writeFile(join(root,'artifacts/style-runs',current.runId,'verification.json'),JSON.stringify({...current,status:'FAIL'}));
  await assert.rejects(retainStyleEvidence(root,join(root,'failed')));
});
