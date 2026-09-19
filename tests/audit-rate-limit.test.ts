import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderCooldown, providerRateLimitDelay } from '../src/server/audit/rate-limit.js';

test('provider429 uses bounded backoff and honors reported retry time', () => {
  assert.equal(providerRateLimitDelay('Request failed (429): try again in 151ms', 0), 10000);
  assert.equal(providerRateLimitDelay('Rate limit reached. Please try again in 45s.', 0), 46000);
  assert.equal(providerRateLimitDelay('Too many requests', 2), 40000);
  assert.equal(providerRateLimitDelay('429 retry after1hour', 10), 80000);
  assert.equal(providerRateLimitDelay('Signup HTTP500 database error', 0), undefined);
  assert.equal(providerRateLimitDelay('Incorrect API key (401)', 0), undefined);
});
test('provider cooldown exits immediately on cancellation', async () => {
  const cooldown = new ProviderCooldown(); cooldown.defer(30000);
  const controller = new AbortController(); controller.abort(new Error('Cancelled by operator'));
  await assert.rejects(cooldown.wait(controller.signal), /Cancelled by operator/);
});
