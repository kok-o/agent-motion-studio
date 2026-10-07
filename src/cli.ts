#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, join, dirname } from 'node:path';
import { mkdir, cp, stat, readFile } from 'node:fs/promises';
import { doctor, findTools, cancelProcesses, cancelled, throwIfCancelled } from './runtime.js';
import { render, validateForRender } from './engine.js';
import { verifyVideo } from './media.js';
import { normalizeError, StudioError } from './errors.js';
import { packageRoot } from './spec.js';
import { createProject, importMedia, editProject, readProject } from './project.js';
import { startStudio } from './server.js';
import { GenerationService } from './generation.js';
import { createReplicateProvider } from './generation-provider.js';
import { GenerationStore } from './generation-store.js';
import { previewScene } from './preview.js';
import { readJsonInput } from './json-input.js';

const usage = 'agent-motion-studio doctor | new --dir <project> [--aspect 9:16|16:9] [--title TEXT] | state <project.json> | import <project.json> --file <media> [--if-match <etag>] | edit <project.json> --action <action.json> [--if-match <etag>] | preview <project.json> --action <action.json> --if-match <etag> --out <new-directory> | generation <capabilities|prepare|list|status|submit|resume|download|preview|accept|reject|stop|resolve-unknown|bind-store> <project.json> [--job <id>] [--request <file>] [--approval <file>] [--resolution <file>] [--draft <file>] [--preview <id>] [--if-match <etag>] [--operation-id <id>] [--out <directory>] | studio <project.json> [--port 4173] | init <template> --dir <project> | validate <manifest.json> | render <manifest.json> --out <directory> [--overwrite] [--no-cache] | verify <output.mp4> [--json]';
process.on('SIGINT', () => cancelProcesses()); process.on('SIGTERM', () => cancelProcesses());
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { json: { type: 'boolean' }, out: { type: 'string' }, dir: { type: 'string' }, aspect: { type: 'string' }, title: { type: 'string' }, file: { type: 'string' }, action: { type: 'string' }, port: { type: 'string' }, request: { type: 'string' }, approval: { type: 'string' }, resolution: { type: 'string' }, job: { type: 'string' }, draft: { type: 'string' }, preview: { type: 'string' }, 'if-match': { type: 'string' }, 'operation-id': { type: 'string' }, overwrite: { type: 'boolean' }, 'no-cache': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  const [command, input] = positionals;
  if (values.help || !command) { console.log(usage); }
  else {
    let result: unknown;
    if (command === 'doctor') { result = await doctor(); if (!(result as {ready:boolean}).ready) process.exitCode = 3; }
    else if (command === 'new' && values.dir) result = await createProject(values.dir, { aspect: values.aspect as '9:16' | '16:9' | undefined, title: values.title });
    else if (command === 'state' && input) result = await readProject(resolve(input));
    else if (command === 'import' && input && values.file) {
      if ((await stat(values.file)).size > 512 * 1024 * 1024) throw new StudioError('ASSET_LIMIT', 'import', 'Maximum import size is 512 MiB.', 2);
      result = await importMedia(input, values.file, await readFile(values.file), values['if-match']);
    }
    else if (command === 'edit' && input && values.action) result = await editProject(input, await readJsonInput(values.action) as Parameters<typeof editProject>[1], values['if-match']);
    else if (command === 'preview' && input) {
      if (!values.action || !values['if-match'] || !values.out) throw new StudioError('INVALID_COMMAND', 'input', 'preview requires --action, --if-match and --out (a new directory).', 2);
      const action = await readJsonInput(values.action) as Parameters<typeof previewScene>[1], output = resolve(values.out);
      // Reserve a fresh output directory. A local draft must never overwrite an
      // accepted source or an earlier export selected accidentally as --out.
      await mkdir(dirname(output), { recursive: true });
      try { await mkdir(output); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new StudioError('OUTPUT_EXISTS', 'preview', 'Preview output already exists. Choose a new --out directory; existing files were kept.', 2); throw error; }
      result = { ...(await previewScene(resolve(input), action, values['if-match'], output)), output: join(output, 'output.mp4') };
    }
    else if (command === 'generation' && input === 'capabilities' && !positionals[2]) result = createReplicateProvider().capabilities();
    else if (command === 'generation' && input === 'bind-store' && positionals[2]) result = await new GenerationStore(resolve(positionals[2])).bindLegacy();
    else if (command === 'generation' && input && positionals[2]) {
      const service = new GenerationService(resolve(positionals[2]));
      const readJson = async (path: string) => await readJsonInput(resolve(path)) as any;
      const required = (name: 'job' | 'request' | 'approval' | 'resolution' | 'draft' | 'preview' | 'if-match' | 'operation-id' | 'out') => {
        const value = values[name]; if (!value) throw new StudioError('INVALID_COMMAND', 'input', `generation ${input} requires --${name}.`, 2); return value;
      };
      switch (input) {
        case 'capabilities': result = await service.capabilities(); break;
        case 'prepare': result = await service.prepare(await readJson(required('request'))); break;
        case 'list': result = await service.list(); break;
        case 'status': result = await service.get(required('job')); break;
        case 'submit': result = await service.submit(required('job'), await readJson(required('approval'))); break;
        case 'resume': result = await service.resume(required('job')); break;
        case 'download': result = await service.download(required('job')); break;
        case 'preview': result = await service.preview(required('job'), await readJson(required('draft')), required('if-match'), resolve(required('out'))); break;
        case 'accept': result = await service.accept(required('job'), await readJson(required('draft')), required('preview'), required('if-match'), required('operation-id')); break;
        case 'reject': result = await service.reject(required('job')); break;
        case 'stop': result = await service.stop(required('job')); break;
        case 'resolve-unknown': result = await service.resolveUnknown(required('job'), await readJson(required('resolution'))); break;
        default: throw new StudioError('INVALID_COMMAND', 'input', usage, 2);
      }
    }
    else if (command === 'studio' && input) {
      const studio = await startStudio(input, Number(values.port ?? 4173));
      console.log(`Local studio: ${studio.url}\nProject: ${studio.project}\nPress Ctrl+C to stop.`);
      const stopped = await new Promise<{ renderActive: boolean }>((ok, bad) => {
        let stopping = false;
        const stop = () => { if (stopping) return; stopping = true; void studio.close().then(ok, bad); };
        process.once('SIGINT', stop); process.once('SIGTERM', stop);
      });
      result = { stopped: true, ...(stopped.renderActive && { renderCancelled: true }), message: stopped.renderActive ? 'Local studio stopped. Active render cancelled; previous exports were kept.' : 'Local studio stopped.' };
    }
    else if (command === 'validate' && input) result = await validateForRender(input);
    else if (command === 'render' && input && values.out) result = await render(input, values.out, { overwrite: values.overwrite, noCache: values['no-cache'], progress: message => console.error(message) });
    else if (command === 'verify' && input) result = await verifyVideo(resolve(input), findTools());
    else if (command === 'init' && input && values.dir && ['repo-promo', 'product-ad', 'feature-explainer', 'kinetic-promo', 'orbit-demo', 'coffee-ritual'].includes(input)) {
      const target = resolve(values.dir);
      try { await stat(target); throw new StudioError('PROJECT_EXISTS', 'input', `${target} already exists; choose an empty new directory.`, 2); } catch (error) { if (error instanceof StudioError) throw error; if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const source = join(packageRoot, 'examples', input);
      await mkdir(target, { recursive: true }); await cp(source, target, { recursive: true, filter: file => !file.split(/[\\/]/).some(part => ['.cache', '.studio', 'exports'].includes(part)) && !/\.(edit-lock|render\.lock)$/.test(file) }); result = { created: true, manifest: join(target, ['orbit-demo', 'coffee-ritual'].includes(input) ? 'project.json' : 'manifest.json') };
    } else throw new StudioError('INVALID_COMMAND', 'input', usage, 2);
    if (command !== 'studio') throwIfCancelled();
    console.log(JSON.stringify(result, null, values.json ? undefined : 2));
  }
} catch (error) {
  const normalized = cancelled ? normalizeError(new StudioError('CANCELLED', 'render', 'Rendering cancelled.', 130)) : normalizeError(error);
  console.log(JSON.stringify(normalized)); process.exitCode = normalized.exitCode;
}
