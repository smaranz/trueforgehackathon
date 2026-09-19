import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { TrueForge } from '@truefoundry/trueforge-sdk';
import type { Run } from '../src/shared/types.js';

const client = new TrueForge({ baseUrl: process.env.TRUEFORGE_BASE_URL || 'http://127.0.0.1:8790', token: process.env.TRUEFORGE_TOKEN, timeoutInSeconds: 90, maxRetries: 0 });
const sessionId = process.argv[2];
const { data: session } = sessionId ? await client.sessions.get(sessionId) : await client.sessions.create({ agent: { name: 'probe' } });
for await (const prior of await client.sessions.listTurns(session.id)) { assert.notEqual(prior.state.status, 'running', 'Do not interrupt a running user turn'); break; }
const began = new Date().toISOString();
const stream = await client.sessions.createTurnStream(session.id, { input: [{ type: 'user.message', content: 'Go and test this app: http://localhost:3000/signup with Probe.' }] });
let output = ''; let done = false; let toolResponses = 0;
for await (const { data: event } of stream.withMetadata()) {
  if (event.type === 'tool.response') toolResponses++;
  if (event.type === 'turn.done') {
    assert.equal(event.state.status, 'done'); done = true;
    if (event.state.status === 'done') output = typeof event.state.output?.content === 'string' ? event.state.output.content : JSON.stringify(event.state.output?.content);
  }
}
assert(done && toolResponses > 0);
const runs: Run[] = await (await fetch('http://127.0.0.1:4310/api/runs')).json();
const audit = runs.find(run => run.startedAt >= began && run.scenario === 'full-audit');
assert(audit, 'An ordinary test-this-app prompt must start the full audit, not a signup smoke test');
assert.equal(audit.audit?.requestedAgents, 30);
assert.equal(runs.filter(run => run.startedAt >= began && run.scenario === 'signup-surface').length, 0);
assert(['running', 'queued'].includes(audit.status), `Audit should continue independently after the chat turn: ${audit.error}`);
assert(output.includes(audit.id), 'Chat must link the actual audit');
const result = { verifiedAt: new Date().toISOString(), sessionId: session.id, prompt: 'Go and test this app: http://localhost:3000/signup with Probe.', output, runId: audit.id, requestedAgents: 30, statusWhenChatFinished: audit.status, queuedAgents: audit.audit!.agents.filter(agent => agent.status === 'queued').length, url: `http://127.0.0.1:4310/#run/${audit.id}`, complete: false };
mkdirSync('.data/acceptance', { recursive: true }); writeFileSync('.data/acceptance/full-audit-routing.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
