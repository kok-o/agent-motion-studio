import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { installAgentSkill } from '../../scripts/install-agent-skill.mjs';
const cli=resolve('dist/cli.js'), catalog=JSON.parse(await readFile('tests/briefs/edits.json'));
const run=args=>{const r=spawnSync(process.execPath,[cli,...args,'--json'],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stdout+r.stderr);return JSON.parse(r.stdout);};
test('E1–E8 catalog examples execute through real CLI, preserve sources and restore scene/global settings separately',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ams-catalog-')),file=join(root,'film/project.json');run(['new','--dir',join(root,'film')]);
  const state=()=>run(['state',file]); let n=0;
  const edit=async value=>{const action=join(root,`action-${n++}.json`);await writeFile(action,JSON.stringify(value));const before=state();
    if(value.type==='edit-scene'){const bytes=await readFile(file);const preview=run(['preview',file,'--action',action,'--if-match',before.etag,'--out',join(root,`preview-${n}`)]);assert.equal(preview.stale,false);assert.ok((await readFile(file)).equals(bytes));}
    return run(['edit',file,'--action',action,'--if-match',before.etag]);};
  const original=run(['import',file,'--file',resolve('examples/product-ad/assets/planner.png'),'--if-match',state().etag]);
  const importedHistory=state().manifest.history.length;
  await edit({type:'batch',actions:[{type:'edit-scene',sceneId:'opening',patch:{durationFrames:60,fontSize:110}}, {type:'add-scene',scene:{id:'planner',type:'product_zoom',asset:original.importedId,caption:'Планер',durationFrames:60,fit:'contain'}},{type:'add-scene',scene:{id:'three',type:'kinetic_title',text:'Шаг три',durationFrames:60}},{type:'add-scene',scene:{id:'closing',type:'cta',text:'Готово',label:'Попробуйте',durationFrames:60}}]});
  assert.equal(state().manifest.history.length,importedHistory+1); const baseline=state(),sourceBytes=await readFile(join(root,'film',baseline.manifest.assets[original.importedId].path));
  let revisionBeforeE2,replacement;
  for(const id of ['E1','E2','E3','E4','E5','E6','E7','E8']){
    const before=state();if(id==='E2')revisionBeforeE2=before.manifest.revision;
    if(id==='E6')replacement=run(['import',file,'--file',resolve('examples/feature-explainer/assets/timeline.png'),'--if-match',before.etag]).importedId;
    const vars={'$second':'planner','$third':'three','$shorter':30,'$replacement':replacement,'$beforeE2':revisionBeforeE2,'$style':before.manifest.video.style};
    const substitute=v=>typeof v==='string'&&v.startsWith('$')?vars[v]:v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,substitute(x)])):v;
    await edit(substitute(catalog[id]));const after=state();
    assert.equal(after.manifest.history.length,before.manifest.history.length+(id==='E6'?2:1));
    assert.ok((await readFile(join(root,'film',after.manifest.assets[original.importedId].path))).equals(sourceBytes));
    if(id==='E1')assert.equal(after.manifest.scenes.find(x=>x.id==='opening').text,'Начни с главного');
    if(id==='E2')assert.equal(after.manifest.scenes.find(x=>x.id==='planner').durationFrames,30);
    if(id==='E3')assert.equal(after.manifest.brand.background,'#FFF8E1');
    if(id==='E4')assert.deepEqual(after.manifest.scenes.map(x=>x.id),['opening','three','planner','closing']);
    if(id==='E5')assert.equal(after.manifest.scenes[0].fontSize,130);
    if(id==='E6')assert.equal(after.manifest.scenes.find(x=>x.id==='planner').asset,replacement);
    if(id==='E7'){assert.deepEqual(after.manifest.scenes.find(x=>x.id==='planner'),baseline.manifest.scenes[1]);assert.deepEqual(after.manifest.brand,before.manifest.brand);}
    if(id==='E8')assert.equal(after.manifest.video.aspectRatio,'9:16');
  }
  const vertical=run(['render',file,'--out',join(root,'vertical')]);assert.equal(vertical.verification.passed,true);
  await edit({type:'restore',revisionId:baseline.manifest.revision});const restored=state();
  for(const key of ['scenes','brand','video','audio'])assert.deepEqual(restored.manifest[key],baseline.manifest[key]);
  run(['validate',file]);assert.equal(restored.manifest.video.aspectRatio,'16:9');assert.ok(restored.manifest.assets[replacement]);
  const other=join(root,'.agents/skills/other/SKILL.md');await mkdir(join(root,'.agents/skills/other'),{recursive:true});await writeFile(other,'Existing user skill');
  const installed=await installAgentSkill({client:'both',directory:root});assert.deepEqual(installed.installs.map(x=>x.status),['installed','installed']);assert.equal(await readFile(other,'utf8'),'Existing user skill');
  assert.ok((await readFile(join(root,'.agents/skills/agent-motion-studio/references/edits.md'),'utf8')).includes('E8'));
});
