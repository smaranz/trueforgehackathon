import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createDemoApp, createEnvironment, getEnvironmentState } from '../src/demo/app.js';
import { allowedBrowserUrl, BrowserFleet, resolveCapability, safeError, type NetworkRecord } from '../src/server/browser.js';
import { mountMcp } from '../src/server/mcp.js';
import { assessExport, cancelRun, createRun, hasActiveRuns } from '../src/server/coordinator.js';
import { demoOrigin, demoPort } from '../src/server/config.js';
import { knownCapability } from '../src/server/store.js';
import { allowedSignupRequest } from '../src/server/signup.js';
import type { Run } from '../src/shared/types.js';

let demo: Server;
let mcp: Server;
let mcpUrl: URL;
before(async () => {
  demo = await new Promise<Server>(resolve => { const server = createDemoApp().listen(demoPort, '127.0.0.1', () => resolve(server)); });
  const app = express(); app.use(express.json()); mountMcp(app);
  mcp = await new Promise<Server>(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const address = mcp.address(); assert(address && typeof address !== 'string');
  mcpUrl = new URL(`http://127.0.0.1:${address.port}/mcp`);
});
after(async () => {
  await Promise.all([demo, mcp].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});
function fixtureRun(): Run {
  const id = randomUUID();
  return { id, name: 'Boundary acceptance', goal: 'Verify isolation', targetUrl: demoOrigin, scenario: 'revoked-access', mode: 'deterministic', variant: 'broken', status: 'completed', phase: 'preconditions', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), cost: null,
    actors: [ { id: `${id}-owner`, role: 'owner', name: 'Mara Vale', email: 'owner@fieldnotes.test', status: 'waiting' }, { id: `${id}-editor`, role: 'editor', name: 'Ellis Park', email: 'editor@fieldnotes.test', status: 'waiting' } ], events: [], artifacts: [], findings: [], verifications: [] };
}

test('URL scope blocks other origins, account switching, source and fixture controls', () => {
  const env = randomUUID();
  assert(allowedBrowserUrl(`${demoOrigin}/w/${env}/documents`, env));
  for (const url of [
    `${demoOrigin}/w/${env}/login`, `${demoOrigin}/w/${env}/api/reset`, `${demoOrigin}/w/${env}/api/fault`,
    `${demoOrigin}/w/${randomUUID()}/documents`, `${demoOrigin}/src/demo/store.ts`, `${demoOrigin}/w/${env}/api/export?variant=broken`,
    'http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1:4310/api/runs', 'file:///etc/passwd', 'https://example.com/',
  ]) assert.equal(allowedBrowserUrl(url, env), false, url);
  assert.equal(allowedBrowserUrl(`${demoOrigin}/w/${env}/api/share`, env, 'DELETE'), false);
});

test('real contexts, scoped MCP, phase checks, evidence ownership and cancellation', async () => {
  const environment = createEnvironment('broken');
  const controller = new AbortController();
  const run = fixtureRun();
  const fleet = new BrowserFleet(run, environment.id, controller.signal);
  const client = new Client({ name: 'acceptance-client', version: '1' });
  let connected = false;
  try {
    await fleet.start();
    const ownerToken = fleet.getCapability('owner'); const editorToken = fleet.getCapability('editor');
    assert.notEqual(ownerToken, editorToken);
    assert.equal(resolveCapability(ownerToken)?.role, 'owner');
    assert.equal(resolveCapability(editorToken)?.role, 'editor');
    assert.match(JSON.stringify(await fleet.inspect('owner')), /Mara/);
    assert.match(JSON.stringify(await fleet.inspect('editor')), /Ellis/);
    assert.equal((await fetch(mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
    await client.connect(new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: { Authorization: `Bearer ${editorToken}` } } })); connected = true;
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(t => t.name).sort(), ['capture_screenshot', 'click', 'get_evidence', 'inspect_page', 'navigate', 'report_observation']);
    assert(!JSON.stringify(tools).includes(ownerToken));
    fleet.setPhase('share', 'owner');
    await assert.rejects(fleet.execute('editor', { action: 'click', testId: 'grant-editor' }), /waiting/);
    await assert.rejects(fleet.execute('editor', { action: 'inspect', actor: 'owner' }), /Unrecognized key/);
    for (const testId of ['open-document', 'share-button', 'grant-editor', 'close-sharing']) {
      const result = await fleet.execute('owner', { action: 'click', testId }) as { error?: string }; assert.equal(result.error, undefined);
    }
    assert.equal(getEnvironmentState(environment.id).grants.editor, 'editor');
    const ownerEvidence = fleet.latest('owner', 'share')!.artifactId;
    const deniedEvidence = await client.callTool({ name: 'get_evidence', arguments: { evidenceId: ownerEvidence } });
    assert.equal(deniedEvidence.isError, true);
    const spoofed = await client.callTool({ name: 'click', arguments: { testId: 'revoke-editor', actor: 'owner' } });
    assert.equal(spoofed.isError, true);
    assert.equal(getEnvironmentState(environment.id).grants.editor, 'editor');
    fleet.setPhase('open', 'editor');
    await fleet.execute('editor', { action: 'click', testId: 'open-document' });
    assert(fleet.latest('editor', 'document')!.body.includes(environment.fixtureMarker));
    const report = await fleet.execute('editor', { action: 'report', observation: 'Claim based on another actor', evidenceIds: [ownerEvidence] }) as { error?: string };
    assert.match(report.error!, /outside this actor/);
    assert(!JSON.stringify(run).includes(ownerToken)); assert(!JSON.stringify(run).includes(editorToken));
    controller.abort();
    await fleet.close();
    assert.equal(resolveCapability(editorToken), undefined);
    assert.equal(resolveCapability(ownerToken), undefined);
    await assert.rejects(fleet.execute('editor', { action: 'inspect' }), /cancelled/);
    assert.equal(knownCapability(editorToken)?.runId, run.id);
    assert(knownCapability(editorToken)?.retiredAt);
    const archivedClient = new Client({ name: 'archived-acceptance-client', version: '1' });
    try {
      await archivedClient.connect(new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: { Authorization: `Bearer ${editorToken}` } } }));
      assert.deepEqual((await archivedClient.listTools()).tools.map(tool => tool.name), ['probe_session_status', 'start_fresh_signup_check', 'start_full_audit']);
      const status = await archivedClient.callTool({ name: 'probe_session_status', arguments: {} });
      const content = status.content as { type: string; text?: string }[];
      const payload = JSON.parse(content.find(item => item.type === 'text')!.text!);
      assert.equal(payload.code, 'PROBE_SESSION_CLOSED');
      assert.equal(payload.browserAvailable, false);
      assert.equal(payload.actor, 'editor');
      assert.equal(payload.runId, run.id);
      assert.equal(payload.canStartFreshSignupCheck, true);
      assert(payload.signupRunUrl.endsWith('/#new/signup'));
      assert.equal(payload.newRunUrl, undefined, 'Must not direct signup users to the demo-only generic route');
      const invalidTarget = await archivedClient.callTool({ name: 'start_fresh_signup_check', arguments: { url: 'http://169.254.169.254/latest/meta-data/' } });
      assert.equal(invalidTarget.isError, true);
      const attemptedWrite = await archivedClient.callTool({ name: 'click', arguments: { testId: 'revoke-editor' } });
      assert.equal(attemptedWrite.isError, true);
      assert.equal(getEnvironmentState(environment.id).grants.editor, 'editor');
    } finally { await archivedClient.close(); }
  } finally { if (connected) await client.close(); await fleet.close(); }
});

