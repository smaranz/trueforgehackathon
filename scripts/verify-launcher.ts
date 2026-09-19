import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { TrueForge } from '@truefoundry/trueforge-sdk';
import type { Run } from '../src/shared/types.js';

const client = new TrueForge({ baseUrl: process.env.TRUEFORGE_BASE_URL || 'http://127.0.0.1:8790', token: process.env.TRUEFORGE_TOKEN, timeoutInSeconds: 120, maxRetries: 0 });
const start = new Date().toISOString();
const archivedSessionId = process.argv[2];
const { data: session } = archivedSessionId ? await client.sessions.get(archivedSessionId) : await client.sessions.create({ agent: { name: 'probe' } });
if (archivedSessionId) {
  assert.equal(session.metadata.probeArchiveVersion, 'fresh-signup-v1', 'The archived session must have the new fresh-task handoff configuration.');
  for await (const turn of await client.sessions.listTurns(session.id)) { assert.notEqual(turn.state.status, 'running', 'Do not interrupt an active user turn.'); break; }
}
console.log(`Probe TrueForge chat: ${session.id}`);
const stream = await client.sessions.createTurnStream(session.id, { input: [{ type: 'user.message', content: 'Go and test this app: http://localhost:3000/signup with Probe. Report observed checks and limitations with the saved result URL.' }] });
let terminal = false;
let toolResponse = false;
let output: unknown;
const events: unknown[] = [];
for await (const { data: raw, id } of stream.withMetadata()) {
  const sanitized = JSON.parse(JSON.stringify(raw, (key, value) => /reasoning|thought|authorization|cookie|password|api.?key/i.test(key) ? undefined : value));
  events.push({ sequence: id, event: sanitized });
  if (raw.type !== 'model.message.delta') console.log(raw.type);
  if (raw.type === 'tool.response') toolResponse = true;
  if (raw.type === 'turn.done') {
    terminal = true;
    assert.equal(raw.state.status, 'done', JSON.stringify(sanitized));
    if (raw.state.status === 'done') {
      assert.equal(raw.state.requiredActions?.length || 0, 0);
      output = raw.state.output;
    }
  }
}
assert(terminal && toolResponse, 'A completed model turn and actual tool execution are required.');
const runs: Run[] = await (await fetch(`http://127.0.0.1:${process.env.PORT || 4310}/api/runs`)).json();
const run = runs.find(run => run.scenario === 'signup-surface' && run.startedAt >= start);
assert(run, 'The tool must create a fresh persisted signup inspection.');
mkdirSync('.data/acceptance', { recursive: true });
const prefix = archivedSessionId ? 'probe-archive-handoff' : 'probe-launcher';
writeFileSync(`.data/acceptance/${prefix}-stream.ndjson`, events.map(event => JSON.stringify(event)).join('\n'));
writeFileSync(`.data/acceptance/${prefix}-verification.json`, JSON.stringify({ sessionId: session.id, runId: run.id, status: run.status, checks: run.checks, error: run.error, limitations: run.limitations, output }, null, 2));
console.log(JSON.stringify({ sessionId: session.id, runId: run.id, status: run.status, checks: run.checks, error: run.error, url: `http://127.0.0.1:4310/#run/${run.id}`, output }, null, 2));
assert.equal(run.status, 'completed', run.error);
assert(run.artifacts.some(artifact => artifact.kind === 'screenshot'));
