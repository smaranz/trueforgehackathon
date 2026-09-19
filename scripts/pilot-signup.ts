import { chromium } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createIdentity, saveIdentity } from '../src/server/audit/identity.js';

const id = `pilot-${randomUUID()}`;
const identity = createIdentity(id, 'Signup Pilot');
const browser = await chromium.launch({ headless: true });
const denied = new Set<string>();
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://localhost:3000' && !/^\/(?:api\/)?(?:admin|cron|voice)/.test(url.pathname)) return route.continue();
    denied.add(url.origin); return route.abort();
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3000/signup');
  const before = await context.request.get('http://localhost:3000/api/profile');
  if (before.status() !== 401) throw new Error(`Fresh auth precondition returned HTTP ${before.status()}, expected401.`);
  await page.getByPlaceholder('Your name', { exact: true }).fill(identity.name);
  await page.getByPlaceholder('you@example.com', { exact: true }).fill(identity.email);
  await page.getByPlaceholder('At least 8 characters', { exact: true }).fill(identity.password);
  identity.signupAttempted = true; saveIdentity(id, identity);
  const [response] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/auth/signup'), { timeout: 30000 }), page.getByRole('button', { name: 'Create account', exact: true }).click()]);
  const body = await response.json();
  if (body.user?.id) { identity.userId = body.user.id; saveIdentity(id, identity); }
  const after = await context.request.get('http://localhost:3000/api/profile');
  const profile = after.status() === 200 ? await after.json() : null;
  if (after.status() === 200) await page.waitForURL('**/onboarding', { timeout: 15000 });
  const result = { id, email: identity.email, signupStatus: response.status(), localOnly: Boolean(body.localOnly), needsEmailConfirmation: Boolean(body.needsEmailConfirmation), error: body.error || null, userIdPresent: Boolean(body.user?.id), profileStatus: after.status(), authenticated: after.status() === 200 && profile && Object.hasOwn(profile, 'profile'), pageUrl: page.url(), deniedOrigins: [...denied] };
  mkdirSync('.data/acceptance', { recursive: true });
  writeFileSync('.data/acceptance/real-signup-pilot.json', JSON.stringify(result, null, 2));
  await page.screenshot({ path: '.data/acceptance/real-signup-pilot.png', fullPage: true, mask: [page.locator('input[type="password"]')] });
  console.log(JSON.stringify(result, null, 2));
  if (!result.authenticated) process.exitCode = 1;
} finally { await browser.close(); }
