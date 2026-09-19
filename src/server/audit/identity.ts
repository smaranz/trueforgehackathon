import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dataDir } from '../config.js';

export interface AuditIdentity { name: string; email: string; password: string; marker: string; signupAttempted: boolean; userId?: string; }
const directory = `${dataDir}/audit-vault`;
mkdirSync(directory, { recursive: true, mode: 0o700 });
const keyPath = `${directory}/key`;
if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
const key = readFileSync(keyPath);
const filename = (id: string) => {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error('Invalid synthetic account identifier');
  return `${directory}/${id}.json`;
};
export function saveIdentity(id: string, identity: AuditIdentity): void {
  savePrivate(id, identity);
}
export function savePrivate(id: string, value: unknown): void {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  writeFileSync(filename(id), JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), content: bytes.toString('base64') }), { mode: 0o600 });
}
export function loadIdentity(id: string): AuditIdentity {
  return loadPrivate(id) as AuditIdentity;
}
export function loadPrivate(id: string): unknown {
  const stored = JSON.parse(readFileSync(filename(id), 'utf8'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(stored.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(stored.content, 'base64')), decipher.final()]).toString('utf8'));
}
export function createIdentity(id: string, name: string): AuditIdentity {
  if (existsSync(filename(id))) return loadIdentity(id);
  const suffix = randomBytes(8).toString('hex');
  let mailbox: string | undefined;
  if (existsSync(filename('mailbox'))) mailbox = (loadPrivate('mailbox') as { email: string }).email;
  const local = mailbox?.split('@')[0].split('+')[0];
  const identity: AuditIdentity = { name: `Probe ${name}`, email: mailbox ? `${local}+probe-${suffix}@${mailbox.split('@')[1]}` : `probe.${suffix}@example.com`, password: `Pr!${randomBytes(24).toString('base64url')}9a`, marker: `PROBE-${suffix}`, signupAttempted: false };
  saveIdentity(id, identity); return identity;
}
