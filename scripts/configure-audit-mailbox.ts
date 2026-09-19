import { readFileSync } from 'node:fs';
import { savePrivate } from '../src/server/audit/identity.js';
import { verifyMailboxConnection } from '../src/server/audit/mailbox.js';
const path = process.env.PROBE_MAILBOX_SECRET_FILE;
if (!path) throw new Error('Provide PROBE_MAILBOX_SECRET_FILE pointing to a private JSON with email and appPassword.');
const config = JSON.parse(readFileSync(path, 'utf8'));
if (!/^[a-z0-9.+_-]+@gmail\.com$/i.test(config.email) || typeof config.appPassword !== 'string') throw new Error('Invalid Gmail configuration');
savePrivate('mailbox', { email: config.email, appPassword: config.appPassword.replace(/\s/g, '') });
console.log(JSON.stringify(await verifyMailboxConnection(), null, 2));
