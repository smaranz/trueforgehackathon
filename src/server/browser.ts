import { chromium, expect, type Browser, type BrowserContext, type Page, type Request } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { issueSession } from '../demo/app.js';
import type { Role, Run, Phase } from '../shared/types.js';
import { demoOrigin } from './config.js';
import { artifact, event, rememberCapability, retireCapability, saveRun } from './store.js';

export const browserInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('inspect') }).strict(),
  z.object({ action: z.literal('navigate'), path: z.enum(['/documents', '/documents/launch-brief']) }).strict(),
  z.object({ action: z.literal('click'), testId: z.enum(['open-document', 'share-button', 'grant-editor', 'revoke-editor', 'close-sharing', 'export-button', 'save-button']) }).strict(),
  z.object({ action: z.literal('fill'), testId: z.literal('document-content'), value: z.string().max(10000) }).strict(),
  z.object({ action: z.literal('screenshot') }).strict(),
  z.object({ action: z.literal('report'), observation: z.string().min(1).max(3000), evidenceIds: z.array(z.string()).max(20) }).strict(),
]);
export type BrowserInput = z.infer<typeof browserInput>;
export interface NetworkRecord {
  sequence: number; requestedAt: string; completedAt: string; actor: Role; method: string; url: string;
  status: number; requestId: string; revision: string; cacheControl: string; fromServiceWorker: boolean;
  body: string; artifactId: string;
}
interface ActorBrowser { role: Role; context: BrowserContext; page: Page; capability: string; busy: boolean; }
export interface Binding { fleet: BrowserFleet; role: Role; }
const capabilities = new Map<string, Binding>();
export function resolveCapability(token: string): Binding | undefined { return capabilities.get(token); }

/** All URLs, including browser subresources and redirects, are evaluated here. */
export function allowedBrowserUrl(raw: string, environmentId: string, method = 'GET'): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.origin !== demoOrigin || url.username || url.password || url.search || url.hash) return false;
  const prefix = `/w/${environmentId}`;
  const path = url.pathname.slice(prefix.length);
  if (!url.pathname.startsWith(`${prefix}/`) && url.pathname !== prefix) return false;
  if (method === 'GET') return ['', '/', '/documents', '/documents/launch-brief', '/api/document', '/api/export'].includes(path);
  return (method === 'POST' && ['/api/share', '/api/revoke'].includes(path)) || (['PUT', 'PATCH'].includes(method) && path === '/api/document');
}

export class BrowserFleet {
  private browser?: Browser;
  private actors = new Map<Role, ActorBrowser>();
  private pending = new Set<Promise<void>>();
  private requests = new WeakMap<Request, { sequence: number; requestedAt: string }>();
  private sequence = 0;
  private closed = false;
  readonly network: NetworkRecord[] = [];
  phase: Phase = 'preconditions';
  activeRole?: Role;
  constructor(readonly run: Run, readonly environmentId: string, readonly signal: AbortSignal) {}

