import { setTimeout as sleep } from 'node:timers/promises';
import type { StressResult, WorkbenchJob } from '../../shared/workbench.js';
import { allowBrowserRequest, validateWorkbenchTarget } from './policy.js';
import { saveJob } from './store.js';

export function summarizeStress(samples: number[], statuses: Record<string, number>, durationMs: number, input: { requests: number; concurrency: number; rps: number }, stoppedEarly: boolean): StressResult {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) => Math.round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] || 0);
  return { requested: input.requests, completed: samples.length, concurrency: input.concurrency, requestsPerSecond: input.rps, durationMs: Math.round(durationMs), throughput: Number((samples.length / Math.max(durationMs / 1000, 0.001)).toFixed(2)), p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: percentile(1), statuses, rateLimited: statuses['429'] || 0, errors: Object.entries(statuses).reduce((n, [status, count]) => n + (status === 'network-error' || Number(status) >= 500 ? count : 0), 0), stoppedEarly };
}
export async function stressTest(job: WorkbenchJob, input: { requests: number; concurrency: number; rps: number }, signal: AbortSignal) {
  const target = validateWorkbenchTarget(job.targetUrl);
  if (!allowBrowserRequest(target.href, 'GET', target)) throw new Error('This endpoint is excluded from read-only stress testing.');
  const start = performance.now(), samples: number[] = [], statuses: Record<string, number> = {};
  let sent = 0, nextSlot = performance.now(), stopped = false;
  const publish = () => { job.stress = summarizeStress(samples, { ...statuses }, performance.now() - start, input, stopped || signal.aborted); job.stage = `${samples.length}/${input.requests} requests completed`; saveJob(job); };
  try {
    const workers = await Promise.allSettled(Array.from({ length: input.concurrency }, async () => {
      while (!stopped && !signal.aborted && sent < input.requests) {
        sent++;
        const slot = Math.max(nextSlot, performance.now()); nextSlot = slot + 1000 / input.rps;
        await sleep(Math.max(0, slot - performance.now()), undefined, { signal });
        if (stopped || signal.aborted) break;
        const began = performance.now(); let status = 'network-error';
        try {
          const response = await fetch(target, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': 'Probe-Local-Stress/1.0', 'Cache-Control': 'no-cache' }, signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
          status = String(response.status);
          // Drain only a bounded body. Do not follow redirects or stress another route by accident.
          const reader = response.body?.getReader(); let bytes = 0;
          if (reader) try { while (bytes < 262144) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; } } finally { await reader.cancel().catch(() => {}); }
        } catch { /* A timeout or failed connection is measured, not a successful request. */ }
        samples.push(performance.now() - began); statuses[status] = (statuses[status] || 0) + 1;
        const errors = (statuses['network-error'] || 0) + Object.entries(statuses).filter(([code]) => Number(code) >= 500).reduce((n, [, count]) => n + count, 0);
        if (status === '429' || status === '503' || Number(status) >= 300 && Number(status) < 400 || samples.length >= 10 && errors / samples.length >= .2) stopped = true;
        publish();
      }
    }));
    signal.throwIfAborted();
    const failed = workers.find(item => item.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  } finally {
    publish();
    job.notes.push('Bounded GET-only test. Latencies include up to 256 KiB of response body. Redirects, HTTP 429/503, or ≥20% failures after ten samples stop the test. Rate-limit absence at this load is not proof of a vulnerability.');
    job.stage = stopped ? 'Stopped at the target’s error/rate-limit boundary' : 'Stress test complete';
  }
}
