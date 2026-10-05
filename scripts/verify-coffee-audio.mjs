import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {findTools,runProcess} from '../dist/runtime.js';
const evidence=resolve(process.argv[2]),output=resolve('artifacts/iteration-2/audio');await mkdir(output,{recursive:true});
const exports=JSON.parse(await readFile(join(evidence,'exports.json'),'utf8')),tools=findTools();
const readSamples=async(file,name)=>{const path=join(output,`${name}.f32`);await runProcess(tools.ffmpeg,['-y','-v','error','-threads','1','-i',file,'-vn','-ac','1','-ar','48000','-c:a','pcm_f32le','-f','f32le',path]);const b=await readFile(path);return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const reference=await readSamples(join(exports.original,'mixed.wav'),'reference'),decoded=await readSamples(join(evidence,'original.mp4'),'decoded');
assert.equal(reference.length,20*48000);assert.ok(Math.abs(decoded.length-reference.length)<=1024);
let peak=0,energy=0;for(const n of decoded){peak=Math.max(peak,Math.abs(n));energy+=n*n;}assert.ok(peak>.005&&peak<.99);const rms=Math.sqrt(energy/decoded.length);assert.ok(rms>.001);
const windows=[];for(const seconds of [1,3,6,10,16,19]){const start=seconds*48000;let best={correlation:-1,offsetSamples:0};for(let offset=-48;offset<=48;offset++){let xy=0,xx=0,yy=0;for(let i=start;i<start+4800;i+=3){const x=reference[i],y=decoded[i+offset];xy+=x*y;xx+=x*x;yy+=y*y;}const correlation=xy/Math.sqrt(xx*yy);if(correlation>best.correlation)best={correlation,offsetSamples:offset};}assert.ok(best.correlation>.97&&Math.abs(best.offsetSamples)<=2);windows.push({seconds,...best});}
const report={passed:true,durationSeconds:20,sampleRate:48000,peak,rms,windows,subjectiveListening:'NOT PERFORMED; amplitude and correlation checks are not human listening'};await writeFile(join(output,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
