import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { setTimeout as delay } from 'node:timers/promises';
import { loadPrivate } from './identity.js';

interface Mailbox { email: string; appPassword: string; }
function configuration(): Mailbox | undefined { try { return loadPrivate('mailbox') as Mailbox; } catch { return; } }
function connection(config: Mailbox) {
  if (!/^[a-z0-9.+_-]+@gmail\.com$/i.test(config.email)) throw new Error('Only the configured Gmail test mailbox is supported.');
  return new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: config.email, pass: config.appPassword }, logger: false, connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 15000 });
}
export function mailboxStatus() { const config = configuration(); return { configured: Boolean(config), address: config?.email, aliases: Boolean(config) }; }
export async function verifyMailboxConnection() {
  const config = configuration(); if (!config) return { configured: false, connected: false };
  const client = connection(config);
  try { await client.connect(); await client.status('INBOX', { messages: true }); return { configured: true, connected: true, address: config.email }; }
  catch { return { configured: true, connected: false, reason: 'Gmail IMAP authentication or connection failed. Check the app password and mailbox access.' }; }
  finally { await client.logout().catch(() => {}); }
}
export function allowedVerificationLink(raw: string, authOrigin: string): string | undefined {
  try {
    const url = new URL(raw.replaceAll('&amp;', '&'));
    if (url.origin !== authOrigin || url.pathname !== '/auth/v1/verify' || url.username || url.password) return;
    const redirect = url.searchParams.get('redirect_to');
    if (redirect && new URL(redirect).origin !== 'http://localhost:3000') return;
    if (!['signup', 'email'].includes(url.searchParams.get('type') || '')) return;
    return url.href;
  } catch { return; }
}
/** Reads only recent confirmation messages addressed to this run's exact synthetic plus-alias. */
export async function waitForConfirmation(alias: string, since: Date, authOrigin: string, signal: AbortSignal): Promise<string | undefined> {
  const config = configuration(); if (!config) return;
  const prefix = config.email.split('@')[0].split('+')[0];
  if (!new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\+probe-[a-f0-9]+@gmail\\.com$`, 'i').test(alias)) throw new Error('Mailbox reads are limited to generated Probe aliases.');
  const client = connection(config); const deadline = Date.now() + 60000; const inspected = new Set<number>();
  try {
    await client.connect(); const lock = await client.getMailboxLock('INBOX');
    try {
      while (Date.now() < deadline && !signal.aborted) {
        const ids = await client.search({ to: alias, since }, { uid: true });
        for (const uid of (ids || []).slice(-6).reverse()) {
          if (inspected.has(uid)) continue; inspected.add(uid);
          const message = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true }, { uid: true });
          if (!message || !message.source || (message.internalDate && new Date(message.internalDate).getTime() < since.getTime())) continue;
          const mail = await simpleParser(message.source);
          const recipients = (Array.isArray(mail.to) ? mail.to : mail.to ? [mail.to] : []).flatMap(address => address.value).map(address => address.address?.toLowerCase());
          if (!recipients.includes(alias.toLowerCase())) continue;
          const links = `${mail.text || ''}\n${mail.html || ''}`.match(/https:\/\/[^\s<>"']+/g) || [];
          for (const raw of links) { const link = allowedVerificationLink(raw, authOrigin); if (link) return link; }
        }
        await delay(4000, undefined, { signal });
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
}
