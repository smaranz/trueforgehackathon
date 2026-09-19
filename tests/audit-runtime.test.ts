import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, test, type TestContext } from 'node:test';
import { chromium, type Browser } from '@playwright/test';
import type { AuditAgent, AuditAssertion, Run } from '../src/shared/types.js';
import type { AuditEvidence } from '../src/server/audit/browser.js';

// Import the runtime only after selecting a private test vault: never reuse a
// configured mailbox, live run database, or account identity.
const sandbox = resolve('.data/tests', `audit-runtime-${randomUUID()}`);
process.env.CZ_DATA_DIR = sandbox;
const { AuditBrowser, resolveAuditBrowser, isProductInteraction } = await import('../src/server/audit/browser.js');
const { auditAssignments } = await import('../src/server/audit/catalog.js');
const { artifact } = await import('../src/server/store.js');
const { loadIdentity } = await import('../src/server/audit/identity.js');
after(() => rmSync(sandbox, { recursive: true, force: true }));

function fixture(t: TestContext) {
  const agents: AuditAgent[] = auditAssignments.slice(0, 2).map(assignment => ({
    ...assignment, status: 'running', signup: 'pending', stepCount: 0, visitedUrls: [], coverage: [],
  }));
  const run: Run = {
    id: randomUUID(), name: 'Audit runtime boundary fixture', goal: 'Verify evidence and capability boundaries',
    targetUrl: 'http://localhost:3000/signup', scenario: 'full-audit', mode: 'deterministic',
    status: 'completed', phase: 'check', startedAt: new Date().toISOString(), cost: null,
    actors: [], events: [], artifacts: [], findings: [], verifications: [],
    audit: { model: 'test-only', requestedAgents: 2, concurrency: 2, maxStepsPerAgent: 60,
      deadlineMinutes: 5, maxTotalTokens: 100000, stage: 'exploration', accountCount: 0,
      agents, reproductions: [] },
  };
  const controller = new AbortController();
  const browsers = agents.map(agent => new AuditBrowser(run, agent, controller.signal));
  t.after(async () => { await Promise.all(browsers.map(browser => browser.close())); });
  return { run, controller, browsers, agents };
}

// A transport-only double. Production AuditBrowser.start/inspect/execute and
// capability registration run unchanged. No listener, HTTP client or real
// Chromium process exists; goto records destinations instead of contacting 3000.
function browserTransport(t: TestContext) {
  const drivers: { navigations: string[]; fills: string[]; closed: boolean; context: object }[] = [];
  t.mock.method(chromium, 'launch', async () => {
    let currentUrl = 'about:blank';
    const driver = { navigations: [] as string[], fills: [] as string[], closed: false, context: {} };
    const page = {
      url: () => currentUrl, setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, on() {},
      goto: async (url: string) => { currentUrl = url; driver.navigations.push(url); },
      title: async () => 'Synthetic credential form', waitForLoadState: async () => {},
      evaluate: async () => undefined, getByText: () => ({}),
      locator: (selector: string) => ({
        evaluateAll: async (_callback: unknown, prefix: string) => [
          { ref: `${prefix}-0`, tag: 'input', type: 'password', label: 'Secret', disabled: false },
          { ref: `${prefix}-1`, tag: 'input', type: 'text', label: 'Email address', disabled: false },
          { ref: `${prefix}-2`, tag: 'input', type: 'text', label: 'Draft title', disabled: false },
        ],
        innerText: async () => 'Synthetic form fixture', isVisible: async () => true, or: () => ({}),
        fill: async (value: string) => { driver.fills.push(`${selector}:${value}`); },
      }),
    };
    const context = { route: async () => {}, routeWebSocket: async () => {},
      newPage: async () => page, on() {} };
    driver.context = context;
    drivers.push(driver);
    return { newContext: async () => context, close: async () => { driver.closed = true; } } as unknown as Browser;
  });
  return drivers;
}

