import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Browser, CaretRight, CheckCircle, Clock, Cpu, DeviceMobile, GlobeHemisphereWest, LockKey, Monitor, Robot, SlidersHorizontal, UsersThree } from '@phosphor-icons/react';
import type { AuditAssignment, AuditInput, Health, Run } from '../shared/types';
import { errorMessage } from './api';
import { Brand, ErrorNotice, SectionTitle } from './components';
import './audit.css';

export interface AuditSetupProps {
  onStarted: (run: Run) => void;
  health: Health | null;
}

const TARGET: AuditInput['targetUrl'] = 'http://localhost:3000/signup';
const MODEL = 'openai/gpt-5-6-sol';
const DEFAULT_GOAL = 'Run a full-product audit: create real accounts with synthetic identities, explore accessible product features, critique observable usability and accessibility, and investigate functional defects and security vulnerabilities. Record browser evidence, reproduce findings, and clearly identify blocked or untested coverage.';

interface AuditCatalog {
  assignments: AuditAssignment[];
  model: string;
  targetUrl: string;
  mailbox?: { configured: boolean; address?: string; aliases?: boolean };
}

type LimitKey = 'agentCount' | 'concurrency' | 'maxStepsPerAgent' | 'deadlineMinutes' | 'maxTotalTokens';
const LIMITS: { key: LimitKey; label: string; min: number; max: number; help: string }[] = [
  { key: 'agentCount', label: 'Specialist agents', min: 1, max: 30, help: '1–30 assignments from the catalog.' },
  { key: 'concurrency', label: 'Concurrent agents', min: 1, max: 6, help: '1–6 at once, up to your agent count.' },
  { key: 'maxStepsPerAgent', label: 'Steps per agent', min: 15, max: 100, help: '15–100 actual agent steps.' },
  { key: 'deadlineMinutes', label: 'Time limit · minutes', min: 5, max: 90, help: '5–90 minutes for the run.' },
  { key: 'maxTotalTokens', label: 'Total token budget', min: 100_000, max: 6_000_000, help: '100,000–6,000,000 tokens across the run.' },
];

async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* Report invalid responses below. */ }
  if (!response.ok) {
    const message = body && typeof body === 'object'
      ? ('error' in body && typeof body.error === 'string' ? body.error : 'message' in body && typeof body.message === 'string' ? body.message : null)
      : null;
    throw new Error(message || `The audit API returned ${response.status}. Please try again when it is available.`);
  }
  if (body === null) throw new Error('The audit API returned an empty or invalid response.');
  return body;
}

function isCatalog(value: unknown): value is AuditCatalog {
  if (!value || typeof value !== 'object' || !('assignments' in value) || !Array.isArray(value.assignments)) return false;
  if (!('model' in value) || typeof value.model !== 'string' || !('targetUrl' in value) || typeof value.targetUrl !== 'string') return false;
  return value.assignments.every((item: unknown) => {
    if (!item || typeof item !== 'object') return false;
    return 'id' in item && typeof item.id === 'string' && item.id.length > 0
      && 'name' in item && typeof item.name === 'string'
      && 'focus' in item && typeof item.focus === 'string'
      && 'objective' in item && typeof item.objective === 'string'
      && 'routes' in item && Array.isArray(item.routes) && item.routes.every(route => typeof route === 'string')
      && 'viewport' in item && (item.viewport === 'desktop' || item.viewport === 'mobile');
  }) && new Set(value.assignments.map(item => item.id)).size === value.assignments.length;
}

function isRun(value: unknown): value is Run {
  return Boolean(value && typeof value === 'object'
    && 'id' in value && typeof value.id === 'string' && value.id
    && 'scenario' in value && value.scenario === 'full-audit'
    && 'status' in value && typeof value.status === 'string'
    && 'events' in value && Array.isArray(value.events)
    && 'actors' in value && Array.isArray(value.actors)
    && 'artifacts' in value && Array.isArray(value.artifacts)
    && 'findings' in value && Array.isArray(value.findings)
    && 'verifications' in value && Array.isArray(value.verifications));
}