  async start(): Promise<void> {
    this.assertOpen();
    this.browser = await chromium.launch({ headless: true });
    try {
      for (const role of ['owner', 'editor'] as const) {
        this.assertOpen();
        this.run.actors.find(actor => actor.role === role)!.sessionId = `browser-${randomUUID()}`;
        const context = await this.browser.newContext({ viewport: { width: 1100, height: 760 }, serviceWorkers: 'block', acceptDownloads: false });
        const cookie = issueSession(this.environmentId, role);
        await context.addCookies([{ ...cookie, domain: '127.0.0.1', httpOnly: true, sameSite: 'Strict', secure: false }]);
        await context.route('**/*', route => allowedBrowserUrl(route.request().url(), this.environmentId, route.request().method()) ? route.continue() : route.abort('blockedbyclient'));
        const page = await context.newPage();
        page.setDefaultTimeout(7000);
        page.setDefaultNavigationTimeout(10000);
        const capability = randomBytes(32).toString('base64url');
        rememberCapability(capability, this.run.id, role);
        this.actors.set(role, { role, context, page, capability, busy: false });
        capabilities.set(capability, { fleet: this, role });
        page.on('request', request => { this.requests.set(request, { sequence: ++this.sequence, requestedAt: new Date().toISOString() }); });
        page.on('response', response => {
          if (!response.url().includes('/api/')) return;
          const promise = (async () => {
            const request = response.request();
            const meta = this.requests.get(request)!;
            const headers = response.headers();
            const record = {
              ...meta, completedAt: new Date().toISOString(), actor: role, method: request.method(), url: response.url(),
              status: response.status(), requestId: headers['x-request-id'] || '', revision: headers['x-document-revision'] || '',
              cacheControl: headers['cache-control'] || '', fromServiceWorker: response.fromServiceWorker(), body: (await response.text()).slice(0, 20000),
            };
            if (this.closed || this.signal.aborted) return;
            const evidence = artifact(this.run, 'network', `${role} · ${record.method} ${new URL(record.url).pathname.split('/api/')[1]} → ${record.status}`, JSON.stringify(record, null, 2), 'json', role);
            this.network.push({ ...record, artifactId: evidence.id });
            event(this.run, 'network.response', `${record.method} /api/${new URL(record.url).pathname.split('/api/')[1]} → HTTP ${record.status}`, { actor: role, artifactIds: [evidence.id], details: { ...record, body: record.body.slice(0, 1200) } });
          })().catch(error => {
            if (!this.closed && !this.signal.aborted) event(this.run, 'evidence.error', `Response body unavailable: ${safeError(error)}`, { actor: role });
          });
          this.pending.add(promise);
          void promise.finally(() => this.pending.delete(promise));
        });
        page.on('console', msg => {
          if (msg.type() === 'error' && !this.closed) event(this.run, 'browser.console', msg.text().slice(0, 1000), { actor: role });
        });
        page.on('pageerror', error => { if (!this.closed) event(this.run, 'browser.error', safeError(error), { actor: role }); });
        context.on('page', extra => { if (extra !== page) void extra.close(); });
        await page.goto(`${demoOrigin}/w/${this.environmentId}/documents`, { waitUntil: 'domcontentloaded' });
        await this.screenshot(role, 'Isolated session established');
      }
      if (this.actors.get('owner')!.context === this.actors.get('editor')!.context) throw new Error('Actor isolation failed');
    } catch (error) { await this.close(); throw error; }
  }

