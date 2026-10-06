// Explicit live provider check. Never imported by default tests, CI, build or installation.
import { parseArgs } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { GenerationService } from '../dist/generation.js';

const { values } = parseArgs({ options: { project: { type: 'string' }, job: { type: 'string' }, approval: { type: 'string' }, out: { type: 'string' } } });
for (const field of ['project', 'job', 'approval', 'out']) if (!values[field]) throw new Error(`Explicit live check requires --${field}. Review the prepared request and obtain permission before running this script.`);
const service = new GenerationService(resolve(values.project));
const approval = JSON.parse(await readFile(resolve(values.approval), 'utf8'));
const output = resolve(values.out); await mkdir(output, { recursive: true });
const phases = [], record = job => { phases.push({ status: job.status, decision: job.decision, submissions: job.submissions, errorCode: job.error?.code, observedAt: new Date().toISOString() }); console.error(`Live job: ${job.status}, submissions=${job.submissions}`); };
let job = await service.get(values.job); record(job);
// An already submitted job is only resumed; the service protects uncertain submit.
if (job.status === 'prepared') { job = await service.submit(values.job, approval); record(job); }
const deadline = Date.now() + 20 * 60 * 1000;
while (['queued', 'running'].includes(job.status) && Date.now() < deadline) {
  const delay = Math.min(60000, Math.max(5000, Date.parse(job.nextPollAt ?? '') - Date.now() || 5000));
  await new Promise(ok => setTimeout(ok, delay)); job = await service.resume(values.job); record(job);
  if (job.error?.code === 'PROVIDER_AUTH') break;
}
if (job.status === 'output_ready') { job = await service.download(values.job); record(job); }
const report = { scope: 'explicit live provider candidate check', jobId: values.job, provider: job.provider, model: job.model, status: job.status, submissions: job.submissions, estimateUsd: job.estimate.usd, actualCostUsd: null, phases, candidate: job.candidate, accepted: false, limits: ['No automatic Accept. Inspect and preview the candidate, then explicitly accept through UI/CLI.', 'Actual billed cost must be checked in the provider account.', 'A local deadline does not cancel inference or provider charges.'] };
await writeFile(join(output, 'live-provider.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (job.status !== 'ready') process.exitCode = 2;
