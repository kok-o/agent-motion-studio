import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve('artifacts/v0.2/visual-expression'),projects=JSON.parse(await readFile(join(root,'projects.json'),'utf8')),log=[];
try{for(const [name,file] of Object.entries(projects)){
  const args=['dist/cli.js','render',file,'--out',join(root,name==='report'?'document-report':'fastgrep','final'),'--json'];
  const r=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,maxBuffer:20e6});log.push({name,args,exit:r.status,stdout:r.stdout,stderr:r.stderr});if(r.status!==0)throw new Error(r.stdout||r.stderr);console.log(name,JSON.parse(r.stdout).totalFrames);
}}finally{await writeFile(join(root,'render-log.json'),JSON.stringify(log,null,2));}
