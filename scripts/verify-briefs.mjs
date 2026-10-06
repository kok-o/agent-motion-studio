// Sequential developer/installed-consumer evidence. Uses only CLI mutations.
import { readFile, writeFile, mkdir, cp, realpath, stat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const [mode = 'before', cliArg = 'dist/cli.js', packageArg = '.', outArg = `artifacts/v0.2/${mode}`] = process.argv.slice(2);
const cli = resolve(cliArg), pkg = resolve(packageArg), out = resolve(outArg);
await mkdir(out, { recursive: true });
const briefs = JSON.parse(await readFile('tests/briefs/matrix.json'));
const catalog = JSON.parse(await readFile('tests/briefs/edits.json'));
const log = [], results = [], digest = b => createHash('sha256').update(b).digest('hex');
async function command(args, allowFailure = false) {
  const started = Date.now(); let stdout = '', stderr = '';
  const exit = await new Promise((ok, reject) => { const child = spawn(process.execPath, [cli, ...args], { windowsHide: true }); child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b); child.on('error', reject); child.on('close', ok); });
  const record = { args, exit, seconds: (Date.now() - started) / 1000, stdout, stderr }; log.push(record);
  await writeFile(join(out, 'commands.json'), JSON.stringify(log, null, 2));
  if (exit !== 0 && !allowFailure) throw new Error(`${args[0]} failed (${exit}): ${stdout} ${stderr}`);
  let value; try { value = JSON.parse(stdout); } catch { value = { stdout }; }
  return { ...record, value };
}
const state = async file => (await command(['state', file, '--json'])).value;
async function action(file, value, label, allowFailure = false) {
  const path = join(dirname(file), `${label}.action.json`); await writeFile(path, JSON.stringify(value));
  const before = await state(file), bytes = await readFile(file);
  if (value.type === 'edit-scene' && label.startsWith('E')) {
    const preview = await command(['preview', file, '--action', path, '--if-match', before.etag, '--out', join(dirname(file), `${label}-preview`), '--json'], allowFailure);
    assert.equal(digest(await readFile(file)), digest(bytes), 'preview must not save');
    if (preview.exit) return preview;
    assert.equal(preview.value.stale, false);
  }
  const edited = await command(['edit', file, '--action', path, '--if-match', before.etag, '--json'], allowFailure);
  if (edited.exit) assert.equal(digest(await readFile(file)), digest(bytes), 'failure must not save');
  return edited;
}
async function render(file, directory) { const result = await command(['render', file, '--out', directory, '--json']); assert.equal(result.value.verification.passed, true); return result.value; }
const hashCache = new Map();
async function frameHashes(video) {
  if (hashCache.has(video)) return hashCache.get(video);
  const args=['-v','error','-threads','1','-i',video,'-map','0:v:0','-an','-f','framemd5','-'];let stdout='',stderr='';const started=Date.now();
  const exit=await new Promise((ok,bad)=>{const p=spawn(process.env.FFMPEG_PATH??'ffmpeg',args,{windowsHide:true});p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('error',bad);p.on('close',ok);});
  assert.equal(exit,0,stderr);const hashes=stdout.split('\n').filter(x=>x&&!x.startsWith('#')).map(x=>x.split(',').at(-1).trim());
  await writeFile(join(dirname(video),'frame-hashes.json'),JSON.stringify({command:args,exit,seconds:(Date.now()-started)/1000,hashes},null,2));hashCache.set(video,hashes);return hashes;
}
async function compareScenes(beforeExport,before,afterExport,after,changedId){
  const old=await frameHashes(beforeExport.outputFile),fresh=await frameHashes(afterExport.outputFile);
  const intervals=manifest=>{let cursor=0;return new Map(manifest.scenes.map(scene=>{const start=cursor;cursor+=scene.durationFrames;return[scene.id,{start,scene}];}));};
  const a=intervals(before),b=intervals(after);let matched=0;const checked=[];
  for(const [id,{start,scene}]of a){if(id===changedId||!b.has(id))continue;const next=b.get(id);assert.deepEqual(next.scene,scene);assert.deepEqual(fresh.slice(next.start,next.start+scene.durationFrames),old.slice(start,start+scene.durationFrames),`unchanged decoded scene ${id}`);matched+=scene.durationFrames;checked.push(id);}
  return{scenes:checked,decodedFramesMatched:matched,comparison:'by stable scene ID and local time'};
}
for (const [id, brief] of Object.entries(briefs)) {
  console.log(`${mode}: ${id}`); const started = Date.now(), directory = join(out, id), file = join(directory, 'project.json');
  await command(['new', '--dir', directory, ...(mode === 'before' ? [] : ['--aspect', brief.aspect, '--title', brief.title]), '--json']);
  const ids = {};
  const importFile = async (name, path) => { const s = await state(file); ids[name] = (await command(['import', file, '--file', path, '--if-match', s.etag, '--json'])).value.importedId; };
  if (id === 'B2') {
    await importFile('planner', join(pkg, 'examples/product-ad/assets/planner.png'));
  }
  if (id === 'B5') {
    const source = JSON.parse(await readFile(join(pkg, 'examples/coffee-ritual/project.json')));
    for (const [key, name] of [['wide', 'extraction-wide.mp4'], ['detail', 'extraction-detail.mp4'], ['score', 'ritual-score.wav']]) await importFile(key, join(pkg, 'examples/coffee-ritual', Object.values(source.assets).find(a => a.name === name).path));
    for (const name of ['CREDITS.md', 'LICENSE.md', 'provenance.json']) await cp(join(pkg, 'examples/coffee-ritual', name), join(directory, name));
  } else await writeFile(join(directory, 'CREDITS.md'), 'Original fictional copy, procedural music and synthetic drawings: Agent Motion Studio, MIT. Fonts: SIL OFL. No external calls/media generation.\n');
  const scenes = brief.scenes.map(scene => ({ ...scene, ...(scene.asset ? { asset: ids[scene.asset.slice(1)] } : {}) }));
  if (mode === 'before') for (const scene of scenes) if (scene.type === 'kinetic_title' && scene.label) delete scene.label;
  const assembly = [{ type: 'composition', video: { aspectRatio: brief.aspect, fps: 30, style: brief.style ?? 'kinetic' } }, { type: 'edit-scene', sceneId: 'opening', patch: Object.fromEntries(Object.entries(scenes[0]).filter(([key]) => !['id','type'].includes(key))) }, ...scenes.slice(1).map(scene => ({ type: 'add-scene', scene }))];
  if (brief.music) assembly.push(brief.music === 'procedural' ? { type: 'music', provider: 'procedural', gainDb: -18 } : { type: 'music', asset: ids.score, gainDb: -10 });
  if (mode === 'before') {
    for (let i = 0; i < assembly.length; i++) await action(file, assembly[i], `initial-${i}`);
    const brand = await action(file, { type: 'brand', patch: { theme: brief.theme, ...brief.brand } }, 'brand-gap', true);
    results.push({ id, gap: brand.exit ? brand.value : null });
  } else { const initial = await state(file); await action(file, { type: 'batch', label: `Create ${id}`, actions: [{ type: 'brand', patch: { theme: brief.theme, ...brief.brand } }, ...assembly] }, 'initial-batch'); assert.equal((await state(file)).manifest.history.length, initial.manifest.history.length + 1); }
  const baseline = await state(file), original = await render(file, join(directory, 'original'));
  const row = results.find(r => r.id === id) ?? { id }; if (!results.includes(row)) results.push(row);
  row.original = original; row.edits = []; row.aspect = baseline.manifest.video.aspectRatio; row.frames = original.totalFrames;
  const sources = Object.fromEntries(await Promise.all(Object.entries(baseline.manifest.assets).map(async ([key,a]) => [key,digest(await readFile(join(directory,a.path)))])));
  let beforeE2, previousExport = original;
  if (mode !== 'before' || ['B1','B3','B4'].includes(id)) for (const edit of brief.edits) {
    const s = await state(file); if (edit === 'E2') beforeE2 = s.manifest.revision;
    if (edit === 'E6') await importFile('replacement', join(pkg, 'examples/product-ad/assets/planner-alternative.png'));
    const second = baseline.manifest.scenes[1].id, third = baseline.manifest.scenes[2].id;
    const variables = { '$second': second, '$third': third, '$shorter': s.manifest.scenes.find(x=>x.id===second).durationFrames - 30, '$replacement': ids.replacement, '$beforeE2': beforeE2, '$style': s.manifest.video.style };
    const substitute = value => typeof value === 'string' && value.startsWith('$') ? variables[value] : Array.isArray(value) ? value.map(substitute) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k,substitute(v)])) : value;
    const value = substitute(catalog[edit]), edited = await action(file, value, edit, mode === 'before');
    row.edits.push({ edit, exit: edited.exit, result: edited.exit ? edited.value : 'accepted' });
    if (edited.exit) continue;
    const current = await state(file);
    assert.equal(current.manifest.history.length, s.manifest.history.length + (edit === 'E6' ? 2 : 1));
    if (edit === 'E2') assert.equal(current.manifest.scenes.find(x=>x.id===second).durationFrames, s.manifest.scenes.find(x=>x.id===second).durationFrames - 30);
    if (edit === 'E7') { assert.deepEqual(current.manifest.scenes.find(x=>x.id===second), baseline.manifest.scenes[1]); assert.deepEqual(current.manifest.brand,s.manifest.brand); }
    if (edit === 'E8') assert.equal(current.manifest.video.aspectRatio,'9:16');
    if (mode !== 'before') {
      const exported = await render(file, join(directory, `${edit}-export`)); row.edits.at(-1).export = exported;
      if (edit === 'E5') {
        const oldSpec = JSON.parse(await readFile(join(dirname(previousExport.outputFile), 'resolved-manifest.json'))), newSpec = JSON.parse(await readFile(join(dirname(exported.outputFile), 'resolved-manifest.json')));
        const oldSize = oldSpec.scenes.find(x=>x.id==='opening').layout.fontSize, newSize = newSpec.scenes.find(x=>x.id==='opening').layout.fontSize;
        assert.ok(newSize > oldSize, 'E5 must increase actual fitted font'); row.edits.at(-1).fontGrowth = { before: oldSize, after: newSize };
      }
      if (!['E3','E8'].includes(edit)) row.edits.at(-1).frameComparison = await compareScenes(previousExport, s.manifest, exported, current.manifest, value.type === 'edit-scene' || value.type === 'restore-scene' ? value.sceneId : null);
      if (edit === 'E7') {
        const referenceAction = { type:'edit-scene',sceneId:second,patch:Object.fromEntries(Object.entries(baseline.manifest.scenes[1]).filter(([key])=>!['id','type'].includes(key))) }, referenceFile = join(directory,'E7-reference.action.json'), referenceOut = join(directory,'E7-reference-preview');
        await writeFile(referenceFile,JSON.stringify(referenceAction));const acceptedBytes=await readFile(file);
        const reference = await command(['preview',file,'--action',referenceFile,'--if-match',current.etag,'--out',referenceOut,'--json']);assert.equal(reference.value.stale,false);assert.ok((await readFile(file)).equals(acceptedBytes));
        let start=0;for(const scene of current.manifest.scenes){if(scene.id===second)break;start+=scene.durationFrames;}
        assert.deepEqual((await frameHashes(exported.outputFile)).slice(start,start+baseline.manifest.scenes[1].durationFrames),await frameHashes(reference.value.output),'E7 matches pre-E2 scene under CURRENT global brand/format');
        row.edits.at(-1).restoredSceneFramesMatched=baseline.manifest.scenes[1].durationFrames;row.edits.at(-1).reference='Pre-E2 scene parameters with current global brand/video, independently previewed without commit';
      }
      previousExport = exported;
    }
  }
  row.changed = await render(file, join(directory, 'changed'));
  if (mode !== 'before') {
    await action(file,{type:'restore',revisionId:baseline.manifest.revision},'full-restore');
    const restored = await state(file); for (const key of ['scenes','brand','video','audio']) assert.deepEqual(restored.manifest[key],baseline.manifest[key]);
    row.restored = await render(file,join(directory,'restored'));
    assert.deepEqual(await frameHashes(row.restored.outputFile), await frameHashes(original.outputFile), 'full restore must match all decoded original frames');
    row.restoredFramesMatched = original.totalFrames;
    row.fullRestoreIdenticalFile = digest(await readFile(row.restored.outputFile)) === digest(await readFile(original.outputFile));
    // Re-accept the desired changed revision using project API; never copy old JSON.
    const changedRevision = restored.manifest.history.at(-1).id;
    await action(file,{type:'restore',revisionId:changedRevision},'preferred-version');
    for (const [key,hash] of Object.entries(sources)) assert.equal(digest(await readFile(join(directory,(await state(file)).manifest.assets[key].path))),hash);
    const portable = join(out, 'portable', id); await mkdir(portable,{recursive:true});
    for (const name of ['project.json','assets','CREDITS.md','LICENSE.md','provenance.json']) { try { await stat(join(directory,name)); } catch { continue; } await cp(join(directory,name),join(portable,name),{recursive:true}); }
    await command(['validate',join(portable,'project.json'),'--json']); await state(join(portable,'project.json')); row.portable = await realpath(portable);
  }
  row.seconds = (Date.now()-started)/1000; await state(file);
  await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));
  await writeFile(join(out,'REPORT.md'),`# ${mode} developer self-run\n\nNot an independent user or human visual/audio acceptance.\n\n${results.map(r=>`- ${r.id}: ${r.frames} frames, ${r.aspect}; ${r.edits.map(e=>`${e.edit}: exit ${e.exit}`).join(', ')}; ${r.seconds}s. ${r.gap ? 'Brand unsupported at baseline.' : ''}`).join('\n')}\n`);
}
console.log(`Saved ${out}`);