export function AuditSetup({ onStarted, health }: AuditSetupProps) {
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [limits, setLimits] = useState<Record<LimitKey, string>>({ agentCount: '30', concurrency: '4', maxStepsPerAgent: '60', deadlineMinutes: '60', maxTotalTokens: '6000000' });
  const [catalog, setCatalog] = useState<AuditCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const submitting = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogLoading(true);
    setCatalogError(null);
    async function load() {
      try {
        const response = await fetch('/api/audits/catalog', { headers: { Accept: 'application/json' }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
        const result = await readResponse(response);
        if (!isCatalog(result)) throw new Error('The specialist catalog could not be read. Reload it to retrieve the current assignments.');
        if (!result.assignments.length) throw new Error('The catalog has no specialist assignments yet.');
        if (!controller.signal.aborted) {
          // Only retain the catalog's public mailbox status fields.
          const mailbox = result.mailbox;
          setCatalog({ assignments: result.assignments, model: result.model, targetUrl: result.targetUrl,
            mailbox: mailbox && typeof mailbox.configured === 'boolean' ? {
              configured: mailbox.configured,
              address: typeof mailbox.address === 'string' ? mailbox.address : undefined,
              aliases: mailbox.aliases === true,
            } : undefined });
        }
      } catch (cause) {
        if (!controller.signal.aborted) { setCatalog(null); setCatalogError(errorMessage(cause)); }
      } finally {
        if (!controller.signal.aborted) setCatalogLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [catalogRevision]);

  const agentCount = Number(limits.agentCount);
  const concurrency = Number(limits.concurrency);
  const validLimits = LIMITS.every(limit => limits[limit.key].trim() !== '' && Number.isInteger(Number(limits[limit.key])) && Number(limits[limit.key]) >= limit.min && Number(limits[limit.key]) <= limit.max)
    && concurrency <= agentCount;
  const previewCount = Number.isInteger(agentCount) && agentCount >= 1 && agentCount <= 30 ? agentCount : 0;
  const assignments = catalog?.assignments.slice(0, 30) ?? [];
  const included = new Set(assignments.slice(0, previewCount).map(assignment => assignment.id));
  const ready = Boolean(health?.trueforge.reachable && health.trueforge.ready);
  const catalogMismatch = catalog && (catalog.model !== MODEL || catalog.targetUrl !== TARGET)
    ? `The catalog reports ${catalog.model} at ${catalog.targetUrl}. This profile requires ${MODEL} at ${TARGET}.`
    : null;
  const missingAssignments = Boolean(catalog && validLimits && assignments.length < agentCount);
  const canStart = ready && !starting && !catalogLoading && Boolean(catalog) && !catalogMismatch && !missingAssignments && validLimits && goal.trim().length >= 5;

  function changeLimit(key: LimitKey, value: string) {
    setLimits(previous => {
      const next = { ...previous, [key]: value };
      if (key === 'agentCount' && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 30 && Number(previous.concurrency) > Number(value)) next.concurrency = value;
      return next;
    });
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canStart || submitting.current) return;
    submitting.current = true;
    setStarting(true);
    setStartError(null);
    const input: AuditInput = {
      targetUrl: TARGET, goal: goal.trim(), agentCount, concurrency,
      maxStepsPerAgent: Number(limits.maxStepsPerAgent), deadlineMinutes: Number(limits.deadlineMinutes), maxTotalTokens: Number(limits.maxTotalTokens),
    };
    let accepted = false;
    try {
      let response: Response;
      try {
        response = await fetch('/api/audits', {
          method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(input), signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new Error('The start response was not received. Check run history before retrying; the server may have accepted this audit.');
      }
      accepted = response.ok;
      const result = await readResponse(response);
      if (!isRun(result)) throw new Error('The API did not return a full-product audit run.');
      onStarted(result);
    } catch (cause) {
      setStartError(`${errorMessage(cause)}${accepted ? ' The request was accepted; check run history before starting another audit.' : ''}`);
    } finally {
      submitting.current = false;
      setStarting(false);
    }
  }

  return <div className="audit-page audit-setup">
    <header className="audit-heading">
      <div><span className="audit-eyebrow"><span className="audit-cross" aria-hidden="true" /> FULL-PRODUCT AUDIT</span><h1>{previewCount || 'Specialist'} perspectives. <span>One real product.</span></h1><p>Start at signup. Give each specialist a distinct assignment and inspect the evidence they bring back.</p></div>
      <span className="audit-index">01 / SET UP</span>
    </header>

    <form className="audit-setup-layout" onSubmit={start} aria-busy={starting}>
      <div className="audit-setup-main">
        <section className="audit-section">
          <SectionTitle number="01" title="The starting point" detail="Real signup → product exploration" />
          <div className="audit-field"><label htmlFor="audit-target">Target URL <span>Fixed local target</span></label><div className="audit-url-field"><GlobeHemisphereWest size={18} /><input id="audit-target" value={TARGET} readOnly aria-describedby="audit-target-help" /><LockKey size={14} /></div><p id="audit-target-help" className="audit-help">Agents submit the real signup form using synthetic identities and attempt to verify account creation.</p></div>
          {catalog?.mailbox && <div className="audit-mailbox"><span className="audit-label">SIGNUP MAILBOX</span><strong>{catalog.mailbox.configured ? catalog.mailbox.address || 'Mailbox configured' : 'Mailbox not configured'}</strong><p>{catalog.mailbox.configured ? catalog.mailbox.aliases ? 'Distinct agent email aliases deliver confirmation messages to this mailbox. Account verification is reported per agent.' : 'A mailbox is configured; per-agent alias support is not reported.' : 'Email-confirmation access is not configured. Signup outcomes will show any resulting blockers.'}</p></div>}
          <div className="audit-field"><label htmlFor="audit-goal">What should the team investigate?</label><textarea id="audit-goal" value={goal} onChange={event => setGoal(event.target.value)} rows={5} required minLength={5} maxLength={2000} disabled={starting} aria-describedby="audit-goal-help" /><p id="audit-goal-help" className="audit-help">Functional defects, feature coverage, security, accessibility, and evidence-backed UX observations.</p></div>
        </section>

        <section className="audit-section">
          <SectionTitle number="02" title="Set the boundaries"><SlidersHorizontal size={17} className="audit-muted" /></SectionTitle>
          <fieldset className="audit-limits" disabled={starting}><legend className="sr-only">Agent, concurrency, step, time and token limits</legend>
            {LIMITS.map(limit => <div className={`audit-field ${limit.key === 'maxTotalTokens' ? 'audit-field-wide' : ''}`} key={limit.key}>
              <label htmlFor={`audit-${limit.key}`}>{limit.label}</label>
              <input id={`audit-${limit.key}`} name={limit.key} type="number" inputMode="numeric" min={limit.min} max={limit.key === 'concurrency' ? Math.min(6, previewCount || 6) : limit.max} step={1} required value={limits[limit.key]} onChange={event => changeLimit(limit.key, event.target.value)} aria-describedby={`audit-${limit.key}-help`} />
              <p className="audit-help" id={`audit-${limit.key}-help`}>{limit.help}</p>
            </div>)}
          </fieldset>
          <div className="audit-inline-note"><Clock size={16} /><p>These are execution ceilings. Agents act as tools return, with no arbitrary delays to fill the time limit. Concurrency limits how many agents run at once.</p></div>
        </section>

        <div className="audit-launch">
          {startError && <ErrorNotice>{startError}</ErrorNotice>}
          <div className="audit-launch-row"><div><strong>Ready to meet your product?</strong><p>{validLimits ? `${agentCount} agents · ${Number(limits.deadlineMinutes)} min ceiling · ${Number(limits.maxTotalTokens).toLocaleString()} token budget` : 'Choose values within the execution limits.'}</p></div><button type="submit" className="button button-primary audit-start-button" disabled={!canStart}>{starting ? 'Starting audit…' : 'Start full-product audit'}<ArrowRight size={17} /></button></div>
          <p className="audit-help" role="status">{starting ? 'Submitting the audit. Your workspace opens when the API returns the saved run.' : !ready ? 'Waiting for TrueForge readiness.' : catalogLoading ? 'Waiting for the assignment catalog.' : !validLimits ? 'Use whole numbers within each range; concurrency cannot exceed the agent count.' : goal.trim().length < 5 ? 'Add an investigation goal of at least 5 characters.' : 'Account creation is real. Time and tokens are limits, not a cost estimate.'}</p>
        </div>

        <section className="audit-section audit-catalog-section" aria-busy={catalogLoading}>
          <SectionTitle number="03" title="Meet the specialists" detail={catalog ? `${assignments.length} catalog assignments` : 'Live assignment catalog'} />
          <p className="audit-section-copy">Each agent gets a specific objective and viewport. The first {previewCount || '—'} catalog assignments are included in this run.</p>
          {catalogLoading ? <div className="audit-catalog-loading" role="status"><span>Loading specialist assignments…</span>{[1, 2, 3].map(index => <div className="audit-skeleton-row" key={index} aria-hidden="true" />)}</div> : catalogError ? <ErrorNotice onRetry={() => setCatalogRevision(value => value + 1)}>{catalogError}</ErrorNotice> : <div className="audit-assignment-list">
            {assignments.map((assignment, index) => <details className="audit-assignment" key={assignment.id} data-included={included.has(assignment.id)}>
              <summary><span className="audit-assignment-number">{String(index + 1).padStart(2, '0')}</span><span className="audit-assignment-title"><strong>{assignment.name}</strong><span>{assignment.focus}</span></span><span className="audit-viewport" title={assignment.viewport}>{assignment.viewport === 'mobile' ? <DeviceMobile size={16} /> : <Monitor size={16} />}<span>{assignment.viewport}</span></span><span className="audit-assignment-inclusion">{included.has(assignment.id) ? 'Included' : 'Outside run'}</span><CaretRight size={14} className="audit-chevron" /></summary>
              <div className="audit-assignment-body"><p>{assignment.objective}</p><span className="audit-label">Suggested routes · coverage is not guaranteed</span>{assignment.routes.length ? <ul className="audit-route-chips">{assignment.routes.map((route, routeIndex) => <li key={`${route}-${routeIndex}`}><code>{route}</code></li>)}</ul> : <p className="audit-help">No initial routes specified.</p>}</div>
            </details>)}
          </div>}
          {catalogMismatch && <ErrorNotice>{catalogMismatch}</ErrorNotice>}
          {missingAssignments && <ErrorNotice>Only {assignments.length} assignments are available. Lower the agent count or reload the catalog.</ErrorNotice>}
        </section>
      </div>

      <aside className="audit-setup-aside">
        <div className="audit-brief">
          <div className="audit-brief-top"><span className="audit-eyebrow">THE INVESTIGATION</span><UsersThree size={20} /></div>
          <div className="audit-team-count"><strong>{previewCount || '—'}</strong><span>specialist agents<br />one shared goal</span></div>
          {assignments.length > 0 && <div className="audit-roster-map" aria-label={`${included.size} included assignments`}>{assignments.map((assignment, index) => <span key={assignment.id} data-included={included.has(assignment.id)} title={`${assignment.name}${included.has(assignment.id) ? ' · included' : ' · outside run'}`}>{String(index + 1).padStart(2, '0')}</span>)}</div>}
          <h2>Real interactions.<br />A record you can inspect.</h2>
          <ol className="audit-flow"><li><span>01</span><div><strong>Create & verify</strong><p>Real account creation with synthetic identities, checked against the signup result.</p></div></li><li><span>02</span><div><strong>Explore the product</strong><p>GPT-5.6 Sol agents choose browser interactions through TrueForge, guided by their assignments.</p></div></li><li><span>03</span><div><strong>Reproduce & report</strong><p>Inspect findings, reproduction outcomes, actual steps, snapshots, and trace artifacts.</p></div></li></ol>
          <div className="audit-brief-foot"><Browser size={16} /><span>{validLimits ? `Up to ${concurrency} agents at once` : 'Bounded parallel execution'} · real browser activity</span></div>
        </div>

        <div className="audit-model"><span className="audit-label"><Cpu size={15} /> FIXED MODEL</span><strong>GPT-5.6 Sol</strong><code>{MODEL}</code><div className="audit-service" data-ready={ready}><span className="audit-service-dot" /><span>{ready ? 'TrueForge ready' : health ? 'TrueForge unavailable' : 'Service status not yet reported'}</span></div><p>{ready ? health?.trueforge.verified ? 'Agent execution verified by the service.' : 'Service configured; this audit will record actual execution.' : health?.trueforge.reason || 'TrueForge must report ready before an audit can start.'}</p></div>
        <div className="audit-expectations"><CheckCircle size={18} /><div><strong>Verified means verified.</strong><p>Email confirmation and rate limits can block signup. A local-only identity is not a verified account. Restricted or unknown coverage stays explicit.</p></div></div>
      </aside>

    </form>
    <footer className="audit-footer"><Brand small /><span><Robot size={14} /> Agent observations. Browser evidence. Explicit limits.</span></footer>
  </div>;
}
