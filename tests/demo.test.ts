import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import {
  createDemoApp, createEnvironment, getEnvironmentState, issueSession, resetEnvironment,
  type Role, type Variant,
} from '../src/demo/app.js';
import { databasePath } from '../src/demo/store.js';

let server: Server;
let origin: string;
const environments: string[] = [];

before(async () => {
  server = createDemoApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  if (environments.length) {
    const database = new DatabaseSync(databasePath);
    try {
      database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;');
      const remove = database.prepare('DELETE FROM demo_environments WHERE id = ?');
      for (const id of environments) remove.run(id);
      database.exec('COMMIT');
    } finally { database.close(); }
  }
});

function fixture(variant: Variant = 'corrected') {
  const environment = createEnvironment(variant);
  environments.push(environment.id);
  const cookies = Object.fromEntries((['owner', 'editor', 'viewer'] as Role[]).map(role => {
    const cookie = issueSession(environment.id, role);
    return [role, `${cookie.name}=${cookie.value}`];
  })) as Record<Role, string>;
  const request = (path: string, role?: Role, options: RequestInit = {}) => fetch(`${origin}/w/${environment.id}${path}`, {
    ...options,
    redirect: 'manual',
    headers: { ...(role ? { cookie: cookies[role] } : {}), ...options.headers },
  });
  const post = (path: string, role: Role, body: unknown) => request(path, role, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { ...environment, cookies, request, post };
}

function assertHeaders(response: Response, revision?: number) {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
  assert.match(response.headers.get('x-document-revision') ?? '', /^\d+$/);
  if (revision !== undefined) assert.equal(response.headers.get('x-document-revision'), String(revision));
}

test('fixtures are independently random, correctly seeded, and persisted with opaque hashed sessions', () => {
  const first = fixture('broken');
  const second = fixture('corrected');
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.documentId, second.documentId);
  assert.notEqual(first.fixtureMarker, second.fixtureMarker);
  assert.match(first.fixtureMarker, /^FIELDNOTES_PRIVATE_[0-9a-f]{48}$/);
  const state = getEnvironmentState(first.id);
  assert.equal(state.id, first.id);
  assert.equal(state.variant, 'broken');
  assert.equal(state.documentId, first.documentId);
  assert.equal(state.fixtureMarker, first.fixtureMarker);
  assert.equal(state.revision, 1);
  assert.deepEqual(state.grants, { owner: 'owner', viewer: 'viewer' });
  assert.ok(state.content.includes(first.fixtureMarker));
  assert.equal(state.activity.length, 1);
  assert.equal(state.activity[0].actor, 'owner');
  assert.equal(state.activity[0].action, 'document.created');
  assert.ok(Number.isFinite(Date.parse(state.activity[0].timestamp)));

  const cookie = issueSession(first.id, 'editor');
  assert.equal(cookie.path, `/w/${first.id}`);
  assert.match(cookie.value, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(cookie.value, issueSession(first.id, 'editor').value);
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const persisted = database.prepare('SELECT content, fixture_marker FROM demo_environments WHERE id = ?').get(first.id)!;
    assert.equal(persisted.content, state.content);
    assert.equal(persisted.fixture_marker, first.fixtureMarker);
    const tokenHash = createHash('sha256').update(cookie.value).digest('hex');
    const session = database.prepare('SELECT token_hash, role, environment_id FROM demo_sessions WHERE token_hash = ?').get(tokenHash)!;
    assert.equal(session.role, 'editor');
    assert.equal(session.environment_id, first.id);
    assert.notEqual(session.token_hash, cookie.value);
  } finally { database.close(); }

  // Returning a state snapshot must not give callers a mutable reference to the store.
  state.grants.editor = 'editor';
  state.content = 'locally changed';
  state.activity.length = 0;
  assert.equal(getEnvironmentState(first.id).grants.editor, undefined);
  assert.notEqual(getEnvironmentState(first.id).content, state.content);
  assert.equal(getEnvironmentState(first.id).activity.length, 1);
});

