import 'dotenv/config';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { TrueForge } from '@truefoundry/trueforge-sdk';
import type { Run } from '../src/shared/types.js';

const forgeUrl = 'http://127.0.0.1:8790';
const origin = 'http://127.0.0.1:4310';
const prompt = 'Go and test this app:http://localhost:3000/signup with probe';
const client = new TrueForge({ baseUrl: forgeUrl, token: process.env.TRUEFORGE_TOKEN, timeoutInSeconds: 90, maxRetries: 0 });
async function runs(): Promise<Run[]> {
  const response = await fetch(`${origin}/api/runs`);
  assert(response.ok, 'Probe run API must be healthy');
  return response.json();
}

const before = await runs();
const activeBefore = before.filter(run => run.scenario === 'full-audit' && ['queued', 'running', 'reproducing'].includes(run.status));
let agentId: string | undefined;
for await (const agent of await client.agents.list({ agentName: 'probe' })) {
  if (agent.name === 'probe') { agentId = agent.id; break; }
}
assert(agentId, 'Saved probe agent must exist');
const { data: agent } = await client.agents.get(agentId);
assert.equal(agent.manifest.model.name, 'openai/gpt-5-6-sol');
const connector = agent.manifest.mcpServers?.find(server => server.name === 'probe-launcher');
assert(connector?.preload && connector.enableTools?.includes('@all'), 'Saved launcher tools must be enabled');
assert.equal(connector.requireApprovalForTools?.length, 0);
assert.match(agent.manifest.instructions || '', /NO total-token or spending cutoff/i);
assert.match(agent.manifest.instructions || '', /omit maxTotalTokens/);

const { data: session } = await client.sessions.create({ agent: { name: 'probe' } });
assert.equal(session.agent.type, 'reference');
assert.equal(session.agent.name, 'probe');
assert.equal(session.agent.id, agentId);
const title = 'Probe — durable full-product audit';
await client.sessions.update(session.id, { title });
const stream = await client.sessions.createTurnStream(session.id, { input: [{ type: 'user.message', content: prompt }] });
let terminal = false;
let output = '';
const toolResponses: string[] = [];
for await (const { data: event } of stream.withMetadata()) {
  if (event.type === 'tool.response') toolResponses.push(event.content);
  if (event.type === 'turn.done') {
    assert.equal(event.state.status, 'done', 'Chat turn must finish successfully');
    terminal = true;
    if (event.state.status === 'done') {
      assert.equal(event.state.requiredActions?.length || 0, 0);
      output = typeof event.state.output?.content === 'string' ? event.state.output.content : JSON.stringify(event.state.output?.content) || '';
    }
  }
}
assert(terminal && toolResponses.length > 0, 'Real tool response and terminal output are required');
const after = await runs();
const audit = after.filter(run => run.scenario === 'full-audit' && output.includes(run.id) && toolResponses.some(response => response.includes(run.id)))
  .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
assert(audit, 'Tool response and terminal output must identify the same actual full audit');
if (activeBefore.length) assert(activeBefore.some(run => run.id === audit.id), 'Reuse the existing active audit');
assert.equal(audit.targetUrl, 'http://localhost:3000/signup');
assert.equal(audit.audit?.requestedAgents, 30);
assert.equal(audit.audit?.agents.length, 30);
assert.equal(audit.audit?.maxTotalTokens, null);
assert(['running', 'queued'].includes(audit.status), 'Audit must remain running or queued');
const runUrl = `${origin}/#run/${audit.id}`;
assert(output.includes(runUrl), 'Terminal reply must contain the actual dashboard link');
const { data: saved } = await client.sessions.get(session.id);
assert.equal(saved.agent.type, 'reference', 'Named registry binding must survive the turn');
assert.equal(saved.agent.id, agentId);
assert.equal(saved.agent.name, 'probe');
const result = {
  verifiedAt: new Date().toISOString(), sessionId: session.id,
  sessionUrl: `${forgeUrl}/?sessionId=${session.id}&agentId=${agentId}`, title: saved.title,
  agent: { name: 'probe', id: agentId, type: saved.agent.type, model: agent.manifest.model.name, connector: 'probe-launcher', unlimitedInstructionsVerified: true },
  prompt, toolResponseCount: toolResponses.length, terminalStatus: 'done', terminalLinksActualRun: true,
  runId: audit.id, runUrl, targetUrl: audit.targetUrl, requestedAgents: 30,
  maxTotalTokens: audit.audit!.maxTotalTokens, statusWhenChatFinished: audit.status,
  reusedActiveRun: activeBefore.some(run => run.id === audit.id), complete: false,
};
// Deliberately persist only allowlisted evidence, never raw model/tool payloads or credentials.
writeFileSync(new URL('../.data/acceptance/durable-probe-chat.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
