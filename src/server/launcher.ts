import type { Express } from 'express';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { forge } from './forge.js';
import { dataDir, demoOrigin, forgeModel, origin } from './config.js';
import { connectorArchived, getRun, listRuns, markConnectorArchived, rememberCapability, updates } from './store.js';
import { createRun } from './coordinator.js';
import { hasActiveSignup, inspectSignup, signupTarget } from './signup.js';
import { safeError } from './browser.js';
import type { Run } from '../shared/types.js';
import { runSummary as summary } from './run-summary.js';
import { archivedAgentSpec, archiveVersion } from './archive-spec.js';
import { auditInput, hasActiveAudit } from './audit/coordinator.js';
import { launchAuditFromChat } from './audit/launch.js';

mkdirSync(dataDir, { recursive: true });
const keyPath = `${dataDir}/probe-launcher.key`;
if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' });
const launcherToken = readFileSync(keyPath, 'utf8').trim();
if (!/^[A-Za-z0-9_-]{43}$/.test(launcherToken)) throw new Error('Invalid local Probe launcher credential file.');
const hash = (value: string) => createHash('sha256').update(value).digest();
const accepts = (value: string) => timingSafeEqual(hash(value), hash(launcherToken));
export let probeIntegration: { configured: boolean; agentId?: string; reason?: string } = { configured: false };

export function mountProbeLauncher(app: Express): void {
  app.post('/mcp/probe', async (req, res) => {
    if (!accepts(req.get('authorization')?.replace(/^Bearer /, '') || '')) { res.status(401).json({ error: 'Invalid Probe launcher credential' }); return; }
    const server = new McpServer({ name: 'probe-launcher', version: '0.1.0' });
    const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
    const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
    server.registerTool('start_full_audit', {
      description: 'DEFAULT tool for “test this app”, “test this URL”, “test signup”, or “test with Probe”. Starts a background full-product audit with30 GPT-5.6 Sol specialists (4concurrent) who create real accounts then test onboarding, projects, essays, applications, SAT, settings, accessibility and bounded security. The signup URL is the entry point, NOT the test scope. Returns actual running/queued state and a dashboard link immediately. Return its reply to the user and end the chat turn; workers continue in Probe.',
      inputSchema: { request: auditInput }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, async ({ request }) => text(await launchAuditFromChat(request)));
    server.registerTool('list_probe_targets', {
      description: 'List the explicitly authorized local targets and supported test scopes. No arbitrary websites or internal services.', inputSchema: {}, annotations: readOnly,
    }, async () => text({ targets: [
      { url: signupTarget, tool: 'start_full_audit', default: true, scope: 'Signup is the starting point.30 independent Sol agents create real accounts and test actual product features with saved evidence. A quick read-only form check is available only when explicitly requested.' },
      { url: demoOrigin, tool: 'start_probe_demo', scope: 'Coordinated owner/editor document sharing and revocation investigation in the isolated Fieldnotes demo.' },
    ] }));
    server.registerTool('test_signup_page', {
      description: 'Only for an EXPLICIT “quick read-only signup form check”, not “test this app” or “test signup”. Does not create an account or test the product. Default testing requests MUST use start_full_audit instead.',
      inputSchema: { url: z.literal(signupTarget), quickReadOnlyOnly: z.literal(true) }, annotations: readOnly,
    }, async ({ url }, extra) => { if (hasActiveAudit()) throw new Error('Full-product audit already running; inspect its existing run.'); return text(summary(await inspectSignup(url, extra.signal))); });
    server.registerTool('start_probe_demo', {
      description: 'Start a NEW coordinated TrueForge owner/editor investigation on the first-party Fieldnotes fixture. The backend creates separate scoped browser/agent sessions. Only local synthetic demo writes are authorized. Returns immediately; use wait_for_probe_run for evidence.',
      inputSchema: { goal: z.string().min(5).max(2000) }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, async ({ goal }) => {
      if (hasActiveSignup() || hasActiveAudit()) throw new Error('Wait for the active check to finish.');
      return text(summary(createRun({ mode: 'trueforge', variant: 'broken', targetUrl: demoOrigin, scenario: 'revoked-access', goal })));
    });
    server.registerTool('get_probe_run', {
      description: 'Read persisted results and evidence for a Probe run. Never claims a run is complete before its terminal state.',
      inputSchema: { runId: z.string().uuid() }, annotations: readOnly,
    }, async ({ runId }) => {
      const run = getRun(runId); if (!run) throw new Error('Run not found'); return text(summary(run));
    });
    server.registerTool('wait_for_probe_run', {
      description: 'Wait on observable run updates for up to 20 seconds, returning at completion or the bounded deadline. If still running, wait again rather than inventing results.',
      inputSchema: { runId: z.string().uuid() }, annotations: readOnly,
    }, async ({ runId }, extra) => {
      const run = getRun(runId); if (!run) throw new Error('Run not found');
      if (!['queued', 'running', 'reproducing'].includes(run.status)) return text(summary(run));
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); updates.off(runId, changed); extra.signal.removeEventListener('abort', done); resolve(); };
        const changed = (next: Run) => { if (!['queued', 'running', 'reproducing'].includes(next.status)) done(); };
        const timer = setTimeout(done, 20000);
        updates.on(runId, changed); extra.signal.addEventListener('abort', done, { once: true });
        if (extra.signal.aborted) done();
      });
      return text(summary(getRun(runId)!));
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch (error) { if (!res.headersSent) res.status(500).json({ error: safeError(error) }); }
  });
  app.get('/mcp/probe', (_req, res) => { res.status(405).end(); });
}

