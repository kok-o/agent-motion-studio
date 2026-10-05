import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const videos = new Map([
  ['kinetic', 'artifacts/quality-v2/final-portrait/output.mp4'],
  ['landscape', 'artifacts/quality-v2/landscape/output.mp4'],
  ['speech', 'artifacts/feature-explainer/output.mp4'],
  ['edge', 'artifacts/edge-online/output.mp4'],
  ['new-voice', 'artifacts/acceptance/edge/different-voice/output.mp4'],
]);
const html = `<!doctype html><meta charset="utf-8"><title>Video acceptance review</title>
<style>body{background:#121416;color:#efeee8;font:16px system-ui;margin:24px}video{display:block;max-width:100%;width:auto;height:70vh;background:#000}button,select{font:inherit;padding:10px;margin:0 10px 14px 0}pre{white-space:pre-wrap}</style>
<h1>Video acceptance review</h1><select id="choice">${[...videos.keys()].map(key => `<option>${key}</option>`).join('')}</select><button id="load">Load</button><button id="play">Play from start</button><video id="video" controls preload="auto" src="/video/kinetic"></video><pre id="status"></pre>
<script>
const video = document.getElementById('video'), status = document.getElementById('status'), choice = document.getElementById('choice');
const events = [];
function update(event) { if(event) events.push({event,time:video.currentTime,source:choice.value}); status.textContent = JSON.stringify({source:choice.value,currentTime:video.currentTime,duration:video.duration,width:video.videoWidth,height:video.videoHeight,ended:video.ended,paused:video.paused,muted:video.muted,volume:video.volume,mediaError:video.error?.message ?? null,events},null,2); }
document.getElementById('load').onclick=()=>{video.src='/video/'+choice.value;video.load();update('load');};
document.getElementById('play').onclick=()=>{video.currentTime=0;video.play().catch(error=>{status.textContent=error.message});};
['loadedmetadata','play','pause','ended','error'].forEach(event=>video.addEventListener(event,()=>update(event)));
video.addEventListener('timeupdate',()=>update());
</script>`;
const server = createServer(async (request, response) => {
  if (request.url === '/') { response.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); response.end(html); return; }
  const key = request.url?.replace('/video/', '');
  const relative = key && videos.get(key);
  if (!relative) { response.writeHead(404); response.end(); return; }
  try {
    const file = path.resolve(relative), size = (await stat(file)).size;
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
    if (range) {
      const start = Number(range[1]), end = Math.min(Number(range[2] || size - 1), size - 1);
      if (start > end) { response.writeHead(416); response.end(); return; }
      response.writeHead(206, {'Content-Type':'video/mp4','Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes','Content-Length':end-start+1});
      createReadStream(file,{start,end}).pipe(response);
    } else { response.writeHead(200, {'Content-Type':'video/mp4','Content-Length':size,'Accept-Ranges':'bytes'}); createReadStream(file).pipe(response); }
  } catch { response.writeHead(404); response.end(); }
});
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/`));
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
