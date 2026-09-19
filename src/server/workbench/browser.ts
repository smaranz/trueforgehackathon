import { chromium } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Diagnostic, PageElement, WorkbenchJob } from '../../shared/workbench.js';
import { allowBrowserRequest, validateWorkbenchTarget } from './policy.js';
import { screenshot } from './store.js';

export interface Inspection { findings: Diagnostic[]; elements: PageElement[]; text: string; screenshotUrl: string; notes: string[]; }
export async function inspectPage(job: WorkbenchJob, signal: AbortSignal): Promise<Inspection> {
  const target = validateWorkbenchTarget(job.targetUrl);
  signal.throwIfAborted();
  const browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP localhost 127.0.0.1'] });
  const close = () => { void browser.close().catch(() => {}); };
  signal.addEventListener('abort', close, { once: true });
  const errors: string[] = [], failed: string[] = [];
  let blocked = 0, requests = 0;
  try {
    signal.throwIfAborted();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', acceptDownloads: false });
    // tsx/esbuild preserves function names with this helper inside serialized evaluate callbacks.
    await context.addInitScript('globalThis.__name = (fn) => fn;');
    await context.routeWebSocket('**/*', route => route.close());
    await context.route('**/*', route => {
      const req = route.request();
      if (++requests > 200 || !allowBrowserRequest(req.url(), req.method(), target)) { blocked++; return route.abort('blockedbyclient'); }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('popup', popup => { void popup.close(); });
    page.on('dialog', dialog => { void dialog.dismiss(); });
    page.on('pageerror', error => { if (errors.length < 10) errors.push(error.message.slice(0, 800)); });
    page.on('response', response => { if (response.status() >= 500 && failed.length < 10) failed.push(`${response.status()} ${new URL(response.url()).pathname}`); });
    const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    signal.throwIfAborted();
    const finalUrl = new URL(page.url());
    if (finalUrl.origin !== target.origin) throw new Error('Target navigated outside its approved origin.');
    const snapshot = await page.evaluate(() => {
      function selector(el: Element): string {
        if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) return `#${CSS.escape(el.id)}`;
        const parts: string[] = [];
        let current: Element | null = el;
        for (let depth = 0; current && depth < 12; depth++, current = current.parentElement) {
          const tag = current.tagName.toLowerCase();
          const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(item => item.tagName === current!.tagName) : [];
          parts.unshift(`${tag}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ''}`);
          if (current === document.body) break;
        }
        return parts.join(' > ');
      }
      const visible = (el: Element) => { const r = el.getBoundingClientRect(); const style = getComputedStyle(el); return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
      const name = (el: Element) => el.getAttribute('aria-label')?.trim()
        || (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim()
        || (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement ? Array.from(el.labels || []).map(label => label.textContent).join(' ').trim() : '')
        || el.getAttribute('title')?.trim()
        || (el instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(el.type) ? el.value || (el.type === 'submit' ? 'Submit' : '') : '')
        || (el.matches('button, a') ? (el.textContent?.trim() || Array.from(el.querySelectorAll('img')).map(img => img.alt).join(' ').trim() || (el.querySelector('[aria-label]')?.getAttribute('aria-label') || '').trim()) : '');
      const issues: { rule: string; selector: string; actual: string }[] = [];
      const add = (rule: string, el: Element, actual: string) => { if (issues.length < 40) issues.push({ rule, selector: selector(el), actual }); };
      for (const el of Array.from(document.querySelectorAll('img,input,select,textarea,button,a[href]')).slice(0, 2000)) {
        if (!visible(el)) continue;
        if (el.matches('img') && !el.hasAttribute('alt') && el.getAttribute('role') !== 'presentation' && el.getAttribute('aria-hidden') !== 'true' && !el.getAttribute('aria-label')) add('image-alt', el, 'Visible image has no alt attribute or accessible name.');
        if (el.matches('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]),select,textarea') && !name(el)) add('field-label', el, 'Visible form control has no associated label, aria-label, aria-labelledby or title. A placeholder is not a persistent label.');
        if (el.matches('button,a[href]') && !name(el) && el.getAttribute('aria-hidden') !== 'true') add('control-name', el, 'Visible interactive control has no detectable accessible name.');
      }
      if (!document.documentElement.lang.trim()) add('document-lang', document.documentElement, 'The root HTML element has no language attribute.');
      if (!document.title.trim()) add('document-title', document.documentElement, 'The page title is empty.');
      if (document.documentElement.scrollWidth > innerWidth + 4) add('layout-overflow', document.body, `Document width ${document.documentElement.scrollWidth}px exceeds the ${innerWidth}px viewport.`);
      const elements = Array.from(document.querySelectorAll('h1,h2,h3,p,button,a,input,select,textarea,img,[role],label')).slice(0, 2000).filter(visible).map(el => {
        const r = el.getBoundingClientRect();
        return { selector: selector(el), tag: el.tagName.toLowerCase(), text: (name(el) || el.textContent || '').trim().slice(0, 160), rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
      }).filter(el => el.rect.y < 800 && el.rect.y + el.rect.height > 0 && el.rect.x < 1280 && el.rect.x + el.rect.width > 0).slice(0, 300);
      // Never include input values (passwords, tokens, or autofilled personal data).
      return { issues, elements, text: (document.body?.innerText || '').slice(0, 16000) };
    });
    const findings: Diagnostic[] = [];
    const add = (rule: string, title: string, actual: string, expected: string, suggestion: string, category: Diagnostic['category'], severity: Diagnostic['severity'], selector?: string) => findings.push({
      id: randomUUID(), rule, title, actual, expected, suggestion, category, severity, selector,
      url: finalUrl.href, status: 'Observed', evidence: [actual, `Captured at ${new Date().toISOString()} in a fresh 1280×800 browser.`],
    });
    const rules: Record<string, [string, string, string]> = {
      'image-alt': ['Image is missing alternative text', 'Images have meaningful alt text, or alt="" when decorative.', 'Add an appropriate alt attribute to this image.'],
      'field-label': ['Form field is missing a label', 'Every form field has a persistent accessible name.', 'Associate a visible label using htmlFor/id, or supply a suitable aria-label.'],
      'control-name': ['Control is missing an accessible name', 'Links and buttons explain their action to assistive technology.', 'Add visible text or an aria-label describing the action.'],
      'document-lang': ['Page language is not declared', 'The document declares its content language.', 'Set the correct lang attribute on the root HTML element.'],
      'document-title': ['Page title is empty', 'The browser tab identifies the page.', 'Set a descriptive document title.'],
      'layout-overflow': ['Page overflows horizontally', 'Page content fits the viewport without unintended horizontal scrolling.', 'Inspect fixed widths, flex/grid minimum sizes and oversized content.'],
    };
    for (const item of snapshot.issues) {
      const [title, expected, suggestion] = rules[item.rule];
      add(item.rule, title, item.actual, expected, suggestion, item.rule === 'layout-overflow' ? 'functional' : 'accessibility', 'Medium', item.selector);
    }
    for (const error of errors) add('runtime-error', 'Uncaught browser exception', error, 'Rendering and page scripts complete without uncaught exceptions.', 'Trace this error to its component and handle the failing state.', 'functional', 'High');
    for (const error of failed) add('server-error', 'Server returned an error', error, 'Required page requests succeed.', 'Inspect the failing route and server logs; fix the underlying exception.', 'functional', 'High');
    if (response) {
      const headers = await response.allHeaders();
      for (const [header, suggestion] of [
        ['x-content-type-options', 'Set X-Content-Type-Options: nosniff on responses.'],
        ['content-security-policy', 'Define a Content-Security-Policy appropriate to the app; test required script/style sources before enforcing.'],
      ]) if (!headers[header]) {
        add(`header-${header}`, `Missing ${header} header`, `The document response does not include ${header}.`, 'Consider defense-in-depth response headers for this route.', suggestion, 'security', 'Low');
        findings[findings.length - 1].status = 'Suspected';
      }
      if (response.status() >= 400 && response.status() < 500) add('page-unavailable', 'Target page is unavailable', `Navigation returned HTTP ${response.status()}.`, 'The intended test route is reachable.', 'Check the route and authentication prerequisites. A protected-route denial is not a vulnerability.', 'functional', 'Low');
    }
    const image = await page.screenshot({ animations: 'disabled', timeout: 8000 });
    return { findings, elements: snapshot.elements, text: snapshot.text, screenshotUrl: screenshot(job, image), notes: [
      'Fresh anonymous, read-only browser inspection. Forms were not submitted; authenticated workflows are not covered.',
      `${requests} resource requests observed; ${blocked} requests blocked by the local read-only policy.`,
      'Security-header suggestions are context-dependent hardening checks, not proof of an exploitable vulnerability.',
    ] };
  } finally { signal.removeEventListener('abort', close); await browser.close(); }
}
