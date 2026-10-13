import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyCurrentKitWorkflow} from '../../scripts/current-kit-consumer.mjs';

test('current kit consumer saves a partial failure before installed workflow startup',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'ams current kit Проверка ')),evidence=join(workspace,'evidence'),page=new EventEmitter();
  let original;
  try{await verifyCurrentKitWorkflow({app:join(workspace,'missing-package'),workspace,evidence,page,cliRun:()=>assert.fail('No CLI before package validation')});}
  catch(error){original=error;}
  assert.equal(original?.code,'ENOENT');
  const report=JSON.parse(await readFile(join(evidence,'verification.json'),'utf8'));
  assert.equal(report.status,'FAIL');assert.ok(report.error);assert.equal(report.modelSessions,0);assert.equal(page.listenerCount('pageerror'),0);
});
