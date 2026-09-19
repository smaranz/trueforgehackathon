import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { artifactDir, dataDir } from './config.js';
import type { ActionEvent, EvidenceArtifact, Role, Run } from '../shared/types.js';

mkdirSync(artifactDir, { recursive: true });
const db = new DatabaseSync(`${dataDir}/customer-zero.sqlite`);
db.exec(`PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, document TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, timestamp TEXT NOT NULL, document TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS events_run ON events(run_id, timestamp);
  CREATE TABLE IF NOT EXISTS actor_capabilities (hash TEXT PRIMARY KEY, run_id TEXT NOT NULL, role TEXT NOT NULL, retired_at TEXT);
  CREATE TABLE IF NOT EXISTS archived_connectors (name TEXT PRIMARY KEY, repaired_at TEXT NOT NULL);`);
export const updates = new EventEmitter();
updates.setMaxListeners(100);
const cache = new Map<string, Run>();

const hashCapability = (token: string) => createHash('sha256').update(token).digest('hex');
export function rememberCapability(token: string, runId: string, role: Role, retired = false): void {
  db.prepare('INSERT OR REPLACE INTO actor_capabilities VALUES (?, ?, ?, ?)').run(hashCapability(token), runId, role, retired ? new Date().toISOString() : null);
}
export function retireCapability(token: string): void {
  db.prepare('UPDATE actor_capabilities SET retired_at = ? WHERE hash = ?').run(new Date().toISOString(), hashCapability(token));
}
export function knownCapability(token: string): { runId: string; role: Role; retiredAt: string | null } | undefined {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  return db.prepare('SELECT run_id AS runId, role, retired_at AS retiredAt FROM actor_capabilities WHERE hash = ?').get(hashCapability(token)) as { runId: string; role: Role; retiredAt: string | null } | undefined;
}
export function connectorArchived(name: string): boolean { return Boolean(db.prepare('SELECT 1 FROM archived_connectors WHERE name = ?').get(name)); }
export function markConnectorArchived(name: string): void { db.prepare('INSERT OR REPLACE INTO archived_connectors VALUES (?, ?)').run(name, new Date().toISOString()); }

export function listRuns(): Run[] {
  return (db.prepare('SELECT document FROM runs ORDER BY started_at DESC LIMIT 100').all() as { document: string }[])
    .map(row => JSON.parse(row.document) as Run);
}
export function getRun(id: string): Run | undefined {
  if (cache.has(id)) return cache.get(id);
  const row = db.prepare('SELECT document FROM runs WHERE id = ?').get(id) as { document: string } | undefined;
  if (!row) return;
  const run = JSON.parse(row.document) as Run;
  cache.set(id, run);
  return run;
}
export function saveRun(run: Run): void {
  cache.set(run.id, run);
  db.prepare('INSERT INTO runs VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document')
    .run(run.id, run.startedAt, JSON.stringify(run));
  updates.emit(run.id, run);
}
export function event(run: Run, type: string, message: string, options: Partial<Pick<ActionEvent, 'actor' | 'actorId' | 'sessionId' | 'details' | 'artifactIds'>> = {}): ActionEvent {
  const entry: ActionEvent = {
    id: randomUUID(), runId: run.id, timestamp: new Date().toISOString(), phase: run.phase,
    type, message, artifactIds: [], ...options,
  };
  if (entry.actor && !entry.sessionId) entry.sessionId = run.actors.find(actor => actor.role === entry.actor)?.sessionId;
  run.events.push(entry);
  run.eventCount = (run.eventCount ?? run.events.length - 1) + 1;
  if (run.scenario === 'full-audit' && run.events.length > 1000) run.events.splice(0, run.events.length - 1000);
  db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)').run(entry.id, run.id, entry.timestamp, JSON.stringify(entry));
  saveRun(run);
  return entry;
}
export function artifact(run: Run, kind: EvidenceArtifact['kind'], label: string, contents: string | Buffer, extension: string, actor?: Role, actorId?: string): EvidenceArtifact {
  const id = randomUUID();
  mkdirSync(`${artifactDir}/${run.id}`, { recursive: true });
  const filename = `${id}.${extension}`;
  writeFileSync(`${artifactDir}/${run.id}/${filename}`, contents);
  const entry: EvidenceArtifact = { id, runId: run.id, kind, label, timestamp: new Date().toISOString(), actor, actorId, url: `/artifacts/${run.id}/${filename}` };
  run.artifacts.push(entry);
  saveRun(run);
  return entry;
}

/** Browser contexts cannot survive process restart. Never pretend to resume them. */
export function recoverInterruptedRuns(): string[] {
  const sessions: string[] = [];
  for (const run of listRuns()) {
    if (['queued', 'running', 'reproducing'].includes(run.status)) {
      sessions.push(...run.actors.flatMap(actor => actor.sessionId ? [actor.sessionId] : []));
      if (run.audit) {
        sessions.push(...run.audit.agents.flatMap(agent => agent.sessionId ? [agent.sessionId] : []));
        for (const agent of run.audit.agents) if (['queued', 'running', 'signing-up', 'reviewing'].includes(agent.status)) { agent.status = 'blocked'; agent.error = 'Coordinator restarted; browser context was lost.'; }
        run.audit.reproductions.forEach(item => { if (['queued', 'running'].includes(item.status)) item.status = 'inconclusive'; });
      }
      run.status = 'inconclusive';
      run.error = 'The coordinator restarted. Evidence was retained; browser sessions were lost. Start a new run.';
      run.finishedAt = new Date().toISOString();
      run.actors.forEach(actor => { actor.status = 'stopped'; });
      run.findings.forEach(finding => { if (['Suspected', 'Reproducing'].includes(finding.status)) finding.status = 'Inconclusive'; });
      event(run, 'recovery', run.error);
    }
  }
  return sessions;
}
