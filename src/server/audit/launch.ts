import type { AuditInput } from '../../shared/types.js';
import { getRun, updates } from '../store.js';
import { runSummary } from '../run-summary.js';
import { currentAudit, startAudit } from './coordinator.js';

/** Starts background work once, then returns after the actual model preflight resolves. */
export async function launchAuditFromChat(input: AuditInput) {
  const existing = currentAudit();
  const run = existing ?? startAudit(input);
  if (run.status === 'queued') await new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); updates.off(run.id, changed); resolve(); };
    const changed = () => { if (getRun(run.id)?.status !== 'queued') finish(); };
    const timer = setTimeout(finish, 8000);
    updates.on(run.id, changed); changed();
  });
  const result = runSummary(getRun(run.id)!);
  const running = ['running', 'reproducing'].includes(result.status);
  return { ...result, existingRun: Boolean(existing), backgroundExecution: running || result.status === 'queued',
    reply: running ? `Running in Probe dashboard: ${result.runUrl}. ${run.audit!.requestedAgents} GPT-5.6 Sol specialists, ${run.audit!.concurrency} active at a time. They create accounts, complete prerequisites, test assigned product workflows, and save evidence. This is still running; signup is only the first phase.`
      : result.status === 'queued' ? `Queued in Probe dashboard: ${result.runUrl}. Preflight is still pending; testing is not complete.`
      : `Probe could not keep this audit running (${result.status}): ${result.error || 'See the run report'}. ${result.runUrl}`,
    nextAction: 'Return the reply and dashboard link to the user NOW. Do not wait/poll in this turn and do not claim that signup or full product testing is complete. Background workers continue independently.' };
}
