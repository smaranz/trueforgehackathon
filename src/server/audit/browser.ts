import { chromium, expect, type Browser, type BrowserContext, type Page, type Response } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuditAgent, AuditAssertion, Finding, Run } from '../../shared/types.js';
import { artifact, event, saveRun } from '../store.js';
import { safeError } from '../browser.js';
import { createIdentity, loadIdentity, saveIdentity, type AuditIdentity } from './identity.js';
import { AUDIT_ORIGIN, isAuditNavigation, requestPolicy, safeActionLabel } from './policy.js';
import { allowedVerificationLink, waitForConfirmation } from './mailbox.js';

export const auditAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('inspect') }).strict(),
  z.object({ action: z.literal('navigate'), path: z.string().max(500) }).strict(),
  z.object({ action: z.literal('click'), ref: z.string().max(50) }).strict(),
  z.object({ action: z.literal('fill'), ref: z.string().max(50), value: z.string().max(6000) }).strict(),
  z.object({ action: z.literal('select'), ref: z.string().max(50), value: z.string().max(300) }).strict(),
  z.object({ action: z.literal('key'), key: z.enum(['Tab', 'Shift+Tab', 'Enter', 'Space', 'Escape', 'ArrowDown', 'ArrowUp']) }).strict(),
  z.object({ action: z.literal('reload') }).strict(),
  z.object({ action: z.literal('back') }).strict(),
  z.object({ action: z.literal('screenshot') }).strict(),
  z.object({ action: z.literal('signup') }).strict(),
  z.object({ action: z.literal('signin') }).strict(),
  z.object({ action: z.literal('accessibility') }).strict(),
  z.object({ action: z.literal('unauthenticated_check'), path: z.enum(['/api/profile', '/api/college-list', '/api/essays/documents', '/api/counselor/documents', '/api/counselor/applications', '/api/counselor/tasks']) }).strict(),
  z.object({ action: z.literal('evidence'), evidenceId: z.string().uuid() }).strict(),
]);
export const assertionSchema = z.object({ kind: z.enum(['http_error', 'visible_text', 'layout_overflow', 'uncaught_exception', 'unauthorized_read', 'observation']), url: z.string().max(500), text: z.string().max(1000).optional(), status: z.number().int().optional() });
export const reportSchema = z.object({ title: z.string().min(5).max(180), category: z.enum(['functional', 'security', 'usability', 'accessibility']), expected: z.string().min(5).max(1500), source: z.string().min(3).max(500), observed: z.string().min(5).max(2500), steps: z.array(z.string().max(500)).min(1).max(12), evidenceIds: z.array(z.string().uuid()).min(1).max(12), severity: z.enum(['High', 'Medium', 'Low']), rationale: z.string().max(1000), assertion: assertionSchema }).strict();
export interface AuditEvidence { id: string; type: string; url: string; status?: number; text?: string; overflow?: boolean; unauthenticated?: boolean; denied?: boolean; fromServiceWorker?: boolean; }
export function sanitizeAuditText(text: string): string {
  return text.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[token redacted]')
    .replace(/(?:sk|sb_secret|sb_publishable)[_-][A-Za-z0-9_-]{12,}/g, '[key redacted]')
    .replace(/((?:[?&#]|%3[fF]|%26)(?:access_token|refresh_token|token_hash|token|code|api_key|apikey|key|password)(?:=|%3[dD]))[^\s&#"<>]*/gi, '$1[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]');
}
const bindings = new Map<string, AuditBrowser>();
export const resolveAuditBrowser = (token: string) => bindings.get(token);
export function isProductInteraction(action: string, rawUrl: string, authenticated: boolean): boolean {
  if (!authenticated || !['click', 'fill', 'select', 'key', 'reload', 'accessibility', 'unauthenticated_check'].includes(action)) return false;
  try {
    const url = new URL(rawUrl);
    return isAuditNavigation(url.href) && !['/', '/landing', '/signup', '/signin', '/onboarding', '/onboarding/complete', '/privacy', '/terms'].includes(url.pathname);
  } catch { return false; }
}

export class AuditBrowser {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private identity: AuditIdentity;
  private capability = randomBytes(32).toString('base64url');
  private busy = false;
  private closed = false;
  private closing?: Promise<void>;
  private counter = 0;
  private metered = 0;
  private writes = 0;
  private refRevision = 0;
  private verificationLink?: string;
  private refs = new Map<string, { selector: string; text: string; type: string }>();
  private inflight = new Set<Promise<void>>();
  private ownedIds = new Set<string>();
  readonly evidence = new Map<string, AuditEvidence>();
  readonly actions: { action: unknown; url: string; timestamp: string }[] = [];
  readonly pages = new Set<string>();
  readonly signal: AbortSignal;
  constructor(readonly run: Run, readonly agent: AuditAgent, signal: AbortSignal, readonly reviewer = false) {
    this.signal = signal;
    this.identity = reviewer ? loadIdentity(`${run.id}-${agent.id}`) : createIdentity(`${run.id}-${agent.id}`, agent.name);
    agent.email = this.identity.email;
  }
  get token() { return this.capability; }
  private check() { if (this.closed || this.signal.aborted) throw new Error('Audit cancelled, expired or closed'); }
  private sanitize(text: string): string {
    return sanitizeAuditText(text.replaceAll(this.identity.password, '[credential redacted]').replaceAll(this.capability, '[capability redacted]'));
  }
  private sanitizeValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (key, item) => /token|password|secret|cookie|authorization|api.?key/i.test(key) ? '[redacted]' : typeof item === 'string' ? this.sanitize(item) : item));
  }
  private emit(type: string, message: string, details?: unknown, ids: string[] = []) {
    const safeDetails = details === undefined ? undefined : this.sanitizeValue(details);
    event(this.run, type, this.sanitize(message), { actor: 'viewer', actorId: this.agent.id, sessionId: this.agent.sessionId, details: safeDetails, artifactIds: ids });
  }
  private save(kind: 'screenshot' | 'network' | 'assertion' | 'log', label: string, data: string | Buffer, extension: string, evidence?: Omit<AuditEvidence, 'id'>) {
    const entry = artifact(this.run, kind, `${this.agent.name} · ${label}`, typeof data === 'string' ? this.sanitize(data) : data, extension, 'viewer', this.agent.id);
    if (evidence) this.evidence.set(entry.id, { id: entry.id, ...evidence, url: this.sanitize(evidence.url), text: evidence.text === undefined ? undefined : this.sanitize(evidence.text) });
    return entry;
  }
  async start(): Promise<void> {
    this.check();
    this.browser = await chromium.launch({ headless: true });
    try {
      if (this.closed || this.signal.aborted) await this.browser.close();
      this.check();
      this.context = await this.browser.newContext({ viewport: this.agent.viewport === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: false });
      await this.context.route('**/*', async route => {
        if (this.closed || this.signal.aborted) { await route.abort(); return; }
        const request = route.request(); const url = new URL(request.url());
        if (this.verificationLink && request.method() === 'GET' && (request.url() === this.verificationLink || (url.origin === AUDIT_ORIGIN && url.pathname === '/auth/callback'))) { await route.continue(); return; }
        const result = requestPolicy(request.url(), request.method(), { authOrigin: process.env.AUDIT_AUTH_ORIGIN || 'https://sytfbpcnkgejtffbdgxo.supabase.co' });
        let reason = result.allowed ? undefined : result.reason;
        if (result.metered && ++this.metered > 6) reason = 'Per-agent target AI request budget reached (6)';
        if (result.allowed && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && ++this.writes > 100) reason = 'Per-agent write budget reached (100)';
        if (request.method() === 'DELETE' && url.pathname !== '/api/onboarding/progress') {
          const id = url.searchParams.get('id');
          if (!id || !this.ownedIds.has(id)) reason = 'Delete restricted to resources this agent created';
        }
        if (reason) {
          this.emit('audit.request.blocked', `${request.method()} ${url.origin}${url.pathname}: ${reason}`);
          await route.abort('blockedbyclient');
        } else await route.continue();
      });
      await this.context.routeWebSocket('**/*', socket => socket.close());
      this.page = await this.context.newPage(); this.page.setDefaultTimeout(6000); this.page.setDefaultNavigationTimeout(15000);
      this.context.on('page', page => { if (page !== this.page) void page.close(); });
      this.page.on('framenavigated', frame => { if (frame === this.page?.mainFrame()) this.refs.clear(); });
      this.page.on('response', response => {
        if (!response.url().startsWith(`${AUDIT_ORIGIN}/api/`)) return;
        const task = this.captureResponse(response).catch(error => { if (!this.closed) this.emit('audit.evidence.error', safeError(error)); });
        this.inflight.add(task); void task.finally(() => this.inflight.delete(task));
      });
      this.page.on('pageerror', error => {
        if (this.closed) return;
        const text = this.sanitize(error.message);
        const item = this.save('log', 'Uncaught browser error', text, 'txt', { type: 'uncaught_exception', url: this.page!.url(), text });
        this.emit('audit.page.error', text, undefined, [item.id]);
      });
      bindings.set(this.capability, this);
      await this.page.goto(`${AUDIT_ORIGIN}/${this.reviewer ? 'signin' : 'signup'}`, { waitUntil: 'domcontentloaded' });
    } catch (error) { await this.close(); throw error; }
  }
  private async captureResponse(response: Response) {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/auth/')) return;
    const method = response.request().method();
    // Streaming chat bodies may be large; capture status and a bounded body for normal JSON responses only.
    const contentType = response.headers()['content-type'] || '';
    let body = '';
    if (contentType.includes('application/json')) {
       const raw = await response.text();
      try {
        const parsed = JSON.parse(raw);
        if (['POST', 'PUT'].includes(method)) {
          const walk = (value: unknown, depth = 0) => { if (!value || typeof value !== 'object' || depth > 4) return; if (Array.isArray(value)) { value.slice(0, 30).forEach(item => walk(item, depth + 1)); return; } for (const [key, val] of Object.entries(value)) { if (key === 'id' && typeof val === 'string') this.ownedIds.add(val); else walk(val, depth + 1); } };
          walk(parsed);
        }
        body = JSON.stringify(parsed, (key, value) => /token|password|secret|cookie|authorization/i.test(key) ? '[redacted]' : value).slice(0, 6000);
      } catch { body = raw.slice(0, 1000); }
    }
    if (this.closed || this.signal.aborted) return;
    const text = this.sanitize(body);
    const record = { method, url: this.sanitize(`${url.origin}${url.pathname}${url.search}`), status: response.status(), timestamp: new Date().toISOString(), body: text };
    const item = this.save('network', `${method} ${url.pathname} → ${response.status()}`, JSON.stringify(record, null, 2), 'json', { type: 'http_response', url: record.url, status: record.status, text });
    this.emit('audit.network', `${method} ${url.pathname} → HTTP ${response.status()}`, { status: record.status, url: record.url }, [item.id]);
  }
  private async auth(kind: 'signup' | 'signin') {
    this.check();
    const page = this.page!;
    const probe = async () => {
      this.check();
      const response = await this.context!.request.get(`${AUDIT_ORIGIN}/api/profile`, { timeout: 5000, maxRedirects: 0 });
      let verified = false;
      if (response.status() === 200) { const body = await response.json(); verified = Boolean(body && typeof body === 'object' && Object.hasOwn(body, 'profile') && !body.localOnly); }
      return { status: response.status(), authenticated: verified };
    };
    const before = await probe();
    if (before.authenticated) {
      if (this.agent.signup !== 'verified' && !this.reviewer) { this.agent.signup = 'verified'; this.run.audit!.accountCount++; }
      const proof = this.save('assertion', 'Existing server authentication check', JSON.stringify(before), 'json', { type: 'authentication', url: `${AUDIT_ORIGIN}/api/profile`, status: before.status });
      return { ...before, alreadySignedIn: true, evidenceId: proof.id, account: this.identity.email, syntheticName: this.identity.name, marker: this.identity.marker };
    }
    if (before.status === 503) { this.agent.signup = 'local-only'; throw new Error('Target authentication backend is unconfigured; real signup cannot be verified.'); }
    if (kind === 'signup' && this.identity.signupAttempted) throw new Error('Signup was already submitted. Inspect authentication or sign in; never repeat uncertain account creation.');
    if (page.url() !== `${AUDIT_ORIGIN}/${kind}`) await page.goto(`${AUDIT_ORIGIN}/${kind}`, { waitUntil: 'domcontentloaded' });
    if (kind === 'signup') await page.getByPlaceholder('Your name', { exact: true }).fill(this.identity.name);
    await page.getByPlaceholder('you@example.com', { exact: true }).fill(this.identity.email);
    await page.getByPlaceholder(kind === 'signup' ? 'At least 8 characters' : 'Your password', { exact: true }).fill(this.identity.password);
    await page.getByPlaceholder(kind === 'signup' ? 'At least 8 characters' : 'Your password', { exact: true }).evaluate(element => element.setAttribute('data-probe-sensitive', 'true'));
    if (kind === 'signup') { this.identity.signupAttempted = true; saveIdentity(`${this.run.id}-${this.agent.id}`, this.identity); }
    const [response] = await Promise.all([page.waitForResponse(r => r.url() === `${AUDIT_ORIGIN}/api/auth/${kind}`, { timeout: 30000 }), page.getByRole('button', { name: kind === 'signup' ? 'Create account' : 'Sign in', exact: true }).click()]);
    const body = (await response.json().catch(() => ({ error: 'Authentication endpoint returned a non-JSON response' }))) || {};
    if (body.user?.id) { this.identity.userId = body.user.id; saveIdentity(`${this.run.id}-${this.agent.id}`, this.identity); }
    let authenticated = await probe();
    if (!authenticated.authenticated && kind === 'signup' && response.status() === 200 && !body.localOnly) {
      this.emit('audit.email.waiting', 'Waiting for a confirmation email addressed only to this synthetic alias.');
      const authOrigin = process.env.AUDIT_AUTH_ORIGIN || 'https://sytfbpcnkgejtffbdgxo.supabase.co';
      const link = await waitForConfirmation(this.identity.email, new Date(Date.now() - 120000), authOrigin, this.signal);
      if (link && allowedVerificationLink(link, authOrigin)) {
        this.verificationLink = link;
        try { await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 }); authenticated = await probe(); }
        finally { this.verificationLink = undefined; }
      }
    }
    const record = { operation: kind, responseStatus: response.status(), realUserIdReturned: Boolean(body.user?.id), localOnly: Boolean(body.localOnly), ...authenticated, error: this.sanitize(String(body.error || '')) };
    const proof = this.save('assertion', `${kind} server authentication check`, JSON.stringify(record, null, 2), 'json', { type: 'authentication', url: `${AUDIT_ORIGIN}/api/auth/${kind}`, status: response.status(), text: JSON.stringify(record) });
    this.emit('audit.authentication', authenticated.authenticated ? 'Real test-account session verified by server' : `Authentication unavailable after ${kind}`, record, [proof.id]);
    if (!authenticated.authenticated) {
      this.agent.signup = body.localOnly ? 'local-only' : response.status() === 200 ? 'verification-required' : 'failed';
      throw new Error(body.localOnly ? 'Local-only auth fallback is not a real account.' : response.status() === 200 ? 'Signup returned but no authenticated session exists. Email confirmation may be required; no bypass or re-registration performed.' : `Signup/signin rejected: HTTP ${response.status()} ${record.error}`);
    }
    if (this.agent.signup !== 'verified' && !this.reviewer) { this.agent.signup = 'verified'; this.run.audit!.accountCount++; }
    await page.waitForURL(url => !['/signup', '/signin'].includes(url.pathname), { timeout: 10000 }).catch(() => {});
    return { ...record, evidenceId: proof.id, account: this.identity.email, syntheticName: this.identity.name, marker: this.identity.marker };
  }
  async inspect() {
    this.check(); const page = this.page!;
    await this.settle();
    const revision = ++this.refRevision; this.refs.clear();
    const controls = await page.locator('a,button,input,textarea,select,[role="button"],[role="checkbox"],[role="radio"],[contenteditable="true"]').evaluateAll((elements, prefix) => elements.filter(element => element.getClientRects().length).slice(0, 100).map((element, index) => {
      const ref = `${prefix}-${index}`; element.setAttribute('data-probe-ref', ref);
      const input = element as HTMLInputElement;
      const label = element.getAttribute('aria-label') || (input.labels ? [...input.labels].map(label => label.textContent).join(' ') : '') || element.getAttribute('placeholder') || element.textContent || '';
      return { ref, tag: element.tagName.toLowerCase(), type: element.getAttribute('type') || '', label: label.trim().slice(0, 160), disabled: input.disabled || element.getAttribute('aria-disabled') === 'true', href: element.getAttribute('href')?.slice(0, 500) || undefined, options: element.tagName === 'SELECT' ? [...(element as HTMLSelectElement).options].slice(0, 40).map(option => ({ value: option.value.slice(0, 300), label: option.label.slice(0, 160) })) : undefined };
    }), `r${revision}`);
    controls.forEach(control => this.refs.set(control.ref, { selector: `[data-probe-ref="${control.ref}"]`, text: control.label, type: control.type }));
    const location = new URL(page.url());
    const url = `${location.origin}${location.pathname}`; this.pages.add(url);
    if (!this.agent.visitedUrls.includes(url)) this.agent.visitedUrls.push(url);
    const result = { url, title: this.sanitize((await page.title()).slice(0, 500)), text: this.sanitize((await page.locator('body').innerText()).slice(0, 11000)), controls: this.sanitizeValue(controls), recentEvidence: [...this.evidence.values()].slice(-8).map(({ id, type, url, status }) => ({ id, type, url, status })), step: this.counter, remainingSteps: Math.max(0, this.run.audit!.maxStepsPerAgent - this.counter) };
    const captured = this.save('assertion', 'Observed page and controls', JSON.stringify(result, null, 2), 'json', { type: 'page_inspection', url, text: result.text });
    return { ...result, inspectionEvidenceId: captured.id };
  }
  private async settle() {
    this.check(); const page = this.page!;
    await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
    await expect.poll(async () => Boolean(await page.evaluate(() => [...document.querySelectorAll('[aria-busy="true"], [role="progressbar"], p, span, div')].some(element => element.getClientRects().length && (element.matches('[aria-busy="true"], [role="progressbar"]') || (!element.children.length && /^loading(?:\.{3}|…)?$/i.test(element.textContent?.trim() || '')))))), { timeout: 2500 }).toBe(false).catch(() => {});
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    this.check();
  }
  async screenshot(label = 'Browser snapshot') {
    this.check();
    await this.settle();
    if (!isAuditNavigation(this.page!.url())) throw new Error('Screenshot withheld on authentication callback or non-product page');
    const shot = await this.page!.screenshot({ animations: 'disabled', timeout: 8000, mask: [this.page!.locator('input[type="password"], [data-probe-sensitive]'), this.page!.getByText(/eyJ[A-Za-z0-9_-]+\.|(?:sk|sb_secret|sb_publishable)[_-][A-Za-z0-9_-]{12,}|(?:access_token|refresh_token|token_hash|[?&]code)=/)] });
    const item = this.save('screenshot', label, shot, 'png', { type: 'screenshot', url: this.page!.url() });
    if (!this.reviewer) this.agent.screenshotId = item.id;
    saveRun(this.run); return item;
  }
  async execute(raw: unknown): Promise<unknown> {
    const input = auditAction.parse(raw); this.check();
    if (this.busy) throw new Error('One browser action is already running. Inspect after its result before continuing.');
    if (this.counter >= this.run.audit!.maxStepsPerAgent) throw new Error('Step budget reached; remainingSteps=0. Do not retry browser_action. Call finish_assignment with observed coverage and budget-limited items, then stop.');
    this.counter++;
    if (!this.reviewer) this.agent.stepCount++;
    this.busy = true;
    this.agent.currentAction = input.action === 'navigate' ? `Navigate ${input.path}` : input.action;
    this.actions.push({ action: this.sanitizeValue(input), url: this.sanitize(this.page!.url()), timestamp: new Date().toISOString() });
    this.emit('audit.tool.started', this.agent.currentAction, input);
    try {
      const page = this.page!;
      if (input.action === 'signup' || input.action === 'signin') {
        const auth = await this.auth(input.action);
        const shot = await this.screenshot('Authenticated account');
        return { auth, screenshotId: shot.id, ...(await this.inspect()) };
      }
      if (input.action === 'navigate') {
        const url = new URL(input.path, AUDIT_ORIGIN).href;
        if (!isAuditNavigation(url)) throw new Error('Navigation outside approved app pages');
        await page.goto(url, { waitUntil: 'domcontentloaded' });
      }
      if (input.action === 'reload') await page.reload({ waitUntil: 'domcontentloaded' });
      if (input.action === 'back') await page.goBack({ waitUntil: 'domcontentloaded' });
      if (['click', 'fill', 'select'].includes(input.action)) {
        const action = input as Extract<z.infer<typeof auditAction>, { ref: string }>;
        const ref = this.refs.get(action.ref); if (!ref) throw new Error('Stale control reference. Inspect the current page before trying again.');
        const locator = page.locator(ref.selector);
        if (!(await locator.isVisible())) throw new Error('Referenced control is no longer visible. Inspect again.');
        if (!safeActionLabel(ref.text)) throw new Error('External, account-destructive or consequential action is outside audit scope');
        if (action.action === 'click') await locator.click();
        if (action.action === 'fill') {
          if (ref.type === 'password' || /password|email/i.test(ref.text)) throw new Error('Use signup/signin account tools for credentials. Do not enter or change account secrets.');
          if (/<script|javascript:|onerror\s*=|union\s+select|drop\s+table/i.test(action.value)) throw new Error('Only benign synthetic input probes are permitted');
          await locator.fill(action.value);
        }
        if (action.action === 'select') await locator.selectOption(action.value);
      }
      if (input.action === 'key') await page.keyboard.press(input.key);
      if (isProductInteraction(input.action, page.url(), this.agent.signup === 'verified')) {
        this.agent.productActions = (this.agent.productActions || 0) + 1;
        this.emit('audit.product.interaction', `Product interaction: ${input.action} on ${new URL(page.url()).pathname}`, { productActions: this.agent.productActions });
      }
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      // Let the browser acknowledge rendering; no time-based coordination or write retries.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      if (input.action === 'accessibility') {
        const result = await page.evaluate(() => {
          const unnamed = [...document.querySelectorAll('button,input,select,textarea,[role="button"]')].filter(element => element.getClientRects().length && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !(element as HTMLInputElement).labels?.length && !element.textContent?.trim() && !element.getAttribute('placeholder')).map(element => element.outerHTML.slice(0, 250)).slice(0, 20);
          return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, unnamedControls: unnamed, h1Count: document.querySelectorAll('h1').length, focusTag: document.activeElement?.tagName };
        });
        const item = this.save('assertion', 'DOM accessibility and layout inspection', JSON.stringify(result, null, 2), 'json', { type: 'layout', url: page.url(), overflow: result.overflow, text: JSON.stringify(result) });
        return { ...result, evidenceId: item.id, note: 'DOM observations, not complete accessibility certification.' };
      }
      if (input.action === 'unauthenticated_check') {
        const context = await this.browser!.newContext();
        try {
          const response = await context.request.get(`${AUDIT_ORIGIN}${input.path}`, { maxRedirects: 0, timeout: 10000 });
          const text = await response.text();
          const ownMarker = text.includes(this.identity.marker) || text.includes(this.identity.email);
          const result = { url: `${AUDIT_ORIGIN}${input.path}`, status: response.status(), ownSyntheticMarkerPresent: ownMarker, bodyLength: text.length, body: ownMarker ? this.sanitize(text).slice(0, 3000) : '[body withheld; no private records exposed to the model]' };
          const item = this.save('assertion', 'Fresh unauthenticated access check', JSON.stringify(result, null, 2), 'json', { type: 'unauthorized_read', url: result.url, status: result.status, unauthenticated: true, text: ownMarker ? 'own-synthetic-marker-present' : '' });
          return { ...result, evidenceId: item.id };
        } finally { await context.close(); }
      }
      if (input.action === 'evidence') { const record = this.evidence.get(input.evidenceId); if (!record) throw new Error('Evidence outside this agent scope'); return record; }
      const shot = ['click', 'navigate', 'reload', 'screenshot'].includes(input.action) ? await this.screenshot(this.agent.currentAction) : undefined;
      const result = await this.inspect();
      this.emit('audit.tool.completed', this.agent.currentAction, undefined, shot ? [shot.id] : []);
      return { ...result, screenshotId: shot?.id };
    } catch (error) {
      const message = this.sanitize(safeError(error));
      this.emit('audit.tool.error', message);
      let page: unknown; try { page = await this.inspect(); } catch { page = { unavailable: true }; }
      return { error: message, page, retryPolicy: 'Inspect state before retrying a possibly completed action. No automatic write retries.' };
    } finally { this.busy = false; saveRun(this.run); }
  }
  report(raw: unknown): unknown {
    const report = reportSchema.parse(raw); this.check();
    if (this.reviewer) return { recorded: false, message: 'Reviewer should reproduce and return observations; no new findings during reproduction.' };
    if (report.evidenceIds.some(id => !this.evidence.has(id))) throw new Error('Finding must reference evidence captured by this specific agent');
    if (!report.evidenceIds.some(id => this.evidence.get(id)?.type !== 'screenshot')) throw new Error('A screenshot alone is not enough: inspect, accessibility or network evidence is required.');
    const dedupe = this.run.findings.find(finding => finding.title.toLowerCase() === report.title.toLowerCase() && finding.auditAssertion?.url === report.assertion.url);
    if (dedupe) { dedupe.actorIds = [...new Set([...(dedupe.actorIds || []), this.agent.id])]; dedupe.evidenceIds.push(...report.evidenceIds); saveRun(this.run); return { findingId: dedupe.id, status: dedupe.status }; }
    if (this.run.findings.filter(finding => finding.actorIds?.includes(this.agent.id)).length >= 4) return { limited: true, message: 'Four findings per specialist maximum. Consolidate related evidence in your summary.' };
    const objectivelySupported = this.matches(report.assertion).some(id => report.evidenceIds.includes(id));
    const finding: Finding = { id: randomUUID(), runId: this.run.id, title: this.sanitize(report.title), category: report.category, scenario: this.agent.name, expected: this.sanitize(report.expected), expectationSource: this.sanitize(report.source), actual: this.sanitize(report.observed), actors: ['viewer'], actorIds: [this.agent.id], preconditions: ['Fresh isolated synthetic account', `Specialist: ${this.agent.name}`, `Viewport: ${this.agent.viewport}`], steps: report.steps.map(step => this.sanitize(step)), evidenceIds: report.evidenceIds, status: 'Suspected', severity: report.severity, rationale: this.sanitize(report.rationale), auditAssertion: objectivelySupported ? report.assertion : { ...report.assertion, kind: 'observation' } };
    this.run.findings.push(finding); this.emit('audit.finding.suspected', finding.title, { findingId: finding.id, category: finding.category }, finding.evidenceIds);
    return { findingId: finding.id, status: finding.status, note: 'Agent observation only. Independent replay and objective evidence are required for confirmation.' };
  }
  finish(summary: string, coverage: string[]) { this.check(); this.agent.summary = this.sanitize(summary); this.agent.coverage = coverage.map(text => this.sanitize(text)); saveRun(this.run); return { recorded: true }; }
  matches(assertion: AuditAssertion): string[] {
    return [...this.evidence.values()].filter(record => {
      let actual: URL; let expected: URL;
      try { actual = new URL(record.url); expected = new URL(assertion.url, AUDIT_ORIGIN); } catch { return false; }
      actual.searchParams.sort(); expected.searchParams.sort();
      if (record.fromServiceWorker || actual.origin !== expected.origin || actual.pathname !== expected.pathname || actual.search !== expected.search) return false;
      if (assertion.kind === 'http_error') return record.type === 'http_response' && record.status === assertion.status && (record.status || 0) >= 500;
      if (assertion.kind === 'layout_overflow') return record.type === 'layout' && record.overflow;
      if (assertion.kind === 'uncaught_exception') return record.type === 'uncaught_exception' && Boolean(assertion.text && record.text?.includes(assertion.text));
      if (assertion.kind === 'unauthorized_read') return record.unauthenticated && record.status === 200 && record.text === 'own-synthetic-marker-present';
      return false;
    }).map(record => record.id);
  }
  async close() {
    if (this.closing) return this.closing;
    this.closed = true; bindings.delete(this.capability);
    this.closing = (async () => { await this.browser?.close(); await Promise.allSettled([...this.inflight]); this.refs.clear(); })();
    return this.closing;
  }
}
