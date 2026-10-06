import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadManifest } from '../dist/spec.js';
import { openRenderer } from '../dist/browser.js';
import { findTools } from '../dist/runtime.js';
const root=resolve('artifacts/v0.2/visual-expression'),projects=JSON.parse(await readFile(join(root,'projects.json'),'utf8'));
for(const [name,file] of Object.entries(projects)){
  const spec=await loadManifest(file),renderer=await openRenderer(spec,findTools().chrome),out=join(root,name==='report'?'document-report':'fastgrep','review');await mkdir(out,{recursive:true});
  try {const settled=spec.scenes.map(s=>s.startFrame+Math.floor(s.durationFrames*.7));await renderer.sheet(settled,join(out,'settled.jpg'));
    const boundaries=[...new Set(spec.scenes.flatMap(s=>[s.startFrame,s.startFrame+5,s.endFrame-1]))];await renderer.sheet(boundaries,join(out,'boundaries.jpg'));
    for(const frame of settled)await writeFile(join(out,`frame-${frame}.png`),await renderer.frame(frame));
    // Dense sample of visible typing/highlight/progress, separate from artistic playback.
    const moving=name==='fastgrep'?[90,102,117,132,147,156,210,218,225,233]:[90,105,120,150,180,195,225,240,255,273];await renderer.sheet(moving,join(out,'motion-samples.jpg'));
    await writeFile(join(out,'indices.json'),JSON.stringify({settled,boundaries,moving},null,2));
  }finally{await renderer.finish();}
}
