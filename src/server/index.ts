import express from 'express';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { createDemoApp, createEnvironment } from '../demo/app.js';
import { artifactDir, demoOrigin, demoPort, origin, port, root } from './config.js';
import { cancelRecoveredSessions, forgeHealth } from './forge.js';
import { getRun, listRuns, recoverInterruptedRuns, updates } from './store.js';
import { cancelRun, createRun, shutdown, startPreparedFixVerification } from './coordinator.js';
import { mountMcp } from './mcp.js';
import { safeError } from './browser.js';
import { connectProbe, mountProbeLauncher, probeIntegration } from './launcher.js';
import { cancelSignup, hasActiveSignup, inspectSignup, shutdownSignup, signupTarget } from './signup.js';
import { mountAuditMcp } from './audit/mcp.js';
import { auditInput, cancelAudit, hasActiveAudit, shutdownAudit, startAudit } from './audit/coordinator.js';
import { auditAssignments } from './audit/catalog.js';
import { AUDIT_MODEL, AUDIT_TARGET } from './audit/policy.js';
import { mailboxStatus } from './audit/mailbox.js';
import { isExpensiveApiPath, localOnly, rateLimiter, streamLimiter } from './security.js';
import { mountWorkbench } from './workbench/routes.js';
import { activeWorkbenchId, shutdownWorkbench, WorkbenchError } from './workbench/service.js';
import { recoverJobs } from './workbench/store.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);
app.use(localOnly);
app.use('/api', rateLimiter(600));
app.use('/mcp', rateLimiter(600));
const writeLimit = rateLimiter(40), expensiveLimit = rateLimiter(8);
app.use('/api', (req, res, next) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? next() : writeLimit(req, res, next));
app.use('/api', (req, res, next) => {
  const costly = req.method === 'POST' && isExpensiveApiPath(req.path);
  if (costly && activeWorkbenchId() && !req.path.toLowerCase().startsWith('/workbench/')) { res.status(409).json({ error: 'A dashboard operation is active. Finish or cancel it first.' }); return; }
  if (costly) expensiveLimit(req, res, next); else next();
});
app.use(express.json({ limit: '128kb' }));
app.use('/mcp', (req, res, next) => {
  const tools = ['start_full_audit', 'test_signup_page', 'start_probe_demo', 'start_fresh_signup_check'];
  if (req.body?.method === 'tools/call' && tools.includes(req.body.params?.name)) expensiveLimit(req, res, next); else next();
});
mountWorkbench(app);
mountMcp(app);
mountProbeLauncher(app);
mountAuditMcp(app);
app.get('/api/audits/catalog', (_req, res) => { res.json({ assignments: auditAssignments, model: AUDIT_MODEL, targetUrl: AUDIT_TARGET, mailbox: mailboxStatus() }); });
app.post('/api/audits', (req, res) => { res.status(202).json(startAudit(auditInput.parse(req.body))); });
app.get('/api/health', async (_req, res) => { res.json({ trueforge: await forgeHealth(), demoUrl: demoOrigin, version: '0.1.0', launcher: probeIntegration }); });
app.post('/api/probe/connect', async (_req, res) => { const result = await connectProbe(); res.status(result.configured ? 200 : 503).json(result); });
app.post('/api/signup/run', async (req, res) => {
  if (hasActiveAudit()) throw new Error('A full-product audit is running. Finish or cancel it first.');
  const { url } = z.object({ url: z.literal(signupTarget) }).strict().parse(req.body);
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  const run = await inspectSignup(url, controller.signal);
  if (!res.destroyed) res.json(run);
});
app.get('/api/runs', (_req, res) => { res.json(listRuns()); });
app.get('/api/runs/:id', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) { res.status(404).json({ error: 'Run not found' }); return; }
  res.json(run);
});
app.get('/api/runs/:id/events', streamLimiter(), (req, res) => {
  const run = getRun(String(req.params.id));
  if (!run) { res.status(404).json({ error: 'Run not found' }); return; }
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  let pending: NodeJS.Timeout | undefined;
  const write = () => { pending = undefined; if (!res.destroyed && res.writableLength < 1024 * 1024) res.write(`event: run\ndata: ${JSON.stringify(getRun(run.id))}\n\n`); };
  const send = () => { if (!pending) pending = setTimeout(write, 250); };
  write();
  updates.on(run.id, send);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  req.on('close', () => { clearInterval(heartbeat); if (pending) clearTimeout(pending); updates.off(run.id, send); });
});
const newRun = z.object({ mode: z.enum(['trueforge', 'deterministic']), variant: z.enum(['broken', 'corrected']), goal: z.string().min(5).max(2000), targetUrl: z.string().url(), scenario: z.literal('revoked-access') }).strict();
app.post('/api/runs', (req, res) => {
  if (hasActiveSignup() || hasActiveAudit()) throw new Error('A Probe check is active. Wait for it to finish or cancel it.');
  res.status(202).json(createRun(newRun.parse(req.body)));
});
app.post('/api/runs/:id/cancel', async (req, res) => {
  const id = String(req.params.id);
  res.json(getRun(id)?.scenario === 'full-audit' ? await cancelAudit(id) : getRun(id)?.scenario === 'signup-surface' ? await cancelSignup(id) : await cancelRun(id));
});
app.post('/api/runs/:id/verify', (req, res) => {
  if (hasActiveSignup() || hasActiveAudit()) throw new Error('Wait for the active check to finish.');
  res.status(202).json(startPreparedFixVerification(String(req.params.id)));
});
app.post('/api/demo/load', (_req, res) => {
  const fixture = createEnvironment('broken');
  res.json({ url: `${demoOrigin}/w/${fixture.id}/login` });
});
app.use('/api', (_req, res) => { res.status(404).json({ error: 'API route not found' }); });
app.use('/artifacts', express.static(artifactDir, {
  dotfiles: 'deny', index: false,
  setHeaders: (res, path) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    if (!path.endsWith('.png')) res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  },
}));
if (existsSync(`${root}dist/index.html`)) {
  app.use(express.static(`${root}dist`));
  app.get('/{*path}', (_req, res) => { res.sendFile(`${root}dist/index.html`); });
} else app.get('/', (_req, res) => { res.type('text').send('Probe API is running. Use http://127.0.0.1:5173 with npm run dev, or npm run build for the bundled UI.'); });
app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) { next(error); return; }
  const parserStatus = (error as { status?: number })?.status;
  const status = error instanceof z.ZodError ? 400 : error instanceof WorkbenchError ? error.status : parserStatus === 413 ? 413 : parserStatus === 400 ? 400 : 500;
  res.status(status).json({ error: error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ') : safeError(error) });
});
const demo = express();
// Separate origin, loopback listener, and no remotely accessible reset/fault controls.
demo.use((req, res, next) => {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.get('host') || '')) { res.status(403).end(); return; }
  next();
});
demo.use(createDemoApp());
demo.get('/', (_req, res) => { res.type('text').send('Fieldnotes isolated collaboration demo. Use Load demo workspace in Probe.'); });
const apiServer = app.listen(port, '127.0.0.1', () => {
  console.log(`Probe → ${origin}`);
  void connectProbe().then(result => console.log(result.configured ? 'Probe launcher registered in TrueForge.' : `Probe launcher setup: ${result.reason}`));
});
const demoServer = demo.listen(demoPort, '127.0.0.1', () => console.log(`Fieldnotes demo → ${demoOrigin}`));
void cancelRecoveredSessions(recoverInterruptedRuns().filter(id => !id.startsWith('browser-')));
recoverJobs();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => {
  await Promise.all([shutdown(), shutdownSignup(), shutdownAudit(), shutdownWorkbench()]); apiServer.close(); demoServer.close(); process.exit(0);
});