test('document lists and HTML shells do not embed protected content or advertise the variant', async () => {
  for (const variant of ['broken', 'corrected'] as const) {
    const environment = fixture(variant);
    for (const role of ['owner', 'editor', 'viewer'] as const) {
      const response = await environment.request('', role);
      assert.equal(response.status, 200);
      assertHeaders(response, 1);
      const html = await response.text();
      assert.ok(html.includes('data-testid="open-document"'));
      assert.ok(html.includes('Mara Vale'));
      assert.ok(html.includes('Ellis Park'));
      assert.ok(html.includes('Noor Bell'));
      assert.ok(!html.includes(environment.fixtureMarker));
      assert.ok(!html.includes('A quieter kind of launch'));
      assert.ok(!html.includes('/api/document'));
      assert.doesNotMatch(html, /broken|corrected|fixtureMarker/);
    }
    const document = await environment.request('/documents/launch-brief', 'owner');
    const html = await document.text();
    assert.equal(document.status, 200);
    assert.ok(!html.includes(environment.fixtureMarker));
    assert.doesNotMatch(html, /broken|corrected|fixtureMarker/);
    for (const testId of ['share-button', 'grant-editor', 'revoke-editor', 'close-sharing', 'export-button', 'document-content', 'save-button', 'document-title', 'permission-editor', 'export-result', 'activity-log']) {
      assert.ok(html.includes(`data-testid="${testId}"`), `${testId} is available`);
    }
    assert.match(html, /cache: 'no-store'/);
    assert.match(html, /Removing someone’s access takes effect immediately/);
    const deniedPage = await environment.request('/documents/launch-brief', 'editor');
    assert.equal(deniedPage.status, 403);
    assert.ok(!(await deniedPage.text()).includes(environment.fixtureMarker));
  }
});

test('every protected endpoint requires an environment-scoped session; role spoofing cannot change identity', async () => {
  const first = fixture();
  const second = fixture();
  for (const [path, method] of [['/api/document', 'GET'], ['/api/export', 'GET'], ['/api/share', 'POST'], ['/api/revoke', 'POST'], ['/api/document', 'PUT']]) {
    const anonymous = await first.request(path, undefined, { method });
    assert.equal(anonymous.status, 401);
    assertHeaders(anonymous, 1);
    assert.ok(!(await anonymous.text()).includes(first.fixtureMarker));
    const transplanted = await second.request(path, undefined, { method, headers: { cookie: first.cookies.owner } });
    assert.equal(transplanted.status, 401);
    assert.ok(!(await transplanted.text()).includes(second.fixtureMarker));
  }
  for (const cookie of ['fieldnotes_session=owner', 'fieldnotes_session=' + 'a'.repeat(43), `${first.cookies.owner}; ${first.cookies.editor}`]) {
    const forged = await first.request('/api/export?role=owner', undefined, { headers: { cookie, 'x-role': 'owner' } });
    assert.equal(forged.status, 401);
  }
  const spoofed = await first.request('/api/document?role=owner', 'viewer', {
    method: 'PUT', headers: { 'content-type': 'application/json', 'x-role': 'owner' }, body: JSON.stringify({ content: 'unauthorized', revision: 1 }),
  });
  assert.equal(spoofed.status, 403);
  const missing = await fetch(`${origin}/w/does-not-exist/api/export`);
  assert.equal(missing.status, 404);
  assertHeaders(missing, 0);
});

for (const variant of ['broken', 'corrected'] as const) {
  test(`${variant}: a real grant/revoke changes reads and writes; export ${variant === 'broken' ? 'exposes the intentional stale-access fault' : 'enforces the current grant'}`, async () => {
    const environment = fixture(variant);
    const before = await environment.request('/api/document', 'editor');
    assert.equal(before.status, 403);
    assert.ok(!(await before.text()).includes(environment.fixtureMarker));
    const neverGrantedExport = await environment.request('/api/export', 'editor');
    assert.equal(neverGrantedExport.status, variant === 'broken' ? 200 : 403);
    assert.equal((await neverGrantedExport.text()).includes(environment.fixtureMarker), variant === 'broken');

    const shared = await environment.post('/api/share', 'owner', { role: 'editor' });
    assert.equal(shared.status, 200);
    assertHeaders(shared, 2);
    assert.equal(getEnvironmentState(environment.id).grants.editor, 'editor');
    const allowedRead = await environment.request('/api/document', 'editor');
    assert.equal(allowedRead.status, 200);
    const document = await allowedRead.json();
    assert.ok(document.content.includes(environment.fixtureMarker));
    assert.equal(document.canEdit, true);
    assert.equal(document.canShare, false);
    assert.equal(document.variant, undefined);
    const allowedExport = await environment.request('/api/export', 'editor');
    assert.equal(allowedExport.status, 200);
    assert.ok((await allowedExport.text()).includes(environment.fixtureMarker));

    const revoked = await environment.post('/api/revoke', 'owner', { role: 'editor' });
    assert.equal(revoked.status, 200);
    assertHeaders(revoked, 3);
    const state = getEnvironmentState(environment.id);
    assert.equal(state.grants.editor, undefined);
    assert.equal(state.activity.filter(event => event.action === 'editor.granted').length, 1);
    assert.equal(state.activity.filter(event => event.action === 'editor.revoked').length, 1);
    const deniedRead = await environment.request('/api/document', 'editor');
    assert.equal(deniedRead.status, 403);
    assert.ok(!(await deniedRead.text()).includes(environment.fixtureMarker));
    const deniedWrite = await environment.post('/api/document', 'editor', { content: 'revoked write', revision: document.revision });
    assert.equal(deniedWrite.status, 403, 'ACL denial takes priority over a stale revision');
    assert.equal(getEnvironmentState(environment.id).content, state.content);

    const exported = await environment.request('/api/export', 'editor', { headers: { 'cache-control': 'no-cache', 'if-none-match': 'anything' } });
    assert.equal(exported.status, variant === 'broken' ? 200 : 403);
    assertHeaders(exported, 3);
    assert.notEqual(exported.headers.get('x-request-id'), allowedExport.headers.get('x-request-id'));
    assert.equal((await exported.text()).includes(environment.fixtureMarker), variant === 'broken');
    const freshSession = issueSession(environment.id, 'editor');
    const freshExport = await environment.request('/api/export', undefined, { headers: { cookie: `${freshSession.name}=${freshSession.value}` } });
    assert.equal(freshExport.status, variant === 'broken' ? 200 : 403, 'The result comes from current server policy, not a cached page or stale cookie claim');
    assert.equal((await environment.request('/api/document', 'owner')).status, 200);
    assert.equal((await environment.request('/api/document', 'viewer')).status, 200);
    const viewerExport = await environment.request('/api/export', 'viewer');
    assert.equal(viewerExport.status, 200);
    assert.ok((await viewerExport.text()).includes(environment.fixtureMarker));
  });
}

