import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { request } from 'node:http';
import { isExpensiveApiPath, localOnly, rateLimiter, streamLimiter } from '../src/server/security.js';
import { allowBrowserRequest, selectElement, validateWorkbenchTarget } from '../src/server/workbench/policy.js';

test('loopback guard rejects rebinding/cross-origin reads and writes; forwarding headers cannot bypass rate limits', async () => {
  let now = 1000;
  const app = express(); app.use(localOnly, rateLimiter(2, 1000, () => now)); app.all('/check', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/check`;
  try {
    const rejected: Record<string, string>[] = [{ host: 'evil.example:4310' }, { origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }];
    for (const headers of rejected) {
      for (const method of ['GET', 'POST']) {
        const status = await new Promise<number | undefined>((resolve, reject) => { const req = request(url, { method, headers }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.end(); });
        assert.equal(status, 403, JSON.stringify({ headers, method }));
      }
    }
    const first = await fetch(url); assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-frame-options'), 'DENY'); assert.match(first.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    assert.equal((await fetch(url, { headers: { 'x-forwarded-for': '8.8.8.8' } })).status, 200);
    const limited = await fetch(url, { headers: { 'x-forwarded-for': '1.1.1.1' } }); assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '1');
    now += 1001; assert.equal((await fetch(url)).status, 200);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('live-stream capacity is released on disconnect', async () => {
  const app = express(); app.get('/events', streamLimiter(1), (_req, res) => { res.type('text/event-stream'); res.write(': connected\n\n'); });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/events`;
  try {
    const first = await fetch(url); assert.equal(first.status, 200);
    assert.equal((await fetch(url)).status, 429);
    await first.body!.cancel(); await new Promise(resolve => setTimeout(resolve, 30));
    const next = await fetch(url); assert.equal(next.status, 200); await next.body!.cancel();
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('job rate limiting covers Express case/trailing-slash aliases and legacy verification', () => {
  for (const path of ['/workbench/scan', '/WORKBENCH/SCAN/', '/runs/id/verify/', '/workbench/jobs/id/BUILD', '/audits/']) assert(isExpensiveApiPath(path), path);
  for (const path of ['/workbench/jobs/id/cancel', '/runs/id/cancel', '/health']) assert.equal(isExpensiveApiPath(path), false, path);
});

test('diagnostic target scope excludes network services, credentials, queries, writes and external resources', () => {
  const target = validateWorkbenchTarget('http://localhost:3000/signup');
  for (const value of ['http://169.254.169.254/', 'http://localhost:4310/api/runs', 'http://localhost:8790/', 'https://example.com/', 'http://evil.test:3000/', 'http://localhost:3000/?url=http://evil.test', 'http://user:pass@localhost:3000/', 'file:///etc/passwd']) assert.throws(() => validateWorkbenchTarget(value), value);
  assert(allowBrowserRequest('http://localhost:3000/static/app.js?v=1', 'GET', target));
  for (const [url, method] of [['http://localhost:3000/api/save', 'POST'], ['http://localhost:3000/logout', 'GET'], ['http://localhost:3000/api/admin/users', 'GET'], ['http://localhost:3000/image?url=http://evil.test', 'GET'], ['http://127.0.0.1:3000/', 'GET']]) assert.equal(allowBrowserRequest(url, method, target), false);
});

test('pinpoint chooses the smallest containing element at screenshot coordinates', () => {
  const elements = [{ selector: 'form', tag: 'form', text: '', rect: { x: 0, y: 0, width: 1280, height: 800 } }, { selector: '#save', tag: 'button', text: 'Save', rect: { x: 600, y: 350, width: 100, height: 100 } }];
  assert.equal(selectElement(elements, { x: .5, y: .5 })?.selector, '#save');
  assert.equal(selectElement([], { x: .5, y: .5 }), undefined);
});
