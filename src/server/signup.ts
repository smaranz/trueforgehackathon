import { chromium, expect, type Browser } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { artifact, event, getRun, saveRun } from './store.js';
import { hasActiveRuns } from './coordinator.js';
import { safeError } from './browser.js';
import type { Run, SurfaceCheck } from '../shared/types.js';

export const signupTarget = 'http://localhost:3000/signup';
const active = new Map<string, { controller: AbortController; done?: Promise<Run>; browser?: Browser }>();
export const hasActiveSignup = () => active.size > 0;

export function allowedSignupRequest(raw: string, method: string): boolean {
  try {
    const url = new URL(raw);
    if (url.origin !== 'http://localhost:3000' || url.username || url.password || !['GET', 'HEAD'].includes(method)) return false;
    return url.pathname === '/signup' || url.pathname.startsWith('/_next/static/') || ['/favicon.ico', '/favicon.svg'].includes(url.pathname);
  } catch { return false; }
}

/** Explicitly authorized target, deterministic surface checks; no account creation or login. */
export function inspectSignup(targetUrl: string, upstreamSignal?: AbortSignal): Promise<Run> {
  if (targetUrl !== signupTarget) throw new Error(`Only the explicitly authorized target ${signupTarget} is supported by this tool.`);
  if (hasActiveRuns() || hasActiveSignup()) throw new Error('A Probe run is active. Wait for it to finish or cancel it.');
  const id = randomUUID();
  const run: Run = { id, name: 'Publick signup · surface check', targetUrl, goal: 'Inspect signup rendering, native form constraints, password visibility and responsive layout without creating an account.',
    scenario: 'signup-surface', mode: 'deterministic', status: 'running', phase: 'preconditions', startedAt: new Date().toISOString(), cost: null,
    actors: [{ id: `${id}-visitor`, role: 'viewer', name: 'Fresh browser visitor', email: 'Unauthenticated · no credentials', status: 'working', sessionId: `browser-${randomUUID()}` }],
    events: [], artifacts: [], findings: [], verifications: [], checks: [], limitations: ['Deterministic browser checks in a fresh unauthenticated context; not a multi-account investigation.', 'Account creation, Google OAuth, email verification and backend authentication were not tested.', 'Requests outside the approved signup page/static assets and all network writes are blocked.'] };
  saveRun(run);
  const execution = { controller: new AbortController(), browser: undefined as Browser | undefined, done: undefined as Promise<Run> | undefined };
  active.set(id, execution);
  const abort = () => execution.controller.abort(new Error('Probe signup check cancelled'));
  upstreamSignal?.addEventListener('abort', abort, { once: true });
  if (upstreamSignal?.aborted) abort();
  execution.done = (async () => {
    const signal = execution.controller.signal;
    const timer = setTimeout(() => execution.controller.abort(new Error('Signup inspection deadline exceeded')), 45000);
    const close = () => { void execution.browser?.close(); };
    signal.addEventListener('abort', close, { once: true });
    const network: { method: string; url: string; status?: number; blocked?: boolean }[] = [];
    const errors: string[] = [];
    const check = (name: string, passed: boolean, observed: string) => {
      signal.throwIfAborted();
      const item: SurfaceCheck = { name, status: passed ? 'passed' : 'failed', observed };
      run.checks!.push(item);
      event(run, 'surface.assertion', `${name}: ${item.status}`, { actor: 'viewer', details: item });
    };
    try {
      signal.throwIfAborted();
      event(run, 'run.started', 'Fresh unauthenticated signup surface check. All network writes are blocked; no account will be created.');
      execution.browser = await chromium.launch({ headless: true });
      signal.throwIfAborted();
      const context = await execution.browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: false });
      await context.route('**/*', route => {
        const request = route.request();
        if (allowedSignupRequest(request.url(), request.method())) return route.continue();
        const url = new URL(request.url());
        network.push({ method: request.method(), url: `${url.origin}${url.pathname}`, blocked: true });
        return route.abort('blockedbyclient');
      });
      await context.routeWebSocket('**/*', socket => socket.close());
      const page = await context.newPage();
      page.setDefaultTimeout(7000);
      context.on('page', extra => { if (extra !== page) void extra.close(); });
      page.on('pageerror', error => errors.push(safeError(error)));
      page.on('response', response => {
        const url = new URL(response.url());
        network.push({ method: response.request().method(), url: `${url.origin}${url.pathname}`, status: response.status() });
      });
      const response = await page.goto(signupTarget, { waitUntil: 'domcontentloaded', timeout: 15000 });
      check('Signup route loads', response?.status() === 200, `HTTP ${response?.status() ?? 'no response'}`);
      await page.getByRole('heading', { name: /Create your .* account/i }).waitFor();
      await page.getByRole('button', { name: 'Create account', exact: true }).waitFor();
      run.phase = 'check';
      const name = page.getByRole('textbox', { name: 'Name', exact: true });
      const email = page.getByRole('textbox', { name: 'Email', exact: true });
      const password = page.locator('input[type="password"]');
      check('Named signup fields are visible', await name.isVisible() && await email.isVisible() && await password.isVisible(), 'Name, Email and Password controls have visible labels.');
      const constraints = await page.locator('input').evaluateAll(elements => elements.map(element => {
        const input = element as HTMLInputElement;
        return { type: input.type, name: input.name, required: input.required, minLength: input.minLength, missing: input.validity.valueMissing };
      }));
      const required = constraints.filter(input => ['text', 'email', 'password'].includes(input.type));
      check('Blank required fields are rejected', required.length >= 3 && required.every(input => input.required && input.missing), JSON.stringify(required));
      await email.fill('not-an-email');
      check('Malformed email is rejected', await email.evaluate((input: HTMLInputElement) => input.validity.typeMismatch), 'Native email validation checked with a synthetic invalid address; no submission.');
      await email.fill('');
      const passwordLocator = page.locator('input').filter({ visible: true }).last();
      await password.fill('short');
      check('Password requires at least eight characters', await password.evaluate((input: HTMLInputElement) => input.minLength >= 8 && input.validity.tooShort), 'Native minlength constraint checked with five synthetic characters; no submission.');
      const toggle = page.getByRole('button', { name: 'Show password', exact: true });
      await toggle.click();
      await expect(page.getByRole('button', { name: 'Hide password', exact: true })).toBeVisible();
      check('Password visibility toggle works', await passwordLocator.getAttribute('type') === 'text', 'Show password changed the input type and exposed a Hide password control.');
      await page.getByRole('button', { name: 'Hide password', exact: true }).click();
      await page.locator('input[type="password"]').fill('');
      check('Sign-in link is present', await page.getByRole('link', { name: 'Sign in', exact: true }).getAttribute('href') === '/signin', 'Link points to /signin; sign-in itself was not tested.');
      check('Desktop fits the viewport', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '1440 × 1000 viewport; checked document scroll width.');
      const desktop = artifact(run, 'screenshot', 'Signup · desktop 1440 × 1000', await page.screenshot({ animations: 'disabled', fullPage: true }), 'png', 'viewer');
      run.actors[0].screenshotId = desktop.id;
      event(run, 'browser.screenshot', 'Desktop signup page captured', { actor: 'viewer', artifactIds: [desktop.id] });
      await page.setViewportSize({ width: 390, height: 844 });
      check('Mobile fits the viewport', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390 × 844 viewport; checked document scroll width.');
      const mobile = artifact(run, 'screenshot', 'Signup · mobile 390 × 844', await page.screenshot({ animations: 'disabled', fullPage: true }), 'png', 'viewer');
      event(run, 'browser.screenshot', 'Mobile signup page captured', { actor: 'viewer', artifactIds: [mobile.id] });
      check('No uncaught page exceptions', errors.length === 0, errors.length ? errors.join('\n') : 'No pageerror events during the check.');
      const evidence = artifact(run, 'assertion', 'Signup surface results and request boundaries', JSON.stringify({ checks: run.checks, network, errors, limitations: run.limitations }, null, 2), 'json', 'viewer');
      event(run, 'surface.completed', `${run.checks!.filter(c => c.status === 'passed').length}/${run.checks!.length} surface checks passed. Backend registration was not exercised.`, { actor: 'viewer', artifactIds: [evidence.id] });
      run.status = 'completed'; run.phase = 'complete';
    } catch (error) {
      run.status = signal.aborted ? 'cancelled' : 'inconclusive'; run.error = safeError(error);
      event(run, 'surface.incomplete', run.error, { actor: 'viewer' });
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', close); upstreamSignal?.removeEventListener('abort', abort);
      await execution.browser?.close();
      run.finishedAt = new Date().toISOString(); run.actors[0].status = run.status === 'completed' ? 'complete' : 'stopped';
      saveRun(run); active.delete(id);
    }
    return run;
  })();
  return execution.done;
}

export async function cancelSignup(id: string): Promise<Run | undefined> {
  const execution = active.get(id);
  if (execution) { execution.controller.abort(new Error('Cancelled by operator')); await execution.done; }
  return getRun(id);
}
export async function shutdownSignup(): Promise<void> { await Promise.all([...active.keys()].map(cancelSignup)); }