test('viewers can read and export but cannot save or manage sharing in either variant', async () => {
  for (const variant of ['broken', 'corrected'] as const) {
    const environment = fixture(variant);
    const response = await environment.request('/api/document', 'viewer');
    assert.equal(response.status, 200);
    const document = await response.json();
    assert.equal(document.canEdit, false);
    assert.equal(document.canShare, false);
    for (const method of ['POST', 'PUT', 'PATCH']) {
      const denied = await environment.request('/api/document', 'viewer', {
        method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'viewer overwrite', revision: document.revision }),
      });
      assert.equal(denied.status, 403);
      assertHeaders(denied, 1);
    }
    for (const role of ['viewer', 'editor'] as const) {
      for (const path of ['/api/share', '/api/revoke']) {
        assert.equal((await environment.post(path, role, { role: 'editor' })).status, 403);
      }
    }
    await environment.post('/api/share', 'owner', { role: 'editor' });
    assert.equal((await environment.post('/api/revoke', 'editor', { role: 'editor' })).status, 403);
    assert.equal(getEnvironmentState(environment.id).content, document.content);
    assert.equal(getEnvironmentState(environment.id).grants.editor, 'editor');
    const exported = await environment.request('/api/export', 'viewer');
    assert.equal(exported.status, 200);
    assert.ok((await exported.text()).includes(environment.fixtureMarker));
  }
});

test('saves are persisted and revision-checked atomically, including simultaneous writes and permission changes', async () => {
  const environment = fixture();
  const initial = await (await environment.request('/api/document', 'owner')).json();
  await environment.post('/api/share', 'owner', { role: 'editor' });
  const staleAfterShare = await environment.post('/api/document', 'owner', { content: 'old owner draft', revision: initial.revision });
  assert.equal(staleAfterShare.status, 409);
  assertHeaders(staleAfterShare, 2);
  const edited = await environment.request('/api/document', 'editor', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Ellis refined the launch story.', revision: 2 }),
  });
  assert.equal(edited.status, 200);
  assertHeaders(edited, 3);
  assert.equal(getEnvironmentState(environment.id).content, 'Ellis refined the launch story.');
  const competing = await Promise.all([
    environment.post('/api/document', 'owner', { content: 'Mara’s final draft.', revision: 3 }),
    environment.post('/api/document', 'editor', { content: 'Ellis’s final draft.', revision: 3 }),
  ]);
  assert.deepEqual(competing.map(response => response.status).sort(), [200, 409]);
  const winner = await competing.find(response => response.status === 200)!.json();
  const state = getEnvironmentState(environment.id);
  assert.equal(state.content, winner.content);
  assert.equal(state.revision, 4);
  assert.equal(state.activity.filter(event => event.action === 'document.saved').length, 2);
  const reloaded = await (await environment.request('/api/document', 'viewer')).json();
  assert.equal(reloaded.content, winner.content);
  assert.equal(reloaded.revision, 4);
  const exported = await environment.request('/api/export', 'owner');
  const body = await exported.text();
  assert.ok(body.includes(winner.content));
  assert.ok(body.includes(environment.fixtureMarker), 'The private export reference survives editing the document');
});