function evidence(browser: InstanceType<typeof AuditBrowser>, details: Omit<AuditEvidence, 'id'> & Record<string, unknown>) {
  const saved = artifact(browser.run, 'assertion', 'Controlled runtime evidence', JSON.stringify(details), 'json', 'viewer', browser.agent.id);
  browser.evidence.set(saved.id, { id: saved.id, ...details });
  assert(existsSync(`${sandbox}${saved.url}`), 'Evidence reference must resolve to a test artifact');
  return saved.id;
}

function report(evidenceIds: string[], assertion: AuditAssertion = { kind: 'http_error', url: 'http://localhost:3000/api/profile', status: 500 }) {
  return { title: 'Profile request fails', category: 'functional', expected: 'Profile should be available',
    source: 'Observed profile workflow', observed: 'Profile returned a server error',
    steps: ['Open the profile workflow', 'Observe the captured response'], evidenceIds,
    severity: 'Medium', rationale: 'Profile cannot be loaded', assertion };
}

test('capabilities bind distinct agents, remain secret, and are revoked on close', async t => {
  const drivers = browserTransport(t);
  const { browsers: [first, second], run, agents } = fixture(t);
  assert.notEqual(first.token, second.token);
  assert.equal(resolveAuditBrowser(first.token), undefined, 'Unstarted browser has no active capability');
  await first.start(); await second.start();
  assert.equal(resolveAuditBrowser(first.token), first);
  assert.equal(resolveAuditBrowser(second.token), second);
  assert.equal(resolveAuditBrowser(randomUUID()), undefined);
  assert.notEqual(drivers[0].context, drivers[1].context);
  await first.inspect(); await second.inspect();
  assert(agents.every(agent => /@example\.com$/.test(agent.email!)));
  assert.notEqual(agents[0].email, agents[1].email);
  const own = loadIdentity(`${run.id}-${agents[0].id}`);
  const other = loadIdentity(`${run.id}-${agents[1].id}`);
  assert.notEqual(own.password, other.password);
  assert.equal(own.signupAttempted, false);
  const serialized = JSON.stringify(run);
  for (const secret of [first.token, second.token, own.password, other.password]) assert(!serialized.includes(secret));
  assert(!readFileSync(`${sandbox}/audit-vault/${run.id}-${agents[0].id}.json`, 'utf8').includes(own.password));
  await first.close();
  assert.equal(resolveAuditBrowser(first.token), undefined);
  assert.equal(resolveAuditBrowser(second.token), second, 'Closing one agent must not retire its peer');
  await assert.rejects(first.execute({ action: 'inspect' }), /cancelled|closed/i);
  await second.close();
  assert.equal(resolveAuditBrowser(second.token), undefined);
  assert(drivers.every(driver => driver.closed));
  assert(drivers.every(driver => driver.navigations.length === 1 && driver.navigations[0].endsWith('/signup')));
  assert.equal(run.audit!.accountCount, 0);
});

test('model cannot select another actor or supply arbitrary selectors/code', async t => {
  const { browsers: [browser], run } = fixture(t);
  for (const input of [
    { action: 'inspect', actor: 'owner' }, { action: 'inspect', actorId: 'audit-02' },
    { action: 'click', ref: 'r1-0', selector: 'input[type=password]' },
    { action: 'fill', ref: 'r1-0', value: 'synthetic', capability: 'other-agent' },
    { action: 'evaluate', code: 'document.cookie' }, { action: 'navigate', path: '/dashboard', origin: 'https://evil.test' },
  ]) await assert.rejects(browser.execute(input));
  assert.equal(browser.agent.stepCount, 0);
  assert.equal(run.events.length, 0);
});

