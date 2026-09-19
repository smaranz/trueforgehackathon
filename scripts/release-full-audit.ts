import { readFileSync, watch } from 'node:fs';
import { resolve } from 'node:path';
import type { Run } from '../src/shared/types.js';

// Read-only release observations. Release artifacts are maintained with apply_patch.
const origin = 'http://127.0.0.1:4310';
const activeStatuses = new Set(['queued', 'running', 'reproducing']);
const command = process.argv[2];
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

async function json(path: string, method = 'GET'): Promise<any> {
  const response = await fetch(`${origin}${path}`, { method, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
  return response.json();
}

function summary(run: Run) {
  const actions = run.events.filter(event => event.type === 'audit.tool.completed');
  return {
    observedAt: new Date().toISOString(), id: run.id, status: run.status,
    phase: run.phase, error: run.error, model: run.audit?.model,
    accountCount: run.audit?.accountCount, requestedAgents: run.audit?.requestedAgents,
    concurrency: run.audit?.concurrency, stage: run.audit?.stage,
    tokens: run.tokens, artifacts: run.artifacts.length, findings: run.findings.length,
    agents: run.audit?.agents.map(agent => ({
      id: agent.id, status: agent.status, signup: agent.signup,
      steps: agent.stepCount, sessionId: agent.sessionId,
      currentAction: agent.currentAction, visitedUrls: agent.visitedUrls,
      coverage: agent.coverage, summary: agent.summary, error: agent.error,
    })),
    browserActionEvents: actions.length,
    recentEvents: run.events.slice(-8).map(event => ({ type: event.type, message: event.message, timestamp: event.timestamp })),
  };
}

async function waitForHandoffs() {
  const names = ['identity', 'core', 'runtime', 'ui'];
  const root = resolve('.data');
  await new Promise<void>((done, reject) => {
    let previous = '';
    let debounce: NodeJS.Timeout | undefined;
    const watcher = watch(root, { recursive: true }, (_event, name) => {
      if (!name?.toString().includes('handoff')) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(check, 50);
    });
    const deadline = setTimeout(() => finish(new Error('Five-minute handoff deadline reached')), 300000);
    function finish(error?: Error) {
      watcher.close(); clearTimeout(deadline); if (debounce) clearTimeout(debounce);
      if (error) reject(error); else done();
    }
    function check() {
      const markers = names.map(name => {
        try { return { name, marker: JSON.parse(readFileSync(resolve(root, 'handoff', `${name}-ready.json`), 'utf8')) }; }
        catch { return { name, marker: null }; }
      });
      const state = JSON.stringify(markers);
      if (state !== previous) { print({ observedAt: new Date().toISOString(), handoffs: markers }); previous = state; }
      if (markers.every(({ marker }) => marker?.ready === true)) finish();
    }
    watcher.on('error', finish);
    check();
  });
}

async function monitor(id: string, seconds: number, goal: string) {
  if (!id) throw new Error('Run ID required');
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), Math.min(seconds, 300) * 1000);
  let last: Run | undefined;
  let signature = '';
  try {
    const response = await fetch(`${origin}/api/runs/${encodeURIComponent(id)}/events`, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`SSE: HTTP ${response.status}`);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += chunk.value;
      let separator: number;
      while ((separator = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, separator); buffer = buffer.slice(separator + 2);
        const data = frame.split('\n').find(line => line.startsWith('data: '));
        if (!data) continue;
        const run: Run = JSON.parse(data.slice(6)); last = run;
        const state = JSON.stringify([run.status, run.audit?.stage, run.audit?.accountCount, run.audit?.agents.map(a => [a.status, a.signup, a.stepCount, a.error])]);
        if (state !== signature) { print(summary(run)); signature = state; }
        const verified = run.audit?.agents.some(a => a.signup === 'verified' && a.sessionId &&
          run.events.filter(event => event.actorId === a.id && event.type === 'audit.tool.completed').length >= (goal === 'pilot' ? 6 : 2));
        if (verified || !activeStatuses.has(run.status)) {
          print({ monitorResult: verified ? 'verified-live-execution' : 'terminal', goal });
          await reader.cancel(); return;
        }
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    print({ monitorResult: 'deadline', goal, last: last ? summary(last) : null });
  } finally { clearTimeout(deadline); controller.abort(); }
}

if (command === 'wait') await waitForHandoffs();
else if (command === 'summary') print(summary(await json(`/api/runs/${encodeURIComponent(process.argv[3])}`)));
else if (command === 'monitor') await monitor(process.argv[3], Number(process.argv[4] || 300), process.argv[5] || 'pilot');
else if (command === 'active') {
  const runs: Run[] = await json('/api/runs');
  const active = runs.filter(run => activeStatuses.has(run.status));
  print({ active: active.map(run => ({ id: run.id, status: run.status, scenario: run.scenario })) });
  if (active.length) process.exitCode = 1;
} else if (command === 'preflight') {
  const health = await json('/api/health');
  const catalog = await json('/api/audits/catalog');
  const launcher = await json('/api/probe/connect', 'POST');
  print({ health, catalog: { assignments: catalog.assignments?.length, model: catalog.model, mailbox: catalog.mailbox }, launcher });
  if (!health.trueforge?.ready || catalog.assignments?.length !== 30 || !catalog.mailbox?.configured || !launcher.configured) process.exitCode = 1;
} else throw new Error('Use wait, active, preflight, summary RUN_ID, or monitor RUN_ID [SECONDS] [pilot|full]');
