import type { Express } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { auditAction, reportSchema, resolveAuditBrowser, sanitizeAuditText } from './browser.js';
import { safeError } from '../browser.js';

export function mountAuditMcp(app: Express) {
  app.post('/mcp/audit', async (req, res) => {
    const token = req.get('authorization')?.replace(/^Bearer /, '') || '';
    const actor = resolveAuditBrowser(token);
    if (!actor) { res.status(401).json({ error: 'Expired or invalid audit actor capability' }); return; }
    const server = new McpServer({ name: 'probe-audit-browser', version: '1.0.0' });
    const respond = (value: unknown) => {
      let text = JSON.stringify(value);
      if (text.length > 64000) {
        const compact = JSON.parse(text);
        // Keep actionable refs and valid JSON when a page contains unusually large select lists.
        const trim = (item: Record<string, unknown>) => {
          if (Array.isArray(item.controls)) item.controls = item.controls.slice(0, 60).map(control => ({ ...control, options: control.options?.slice(0, 10) }));
          item.payloadTruncated = true;
        };
        trim(compact); if (compact.page && typeof compact.page === 'object') trim(compact.page);
        text = JSON.stringify(compact);
        if (text.length > 64000) text = JSON.stringify({ payloadTruncated: true, excerpt: text.slice(0, 24000), instruction: 'Inspect or request a specific evidence ID for remaining details.' });
      }
      return { content: [{ type: 'text' as const, text }] };
    };
    const guard = () => { if (resolveAuditBrowser(token) !== actor) throw new Error('Audit actor has been closed'); };
    server.registerTool('browser_action', {
      description: 'Operate YOUR isolated test-account browser. Start with signup (or signin when reproducing), which securely uses backend-held synthetic credentials and verifies server authentication. inspect returns ephemeral control refs: use those with click/fill/select. Never guess refs; inspect after uncertain actions. navigate accepts only approved local product pages. accessibility gathers DOM/layout evidence. unauthenticated_check makes a bounded fresh anonymous read for ownership testing. Credentials, cookies, source code and arbitrary JS/network access are never exposed.',
      inputSchema: { command: auditAction }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, async ({ command }) => { guard(); return respond(await actor.execute(command)); });
    server.registerTool('report_finding', {
      description: 'Report a concrete observed failure or usability/accessibility concern, citing your own evidence IDs and exact reproduction steps. This creates Suspected, never Confirmed. Use http_error only for actual captured server 5xx; a 4xx alone is not a bug. Use layout_overflow for DOM assertion, uncaught_exception for pageerror, unauthorized_read only with your own synthetic marker in an anonymous response. Use observation for judgment-based UI concerns; do not fabricate user sentiment or vulnerability severity.',
      inputSchema: { finding: reportSchema }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, async ({ finding }) => { guard(); return respond(actor.report(finding)); });
    server.registerTool('finish_assignment', {
      description: 'Record actual tested coverage, skipped/blocked areas and a factual summary. Do not claim every feature was tested. After this tool, finish your turn.',
      inputSchema: { summary: z.string().min(10).max(5000), coverage: z.array(z.string().max(400)).min(1).max(30) }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, async ({ summary, coverage }) => { guard(); return respond(actor.finish(summary, coverage)); });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void server.close(); void transport.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch (error) { if (!res.headersSent) res.status(500).json({ error: sanitizeAuditText(safeError(error)) }); }
  });
  app.get('/mcp/audit', (_req, res) => { res.status(405).end(); });
}