test('runtime blocks external navigation and credential fill before transport side effects', async t => {
  const drivers = browserTransport(t);
  const { browsers: [browser] } = fixture(t);
  await browser.start();
  for (const path of ['https://evil.test/signup', '//169.254.169.254/', 'file:///etc/passwd', '/api/admin/users', '/signup?next=https://evil.test']) {
    const result = await browser.execute({ action: 'navigate', path }) as { error?: string };
    assert.match(result.error || '', /outside approved/i, path);
  }
  for (const type of ['password', 'email']) {
    const inspected = await browser.inspect();
    const controls = inspected.controls as { ref: string; type: string; label: string }[];
    const control = controls.find(control => type === 'password' ? control.type === 'password' : control.label === 'Email address')!;
    const result = await browser.execute({ action: 'fill', ref: control.ref, value: 'synthetic-only' }) as { error?: string };
    assert.match(result.error || '', /credentials|secrets/i);
  }
  const inspected = await browser.inspect();
  const normal = (inspected.controls as { ref: string; label: string }[]).find(control => control.label === 'Draft title')!;
  const result = await browser.execute({ action: 'fill', ref: normal.ref, value: 'PROBE fixture draft' }) as { error?: string };
  assert.equal(result.error, undefined, 'Ordinary synthetic input remains usable');
  assert.equal(drivers[0].fills.length, 1);
  assert.deepEqual(drivers[0].navigations, ['http://localhost:3000/signup']);
});

test('findings reject foreign, invented, mixed-owner and screenshot-only evidence', t => {
  const { browsers: [first, second], run } = fixture(t);
  const own = evidence(first, { type: 'http_response', url: 'http://localhost:3000/api/profile', status: 500 });
  const foreign = evidence(second, { type: 'http_response', url: 'http://localhost:3000/api/profile', status: 500 });
  const screenshot = evidence(first, { type: 'screenshot', url: 'http://localhost:3000/profile' });
  for (const ids of [[randomUUID()], [foreign], [own, foreign]]) assert.throws(() => first.report(report(ids)), /specific agent/i);
  assert.throws(() => first.report(report([screenshot])), /screenshot alone/i);
  assert.equal(run.findings.length, 0);
});

test('objective evidence creates only Suspected; unsupported cited claims become observations', t => {
  const { browsers: [browser], run } = fixture(t);
  const match = evidence(browser, { type: 'http_response', url: 'http://localhost:3000/api/profile', status: 500 });
  browser.report(report([match]));
  assert.equal(run.findings[0].status, 'Suspected');
  assert.equal(run.findings[0].auditAssertion?.kind, 'http_error');
  const unrelated = evidence(browser, { type: 'page_inspection', url: 'http://localhost:3000/profile', text: 'Profile page' });
  browser.report({ ...report([unrelated]), title: 'Unsubstantiated profile error' });
  assert.equal(run.findings[1].auditAssertion?.kind, 'observation', 'Uncited matching evidence cannot support the claim');
  assert(run.findings.every(finding => finding.status === 'Suspected'));
  assert.equal(run.audit!.reproductions.length, 0);
  assert.throws(() => browser.report({ ...report([match]), status: 'Confirmed' }));
});

test('objective HTTP matching rejects healthy/4xx/wrong-path evidence and accepts exact 5xx', t => {
  const { browsers: [browser] } = fixture(t);
  for (const status of [200, 304, 400, 401, 403, 404, 429]) {
    evidence(browser, { type: 'http_response', url: 'http://localhost:3000/api/profile', status });
    assert.deepEqual(browser.matches({ kind: 'http_error', url: '/api/profile', status }), []);
  }
  evidence(browser, { type: 'http_response', url: 'http://localhost:3000/api/college-list', status: 500 });
  assert.deepEqual(browser.matches({ kind: 'http_error', url: '/api/profile', status: 500 }), []);
  const id = evidence(browser, { type: 'http_response', url: 'http://localhost:3000/api/profile', status: 500 });
  assert.deepEqual(browser.matches({ kind: 'http_error', url: '/api/profile', status: 500 }), [id]);
  assert.deepEqual(browser.matches({ kind: 'http_error', url: '/api/profile', status: 503 }), []);
});

