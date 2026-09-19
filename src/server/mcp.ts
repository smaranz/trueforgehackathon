import type { Express } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { resolveCapability, safeError } from './browser.js';
import { getRun, knownCapability } from './store.js';
import { forgeUrl, origin } from './config.js';
import { inspectSignup, signupTarget } from './signup.js';
import { runSummary } from './run-summary.js';
import { auditInput, hasActiveAudit } from './audit/coordinator.js';
import { launchAuditFromChat } from './audit/launch.js';

/** The retired actor stays closed; the separately authorized signup tool always starts fresh. */
export function closedSessionStatus(token: string) {
  const known = knownCapability(token);
  if (!known) return;
  const run = getRun(known.runId);
  return { code: 'PROBE_SESSION_CLOSED', actor: known.role, runId: known.runId, status: run?.status || 'unavailable',
    browserAvailable: false, canResumeBrowser: false, runUrl: `${origin}/#run/${known.runId}`,
    canStartFreshSignupCheck: true,
    message: 'The original actor browser is closed. A NEW full-product audit of http://localhost:3000/signup is supported here: call start_full_audit instead of refusing or running only a signup form check. It starts30 isolated Sol specialists with real accounts, post-signup exploration and a live dashboard. Return the running/queued result and dashboard URL immediately.',
    defaultTool: 'start_full_audit', fullAuditUrl: `${origin}/#new/audit`, signupTarget, signupRunUrl: `${origin}/#new/signup`,
    trueforgeAgentsUrl: `${forgeUrl}/library`, trueforgeAgentName: 'probe' };
}

export function mountMcp(app: Express): void {
  app.post('/mcp', async (req, res) => {
    const token = req.get('authorization')?.replace(/^Bearer /, '') || '';
    const binding = resolveCapability(token);
    if (!binding) {
      const status = closedSessionStatus(token);
      if (!status) { res.status(401).json({ error: 'Invalid actor capability' }); return; }
      const archived = new McpServer({ name: 'probe-closed-session', version: '0.1.0' }, { instructions: status.message });
      archived.registerTool('probe_session_status', {
        description: 'Read status of the historical closed actor. For any new app/signup testing request use start_full_audit; the previous closed browser does not prevent a new30-agent full-product audit.',
        inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      }, async () => ({ content: [{ type: 'text', text: JSON.stringify(status) }] }));
      archived.registerTool('start_fresh_signup_check', {
        description: 'Use this when the user asks to test http://localhost:3000/signup. Starts a NEW unauthenticated browser and independent Probe report, even though the earlier actor browser is closed. Checks rendering, native validation, password visibility and responsive layout. No account creation, OAuth or backend auth tests. Returns observed results and the report URL. Do not refuse the new task because the previous browser is archived.',
        inputSchema: { url: z.literal(signupTarget) }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      }, async ({ url }, extra) => {
        if (hasActiveAudit()) throw new Error('A full-product audit is already running. Use its run URL to inspect progress.');
        if (!knownCapability(token) || resolveCapability(token)) throw new Error('Fresh-task handoff is only available after the original actor closes.');
        return { content: [{ type: 'text', text: JSON.stringify(runSummary(await inspectSignup(url, extra.signal))) }] };
      });
      archived.registerTool('start_full_audit', {
        description: 'DEFAULT for “test this app”, “test this URL”, or “test signup with Probe”. Start a long-running full product audit,30Sol agents4at a time, real signup THEN onboarding and product feature testing. Signup is an entrypoint, not the endpoint. Returns an actual running/queued state and dashboard link; immediately return its reply and finish the chat turn while background workers continue.',
        inputSchema: { request: auditInput }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      }, async ({ request }) => {
        if (!knownCapability(token) || resolveCapability(token)) throw new Error('Fresh audit handoff requires a retired original browser.');
        return { content: [{ type: 'text', text: JSON.stringify(await launchAuditFromChat(request)) }] };
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { void transport.close(); void archived.close(); });
      try { await archived.connect(transport); await transport.handleRequest(req, res, req.body); }
      catch (error) { if (!res.headersSent) res.status(500).json({ error: safeError(error) }); }
      return;
    }
    const { fleet, role } = binding;
    const server = new McpServer({ name: 'probe-browser', version: '0.1.0' });
    const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
    const call = async (input: unknown) => {
      // Bindings are revoked at cancellation/cleanup; a pre-existing MCP connection grants no bypass.
      if (resolveCapability(token) !== binding) throw new Error('Actor capability revoked');
      return text(await fleet.execute(role, input));
    };
    const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
    const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
    server.registerTool('inspect_page', { description: 'Inspect YOUR browser, visible controls, current phase, and recent evidence references. Never exposes auth state.', inputSchema: {}, annotations: readOnly }, () => call({ action: 'inspect' }));
    server.registerTool('navigate', {
      description: 'Navigate your browser to a permitted workspace page. Only the two declared paths are allowed. Inspect after an uncertain action instead of repeating it.',
      inputSchema: { path: z.enum(['/documents', '/documents/launch-brief']) }, annotations: readOnly,
    }, ({ path }) => call({ action: 'navigate', path }));
    server.registerTool('click', {
      description: 'Click a stable data-testid visible in inspect_page. The coordinator enforces role and phase permissions. Local synthetic workspace writes are preauthorized by Start run.',
      inputSchema: { testId: z.enum(['open-document', 'share-button', 'grant-editor', 'revoke-editor', 'close-sharing', 'export-button', 'save-button']) }, annotations: write,
    }, ({ testId }) => call({ action: 'click', testId }));
    server.registerTool('capture_screenshot', { description: 'Capture your current browser view and return its evidence ID, with a page inspection.', inputSchema: {}, annotations: readOnly }, () => call({ action: 'screenshot' }));
    server.registerTool('get_evidence', {
      description: 'Read one of your captured network responses. Only evidence produced by this actor is accessible; no cookies, auth headers, setup controls or source files.',
      inputSchema: { evidenceId: z.string() }, annotations: readOnly,
    }, async ({ evidenceId }) => {
      if (resolveCapability(token) !== binding) throw new Error('Actor capability revoked');
      const record = fleet.network.find(item => item.artifactId === evidenceId && item.actor === role);
      if (!record) return { ...text({ error: 'Evidence not found within your actor scope' }), isError: true };
      return text(record);
    });
    server.registerTool('report_observation', {
      description: 'Record observed behavior with YOUR evidence IDs. This is a claim, not confirmation. Describe HTTP result, expected behavior and uncertainty; never invent sentiment or impact.',
      inputSchema: { observation: z.string().min(1).max(3000), evidenceIds: z.array(z.string()).max(20) }, annotations: write,
    }, input => call({ action: 'report', ...input }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) res.status(500).json({ error: safeError(error) });
    }
  });
  app.get('/mcp', (_req, res) => { res.status(405).end(); });
  app.delete('/mcp', (_req, res) => { res.status(405).end(); });
}
