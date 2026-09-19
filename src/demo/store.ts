import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export type Variant = 'broken' | 'corrected';
export type Role = 'owner' | 'editor' | 'viewer';
export interface Activity {
  id: string;
  timestamp: string;
  actor: Role;
  action: string;
}
export interface EnvironmentState {
  id: string;
  variant: Variant;
  documentId: string;
  fixtureMarker: string;
  grants: { owner: 'owner'; editor?: 'editor'; viewer?: 'viewer' };
  revision: number;
  activity: Activity[];
  content: string;
}
export interface SessionCookie { name: string; value: string; path: string }

export const people = {
  owner: { name: 'Mara Vale', email: 'owner@fieldnotes.test', initials: 'MV' },
  editor: { name: 'Ellis Park', email: 'editor@fieldnotes.test', initials: 'EP' },
  viewer: { name: 'Noor Bell', email: 'viewer@fieldnotes.test', initials: 'NB' },
} as const;
export const sessionCookieName = 'fieldnotes_session';
export const databasePath = process.env.CZ_DATA_DIR ? resolve(process.env.CZ_DATA_DIR, 'demo.sqlite') : fileURLToPath(new URL('../../.data/demo.sqlite', import.meta.url));

interface EnvironmentRow {
  id: string;
  variant: Variant;
  document_id: string;
  fixture_marker: string;
  content: string;
  revision: number;
  editor_granted: number;
  viewer_granted: number;
}

