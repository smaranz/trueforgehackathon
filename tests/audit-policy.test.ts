import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditAssignments } from '../src/server/audit/catalog.js';
import { isAuditNavigation, requestPolicy, safeActionLabel } from '../src/server/audit/policy.js';
import { allowedVerificationLink } from '../src/server/audit/mailbox.js';

test('30 distinct specialist assignments have approved routes and honest bounded objectives', () => {
  assert.equal(auditAssignments.length, 30); assert.equal(new Set(auditAssignments.map(item => item.id)).size, 30);
  for (const item of auditAssignments) { assert(item.objective.length > 50); assert(item.routes.every(route => isAuditNavigation(`http://localhost:3000${route}`))); }
});
test('product scope blocks external/internal services, destructive account actions and forbidden writes', () => {
  for (const url of ['http://127.0.0.1:4310/api/runs', 'http://169.254.169.254/', 'file:///etc/passwd', 'http://localhost:3000/api/admin/users', 'http://localhost:3000/api/cron/refresh', 'http://localhost:3000/api/auth/delete-account', 'http://localhost:3000/api/counselor/share', 'http://localhost:3000/_next/image?url=http://169.254.169.254', 'http://localhost:3000/api/essays/challenge', 'http://localhost:3000/signup?next=http://attacker.test']) {
    assert.equal(requestPolicy(url, 'GET').allowed, false, url); assert.equal(requestPolicy(url, 'POST').allowed, false, url);
  }
  assert.equal(requestPolicy('http://localhost:3000/api/profile', 'PUT').allowed, true);
  assert.equal(requestPolicy('http://localhost:3000/api/profile', 'DELETE').allowed, false);
  assert.equal(requestPolicy('http://localhost:3000/api/onboarding/analyze', 'POST').metered, true);
  assert.equal(requestPolicy('http://localhost:3000/api/auth/signup', 'POST').auth, true);
  assert.equal(requestPolicy('http://localhost:3000/api/counselor/records?type=users', 'GET').allowed, false);
  assert.equal(requestPolicy('http://localhost:3000/api/profile', 'PUT', { allowWrites: false }).allowed, false);
});
test('auth access is restricted to configured provider authentication endpoints', () => {
  const authOrigin = 'https://test-project.supabase.co';
  assert(requestPolicy(`${authOrigin}/auth/v1/user`, 'GET', { authOrigin }).allowed);
  assert(requestPolicy(`${authOrigin}/auth/v1/token?grant_type=refresh_token`, 'POST', { authOrigin }).allowed);
  assert(!requestPolicy(`${authOrigin}/rest/v1/users`, 'GET', { authOrigin }).allowed);
  assert(!requestPolicy('https://different.supabase.co/auth/v1/user', 'GET', { authOrigin }).allowed);
  assert(!requestPolicy(`${authOrigin}/auth/v1/user`, 'PUT', { authOrigin }).allowed);
});
test('confirmation links cannot redirect the trusted browser outside the authorized target', () => {
  const authOrigin = 'https://test-project.supabase.co';
  assert(allowedVerificationLink(`${authOrigin}/auth/v1/verify?token=synthetic&type=signup&redirect_to=http://localhost:3000/auth/callback`, authOrigin));
  assert.equal(allowedVerificationLink(`${authOrigin}/auth/v1/verify?token=synthetic&type=signup&redirect_to=http://169.254.169.254`, authOrigin), undefined);
  assert.equal(allowedVerificationLink('https://evil.test/auth/v1/verify?type=signup', authOrigin), undefined);
  assert.equal(allowedVerificationLink(`${authOrigin}/auth/v1/verify?type=recovery`, authOrigin), undefined);
});
test('consequential UI actions are excluded while ordinary synthetic CRUD is permitted', () => {
  for (const label of ['Continue with Google', 'Delete account', 'Reset password', 'Invite friends', 'Buy premium', 'Publish essay', 'Share public link']) assert.equal(safeActionLabel(label), false);
  for (const label of ['Create account', 'Save document', 'Choose this project', 'Delete draft', 'Next']) assert(safeActionLabel(label));
});
