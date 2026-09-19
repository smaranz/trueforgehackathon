import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Diagnostic, WorkbenchJob } from '../../shared/workbench.js';
import { listRuns } from '../store.js';
import { safeError } from '../browser.js';
import { inspectPage } from './browser.js';
import { applyMemory, getJob, listMemory, saveJob } from './store.js';
import { selectElement, validateWorkbenchTarget } from './policy.js';
import { askModel } from './model.js';
import { buildRepair, proposeRepair } from './repair.js';
import { stressTest } from './stress.js';

export class WorkbenchError extends Error { constructor(message: string, readonly status = 409) { super(message); } }
let active: { job: WorkbenchJob; controller: AbortController; done: Promise<void> } | undefined;
export const activeWorkbenchId = () => active?.job.id;
const pointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
export const scanInput = z.object({ targetUrl: z.string().url().max(2000) }).strict();
export const investigationInput = scanInput.extend({ prompt: z.string().trim().min(5).max(3000), parentId: z.string().uuid().optional(), point: pointSchema.optional() }).strict();
export const stressInput = scanInput.extend({ requests: z.number().int().min(1).max(200).default(40), concurrency: z.number().int().min(1).max(5).default(3), rps: z.number().int().min(1).max(10).default(5) }).strict();

export function requireJob(id: string) {
  const job = getJob(id); if (!job) throw new WorkbenchError('Operation not found.', 404); return job;
}
function start(kind: WorkbenchJob['kind'], targetUrl: string, execute: (job: WorkbenchJob, signal: AbortSignal) => Promise<void>): WorkbenchJob {
  try { validateWorkbenchTarget(targetUrl); } catch (error) { throw new WorkbenchError(safeError(error), 400); }
  if (active || listRuns().some(run => ['queued', 'running', 'reproducing'].includes(run.status))) throw new WorkbenchError('Another operation is running. Finish or cancel it before starting this one.');
  const job: WorkbenchJob = { id: randomUUID(), kind, targetUrl, startedAt: new Date().toISOString(), status: 'running', stage: 'Starting', findings: [], notes: [] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Operation deadline exceeded')), kind === 'build' ? 420000 : 180000);
  saveJob(job);
  // Install the lock synchronously, before the first awaited action.
  active = { job, controller, done: Promise.resolve() };
  active.done = Promise.resolve().then(() => execute(job, controller.signal)).then(() => {
    job.status = controller.signal.aborted && !job.build?.applied ? 'cancelled' : 'completed';
  }).catch(error => {
    job.status = controller.signal.aborted ? 'cancelled' : 'failed'; job.error = safeError(error);
    if (job.build) job.build.log = `${job.build.log}\n${job.error}`.slice(-30000);
  }).finally(() => {
    clearTimeout(timer); job.finishedAt = new Date().toISOString(); saveJob(job); active = undefined;
  });
  return job;
}
export async function cancelWorkbench(id: string): Promise<WorkbenchJob> {
  if (active?.job.id === id) { active.controller.abort(new Error('Cancelled by operator')); await active.done; }
  return requireJob(id);
}
export async function shutdownWorkbench() { if (active) await cancelWorkbench(active.job.id); }

async function scan(job: WorkbenchJob, signal: AbortSignal) {
  job.stage = 'Inspecting the page in a fresh browser'; saveJob(job);
  const page = await inspectPage(job, signal);
  job.screenshotUrl = page.screenshotUrl; job.elements = page.elements;
  job.findings = applyMemory(page.findings); job.notes = page.notes;
  job.stage = `Captured ${job.findings.length} findings`; saveJob(job);
  return page;
}
export const startScan = (input: z.infer<typeof scanInput>) => start('scan', input.targetUrl, async (job, signal) => { await scan(job, signal); });

const deeperSchema = z.object({ summary: z.string().max(5000), findings: z.array(z.object({
  title: z.string().min(5).max(200), selector: z.string().max(1000).optional(),
  actual: z.string().min(5).max(2000), expected: z.string().min(5).max(1000),
  suggestion: z.string().min(5).max(2000), evidence: z.string().min(5).max(2000),
  category: z.enum(['functional', 'security', 'accessibility', 'performance']), severity: z.enum(['High', 'Medium', 'Low']),
}).strict()).max(8) }).strict();
export function startInvestigation(input: z.infer<typeof investigationInput>) {
  const parent = input.parentId ? requireJob(input.parentId) : undefined;
  if (input.point && (!parent?.elements || parent.targetUrl !== input.targetUrl)) throw new WorkbenchError('Capture this target first, then choose a point on its screenshot.', 400);
  const selected = input.point && parent?.elements ? selectElement(parent.elements, input.point) : undefined;
  return start('investigate', input.targetUrl, async (job, signal) => {
    job.parentId = input.parentId; job.prompt = input.prompt; job.point = input.point; job.selectedElement = selected;
    const page = await scan(job, signal);
    if (parent) for (const finding of job.findings) {
      if (finding.status !== 'Observed' || finding.rule === 'page-unavailable' || finding.feedback?.verdict === 'false-positive') continue;
      const original = parent.findings.find(item => item.rule === finding.rule && item.url === finding.url && item.selector === finding.selector && item.actual === finding.actual);
      if (original) { finding.status = 'Confirmed'; finding.evidence.push(`The same objective observation was captured independently in prior operation ${parent.id}.`); }
    }
    job.stage = 'Agent is investigating your concern and the selected element'; saveJob(job);
    const result = await askModel('Investigate the user’s suspected issue using only the supplied fresh page evidence. The pinpoint comes from the previous screenshot and may have moved; match it to current elements by selector. Distinguish intended behavior/known false positives from defects. Quote exact observed evidence. Do not invent interactions, server internals or exploitability. Output {"summary":string,"findings":[{"title":string,"selector"?:string,"actual":string,"expected":string,"suggestion":string,"evidence":string,"category":"functional"|"security"|"accessibility"|"performance","severity":"High"|"Medium"|"Low"}]}. Return no findings if the concern is unsupported and explain what needs further testing. All model findings are treated as suspected.', {
      prompt: input.prompt, selectedElement: selected, targetUrl: input.targetUrl, text: page.text,
      elements: page.elements, observedFindings: page.findings,
      personalMemory: listMemory().filter(item => item.origin === new URL(input.targetUrl).origin),
    }, deeperSchema, signal);
    const additions: Diagnostic[] = result.findings.map(item => ({ ...item, id: randomUUID(), rule: `agent-${item.category}-${item.selector || 'page'}`, url: input.targetUrl, evidence: [item.evidence], status: 'Suspected' }));
    for (const item of additions) if (item.selector && !page.elements.some(element => element.selector === item.selector)) item.selector = undefined;
    job.findings.push(...applyMemory(additions));
    job.notes.push(result.summary, 'Agent conclusions remain Suspected until independently reproduced. Feedback is local, scoped memory supplied to later investigations; model weights are not retrained.');
    job.stage = 'Deeper investigation complete';
  });
}
export const startStress = (input: z.infer<typeof stressInput>) => start('stress', input.targetUrl, (job, signal) => stressTest(job, input, signal));
export function startProposal(parentId: string, findingId: string) {
  const parent = requireJob(parentId), finding = applyMemory(parent.findings).find(item => item.id === findingId);
  if (!finding) throw new WorkbenchError('Finding not found.', 404);
  if (finding.feedback?.verdict === 'false-positive') throw new WorkbenchError('This finding is marked false positive. Accept it before proposing a fix.');
  return start('propose', parent.targetUrl, async (job, signal) => {
    job.parentId = parentId; job.findings = [finding]; job.screenshotUrl = parent.screenshotUrl;
    await proposeRepair(job, finding, signal);
  });
}
export function startBuild(parentId: string) {
  const parent = requireJob(parentId);
  parent.findings = applyMemory(parent.findings);
  if (!parent.proposal || parent.status !== 'completed') throw new WorkbenchError('Complete a fix proposal before building it.');
  if (parent.findings.some(finding => finding.feedback?.verdict === 'false-positive')) throw new WorkbenchError('Accept the finding before building its fix.');
  return start('build', parent.targetUrl, async (job, signal) => {
    job.parentId = parentId; job.findings = parent.findings; job.proposal = parent.proposal;
    await buildRepair(job, parent.proposal!, signal);
  });
}