test('objective matching rejects a different origin even when the pathname matches', t => {
  const { browsers: [browser] } = fixture(t);
  evidence(browser, { type: 'http_response', url: 'https://unrelated.test/api/profile', status: 500 });
  assert.deepEqual(browser.matches({ kind: 'http_error', url: 'http://localhost:3000/api/profile', status: 500 }), []);
});

test('objective matching rejects a different query-selected resource', t => {
  const { browsers: [browser] } = fixture(t);
  evidence(browser, { type: 'http_response', url: 'http://localhost:3000/api/counselor/records?type=aid', status: 500 });
  assert.deepEqual(browser.matches({ kind: 'http_error', url: '/api/counselor/records?type=goals', status: 500 }), []);
});

test('anonymous-read proof requires a successful fresh anonymous response with own marker', t => {
  const { browsers: [browser] } = fixture(t);
  const assertion: AuditAssertion = { kind: 'unauthorized_read', url: '/api/profile' };
  for (const details of [
    { status: 403, unauthenticated: true, text: 'own-synthetic-marker-present' },
    { status: 200, unauthenticated: false, text: 'own-synthetic-marker-present' },
    { status: 200, unauthenticated: true, text: '' },
    { status: 200, unauthenticated: true, text: 'some-other-users-marker' },
  ]) evidence(browser, { type: 'unauthorized_read', url: 'http://localhost:3000/api/profile', ...details });
  assert.deepEqual(browser.matches(assertion), []);
  const id = evidence(browser, { type: 'unauthorized_read', url: 'http://localhost:3000/api/profile', status: 200, unauthenticated: true, text: 'own-synthetic-marker-present' });
  assert.deepEqual(browser.matches(assertion), [id]);
});

test('cached service-worker content cannot prove a fresh unauthorized read', t => {
  const { browsers: [browser] } = fixture(t);
  evidence(browser, { type: 'unauthorized_read', url: 'http://localhost:3000/api/profile', status: 200,
    unauthenticated: true, text: 'own-synthetic-marker-present', fromServiceWorker: true });
  assert.deepEqual(browser.matches({ kind: 'unauthorized_read', url: '/api/profile' }), []);
});

test('abort and close prevent inspection, reports and assignment writes', async t => {
  const { browsers: [browser], controller, run } = fixture(t);
  const id = evidence(browser, { type: 'http_response', url: 'http://localhost:3000/api/profile', status: 500 });
  controller.abort();
  await assert.rejects(browser.execute({ action: 'inspect' }), /cancelled|closed/i);
  await assert.rejects(browser.inspect(), /cancelled|closed/i);
  assert.throws(() => browser.report(report([id])), /cancelled|closed/i);
  assert.throws(() => browser.finish('Must not be persisted', ['profile']), /cancelled|closed/i);
  await browser.close(); await browser.close();
  assert.equal(resolveAuditBrowser(browser.token), undefined);
  assert.equal(run.findings.length, 0);
  assert.equal(browser.agent.summary, undefined);
});

test('signup and onboarding alone cannot count as actual product testing', () => {
  for (const path of ['/signup', '/signin', '/onboarding', '/onboarding/complete', '/']) {
    for (const action of ['signup', 'inspect', 'navigate', 'click', 'fill', 'reload']) assert.equal(isProductInteraction(action, `http://localhost:3000${path}`, true), false);
  }
  assert.equal(isProductInteraction('click', 'http://localhost:3000/essays', false), false);
  assert.equal(isProductInteraction('inspect', 'http://localhost:3000/essays', true), false);
  assert.equal(isProductInteraction('click', 'https://unrelated.test/essays', true), false);
  assert(isProductInteraction('fill', 'http://localhost:3000/essays', true));
  assert(isProductInteraction('accessibility', 'http://localhost:3000/dashboard', true));
});
