import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Run, Finding } from '../src/shared/types.js';

const directory = resolve('.data/tests', `unlimited-${randomUUID()}`);
process.env.CZ_DATA_DIR = directory;
const { auditInput, startAudit } = await import('../src/server/audit/coordinator.js');
const { AuditBrowser } = await import('../src/server/audit/browser.js');
const { forge } = await import('../src/server/forge.js');
const { artifact, updates } = await import('../src/server/store.js');
after(() => rmSync(directory, { recursive: true, force: true }));

test('new audit input supports omitted/null token budgets and legacy callers without changing execution bounds', () => {
  assert.equal(auditInput.parse({ targetUrl: 'http://localhost:3000/signup' }).maxTotalTokens, undefined);
  assert.equal(auditInput.parse({ targetUrl: 'http://localhost:3000/signup', maxTotalTokens: null }).maxTotalTokens, null);
  assert.equal(auditInput.parse({ targetUrl: 'http://localhost:3000/signup', maxTotalTokens: 6000000 }).agentCount, 30);
  assert.throws(() => auditInput.parse({ targetUrl: 'http://localhost:3000/signup', concurrency: 100 }));
  assert.throws(() => auditInput.parse({ targetUrl: 'http://unapproved.test/signup' }));
});

test('token usage far above a legacy cutoff does not skip queued agents, rechecks, or objective reproduction', async t => {
  // Exercise the real coordinator with deterministic transport/model doubles.
  // No real target requests, accounts, browsers or paid model calls are made.
  const started: InstanceType<typeof AuditBrowser>[] = [];
  const sessions = new Map<string, InstanceType<typeof AuditBrowser>>();
  const phaseCounts = { registration: 0, exploration: 0, recheck: 0, reproduction: 0 };
  t.mock.method(AuditBrowser.prototype, 'start', async function(this: InstanceType<typeof AuditBrowser>) { started.push(this); });
  t.mock.method(AuditBrowser.prototype, 'close', async () => {});
  t.mock.method(forge.models, 'list', async () => ({ data: [{ name: 'openai/gpt-5-6-sol' }] }));
  t.mock.method(forge.settings.mcpServers, 'create', async () => ({}));
  t.mock.method(forge.sessions, 'create', async () => {
    const id = randomUUID(); sessions.set(id, started.at(-1)!); return { data: { id } };
  });
  t.mock.method(forge.sessions, 'cancel', async () => ({}));
  const objective = (browser: InstanceType<typeof AuditBrowser>) => {
    const saved = artifact(browser.run, 'assertion', 'Controlled HTTP500 evidence', '{"status":500}', 'json', 'viewer', browser.agent.id);
    browser.evidence.set(saved.id, { id: saved.id, type: 'http_response', url: 'http://localhost:3000/api/profile', status: 500 });
    return saved.id;
  };
  t.mock.method(forge.sessions, 'createTurnStream', async (sessionId: string, request: { input: { content: string }[] }) => {
    const browser = sessions.get(sessionId)!;
    const prompt = request.input[0].content;
    if (prompt.startsWith('PHASE1')) { phaseCounts.registration++; browser.agent.signup = 'verified'; browser.run.audit!.accountCount++; }
    else if (prompt.startsWith('PHASE2')) {
      phaseCounts.exploration++; browser.agent.productActions = 1;
      if (browser.agent.id === 'audit-01') {
        const finding: Finding = { id: randomUUID(), runId: browser.run.id, title: 'Controlled server failure', category: 'functional', scenario: 'test', expected: 'HTTP200', expectationSource: 'Fixture contract', actual: 'HTTP500', actors: ['viewer'], actorIds: [browser.agent.id], preconditions: [], steps: ['Load own profile'], evidenceIds: [objective(browser)], status: 'Suspected', severity: 'Medium', rationale: 'Controlled regression fixture', auditAssertion: { kind: 'http_error', url: 'http://localhost:3000/api/profile', status: 500 } };
        browser.run.findings.push(finding);
      }
    } else if (prompt.startsWith('PHASE3')) phaseCounts.recheck++;
    else if (prompt.startsWith('INDEPENDENT')) { phaseCounts.reproduction++; objective(browser); }
    browser.agent.summary = 'Completed the controlled product workflow and recorded coverage.';
    browser.agent.coverage = ['Own profile workflow'];
    return { withMetadata: () => (async function* () {
      yield { id: '1', data: { id: randomUUID(), type: 'turn.done', state: { status: 'done', requiredActions: [], metrics: { totalInputTokens: 9000000, totalOutputTokens: 100 }, output: null } } };
    })() };
  });

  const run = startAudit(auditInput.parse({ targetUrl: 'http://localhost:3000/signup', agentCount: 3, concurrency: 1, maxTotalTokens: 1 }));
  assert.equal(run.audit!.maxTotalTokens, null, 'Legacy token-cap input must not reintroduce a cutoff');
  await new Promise<void>((resolve, reject) => {
    const changed = (value: Run) => { if (value.finishedAt) { clearTimeout(timer); updates.off(run.id, changed); resolve(); } };
    const timer = setTimeout(() => { updates.off(run.id, changed); reject(new Error('Controlled audit failed to complete')); }, 5000);
    updates.on(run.id, changed);
  });
  assert.equal(run.status, 'completed', run.error);
  assert.equal(run.audit!.agents.length, 3);
  assert(run.audit!.agents.every(agent => agent.status === 'completed'));
  assert.deepEqual(phaseCounts, { registration: 3, exploration: 3, recheck: 3, reproduction: 1 });
  assert.equal(run.findings[0].status, 'Confirmed');
  assert((run.tokens!.input + run.tokens!.output) > 6000000, 'Actual metrics are retained even without a cutoff');
  assert(!run.audit!.agents.some(agent => agent.error?.includes('Token budget')));
});