  getCapability(role: Role): string { return this.getActor(role).capability; }
  private getActor(role: Role): ActorBrowser {
    const actor = this.actors.get(role);
    if (!actor) throw new Error('Actor context not found');
    return actor;
  }
  private assertOpen(): void {
    if (this.closed || this.signal.aborted) throw new Error('Run cancelled or deadline exceeded');
  }
  async drain(): Promise<void> { await Promise.all([...this.pending]); }
  latest(role: Role, apiPath: string, after = 0): NetworkRecord | undefined {
    return this.network.filter(record => record.actor === role && record.url.endsWith(`/api/${apiPath}`) && record.sequence > after).sort((a, b) => b.sequence - a.sequence)[0];
  }
  setPhase(phase: Phase, role?: Role): void { this.phase = phase; this.activeRole = role; }
  async inspect(role: Role) {
    this.assertOpen();
    const page = this.getActor(role).page;
    return {
      url: page.url(), actor: role, phase: this.phase,
      page: (await page.locator('body').ariaSnapshot()).slice(0, 16000),
      controls: await page.locator('[data-testid]').evaluateAll(elements => elements.map(element => ({
        testId: element.getAttribute('data-testid'), tag: element.tagName.toLowerCase(), text: element.textContent?.slice(0, 130),
        visible: Boolean(element.getClientRects().length), disabled: element.hasAttribute('disabled'),
      }))),
      recentEvidence: this.network.filter(record => record.actor === role).slice(-5).map(({ artifactId, status, url, requestId }) => ({ artifactId, status, url, requestId })),
    };
  }
  private checkPermission(role: Role, input: BrowserInput): void {
    this.assertOpen();
    if (['inspect', 'screenshot', 'report'].includes(input.action)) return;
    if (role !== this.activeRole) throw new Error(`Actor is waiting at the ${this.phase} coordination boundary.`);
    if (input.action === 'navigate') return;
    if (input.action === 'fill') throw new Error('Editing is outside this access-revocation scenario.');
    if (input.action !== 'click') return;
    const allowed: Partial<Record<Phase, string[]>> = {
      share: ['open-document', 'share-button', 'grant-editor', 'close-sharing'],
      open: ['open-document'],
      revoke: ['share-button', 'revoke-editor', 'close-sharing'],
      check: ['open-document', 'export-button'],
    };
    if (!allowed[this.phase]?.includes(input.testId)) throw new Error(`Action is outside the ${this.phase} phase permissions.`);
  }
  async execute(role: Role, raw: unknown): Promise<unknown> {
    const input = browserInput.parse(raw);
    this.checkPermission(role, input);
    const actor = this.getActor(role);
    if (actor.busy) throw new Error('An action is already in flight. Inspect its result before issuing another action.');
    actor.busy = true;
    const display = this.run.actors.find(a => a.role === role)!;
    display.currentAction = input.action === 'click' ? `Click ${input.testId}` : input.action;
    display.status = 'working';
    event(this.run, 'tool.started', display.currentAction, { actor: role, details: input });
    try {
      if (input.action === 'report') {
        if (input.evidenceIds.some(id => !this.run.artifacts.some(a => a.id === id && a.actor === role))) throw new Error('Observation references evidence outside this actor’s scope.');
        event(this.run, 'agent.observation', input.observation, { actor: role, artifactIds: input.evidenceIds });
        return { recorded: true, note: 'Observation recorded. Confirmation requires independent objective verification.' };
      }
      if (input.action === 'navigate') {
        await actor.page.goto(`${demoOrigin}/w/${this.environmentId}${input.path}`, { waitUntil: 'domcontentloaded' });
        if (input.path.endsWith('/launch-brief')) await expect(actor.page.getByTestId('document-content')).not.toHaveAttribute('aria-busy', 'true');
      }
      if (input.action === 'click') {
        const api = ({ 'grant-editor': 'share', 'revoke-editor': 'revoke', 'export-button': 'export', 'open-document': 'document' } as Record<string, string>)[input.testId];
        if (api) {
          const responsePromise = actor.page.waitForResponse(response => response.url().endsWith(`/api/${api}`), { timeout: 10000 });
          // Always observe completion; never retry an uncertain write automatically.
          const [response] = await Promise.all([responsePromise, actor.page.getByTestId(input.testId).click()]);
          await response.finished();
          if (api === 'export') {
            await expect(actor.page.getByTestId('export-result')).toHaveAttribute('data-status', String(response.status()));
            await actor.page.getByTestId('export-result').scrollIntoViewIfNeeded();
          }
          if (api === 'share' || api === 'revoke') await expect(actor.page.getByTestId('permission-editor')).toHaveText(api === 'share' ? 'Editor' : 'No access');
          if (api === 'document') await expect(actor.page.getByTestId('document-content')).not.toHaveAttribute('aria-busy', 'true');
        } else await actor.page.getByTestId(input.testId).click();
      }
      await this.drain();
      const shot = input.action !== 'inspect' ? await this.screenshot(role, display.currentAction) : undefined;
      const result = { ...(await this.inspect(role)), screenshotId: shot?.id };
      event(this.run, 'tool.completed', display.currentAction, { actor: role, artifactIds: shot ? [shot.id] : [] });
      return result;
    } catch (error) {
      let state: unknown;
      try { state = await this.inspect(role); } catch { state = { unavailable: true }; }
      const message = safeError(error);
      event(this.run, 'tool.error', message, { actor: role, details: { input, state, retryPolicy: 'State inspected after uncertainty; no automatic write retry.' } });
      return { error: message, inspectBeforeRetry: true, state };
    } finally {
      actor.busy = false;
      display.status = this.signal.aborted ? 'stopped' : 'waiting';
      saveRun(this.run);
    }
  }
  async screenshot(role: Role, label: string) {
    this.assertOpen();
    const image = await this.getActor(role).page.screenshot({ type: 'png', animations: 'disabled' });
    const entry = artifact(this.run, 'screenshot', `${role} · ${label}`, image, 'png', role);
    this.run.actors.find(a => a.role === role)!.screenshotId = entry.id;
    saveRun(this.run);
    return entry;
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const actor of this.actors.values()) {
      capabilities.delete(actor.capability);
      retireCapability(actor.capability);
    }
    await this.browser?.close();
    await this.drain();
    this.actors.clear();
  }
}

export function safeError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 1800);
}

export function redactSecrets(value: string): string {
  return value.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_*.-]{8,}/g, '[redacted credential]');
}