test('objective assessment rejects cached, incomplete and unknown evidence', () => {
  const revoked: NetworkRecord = { sequence: 10, requestedAt: '2026-09-19T00:00:00Z', completedAt: '2026-09-19T00:00:01Z', actor: 'owner', method: 'POST', url: `${demoOrigin}/api/revoke`, status: 200, requestId: 'revoke-request', revision: '3', cacheControl: 'no-store', fromServiceWorker: false, body: JSON.stringify({ grants: { owner: 'owner' } }), artifactId: 'revoke-evidence' };
  const exported: NetworkRecord = { ...revoked, sequence: 11, requestedAt: '2026-09-19T00:00:02Z', completedAt: '2026-09-19T00:00:03Z', actor: 'editor', method: 'GET', url: `${demoOrigin}/api/export`, requestId: 'new-export', body: 'PROTECTED_FIXTURE', artifactId: 'export-evidence' };
  assert.deepEqual(assessExport(revoked, exported, 'PROTECTED_FIXTURE', 3), { unauthorized: true });
  assert.deepEqual(assessExport(revoked, { ...exported, status: 403, body: 'Forbidden' }, 'PROTECTED_FIXTURE', 3), { unauthorized: false });
  for (const bad of [ { ...exported, sequence: 9 }, { ...exported, fromServiceWorker: true }, { ...exported, requestId: '' }, { ...exported, status: 500 }, { ...exported, body: '' }, { ...exported, revision: '2' } ]) assert.throws(() => assessExport(revoked, bad, 'PROTECTED_FIXTURE', 3));
  assert.throws(() => assessExport({ ...revoked, body: JSON.stringify({ grants: { editor: 'editor' } }) }, exported, 'PROTECTED_FIXTURE', 3));
});

test('provider errors redact credentials before persistence', () => {
  assert.equal(safeError(new Error('Incorrect API key: sk-proj-abcdef123456789. Authorization: Bearer secret12345')), 'Incorrect API key: [redacted credential] Authorization: Bearer [redacted]');
});

test('coordinator cancellation waits for cleanup and retains an honest terminal run', async () => {
  const run = createRun({ mode: 'deterministic', variant: 'broken', scenario: 'revoked-access', goal: 'Cancel an in-flight browser run', targetUrl: demoOrigin });
  const result = await cancelRun(run.id);
  assert.equal(result.status, 'cancelled');
  assert(result.finishedAt);
  assert.equal(result.findings.length, 0);
  assert.equal(hasActiveRuns(), false);
  assert(result.actors.every(actor => actor.status === 'stopped'));
});

test('signup profile allows only approved page/assets and blocks account writes, redirects and internal services', () => {
  assert(allowedSignupRequest('http://localhost:3000/signup', 'GET'));
  assert(allowedSignupRequest('http://localhost:3000/_next/static/chunks/app.js', 'GET'));
  for (const [url, method] of [
    ['http://localhost:3000/api/auth/signup', 'POST'],
    ['http://localhost:3000/signup', 'POST'],
    ['http://localhost:3000/api/private', 'GET'],
    ['http://localhost:3000/_next/image?url=http://169.254.169.254', 'GET'],
    ['http://localhost:3000/signin', 'GET'],
    ['http://127.0.0.1:4310/api/runs', 'GET'],
    ['http://169.254.169.254/latest/meta-data', 'GET'],
    ['http://evil.example:3000/signup', 'GET'],
  ]) assert.equal(allowedSignupRequest(url, method), false, `${method} ${url}`);
});
