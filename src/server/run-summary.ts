import { origin } from './config.js';
import type { Run } from '../shared/types.js';

export function runSummary(run: Run) {
  return { runId: run.id, name: run.name, status: run.status, mode: run.mode, scenario: run.scenario, phase: run.phase,
    runUrl: `${origin}/#run/${run.id}`, targetUrl: run.targetUrl, checks: run.checks, limitations: run.limitations, error: run.error,
    audit: run.audit ? { model: run.audit.model, stage: run.audit.stage, requestedAgents: run.audit.requestedAgents, concurrency: run.audit.concurrency, accountCount: run.audit.accountCount, agents: run.audit.agents.map(agent => ({ id: agent.id, name: agent.name, status: agent.status, signup: agent.signup, workPhase: agent.workPhase, productActions: agent.productActions, coverage: agent.coverage, summary: agent.summary, error: agent.error })), reproductions: run.audit.reproductions } : undefined,
    findings: run.findings.map(finding => ({ title: finding.title, status: finding.status, expected: finding.expected, actual: finding.actual, evidenceIds: finding.evidenceIds })),
    artifacts: run.artifacts.map(({ id, kind, label, url }) => ({ id, kind, label, url: `${origin}${url}` })),
    note: 'Only report checks actually performed. Completed means execution finished, not that all product behavior is verified.' };
}
