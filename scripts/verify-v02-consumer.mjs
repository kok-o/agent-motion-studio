// Offline/local acceptance through a freshly installed runtime, outside checkout.
import assert from 'node:assert/strict';
import { mkdtemp, realpath, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const repo=await realpath(process.cwd()), reportRoot=join(repo,'artifacts/v0.2');
const latest=JSON.parse(await readFile('artifacts/release/latest.json'));
const consumer=await realpath(await mkdtemp(join(tmpdir(),'AMS v0.2 Проверка ')));
const rel=relative(repo,consumer);assert.ok(rel.startsWith('..')||isAbsolute(rel),'Consumer must be outside checkout');
const log=[],report={consumer,resolved:resolve(consumer),realpath:consumer,outsideCheckout:true,archive:latest.runtime,sha256:createHash('sha256').update(await readFile(latest.runtime)).digest('hex'),checks:{},status:'running'};
const save=async()=>{await writeFile(join(reportRoot,'consumer.json'),JSON.stringify(report,null,2));await writeFile(join(reportRoot,'consumer-commands.json'),JSON.stringify(log,null,2));};
async function run(args,cwd=consumer){let stdout='',stderr='';const started=Date.now();const exit=await new Promise((ok,bad)=>{const p=spawn(process.execPath,args,{cwd,windowsHide:true});p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('error',bad);p.on('close',ok);});log.push({args,cwd,exit,seconds:(Date.now()-started)/1000,stdout,stderr});await save();assert.equal(exit,0,stdout+stderr);return stdout;}
try{
  assert.ok(process.env.npm_execpath,'Run with npm run verify:v02');
  await writeFile(join(consumer,'package.json'),JSON.stringify({name:'ams-v02-consumer',private:true,version:'1.0.0'}));
  await run([process.env.npm_execpath,'install','--ignore-scripts','--omit=dev','--no-audit','--no-fund',latest.runtime]);
  const pkg=join(consumer,'node_modules/agent-motion-studio'),cli=join(pkg,'dist/cli.js');report.package=pkg;report.cli=cli;
  report.checks.doctor=JSON.parse(await run([cli,'doctor','--json']));assert.equal(report.checks.doctor.ready,true);
  report.checks.skill=JSON.parse(await run([join(pkg,'scripts/install-agent-skill.mjs'),'--client','both','--scope','project']));
  report.checks.newResources={dictionary:(await readFile(join(pkg,'dist/studio/i18n.js'),'utf8')).includes('initializeI18n'),catalog:(await readFile(join(pkg,'skills/agent-motion-studio/references/edits.md'),'utf8')).includes('E8')};assert.ok(Object.values(report.checks.newResources).every(Boolean));
  const out=join(consumer,'films');report.films=out;await save();
  await run([join(repo,'scripts/verify-briefs.mjs'),'after',cli,pkg,out],repo);
  await cp(join(out,'results.json'),join(reportRoot,'installed-results.json'));await cp(join(out,'commands.json'),join(reportRoot,'installed-cli-commands.json'));await cp(join(out,'REPORT.md'),join(reportRoot,'installed-REPORT.md'));
  const portableCopy=await realpath(await mkdtemp(join(tmpdir(),'AMS Перенос проектов ')));report.secondCopy=portableCopy;
  for(const id of ['B1','B2','B3','B4','B5']){await cp(join(out,'portable',id),join(portableCopy,id),{recursive:true});await run([cli,'validate',join(portableCopy,id,'project.json'),'--json']);await run([cli,'state',join(portableCopy,id,'project.json'),'--json']);}
  // Retain final deliverables in task artifacts as well as the actual installed consumer.
  await cp(join(out,'portable'),join(reportRoot,'projects'),{recursive:true});
  await mkdir(join(reportRoot,'films'),{recursive:true});
  for(const id of ['B1','B2','B3','B4','B5']){
    await mkdir(join(reportRoot,'films',id),{recursive:true});
    for(const version of ['original','changed','restored']){
      await cp(join(out,id,version,'output.mp4'),join(reportRoot,'films',id,`${version}.mp4`));
      await cp(join(out,id,version,'contact-sheet.jpg'),join(reportRoot,'films',id,`${version}-contact.jpg`));
      await cp(join(out,id,version,'render-report.json'),join(reportRoot,'films',id,`${version}-report.json`));
    }
  }
  report.status='passed';report.checks.matrix='B1–B5/E1–E8 plus measured frame/font/source/history/full and scene restore checks';report.checks.secondCopy='all five validated/reopened on this host';await save();console.log(JSON.stringify(report,null,2));
}catch(error){report.status='failed';report.error=error.message;await save();throw error;}
