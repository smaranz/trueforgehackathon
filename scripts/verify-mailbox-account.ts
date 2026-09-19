import { chromium } from '@playwright/test';
import { verifyMailboxConnection } from '../src/server/audit/mailbox.js';

const mode = process.argv[2];
try {
  if (mode === 'mailbox') {
    const result = await verifyMailboxConnection();
    console.log(JSON.stringify({ check: 'mailbox', verifiedAt: new Date().toISOString(), ...result }));
    if (!result.connected) process.exitCode = 1;
  } else if (mode === 'isolation') {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      try {
        const response = await context.request.get('http://localhost:3000/api/profile', {
          timeout: 15000,
          maxRedirects: 0,
        });
        const status = response.status();
        console.log(JSON.stringify({ check: 'fresh-independent-context', verifiedAt: new Date().toISOString(), profileStatus: status, expectedStatus: 401, passed: status === 401, cookiesCopied: false }));
        if (status !== 401) process.exitCode = 1;
      } finally { await context.close(); }
    } finally { await browser.close(); }
  } else {
    console.log(JSON.stringify({ error: 'Choose mailbox or isolation.' }));
    process.exitCode = 1;
  }
} catch {
  console.log(JSON.stringify({ check: mode, passed: false, error: 'Verification could not complete; no raw diagnostic data emitted.' }));
  process.exitCode = 1;
}
