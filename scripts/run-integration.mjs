import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {styleRunIdentity,styleRunScenarios} from './style-evidence-consumer.mjs';

// One explicit run set; older artifacts are preserved and never considered.
const root=process.cwd(),runId=randomUUID(),directory=join(root,'artifacts/style-runs',runId);
await mkdir(directory,{recursive:true});
const report={status:'running',runId,startedUTC:new Date().toISOString(),identity:await styleRunIdentity(root),command:[process.execPath,...process.argv.slice(2)]};
const save=()=>writeFile(join(directory,'verification.json'),JSON.stringify(report,null,2)+'\n');
await save();
await writeFile(join(root,'artifacts/style-runs/latest.json'),JSON.stringify({runId})+'\n');
let exitCode=1;
try{
  assert.ok(process.argv.includes('--test-concurrency=1'),'Media integration must remain sequential');
  const child=spawn(process.execPath,process.argv.slice(2),{stdio:'inherit',windowsHide:true,env:{...process.env,AMS_STYLE_RUN_ID:runId}});
  exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
  assert.equal(exitCode,0,'Integration tests failed');
  assert.deepEqual(await styleRunIdentity(root),report.identity,'Source/runtime changed during integration');
  report.scenarios=await styleRunScenarios(root,runId);report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.message;exitCode=1;}
report.completedUTC=new Date().toISOString();await save();
// A failed latest run must not fall back to an older green run.
await writeFile(join(root,'artifacts/style-runs/latest.json'),JSON.stringify({runId})+'\n');
process.exitCode=exitCode;
