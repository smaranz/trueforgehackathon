import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { artifactDir, dataDir } from '../config.js';
import type { AgentMemory, Diagnostic, WorkbenchJob } from '../../shared/workbench.js';

mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(`${dataDir}/workbench.sqlite`);
db.exec(`PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, document TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memory (id TEXT PRIMARY KEY, scope TEXT UNIQUE NOT NULL, document TEXT NOT NULL);`);

export function saveJob(job: WorkbenchJob) {
  db.prepare('INSERT INTO jobs VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document')
    .run(job.id, job.startedAt, JSON.stringify(job));
}
export function getJob(id: string): WorkbenchJob | undefined {
  const row = db.prepare('SELECT document FROM jobs WHERE id = ?').get(id) as { document: string } | undefined;
  return row && JSON.parse(row.document);
}
export function listJobs(): WorkbenchJob[] {
  return (db.prepare('SELECT document FROM jobs ORDER BY started_at DESC LIMIT 60').all() as { document: string }[])
    .map(row => JSON.parse(row.document));
}
export function listMemory(): AgentMemory[] {
  return (db.prepare('SELECT document FROM memory ORDER BY rowid DESC LIMIT 200').all() as { document: string }[]).map(row => JSON.parse(row.document));
}
export function forgetMemory(id: string) { db.prepare('DELETE FROM memory WHERE id = ?').run(id); }
export function remember(finding: Diagnostic, verdict: AgentMemory['verdict'], reason: string): AgentMemory {
  const url = new URL(finding.url);
  const value: AgentMemory = { id: randomUUID(), origin: url.origin, path: url.pathname, rule: finding.rule, selector: finding.selector || '', observation: finding.actual, verdict, reason, createdAt: new Date().toISOString() };
  const scope = JSON.stringify([value.origin, value.path, value.rule, value.selector, value.observation]);
  const existing = db.prepare('SELECT document FROM memory WHERE scope = ?').get(scope) as { document: string } | undefined;
  if (existing) value.id = JSON.parse(existing.document).id;
  db.prepare('INSERT INTO memory VALUES (?, ?, ?) ON CONFLICT(scope) DO UPDATE SET document=excluded.document').run(value.id, scope, JSON.stringify(value));
  return value;
}
export function applyMemory(findings: Diagnostic[]): Diagnostic[] {
  const memory = listMemory();
  return findings.map(finding => {
    const url = new URL(finding.url);
    const match = memory.find(item => item.origin === url.origin && item.path === url.pathname && item.rule === finding.rule && item.selector === (finding.selector || '') && item.observation === finding.actual);
    return match ? { ...finding, feedback: { verdict: match.verdict, reason: match.reason, memoryId: match.id } } : finding;
  });
}
export function screenshot(job: WorkbenchJob, image: Buffer): string {
  const directory = `${artifactDir}/workbench-${job.id}`;
  mkdirSync(directory, { recursive: true });
  const filename = `${randomUUID()}.png`;
  writeFileSync(`${directory}/${filename}`, image, { mode: 0o600 });
  return `/artifacts/workbench-${job.id}/${filename}`;
}
export function recoverJobs() {
  for (const row of db.prepare('SELECT document FROM jobs').all() as { document: string }[]) {
    const job: WorkbenchJob = JSON.parse(row.document);
    if (job.status !== 'running') continue;
    job.status = 'failed'; job.finishedAt = new Date().toISOString();
    job.error = 'Probe restarted during this operation. Review source changes if a build was applying; rerun to verify.';
    saveJob(job);
  }
}