let database: DatabaseSync | undefined;
function db(): DatabaseSync {
  if (database) return database;
  mkdirSync(dirname(databasePath), { recursive: true });
  const connection = new DatabaseSync(databasePath);
  connection.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS demo_environments (
      id TEXT PRIMARY KEY,
      variant TEXT NOT NULL CHECK (variant IN ('broken', 'corrected')),
      document_id TEXT NOT NULL UNIQUE,
      fixture_marker TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      editor_granted INTEGER NOT NULL DEFAULT 0 CHECK (editor_granted IN (0, 1)),
      viewer_granted INTEGER NOT NULL DEFAULT 1 CHECK (viewer_granted IN (0, 1))
    );
    CREATE TABLE IF NOT EXISTS demo_sessions (
      token_hash TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL REFERENCES demo_environments(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS demo_sessions_environment ON demo_sessions(environment_id);
    CREATE TABLE IF NOT EXISTS demo_activity (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      environment_id TEXT NOT NULL REFERENCES demo_environments(id) ON DELETE CASCADE,
      timestamp TEXT NOT NULL,
      actor TEXT NOT NULL CHECK (actor IN ('owner', 'editor', 'viewer')),
      action TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS demo_activity_environment ON demo_activity(environment_id, sequence);
  `);
  database = connection;
  return connection;
}

function transaction<T>(operation: () => T): T {
  const connection = db();
  connection.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    connection.exec('COMMIT');
    return result;
  } catch (error) {
    connection.exec('ROLLBACK');
    throw error;
  }
}

function validateVariant(variant: Variant): void {
  if (variant !== 'broken' && variant !== 'corrected') throw new Error('Unknown environment variant');
}

function seedContent(marker: string): string {
  return `A quieter kind of launch

THE IDEA
Give small teams a shared place for the thinking behind their work. Our launch should feel like a useful note from a colleague: clear, considered, and worth keeping.

WHAT WE ARE MAKING
A focused workspace for project briefs, working notes, and decisions. Start with one good document. Invite the people who need to be in the room.

FIRST CHAPTER
Mara will shape the story and approve the launch brief. Ellis will refine the product notes. Noor will read through the final draft and collect feedback.

BEFORE WE SHARE
Keep the working brief within this team. Confirm document access before circulating a copy, and keep the final language direct and human.

PRIVATE WORKSPACE REFERENCE
${marker}`;
}

function addActivity(id: string, actor: Role, action: string): void {
  db().prepare('INSERT INTO demo_activity (id, environment_id, timestamp, actor, action) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), id, new Date().toISOString(), actor, action);
}

export function environmentExists(id: string): boolean {
  return Boolean(db().prepare('SELECT 1 FROM demo_environments WHERE id = ?').get(id));
}

export function documentRevision(id: string): number {
  const row = db().prepare('SELECT revision FROM demo_environments WHERE id = ?').get(id);
  return row ? Number(row.revision) : 0;
}

export function getEnvironmentState(id: string): EnvironmentState {
  const row = db().prepare('SELECT * FROM demo_environments WHERE id = ?').get(id) as unknown as EnvironmentRow | undefined;
  if (!row) throw new Error('Environment not found');
  const activity = db().prepare('SELECT id, timestamp, actor, action FROM demo_activity WHERE environment_id = ? ORDER BY sequence')
    .all(id) as unknown as Activity[];
  return {
    id: row.id,
    variant: row.variant,
    documentId: row.document_id,
    fixtureMarker: row.fixture_marker,
    grants: {
      owner: 'owner',
      ...(row.editor_granted ? { editor: 'editor' as const } : {}),
      ...(row.viewer_granted ? { viewer: 'viewer' as const } : {}),
    },
    revision: row.revision,
    activity,
    content: row.content,
  };
}

export function createEnvironment(variant: Variant): { id: string; documentId: string; fixtureMarker: string } {
  validateVariant(variant);
  const id = randomUUID();
  const documentId = randomUUID();
  const fixtureMarker = `FIELDNOTES_PRIVATE_${randomBytes(24).toString('hex')}`;
  transaction(() => {
    db().prepare('INSERT INTO demo_environments (id, variant, document_id, fixture_marker, content, revision) VALUES (?, ?, ?, ?, ?, 1)')
      .run(id, variant, documentId, fixtureMarker, seedContent(fixtureMarker));
    addActivity(id, 'owner', 'document.created');
  });
  return { id, documentId, fixtureMarker };
}

export function resetEnvironment(id: string, variant?: Variant): { id: string; documentId: string; fixtureMarker: string } {
  if (variant !== undefined) validateVariant(variant);
  return transaction(() => {
    const current = getEnvironmentState(id);
    const documentId = randomUUID();
    const fixtureMarker = `FIELDNOTES_PRIVATE_${randomBytes(24).toString('hex')}`;
    db().prepare('DELETE FROM demo_sessions WHERE environment_id = ?').run(id);
    db().prepare('DELETE FROM demo_activity WHERE environment_id = ?').run(id);
    db().prepare(`UPDATE demo_environments SET variant = ?, document_id = ?, fixture_marker = ?, content = ?,
      revision = 1, editor_granted = 0, viewer_granted = 1 WHERE id = ?`)
      .run(variant ?? current.variant, documentId, fixtureMarker, seedContent(fixtureMarker), id);
    addActivity(id, 'owner', 'document.created');
    return { id, documentId, fixtureMarker };
  });
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function issueSession(environmentId: string, role: Role): SessionCookie {
  if (!environmentExists(environmentId)) throw new Error('Environment not found');
  if (role !== 'owner' && role !== 'editor' && role !== 'viewer') throw new Error('Unknown session role');
  const value = randomBytes(32).toString('base64url');
  db().prepare('INSERT INTO demo_sessions (token_hash, environment_id, role, created_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(value), environmentId, role, new Date().toISOString());
  return { name: sessionCookieName, value, path: `/w/${environmentId}` };
}

export function resolveSession(environmentId: string, cookieHeader?: string): Role | undefined {
  if (!cookieHeader) return undefined;
  // Reject ambiguous duplicate cookies rather than selecting an attacker-controlled identity.
  const matches = cookieHeader.split(';').map(part => part.trim()).filter(part => part.startsWith(`${sessionCookieName}=`));
  if (matches.length !== 1) return undefined;
  const token = matches[0].slice(sessionCookieName.length + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  const row = db().prepare('SELECT role FROM demo_sessions WHERE token_hash = ? AND environment_id = ?')
    .get(hashToken(token), environmentId);
  return row?.role as Role | undefined;
}

export function canRead(state: EnvironmentState, role: Role): boolean {
  return state.grants[role] === role;
}

export class DocumentError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function setEditorGrant(id: string, actor: Role, granted: boolean): EnvironmentState {
  return transaction(() => {
    if (actor !== 'owner') throw new DocumentError(403, 'Only the owner can manage document sharing.');
    const current = getEnvironmentState(id);
    if (Boolean(current.grants.editor) !== granted) {
      db().prepare('UPDATE demo_environments SET editor_granted = ?, revision = revision + 1 WHERE id = ?').run(granted ? 1 : 0, id);
      addActivity(id, actor, granted ? 'editor.granted' : 'editor.revoked');
    }
    return getEnvironmentState(id);
  });
}

export function saveDocument(id: string, role: Role, content: string, revision: number): EnvironmentState {
  return transaction(() => {
    const state = getEnvironmentState(id);
    if (!canRead(state, role) || role === 'viewer') throw new DocumentError(403, 'You do not have permission to edit this document.');
    if (state.revision !== revision) throw new DocumentError(409, 'This document changed since you opened it. Reload before saving your changes.');
    db().prepare('UPDATE demo_environments SET content = ?, revision = revision + 1 WHERE id = ?').run(content, id);
    addActivity(id, role, 'document.saved');
    return getEnvironmentState(id);
  });
}

export function exportDocument(id: string, role: Role): { state: EnvironmentState; body: string } {
  return transaction(() => {
    const state = getEnvironmentState(id);
    // Deliberate, isolated demo fault: the legacy exporter trusts editor identity instead of the current grant.
    const allowed = state.variant === 'broken' && role === 'editor' ? true : canRead(state, role);
    if (!allowed) throw new DocumentError(403, 'You no longer have access to export this document.');
    addActivity(id, role, 'document.exported');
    return {
      state,
      body: `Fieldnotes / Launch brief\nDocument: ${state.documentId}\nRevision: ${state.revision}\n\n${state.content}\n\nPrivate document reference: ${state.fixtureMarker}\n`,
    };
  });
}
