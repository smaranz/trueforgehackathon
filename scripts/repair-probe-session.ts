import 'dotenv/config';
import assert from 'node:assert/strict';
import { connectProbe, matchesArchivedAgentSpec } from '../src/server/launcher.js';
import { forge } from '../src/server/forge.js';
import { listRuns } from '../src/server/store.js';
import { archivedAgentSpec, archiveVersion } from '../src/server/archive-spec.js';

const sessionId = process.argv[2] || '01m2xmm5nh9t6kd51nkggmtqws';
const run = listRuns().find(run => run.mode === 'trueforge' &&
  !['queued', 'running', 'reproducing'].includes(run.status) &&
  run.events.some(event => event.type === 'trueforge.session.created' && event.sessionId === sessionId));
assert(run, 'Session must belong to a locally recorded ended run.');
const role = run.events.find(event => event.type === 'trueforge.session.created' && event.sessionId === sessionId)?.actor;
assert(role === 'owner' || role === 'editor');
const { data: before } = await forge.sessions.get(sessionId);
assert.equal(before.metadata.probeSourceRunId, run.id);
assert.equal(before.metadata.probeSourceRole, role);
const result = await connectProbe(sessionId);
assert(result.configured, result.reason);
const { data: session } = await forge.sessions.get(sessionId);
assert.equal(session.agent.type, 'inline');
if (session.agent.type !== 'inline') throw new Error('Expected inline agent.');
const spec = session.agent.spec;
const connectorName = spec.mcpServers?.[0]?.name;
assert(connectorName, 'Archived connector was not restored (session may have an active turn).');
const expected = archivedAgentSpec(connectorName);
assert.equal(session.metadata.probeArchiveVersion, archiveVersion);
assert.equal(session.metadata.probeSourceRunId, run.id);
assert.equal(session.metadata.probeSourceRole, role);
assert.deepEqual(spec.model, expected.model);
assert.equal(spec.instructions, expected.instructions);
assert(matchesArchivedAgentSpec(spec, connectorName), 'Archived connector, tools, instructions and model must match.');
console.log(JSON.stringify({ sessionId, verified: true, model: spec.model, instructionsRestored: true,
  connectors: spec.mcpServers?.map(server => ({ name: server.name, tools: server.enableTools })),
  archiveVersion }, null, 2));
