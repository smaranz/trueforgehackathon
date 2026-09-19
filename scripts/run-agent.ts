import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Run } from '../src/shared/types.js';

const base = `http://127.0.0.1:${process.env.PORT || 4310}`;
const response = await fetch(`${base}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
  mode: 'trueforge', variant: process.argv.includes('--corrected') ? 'corrected' : 'broken', scenario: 'revoked-access',
  targetUrl: `http://127.0.0.1:${process.env.DEMO_PORT || 4311}`,
  goal: 'Verify that document sharing and access revocation are enforced across owner and editor accounts, including fresh exports from an open tab.',
}) });
if (!response.ok) throw new Error(await response.text());
const started = await response.json() as Run;
console.log(`TrueForge investigation ${started.id}`);
const stream = await fetch(`${base}/api/runs/${started.id}/events`, { signal: AbortSignal.timeout(660000) });
const reader = stream.body!.getReader();
const decoder = new TextDecoder();
let buffer = '';
let seen = new Set<string>();
try {
  outer: while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error('Stream ended unexpectedly');
    buffer += decoder.decode(value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
      const line = block.split('\n').find(line => line.startsWith('data: '));
      if (!line) continue;
      const run: Run = JSON.parse(line.slice(6));
      for (const event of run.events) if (!seen.has(event.id)) {
        seen.add(event.id);
        console.log(`${event.timestamp} ${event.actor || 'system'} ${event.type}: ${event.message}`);
      }
      if (run.finishedAt && !['queued', 'running', 'reproducing'].includes(run.status)) {
        mkdirSync('.data/acceptance', { recursive: true });
        writeFileSync(`.data/acceptance/agent-${run.id}.json`, JSON.stringify(run, null, 2));
        console.log(JSON.stringify({ id: run.id, status: run.status, findings: run.findings.map(f => f.status), tokens: run.tokens, error: run.error }, null, 2));
        if (run.status !== 'completed') process.exitCode = 1;
        break outer;
      }
    }
  }
} finally { await reader.cancel(); }
