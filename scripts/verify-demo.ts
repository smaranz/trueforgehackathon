import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Run } from '../src/shared/types.js';

const base = `http://127.0.0.1:${process.env.PORT || 4310}`;
async function api(path: string, data?: unknown) {
  const response = await fetch(`${base}/api${path}`, data === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
async function completed(id: string): Promise<Run> {
  const response = await fetch(`${base}/api/runs/${id}/events`, { signal: AbortSignal.timeout(180000) });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error('Event stream ended before completion');
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const line = block.split('\n').find(line => line.startsWith('data: '));
        if (!line) continue;
        const run: Run = JSON.parse(line.slice(6));
        if (run.finishedAt && !['queued', 'running', 'reproducing'].includes(run.status)) return run;
      }
    }
  } finally { await reader.cancel(); }
}
const health = await api('/health');
console.log('Running deterministic browser acceptance proof (no agent reasoning).');
const input = { mode: 'deterministic', scenario: 'revoked-access', goal: 'Verify document sharing and immediate access revocation across owner and editor.', targetUrl: health.demoUrl };
const started: Run = await api('/runs', { ...input, variant: 'broken' });
let broken = await completed(started.id);
assert.equal(broken.status, 'completed', broken.error);
assert.equal(broken.findings[0]?.status, 'Confirmed');
assert.equal(broken.verifications[0]?.status, 'failed');
console.log(`Confirmed with clean reproduction: ${broken.id}`);
await api(`/runs/${broken.id}/verify`, {});
broken = await completed(broken.id);
assert.equal(broken.verifications[1]?.status, 'passed', broken.error);
assert.equal(broken.verifications[0].testHash, broken.verifications[1].testHash);
console.log('Unchanged Playwright regression: broken FAIL → corrected PASS.');
const correctedStarted: Run = await api('/runs', { ...input, variant: 'corrected' });
const corrected = await completed(correctedStarted.id);
assert.equal(corrected.status, 'completed', corrected.error);
assert.equal(corrected.findings.length, 0, 'Healthy run must not invent findings');
const persisted: Run = await api(`/runs/${broken.id}`);
assert.equal(persisted.verifications.length, 2);
mkdirSync('.data/acceptance', { recursive: true });
writeFileSync('.data/acceptance/demo-verification.json', JSON.stringify({ executedAt: new Date().toISOString(), mode: 'deterministic', trueforgeVerified: false, brokenRunId: broken.id, correctedRunId: corrected.id, confirmed: true, regressionBefore: broken.verifications[0], regressionAfter: broken.verifications[1], healthyFindingCount: corrected.findings.length, persisted: true }, null, 2));
console.log(`Healthy run: ${corrected.id}, no findings. Evidence saved to .data/acceptance/demo-verification.json`);
