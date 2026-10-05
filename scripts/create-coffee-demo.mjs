import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createProject, importMedia, editProject } from '../dist/project.js';
import { findTools, runProcess } from '../dist/runtime.js';
import { hashBytes } from '../dist/spec.js';

// The upstream film is downloaded separately and retained only as provenance.
const source = resolve('artifacts/iteration-2/footage/morning-espresso.webm');
const dir = resolve('examples/coffee-ritual'), work = resolve('artifacts/iteration-2/footage/prepared');
await mkdir(work,{recursive:true}); const file=(await createProject(dir)).project, tools=findTools();
const clips=[{name:'extraction-wide.mp4',start:32,filter:'scale=1920:1080'}, {name:'first-drops.mp4',start:28,filter:'scale=1920:1080'}, {name:'extraction-detail.mp4',start:43,filter:'crop=1280:720:280:230,scale=1920:1080'}];
for(const clip of clips) await runProcess(tools.ffmpeg,['-y','-v','error','-threads','1','-filter_threads','1','-ss',String(clip.start),'-i',source,'-t','9','-an','-vf',`${clip.filter},fps=30,setsar=1`,'-c:v','libx264','-threads','2','-preset','medium','-crf','18','-rc-lookahead','12','-pix_fmt','yuv420p','-movflags','+faststart',join(work,clip.name)]);
await runProcess(tools.ffmpeg,['-y','-v','error','-ss','48','-i',source,'-frames:v','1','-threads','1',join(work,'espresso.png')]);
await copyFile('examples/orbit-sources/orbit-score.wav',join(work,'ritual-score.wav'));
const ids={};for(const name of [...clips.map(c=>c.name),'espresso.png','ritual-score.wav'])ids[name]=(await importMedia(file,name,await readFile(join(work,name)))).importedId;
await editProject(file,{type:'edit-scene',sceneId:'opening',patch:{text:'DAILY\nRITUAL',highlight:'RITUAL',durationFrames:90}});
await editProject(file,{type:'add-scene',scene:{id:'first-pour',type:'video',asset:ids['extraction-wide.mp4'],trimStartSeconds:1,durationFrames:210,fit:'cover',focalPoint:{x:.5,y:.5}}});
await editProject(file,{type:'add-scene',scene:{id:'closer',type:'video',asset:ids['extraction-detail.mp4'],trimStartSeconds:1,durationFrames:180,fit:'cover',focalPoint:{x:.5,y:.5}}});
await editProject(file,{type:'add-scene',scene:{id:'take-a-moment',type:'product_zoom',asset:ids['espresso.png'],caption:'TAKE A\nMOMENT',durationFrames:120,fit:'cover',focalPoint:{x:.53,y:.56}}});
await editProject(file,{type:'music',asset:ids['ritual-score.wav'],gainDb:-10});
const manifest=JSON.parse(await readFile(file,'utf8'));manifest.id='daily-ritual';manifest.brand={...manifest.brand,background:'#171411',foreground:'#F5EADD',accent:'#E7AA66'};
// Deliver a clean authored baseline; subsequent user edits create ordinary history.
manifest.history=[];await writeFile(file,JSON.stringify(manifest,null,2)+'\n');
const provenance={author:'Scott Schiller',title:'Morning Espresso Routine: Progress, Results, Observations and Miscellany',original:'https://www.flickr.com/photos/schill/14588642105/',download:'https://upload.wikimedia.org/wikipedia/commons/3/36/Morning_Espresso_Routine_-_Progress%2C_Results%2C_Observations_and_Miscellany.webm',commons:'https://commons.wikimedia.org/wiki/File:Morning_Espresso_Routine_-_Progress,_Results,_Observations_and_Miscellany.webm',license:'CC BY-SA 2.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/2.0/',checkedOn:'2026-10-05',upstreamSha256:hashBytes(await readFile(source)),transformations:clips,stillSeconds:48,originalAudio:'removed',music:'Original deterministic procedural score from Agent Motion Studio (MIT); no sampled recording',assets:manifest.assets};
await writeFile(join(dir,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
provenance.licenseDiscrepancy='Commons lists historic CC BY 2.0, reviewed 2015-04-30; the current Flickr author link is CC BY-SA 2.0. This distribution follows CC BY-SA 2.0 for derivatives and finished remix.';
await writeFile(join(dir,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
await writeFile(join(dir,'LICENSE.md'),'# Media and composition license\n\nThe edited footage, still, finished film and this example composition are distributed under CC BY-SA 2.0: https://creativecommons.org/licenses/by-sa/2.0/ . Retain attribution and changes in CREDITS.md. The separate original WAV and application code remain MIT.\n\n'+await readFile('LICENSE','utf8'));
console.log(JSON.stringify({project:file,assets:ids,provenance:join(dir,'provenance.json')},null,2));