/** Repairs only our known ended-run connectors; never reopens their browsers. */
export async function repairArchivedConnectors(): Promise<string[]> {
  const { data: configured } = await forge.settings.mcpServers.list({ timeoutInSeconds: 8 });
  const repaired: string[] = [];
  for (const run of listRuns()) {
    if (run.mode !== 'trueforge' || ['queued', 'running', 'reproducing'].includes(run.status)) continue;
    let environmentId: string;
    try {
      const url = new URL(run.targetUrl);
      if (url.origin !== demoOrigin) continue;
      environmentId = url.pathname.split('/')[2];
      if (!environmentId) continue;
    } catch { continue; }
    for (const role of ['owner', 'editor'] as const) {
      if (!run.events.some(entry => entry.type === 'trueforge.session.created' && entry.actor === role)) continue;
      for (const prefix of ['cz', 'probe']) {
        const name = `${prefix}-${run.id.slice(0, 8)}-${environmentId.slice(0, 8)}-${role}`;
        const connector = configured.find(item => item.name === name);
        if (!connector || connector.manifest.type !== 'remote' || connector.manifest.url !== `${origin}/mcp`) continue;
        if (!connectorArchived(name)) {
          const token = randomBytes(32).toString('base64url');
          rememberCapability(token, run.id, role, true);
          await forge.settings.mcpServers.createOrUpdate({ manifest: {
            type: 'remote', name, url: `${origin}/mcp`, description: `Closed Probe ${role} browser. Original run status and fresh independent signup checks.`,
            auth: { type: 'header', headers: { Authorization: `Bearer ${token}` } },
          } }, { timeoutInSeconds: 8 });
          markConnectorArchived(name); repaired.push(name);
        }
        const sessionId = run.events.find(entry => entry.type === 'trueforge.session.created' && entry.actor === role)?.sessionId;
        if (!sessionId) continue;
        const { data: session } = await forge.sessions.get(sessionId, { timeoutInSeconds: 8 });
        if (session.agent.type !== 'inline' || session.metadata.probeArchiveVersion === archiveVersion || session.agent.spec.mcpServers?.length !== 1 || session.agent.spec.mcpServers[0].name !== name) continue;
        let running = false;
        for await (const turn of await forge.sessions.listTurns(sessionId)) { running = turn.state.status === 'running'; break; }
        if (running) continue;
        await forge.sessions.update(sessionId, {
          agent: { spec: archivedAgentSpec(name) },
          metadata: { ...session.metadata, probeArchiveVersion: archiveVersion, probeSourceRunId: run.id, probeSourceRole: role },
        }, { timeoutInSeconds: 8 });
      }
    }
  }
  return repaired;
}

