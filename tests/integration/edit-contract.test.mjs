import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createStudioTool } from '../../scripts/api-agent.mjs';

const cli = resolve('dist/cli.js');
function run(args, expected = 0) {
  const result = spawnSync(process.execPath,[cli,...args,'--json'],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,expected,result.stdout + result.stderr); return JSON.parse(result.stdout);
}
test('real CLI accepts BOM/brand/new/batch; failed batch leaves bytes, history, sources and ETag intact', async () => {
  const root = await mkdtemp(join(tmpdir(),'ams-contract-')), file = join(root,'project.json');
  run(['new','--dir',root,'--aspect','9:16','--title','Название фильма']);
  const state = () => run(['state',file]);
  let n = 0;
  const edit = async (value, expected = 0, etag = state().etag) => { const action = join(root,`action-${n++}.json`); await writeFile(action,'\uFEFF'+JSON.stringify(value)); return run(['edit',file,'--action',action,'--if-match',etag],expected); };
  const initial = state(); assert.equal(initial.manifest.id,'my-film'); assert.equal(initial.manifest.scenes[0].text,'Название фильма'); assert.equal(initial.manifest.video.aspectRatio,'9:16');
  const imported = run(['import',file,'--file',resolve('examples/product-ad/assets/planner.png'),'--if-match',initial.etag]);
  const beforeAssembly = state();
  await edit({type:'batch',label:'Four shots',actions:[{type:'edit-scene',sceneId:'opening',patch:{text:'ONE',durationFrames:30}},...['two','three','four'].map(id=>({type:'add-scene',scene:{id,type:'kinetic_title',text:id,durationFrames:30}}))]});
  const assembled = state(); assert.equal(assembled.manifest.scenes.length,4); assert.equal(assembled.manifest.history.length,beforeAssembly.manifest.history.length+1);
  const baselineRevision = assembled.manifest.revision;
  await edit({type:'brand',patch:{theme:'light'}}); const light = state(); assert.equal(light.manifest.brand.theme,'light'); assert.notEqual(light.manifest.brand.background,assembled.manifest.brand.background); assert.equal(light.manifest.brand.font,assembled.manifest.brand.font);
  await edit({type:'brand',patch:{theme:'dark',accent:'#123456'}}); assert.equal(state().manifest.brand.accent,'#123456');
  await edit({type:'restore',revisionId:baselineRevision}); assert.deepEqual(state().manifest.brand,assembled.manifest.brand);
  const acceptedBytes = await readFile(file), accepted = state(), files = await readdir(join(root,'assets'));
  const badActions = [
    {type:'__proto__'}, {type:'brand',patch:{theme:'blue'}}, {type:'brand',patch:{accent:'#FFF'}}, {type:'brand',patch:{font:'custom'}}, {type:'brand',patch:{}},
    {type:'batch',actions:[]}, {type:'batch',actions:Array(33).fill({type:'music'})}, {type:'batch',label:'x\ny',actions:[{type:'music'}]},
    {type:'batch',actions:[{type:'music',provider:'none'},{type:'batch',actions:[{type:'music'}]}]},
    {type:'batch',actions:[{type:'restore',revisionId:baselineRevision}]}, {type:'batch',actions:[{type:'restore-scene',sceneId:'two',revisionId:baselineRevision}]},
    {type:'batch',actions:[{type:'brand',patch:{accent:'#112233'}},{type:'edit-scene',sceneId:'missing',patch:{text:'NO'}}]},
    {type:'batch',actions:[{type:'edit-scene',sceneId:'two',patch:{durationFrames:0}},{type:'edit-scene',sceneId:'two',patch:{durationFrames:30}}]},
    {type:'batch',actions:[{type:'edit-scene',sceneId:'two',patch:{command:null}}]},
    {type:'batch',actions:[{type:'music',provider:'bogus'},{type:'music',provider:'none'}]},
    {type:'batch',actions:[{type:'composition',video:{aspectRatio:'9:16',fps:30,extra:1}}]},
    {type:'batch',actions:[{type:'brand',patch:{accent:'#123456'},shell:'NO'}]},
    {type:'batch',actions:accepted.manifest.scenes.map(scene=>({type:'remove-scene',sceneId:scene.id}))}
  ];
  for (const bad of badActions) {
    const result = await edit(bad,2); if (bad.type==='batch' && bad.actions?.[1]?.sceneId==='missing') assert.match(result.error.message,/action\[1\]/);
    assert.ok((await readFile(file)).equals(acceptedBytes)); assert.deepEqual(state(),accepted); assert.deepEqual(await readdir(join(root,'assets')),files);
  }
  await edit({type:'batch',actions:[{type:'music'}]},2,initial.etag); assert.ok((await readFile(file)).equals(acceptedBytes));
  assert.equal(state().manifest.assets[imported.importedId].sha256,imported.manifest.assets[imported.importedId].sha256);
  const tools = await createStudioTool(file,root);
  await assert.rejects(tools.execute({operation:'edit',action:JSON.stringify({type:'batch',actions:[{type:'edit-scene',sceneId:'two',patch:{text:'NO PREVIEW'}}]}),etag:accepted.etag,label:null,previewToken:null}),/Batch is unavailable/);
  assert.ok((await readFile(file)).equals(acceptedBytes));
});

test('common JSON reader covers action/request/approval/draft/resolution without exposing malformed content',async()=>{
  const root = await mkdtemp(join(tmpdir(),'ams-json-')), file = join(root,'project.json'); run(['new','--dir',root]);
  const input = join(root,'input.json');
  const commands = [['edit',file,'--action',input],['generation','prepare',file,'--request',input],['generation','submit',file,'--job','missing','--approval',input],['generation','preview',file,'--job','missing','--draft',input,'--if-match',run(['state',file]).etag,'--out',join(root,'preview')],['generation','resolve-unknown',file,'--job','missing','--resolution',input]];
  for (const args of commands) {
    await writeFile(input,'\uFEFF{"secret":"do-not-leak",'); const result=run(args,2); assert.equal(result.error.code,'INVALID_JSON'); assert.match(result.error.message,/input.json/); assert.ok(!JSON.stringify(result).includes('do-not-leak'));
    await writeFile(input,'\uFEFF{}'); const parsed=run(args,2); assert.notEqual(parsed.error.code,'INVALID_JSON');
  }
  assert.equal(run(['new','--dir',join(root,'invalid'),'--aspect','4:3'],2).error.code,'INVALID_MANIFEST');
});
