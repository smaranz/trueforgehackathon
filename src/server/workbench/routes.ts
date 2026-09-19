import type { Express } from 'express';
import { z } from 'zod';
import { forgeModel } from '../config.js';
import { getRun } from '../store.js';
import { allowedOrigins, targetUrl } from './policy.js';
import { sourceLabel, sourceRoot } from './repair.js';
import { applyMemory, forgetMemory, listJobs, listMemory, remember, saveJob } from './store.js';
import { activeWorkbenchId, cancelWorkbench, investigationInput, requireJob, scanInput, startBuild, startInvestigation, startProposal, startScan, startStress, stressInput, WorkbenchError } from './service.js';

export function mountWorkbench(app: Express) {
  app.get('/api/workbench/config', (_req, res) => { res.json({ targetUrl, allowedOrigins: allowedOrigins(), sourceConnected: Boolean(sourceRoot), sourceLabel, buildConfigured: Boolean(sourceRoot), model: forgeModel, activeJobId: activeWorkbenchId() }); });
  app.get('/api/workbench/jobs', (_req, res) => { res.json(listJobs().map(job => ({ ...job, elements: undefined, proposal: undefined, build: job.build ? { ...job.build, log: '' } : undefined }))); });
  app.get('/api/workbench/jobs/:id', (req, res) => { res.json(requireJob(String(req.params.id))); });
  app.post('/api/workbench/scan', (req, res) => { res.status(202).json(startScan(scanInput.parse(req.body))); });
  app.post('/api/workbench/investigate', (req, res) => { res.status(202).json(startInvestigation(investigationInput.parse(req.body))); });
  app.post('/api/workbench/stress', (req, res) => { res.status(202).json(startStress(stressInput.parse(req.body))); });
  app.post('/api/workbench/jobs/:id/cancel', async (req, res) => { res.json(await cancelWorkbench(String(req.params.id))); });
  app.post('/api/workbench/jobs/:id/propose', (req, res) => {
    const input = z.object({ findingId: z.string().uuid() }).strict().parse(req.body);
    res.status(202).json(startProposal(String(req.params.id), input.findingId));
  });
  app.post('/api/workbench/jobs/:id/build', (req, res) => { res.status(202).json(startBuild(String(req.params.id))); });
  app.get('/api/workbench/memory', (_req, res) => { res.json(listMemory()); });
  app.delete('/api/workbench/memory/:id', (req, res) => { forgetMemory(String(req.params.id)); res.json({ forgotten: true }); });
  app.post('/api/workbench/jobs/:id/feedback', (req, res) => {
    const input = z.object({ findingId: z.string().uuid(), verdict: z.enum(['false-positive', 'accepted']), reason: z.string().trim().min(5).max(2000) }).strict().parse(req.body);
    const job = requireJob(String(req.params.id));
    if (job.status === 'running') throw new WorkbenchError('Wait for the investigation to finish before recording feedback.');
    const finding = job.findings.find(item => item.id === input.findingId);
    if (!finding) throw new WorkbenchError('Finding not found.', 404);
    remember(finding, input.verdict, input.reason); job.findings = applyMemory(job.findings); saveJob(job); res.json(job);
  });
  // Carry an existing multi-agent finding into the repair dashboard without fabricating new evidence.
  app.post('/api/workbench/import', (req, res) => {
    const input = z.object({ runId: z.string().uuid(), findingId: z.string().uuid() }).strict().parse(req.body);
    const run = getRun(input.runId), finding = run?.findings.find(item => item.id === input.findingId);
    if (!run || !finding) throw new WorkbenchError('Finding not found.', 404);
    res.status(202).json(startInvestigation({ targetUrl: run.targetUrl, prompt: `${finding.title}\nExpected: ${finding.expected}\nObserved: ${finding.actual}\nSteps: ${finding.steps.join('; ')}`.slice(0, 3000) }));
  });
}