test('invalid payloads, cross-origin mutations, and duplicate grant/revoke requests do not mutate state', async () => {
  const environment = fixture();
  const initial = getEnvironmentState(environment.id);
  for (const body of [{ role: 'owner' }, { role: 'viewer' }, { role: 'editor', variant: 'broken' }, {}, null]) {
    assert.equal((await environment.post('/api/share', 'owner', body)).status, 400);
  }
  for (const body of [{ content: 'missing revision' }, { content: 'wrong revision type', revision: '1' }, { content: '', revision: 1 }, { content: 'unexpected identity', revision: 1, role: 'owner' }]) {
    assert.equal((await environment.post('/api/document', 'owner', body)).status, 400);
  }
  const malformed = await environment.request('/api/document', 'owner', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assertHeaders(malformed, 1);
  const external = await environment.request('/api/share', 'owner', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://other.example' }, body: JSON.stringify({ role: 'editor' }),
  });
  assert.equal(external.status, 403);
  assert.deepEqual(getEnvironmentState(environment.id), initial);
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await environment.post('/api/share', 'owner', { role: 'editor' })).status, 200);
  assert.equal(getEnvironmentState(environment.id).revision, 2);
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await environment.post('/api/revoke', 'owner', { role: 'editor' })).status, 200);
  assert.equal(getEnvironmentState(environment.id).revision, 3);
  assert.equal(getEnvironmentState(environment.id).activity.length, 3);
});

test('reset regenerates the fixture, optionally changes variant, and invalidates every old session only in that environment', async () => {
  const environment = fixture('broken');
  const neighbor = fixture('broken');
  await environment.post('/api/share', 'owner', { role: 'editor' });
  await environment.post('/api/document', 'editor', { content: 'Before reset', revision: 2 });
  const reset = resetEnvironment(environment.id, 'corrected');
  assert.equal(reset.id, environment.id);
  assert.notEqual(reset.documentId, environment.documentId);
  assert.notEqual(reset.fixtureMarker, environment.fixtureMarker);
  const state = getEnvironmentState(environment.id);
  assert.equal(state.variant, 'corrected');
  assert.equal(state.revision, 1);
  assert.deepEqual(state.grants, { owner: 'owner', viewer: 'viewer' });
  assert.equal(state.activity.length, 1);
  assert.ok(!state.content.includes(environment.fixtureMarker));
  for (const role of ['owner', 'editor', 'viewer'] as const) {
    assert.equal((await environment.request('/api/document', role)).status, 401);
    assert.equal((await environment.request('/api/export', role)).status, 401);
  }
  assert.equal((await neighbor.request('/api/document', 'owner')).status, 200);
  const newOwner = issueSession(environment.id, 'owner');
  const newRead = await environment.request('/api/document', undefined, { headers: { cookie: `${newOwner.name}=${newOwner.value}` } });
  assert.equal(newRead.status, 200);
  assert.ok((await newRead.text()).includes(reset.fixtureMarker));
  resetEnvironment(environment.id);
  assert.equal(getEnvironmentState(environment.id).variant, 'corrected');
  assert.equal((await environment.request('/api/document', undefined, { headers: { cookie: `${newOwner.name}=${newOwner.value}` } })).status, 401);
});

test('human sign-in sets an HttpOnly, SameSite=Strict, path-scoped session without exposing reset or fault endpoints', async () => {
  const environment = fixture();
  const loginPage = await environment.request('/login');
  assert.equal(loginPage.status, 200);
  assertHeaders(loginPage, 1);
  const html = await loginPage.text();
  for (const email of ['owner@fieldnotes.test', 'editor@fieldnotes.test', 'viewer@fieldnotes.test']) assert.ok(html.includes(email));
  assert.ok(!html.includes(environment.fixtureMarker));
  const login = await environment.request('/login', undefined, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=viewer%40fieldnotes.test',
  });
  assert.equal(login.status, 303);
  assert.equal(login.headers.get('location'), `/w/${environment.id}`);
  assertHeaders(login, 1);
  const cookie = login.headers.get('set-cookie')!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.ok(cookie.includes(`Path=/w/${environment.id}`));
  const viewer = await environment.request('/api/document', undefined, { headers: { cookie: cookie.split(';')[0] } });
  assert.equal(viewer.status, 200);
  assert.equal((await viewer.json()).canEdit, false);
  const rejectedLogin = await environment.request('/login', undefined, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'someone@else.test' }),
  });
  assert.equal(rejectedLogin.status, 400);
  assert.equal(rejectedLogin.headers.get('set-cookie'), null);
  const before = getEnvironmentState(environment.id);
  for (const path of ['/reset', '/fault', '/api/reset', '/api/fault', '/api/session', '/api/environment']) {
    const response = await environment.post(path, 'owner', { variant: 'broken' });
    assert.equal(response.status, 404);
    assertHeaders(response, 1);
  }
  assert.deepEqual(getEnvironmentState(environment.id), before);
});