let connecting: Promise<typeof probeIntegration> | undefined;
export function connectProbe(): Promise<typeof probeIntegration> {
  if (connecting) return connecting;
  connecting = (async () => {
    try {
      await forge.settings.mcpServers.createOrUpdate({ manifest: {
        type: 'remote', name: 'probe-launcher', url: `${origin}/mcp/probe`,
        description: 'Probe: start fresh, scoped local product tests and retrieve their real results. Independent of expiring actor connectors.',
        auth: { type: 'header', headers: { Authorization: `Bearer ${launcherToken}` } },
      } }, { timeoutInSeconds: 8 });
      const manifest = {
        model: { name: forgeModel },
        instructions: `You are Probe, the user's full-product audit launcher. DEFAULT behavior for any “test this app”, “test this URL”, “test signup” or “go test with Probe” request at http://localhost:3000/signup is to call start_full_audit with targetUrl http://localhost:3000/signup and defaults30 agents4concurrent60steps60min6milliontokens. Signup is only the entry point; agents must create accounts, complete prerequisites and test product workflows. Do NOT choose the quick signup form tool just because the URL contains /signup. Earlier smoke-check results in conversation are historical and must not override this default.
After start_full_audit returns, reply immediately using its actual reply field: “Running in Probe dashboard” and the exact runUrl,30Sol agents4at a time. END YOUR TURN. The audit runs in backend workers after your chat response; do not poll or wait for it to finish unless the user separately asks for progress. Do not claim full results at launch. If preflight failed, report the failure instead of saying running. An existing active run should be linked instead of started twice.
Only if the user EXPLICITLY requests a “quick read-only signup form check” use test_signup_page with quickReadOnlyOnly true. That mode does not create accounts or test the product. Fieldnotes demo requests use start_probe_demo. Synthetic mailbox aliases and encrypted account passwords stay on backend; never ask for or reveal credentials. No unrelated origins, external OAuth, purchases, invitations, public posts or destructive account/admin actions. Use actual evidence and disclose incomplete/blocked coverage.`,
        mcpServers: [{ name: 'probe-launcher', preload: true, enableTools: ['@all'], requireApprovalForTools: [] }],
        config: { sandbox: { enabled: false }, dynamicSubAgents: { enabled: false }, webSearch: { enabled: false }, askUserQuestions: { enabled: false }, generativeUi: { enabled: false }, iterationLimit: 12, contextManagement: { largeToolResponse: { enabled: false } } },
      };
      let agentId: string | undefined;
      for await (const candidate of await forge.agents.list({ agentName: 'probe' }, { timeoutInSeconds: 8 })) {
        if (candidate.name === 'probe') { agentId = candidate.id; break; }
      }
      if (agentId) await forge.agents.update(agentId, { manifest, description: 'Start fresh local browser checks with Probe. Signup surface inspection and coordinated owner/editor demo testing.' });
      else { const { data } = await forge.agents.create({ name: 'probe', description: 'Start fresh local browser checks with Probe. Signup surface inspection and coordinated owner/editor demo testing.', manifest }); agentId = data.id; }
      await repairArchivedConnectors();
      probeIntegration = { configured: true, agentId };
    } catch (error) { probeIntegration = { configured: false, reason: safeError(error) }; }
    return probeIntegration;
  })().finally(() => { connecting = undefined; });
  return connecting;
}
