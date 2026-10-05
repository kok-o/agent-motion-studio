#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { mkdir, cp, stat, readFile } from 'node:fs/promises';
import { doctor, findTools, cancelProcesses, cancelled, throwIfCancelled } from './runtime.js';
import { render, validateForRender } from './engine.js';
import { verifyVideo } from './media.js';
import { normalizeError, StudioError } from './errors.js';
import { packageRoot } from './spec.js';
import { createProject, importMedia, editProject } from './project.js';
import { startStudio } from './server.js';

const usage = 'agent-motion-studio doctor | new --dir <project> | import <project.json> --file <media> | edit <project.json> --action <action.json> | studio <project.json> [--port 4173] | init <template> --dir <project> | validate <manifest.json> | render <manifest.json> --out <directory> [--overwrite] [--no-cache] | verify <output.mp4> [--json]';
process.on('SIGINT', () => cancelProcesses()); process.on('SIGTERM', () => cancelProcesses());
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { json: { type: 'boolean' }, out: { type: 'string' }, dir: { type: 'string' }, file: { type: 'string' }, action: { type: 'string' }, port: { type: 'string' }, overwrite: { type: 'boolean' }, 'no-cache': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  const [command, input] = positionals;
  if (values.help || !command) { console.log(usage); }
  else {
    let result: unknown;
    if (command === 'doctor') { result = await doctor(); if (!(result as {ready:boolean}).ready) process.exitCode = 3; }
    else if (command === 'new' && values.dir) result = await createProject(values.dir);
    else if (command === 'import' && input && values.file) {
      if ((await stat(values.file)).size > 512 * 1024 * 1024) throw new StudioError('ASSET_LIMIT', 'import', 'Maximum import size is 512 MiB.', 2);
      result = await importMedia(input, values.file, await readFile(values.file));
    }
    else if (command === 'edit' && input && values.action) result = await editProject(input, JSON.parse(await readFile(values.action, 'utf8')));
    else if (command === 'studio' && input) {
      const studio = await startStudio(input, Number(values.port ?? 4173));
      console.log(`Local studio: ${studio.url}\nProject: ${studio.project}\nPress Ctrl+C to stop.`);
      await new Promise<void>(ok => { process.once('SIGINT', () => { void studio.close().then(ok); }); process.once('SIGTERM', () => { void studio.close().then(ok); }); });
      result = { stopped: true };
    }
    else if (command === 'validate' && input) result = await validateForRender(input);
    else if (command === 'render' && input && values.out) result = await render(input, values.out, { overwrite: values.overwrite, noCache: values['no-cache'], progress: message => console.error(message) });
    else if (command === 'verify' && input) result = await verifyVideo(resolve(input), findTools());
    else if (command === 'init' && input && values.dir && ['repo-promo', 'product-ad', 'feature-explainer', 'kinetic-promo', 'orbit-demo', 'coffee-ritual'].includes(input)) {
      const target = resolve(values.dir);
      try { await stat(target); throw new StudioError('PROJECT_EXISTS', 'input', `${target} already exists; choose an empty new directory.`, 2); } catch (error) { if (error instanceof StudioError) throw error; if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const source = join(packageRoot, 'examples', input);
      await mkdir(target, { recursive: true }); await cp(source, target, { recursive: true, filter: file => !file.split(/[\\/]/).some(part => ['.cache', 'exports'].includes(part)) && !/\.(edit-lock|render\.lock)$/.test(file) }); result = { created: true, manifest: join(target, ['orbit-demo', 'coffee-ritual'].includes(input) ? 'project.json' : 'manifest.json') };
    } else throw new StudioError('INVALID_COMMAND', 'input', usage, 2);
    throwIfCancelled();
    console.log(JSON.stringify(result, null, values.json ? undefined : 2));
  }
} catch (error) {
  const normalized = cancelled ? normalizeError(new StudioError('CANCELLED', 'render', 'Rendering cancelled.', 130)) : normalizeError(error);
  console.log(JSON.stringify(normalized)); process.exitCode = normalized.exitCode;
}
