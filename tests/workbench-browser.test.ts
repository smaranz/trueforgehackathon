import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { inspectPage } from '../src/server/workbench/browser.js';
import { stressTest, summarizeStress } from '../src/server/workbench/stress.js';
import { applyMemory, forgetMemory, remember } from '../src/server/workbench/store.js';
import type { WorkbenchJob } from '../src/shared/workbench.js';

const job = (targetUrl: string, kind: WorkbenchJob['kind'] = 'scan'): WorkbenchJob => ({ id: randomUUID(), targetUrl, kind, status: 'running', startedAt: new Date().toISOString(), stage: '', findings: [], notes: [] });

test('real browser captures actionable DOM/runtime evidence without submitting forms; memory stays scoped', async () => {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'text/html');
    res.end(`<html><head><title>Test form</title></head><body><h1>Signup</h1><input id="email" placeholder="Email"><button id="submit"></button><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="20" height="20"><script>fetch('/write',{method:'POST'}).catch(()=>{});setTimeout(()=>{throw new Error('render failed')},20)</script></body></html>`);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const target = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.PROBE_TARGET_ORIGINS = target;
  try {
    const result = await inspectPage(job(target), new AbortController().signal);
    assert(result.findings.some(item => item.rule === 'field-label' && item.selector === '#email'));
    assert(result.findings.some(item => item.rule === 'control-name' && item.selector === '#submit'));
    assert(result.findings.some(item => item.rule === 'runtime-error' && item.actual.includes('render failed')));
    assert(result.findings.some(item => item.rule === 'image-alt'));
    assert(!requests.some(item => item.startsWith('POST')));
    assert(result.screenshotUrl.endsWith('.png'));
    assert(result.elements.some(item => item.selector === '#submit' && item.rect.width > 0));
    const finding = result.findings.find(item => item.rule === 'field-label')!;
    const memory = remember(finding, 'false-positive', 'This fixture is intentionally unlabelled.');
    try {
      assert.equal(applyMemory([finding])[0].feedback?.verdict, 'false-positive');
      assert.equal(applyMemory([{ ...finding, url: `${target}/other` }])[0].feedback, undefined);
      assert.equal(applyMemory([{ ...finding, selector: '#other' }])[0].feedback, undefined);
      assert.equal(applyMemory([{ ...finding, actual: 'A different failure on the same control.' }])[0].feedback, undefined);
      assert.equal(applyMemory([finding])[0].actual, finding.actual);
    } finally { forgetMemory(memory.id); }
    assert.equal(applyMemory([finding])[0].feedback, undefined);
  } finally { delete process.env.PROBE_TARGET_ORIGINS; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('stress testing respects concurrency, global pacing and a target rate-limit boundary', async () => {
  let inflight = 0, peak = 0, total = 0;
  const times: number[] = [];
  const server = createServer((_req, res) => {
    times.push(performance.now()); total++; inflight++; peak = Math.max(peak, inflight);
    const status = total >= 4 ? 429 : 200;
    setTimeout(() => { res.writeHead(status); res.end('bounded response'); inflight--; }, 130);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const target = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.PROBE_TARGET_ORIGINS = target;
  try {
    const run = job(target, 'stress');
    await stressTest(run, { requests: 30, concurrency: 2, rps: 10 }, new AbortController().signal);
    assert(peak <= 2); assert(total <= 6); assert(run.stress!.rateLimited > 0); assert(run.stress!.stoppedEarly);
    assert.equal(run.stress!.completed, total); assert(run.stress!.p95Ms >= 120);
    assert(times[times.length - 1] - times[0] >= (times.length - 1) * 80);
    const before = total, controller = new AbortController(); controller.abort();
    await assert.rejects(stressTest(job(target, 'stress'), { requests: 100, concurrency: 5, rps: 10 }, controller.signal));
    assert.equal(total, before);
  } finally { delete process.env.PROBE_TARGET_ORIGINS; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('stress summary distinguishes request failures, healthy responses and rate limits', () => {
  const result = summarizeStress([10, 30, 20, 100], { '200': 1, '500': 1, '429': 1, 'network-error': 1 }, 1000, { requests: 4, concurrency: 2, rps: 4 }, false);
  assert.equal(result.p50Ms, 20); assert.equal(result.p95Ms, 100); assert.equal(result.errors, 2); assert.equal(result.rateLimited, 1); assert.equal(result.throughput, 4);
});
