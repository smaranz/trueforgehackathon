import { useMemo, useRef, useState, useEffect } from 'react';
import { ArrowDown, ArrowRight, ArrowSquareOut, Browser, CaretRight, CheckCircle, Clock, DeviceMobile, DownloadSimple, FileMagnifyingGlass, GlobeHemisphereWest, ImageSquare, ListChecks, MagnifyingGlass, Monitor, Pause, Stop, TerminalWindow, WarningCircle, WifiHigh } from '@phosphor-icons/react';
import type { ActionEvent, AuditAgent, AuditAgentStatus, AuditReproduction, AuditState, EvidenceArtifact, Finding, Run } from '../shared/types';
import { ArtifactImage, ArtifactLink, EmptyState, ErrorNotice, RunDuration, SectionTitle, Status } from './components';
import { artifactUrl, clock, dateTime, isActive, runHash, shortId } from './lib';
import './audit.css';
import { CopyFixPrompt, isErrorEvent } from './CopyFixPrompt';

export interface AuditRunProps {
  run: Run;
  onCancel: () => void;
  cancelling: boolean;
  connection: string;
  actionError: string | null;
}

const AGENT_STATUS: Record<AuditAgentStatus, string> = {
  queued: 'Queued', 'signing-up': 'Signing up', running: 'Exploring', reviewing: 'Reviewing', completed: 'Completed', blocked: 'Blocked', failed: 'Failed', cancelled: 'Cancelled', 'budget-exhausted': 'Budget exhausted',
};
const SIGNUP_STATUS: Record<AuditAgent['signup'], string> = {
  pending: 'Signup pending', verified: 'Signup verified', failed: 'Signup failed', 'verification-required': 'Confirmation required', 'local-only': 'Local-only identity',
};
const SIGNUP_DETAIL: Record<AuditAgent['signup'], string> = {
  pending: 'No verified signup result has been reported.',
  verified: 'Account signup is reported as verified by the run.',
  failed: 'Signup failed. A working account has not been verified.',
  'verification-required': 'Confirmation is required. Account access is not verified; dependent coverage may be blocked.',
  'local-only': 'Only a local identity is recorded. This does not establish a real, verified account.',
};
const TERMINAL = new Set<AuditAgentStatus>(['completed', 'blocked', 'failed', 'cancelled', 'budget-exhausted']);
const STAGES: { key: AuditState['stage']; label: string; detail: string }[] = [
  { key: 'registration', label: 'Registration', detail: 'Create & verify accounts' },
  { key: 'exploration', label: 'Exploration', detail: 'Specialist browser work' },
  { key: 'verification', label: 'Verification', detail: 'Reproduce findings' },
  { key: 'complete', label: 'Complete', detail: 'Recorded outcomes' },
];
const REPRO_STATUS: Record<AuditReproduction['status'], string> = { queued: 'Queued', running: 'Running', confirmed: 'Confirmed', 'not-reproduced': 'Not reproduced', inconclusive: 'Inconclusive' };

function timestamp(value: string) { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : 0; }
function agentName(run: Run, id?: string) { return id ? run.audit?.agents.find(agent => agent.id === id)?.name || id : 'Run system'; }
function safeWebUrl(value: string): string | undefined {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
function serialize(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2) ?? 'No details recorded.'; } catch { return 'These details could not be displayed.'; }
}

function AgentBadge({ agent }: { agent: AuditAgent }) {
  return <span className="audit-agent-status" data-state={agent.status}><Status value={AGENT_STATUS[agent.status]} /></span>;
}
function SignupBadge({ signup }: { signup: AuditAgent['signup'] }) {
  return <span className="audit-signup" data-signup={signup}>{signup === 'verified' && <CheckCircle size={12} />}{SIGNUP_STATUS[signup]}</span>;
}
function RecordedTime({ value, fallback = 'Not recorded' }: { value?: string; fallback?: string }) {
  return value ? <time dateTime={value} title={value}>{dateTime(value)}</time> : <span className="audit-muted">{fallback}</span>;
}

function ArtifactRow({ artifact, showActor = false, run }: { artifact: EvidenceArtifact; showActor?: boolean; run: Run }) {
  const href = artifactUrl(artifact);
  return <div className="audit-artifact-row"><div><ArtifactLink artifact={artifact} /><span className="audit-artifact-meta">{artifact.kind}{showActor && <> · {agentName(run, artifact.actorId)}</>} · <time dateTime={artifact.timestamp} title={dateTime(artifact.timestamp)}>{clock(artifact.timestamp)}</time></span></div>{href && <a className="audit-download" href={href} download target="_blank" rel="noreferrer" aria-label={`Download ${artifact.label}`} title="Download artifact"><DownloadSimple size={17} /></a>}</div>;
}

function ArtifactList({ artifacts, run, showActor = false }: { artifacts: EvidenceArtifact[]; run: Run; showActor?: boolean }) {
  const [limit, setLimit] = useState(15);
  return artifacts.length ? <div className="audit-artifact-list">{artifacts.slice(0, limit).map(artifact => <ArtifactRow artifact={artifact} run={run} showActor={showActor} key={artifact.id} />)}{artifacts.length > limit && <button className="audit-load-more" type="button" onClick={() => setLimit(value => value + 30)}>Show more artifacts <span>{artifacts.length - limit} remaining</span><ArrowDown size={14} /></button>}</div> : <p className="audit-empty-copy">No matching artifacts have been recorded.</p>;
}

function AgentInspector({ agent, run }: { agent: AuditAgent; run: Run }) {
  const artifacts = useMemo(() => run.artifacts.filter(artifact => artifact.actorId === agent.id).sort((a, b) => timestamp(b.timestamp) - timestamp(a.timestamp)), [run.artifacts, agent.id]);
  const screenshot = artifacts.find(artifact => artifact.id === agent.screenshotId && artifact.kind === 'screenshot') || artifacts.find(artifact => artifact.kind === 'screenshot');
  const traces = artifacts.filter(artifact => artifact.kind === 'trace' || artifact.kind === 'log');
  const findings = run.findings.filter(finding => finding.actorIds?.includes(agent.id));
  return <>
    <div className="audit-inspector-heading"><div><span className="audit-eyebrow">AGENT INSPECTOR</span><h3>{agent.name}</h3><p>{agent.focus}</p></div><AgentBadge agent={agent} /></div>
    <div className="audit-inspector-action"><span className="audit-label">{TERMINAL.has(agent.status) ? 'LAST REPORTED ACTION' : 'CURRENT ACTION'}</span><p>{agent.currentAction || 'No action reported yet.'}</p></div>
    <figure className="audit-snapshot">{screenshot ? <ArtifactImage key={`${agent.id}-${screenshot.id}`} artifact={screenshot} /> : <div className="audit-snapshot-empty"><ImageSquare size={28} /><strong>No recorded snapshot</strong><p>{isActive(run.status) && !TERMINAL.has(agent.status) ? 'A browser capture will appear when this agent supplies one.' : 'No screenshot artifact is available for this agent.'}</p></div>}<figcaption><span>{screenshot ? screenshot.label : 'Screenshots are captured after real browser actions.'}</span>{screenshot && <time dateTime={screenshot.timestamp} title={dateTime(screenshot.timestamp)}>{clock(screenshot.timestamp)}</time>}</figcaption></figure>
    <div className="audit-inspector-body">
      <div className="audit-signup-detail"><SignupBadge signup={agent.signup} /><p>{SIGNUP_DETAIL[agent.signup]}</p></div>
      {agent.error && <><div className="audit-agent-error" role="status"><WarningCircle size={16} /><p>{agent.error}</p></div><CopyFixPrompt run={run} error={agent.error} context={`Agent ${agent.id}: ${agent.name}. Last action: ${agent.currentAction || 'not recorded'}. Session: ${agent.sessionId || 'not assigned'}.`} evidenceIds={artifacts.slice(0, 5).map(artifact => artifact.id)} /></>}
      <dl className="audit-facts">
        <div><dt>Actual steps</dt><dd>{agent.stepCount.toLocaleString()} <span className="audit-muted">/ {run.audit?.maxStepsPerAgent ?? '—'} max</span></dd></div>
        <div><dt>Product interactions after signup</dt><dd>{agent.productActions === undefined ? 'Not recorded' : agent.productActions}</dd></div>
        <div><dt>Work phase</dt><dd>{agent.workPhase || agent.status}</dd></div>
        <div><dt>Viewport</dt><dd className="audit-viewport">{agent.viewport === 'mobile' ? <DeviceMobile size={14} /> : <Monitor size={14} />}{agent.viewport}</dd></div>
        <div><dt>Started</dt><dd><RecordedTime value={agent.startedAt} fallback="Not started" /></dd></div>
        <div><dt>Finished</dt><dd><RecordedTime value={agent.finishedAt} /></dd></div>
        <div className="audit-fact-wide"><dt>Synthetic identity</dt><dd>{agent.email || <span className="audit-muted">Not assigned</span>}</dd></div>
        <div className="audit-fact-wide"><dt>TrueForge session ID</dt><dd><code>{agent.sessionId || 'Not assigned'}</code></dd></div>
        <div className="audit-fact-wide"><dt>Reported tokens · input / output</dt><dd>{agent.tokens ? `${agent.tokens.input.toLocaleString()} / ${agent.tokens.output.toLocaleString()}` : <span className="audit-muted">Not reported</span>}</dd></div>
      </dl>
      {agent.summary && <div className="audit-agent-summary"><span className="audit-label">AGENT SUMMARY</span><p>{agent.summary}</p></div>}
      <details className="audit-disclosure"><summary><span>Assignment & suggested routes</span><CaretRight size={14} className="audit-chevron" /></summary><div className="audit-disclosure-body"><p>{agent.objective}</p>{agent.routes.length > 0 && <ul className="audit-route-chips">{agent.routes.map((route, index) => <li key={`${route}-${index}`}><code>{route}</code></li>)}</ul>}<p className="audit-help">Assigned routes are intended scope, not evidence of a visit.</p></div></details>
      <details className="audit-disclosure" open><summary><span>Visited URLs & coverage <small>{agent.visitedUrls.length} URLs</small></span><CaretRight size={14} className="audit-chevron" /></summary><div className="audit-disclosure-body">{agent.visitedUrls.length ? <ul className="audit-url-list">{agent.visitedUrls.map((url, index) => <li key={`${url}-${index}`}><GlobeHemisphereWest size={13} />{safeWebUrl(url) ? <a href={safeWebUrl(url)} target="_blank" rel="noreferrer">{url}<ArrowSquareOut size={12} /></a> : <code>{url}</code>}</li>)}</ul> : <p>No visited URLs reported.</p>}{agent.coverage.length > 0 ? <ul className="audit-coverage-notes">{agent.coverage.map((note, index) => <li key={index}>{note}</li>)}</ul> : <p className="audit-help">Coverage observations are not yet reported.</p>}<p className="audit-help">A visited page is not a passing check. Unvisited features remain untested.</p></div></details>
      <details className="audit-disclosure"><summary><span>Session traces & logs <small>{traces.length}</small></span><CaretRight size={14} className="audit-chevron" /></summary><ArtifactList artifacts={traces} run={run} /></details>
      <details className="audit-disclosure"><summary><span>All agent artifacts <small>{artifacts.length}</small></span><CaretRight size={14} className="audit-chevron" /></summary><ArtifactList artifacts={artifacts} run={run} /></details>
      {findings.length > 0 && <div className="audit-agent-findings"><span className="audit-label">THIS AGENT’S FINDINGS</span>{findings.map(finding => <div key={finding.id} className="audit-agent-finding"><a href={runHash(run.id, finding.id)}>{finding.title}<ArrowRight size={14} /></a><CopyFixPrompt run={run} finding={finding} /></div>)}</div>}
    </div>
  </>;
}

function AgentPool({ run }: { run: Run }) {
  const agents = run.audit?.agents ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState('all');
  const [status, setStatus] = useState('all');
  const inspector = useRef<HTMLDivElement>(null);
  const focuses = [...new Set(agents.map(agent => agent.focus))];
  const matching = agents.filter(agent => (focus === 'all' || agent.focus === focus) && (status === 'all' || agent.status === status)
    && `${agent.name} ${agent.focus} ${agent.id} ${agent.viewport}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = matching.find(agent => agent.id === selectedId) ?? matching[0];
  useEffect(() => { if (inspector.current) inspector.current.scrollTop = 0; }, [selected?.id]);
  function select(agent: AuditAgent) {
    setSelectedId(agent.id);
    if (window.matchMedia('(max-width: 1023px)').matches) { inspector.current?.focus({ preventScroll: true }); inspector.current?.scrollIntoView({ block: 'start' }); }
  }
  function resetFilters() { setQuery(''); setFocus('all'); setStatus('all'); }

  return <section className="audit-pool-section" aria-labelledby="audit-pool-title">
    <div className="audit-section-heading"><div><span className="audit-eyebrow">THE TEAM</span><h2 id="audit-pool-title">Specialist perspectives. Individual evidence.</h2><p>{agents.length} reported agents{run.audit ? ` / ${run.audit.requestedAgents} requested` : ''}. Select a specialist to inspect their browser work.</p></div><span className="audit-count">{matching.length} shown</span></div>
    <div className="audit-pool-layout">
      <div className="audit-pool-main">
        <div className="audit-pool-filters">
          <div className="audit-search"><MagnifyingGlass size={16} /><label className="sr-only" htmlFor="audit-agent-search">Search agents</label><input type="search" id="audit-agent-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find an agent, focus, or viewport…" /></div>
          <div className="audit-field"><label htmlFor="audit-agent-focus">Specialty</label><select id="audit-agent-focus" value={focus} onChange={event => setFocus(event.target.value)}><option value="all">All specialties</option>{focuses.map(value => <option key={value} value={value}>{value}</option>)}</select></div>
          <div className="audit-field"><label htmlFor="audit-agent-status">Agent status</label><select id="audit-agent-status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All states · {agents.length}</option>{Object.entries(AGENT_STATUS).map(([value, label]) => <option key={value} value={value}>{label} · {agents.filter(agent => agent.status === value).length}</option>)}</select></div>
        </div>
        {matching.length ? <ul className="audit-agent-grid" aria-label="Audit agents">{matching.map(agent => <li key={agent.id}><button className="audit-agent-card" type="button" aria-pressed={selected?.id === agent.id} aria-controls="audit-agent-inspector" onClick={() => select(agent)}>
          <span className="audit-agent-card-top"><span className="audit-agent-number">{String(agents.indexOf(agent) + 1).padStart(2, '0')}</span><span className="audit-viewport" title={`${agent.viewport} viewport`}>{agent.viewport === 'mobile' ? <DeviceMobile size={14} /> : <Monitor size={14} />}<span className="sr-only">{agent.viewport}</span></span><span className="audit-agent-step">{agent.stepCount} steps</span></span>
          <strong title={agent.name}>{agent.name}</strong><AgentBadge agent={agent} /><span className="audit-agent-action">{agent.workPhase === 'testing' ? 'Testing product · ' : agent.workPhase === 'rechecking' ? 'Rechecking · ' : ''}{agent.currentAction || (agent.status === 'queued' ? 'Awaiting an execution slot.' : 'No action reported.')}</span><SignupBadge signup={agent.signup} />{agent.productActions !== undefined && <span className="audit-help">{agent.productActions} product interactions</span>}
        </button></li>)}</ul> : <div className="audit-pool-empty"><EmptyState icon={<Browser size={26} />} title={agents.length ? 'No specialists match' : 'Waiting for agent records'}>{agents.length ? 'Try a different specialty, status, or search.' : isActive(run.status) ? 'The saved run will supply agent identities and states as they become available.' : 'This run contains no recorded audit agents.'}</EmptyState>{agents.length > 0 && <button className="text-button" type="button" onClick={resetFilters}>Clear filters</button>}</div>}
        <div className="audit-pool-legend"><span><span className="audit-legend-dot" /> Reported state only</span><span>Steps are tool work, not a timer.</span></div>
      </div>
      <div className="audit-inspector" id="audit-agent-inspector" ref={inspector} role="region" tabIndex={0} aria-label={selected ? `Details for ${selected.name}` : 'Agent inspector'}>{selected ? <AgentInspector key={selected.id} agent={selected} run={run} /> : <div className="audit-inspector-empty"><FileMagnifyingGlass size={30} /><h3>Your evidence, up close.</h3><p>Select an available agent to inspect their session, signup outcome, and recorded coverage.</p></div>}</div>
    </div>
  </section>;
}

function AuditFindings({ run }: { run: Run }) {
  const [category, setCategory] = useState('all');
  const [proof, setProof] = useState('all');
  const [limit, setLimit] = useState(12);
  const categories: { value: string; label: string }[] = [{ value: 'all', label: 'All findings' }, { value: 'functional', label: 'Functional' }, { value: 'security', label: 'Security' }, { value: 'usability', label: 'Usability' }, { value: 'accessibility', label: 'Accessibility' }, ...(run.findings.some(finding => !finding.category) ? [{ value: 'uncategorized', label: 'Uncategorized' }] : [])];
  const findings = run.findings.filter(finding => (category === 'all' || (finding.category || 'uncategorized') === category) && (proof === 'all' || finding.status === proof));
  const statuses: Finding['status'][] = ['Suspected', 'Reproducing', 'Confirmed', 'Not reproduced', 'Inconclusive'];
  return <section className="audit-findings-section">
    <SectionTitle title="Findings & observations" detail={`${run.findings.filter(finding => finding.status === 'Confirmed').length} confirmed / ${run.findings.length} recorded`} />
    <div className="audit-findings-toolbar"><div className="audit-filter-tabs" role="group" aria-label="Filter findings by category">{categories.map(item => <button type="button" key={item.value} aria-pressed={category === item.value} onClick={() => { setCategory(item.value); setLimit(12); }}>{item.label}<span>{item.value === 'all' ? run.findings.length : run.findings.filter(finding => (finding.category || 'uncategorized') === item.value).length}</span></button>)}</div><div className="audit-field"><label htmlFor="audit-finding-proof">Proof status</label><select id="audit-finding-proof" value={proof} onChange={event => { setProof(event.target.value); setLimit(12); }}><option value="all">All proof states</option>{statuses.map(value => <option key={value}>{value}</option>)}</select></div></div>
    <p className="audit-help audit-findings-note">UX entries describe observed interface behavior, not human sentiment. A suspected issue is not a confirmed vulnerability.</p>
    {findings.length ? <div className="audit-findings-grid">{findings.slice(0, limit).map(finding => {
      const available = run.artifacts.filter(artifact => finding.evidenceIds.includes(artifact.id)).length;
      return <article className="audit-finding" key={finding.id}><a className="finding-card-link" href={runHash(run.id, finding.id)}><div className="audit-finding-top"><span className="audit-category">{finding.category || 'Uncategorized'}</span><Status value={finding.severity} dot={false} /><Status value={finding.status} /></div><h3>{finding.title}<ArrowRight size={17} /></h3><div className="audit-finding-comparison"><div><span className="audit-label">EXPECTED</span><p>{finding.expected || 'Not recorded'}</p></div><div><span className="audit-label">OBSERVED</span><p>{finding.actual || 'Not recorded'}</p></div></div><div className="audit-finding-source"><span>Expectation source</span><p>{finding.expectationSource || 'Not recorded'}</p></div><div className="audit-finding-proof"><span><FileMagnifyingGlass size={14} />{finding.auditAssertion ? finding.auditAssertion.kind.replaceAll('_', ' ') : 'No assertion recorded'}</span><span>{available}/{finding.evidenceIds.length} evidence artifacts available</span></div></a><div className="finding-card-actions"><CopyFixPrompt run={run} finding={finding} /></div></article>;
    })}</div> : <EmptyState icon={<FileMagnifyingGlass size={25} />} title={run.findings.length ? 'No matching findings' : 'Evidence before conclusions.'}>{run.findings.length ? 'Choose another category or proof status to inspect the recorded findings.' : 'No findings have been recorded. That does not establish that the product passed; review actual coverage and blocked work below.'}</EmptyState>}
    {findings.length > limit && <button type="button" className="audit-load-more" onClick={() => setLimit(value => value + 12)}>Show more findings <span>{findings.length - limit} remaining</span><ArrowDown size={14} /></button>}
  </section>;
}

function Reproductions({ run }: { run: Run }) {
  const reproductions = run.audit?.reproductions ?? [];
  return <section className="audit-reproductions"><SectionTitle title="Reproduction records" detail={`${reproductions.length} attempts`} />{reproductions.length ? <div className="audit-reproduction-list">{reproductions.map(reproduction => {
    const finding = run.findings.find(item => item.id === reproduction.findingId);
    const artifacts = run.artifacts.filter(artifact => reproduction.evidenceIds.includes(artifact.id));
    const missing = reproduction.evidenceIds.filter(id => !artifacts.some(artifact => artifact.id === id)).length;
    return <details className="audit-reproduction" key={reproduction.id}><summary><span className="audit-repro-icon"><ListChecks size={18} /></span><span className="audit-repro-title"><strong>{finding?.title || `Finding ${shortId(reproduction.findingId)}`}</strong><span>{agentName(run, reproduction.agentId)}</span></span><Status value={REPRO_STATUS[reproduction.status]} /><CaretRight size={14} className="audit-chevron" /></summary><div className="audit-repro-body"><p>{reproduction.details || 'No reproduction details have been reported.'}</p><dl className="audit-facts"><div><dt>Record ID</dt><dd><code>{reproduction.id}</code></dd></div><div><dt>Agent ID</dt><dd><code>{reproduction.agentId}</code></dd></div><div className="audit-fact-wide"><dt>Session ID</dt><dd><code>{reproduction.sessionId || 'Not assigned'}</code></dd></div></dl><a className="text-button" href={runHash(run.id, reproduction.findingId)}>Inspect finding <ArrowRight size={14} /></a><ArtifactList artifacts={artifacts} run={run} />{missing > 0 && <p className="audit-help">{missing} referenced evidence artifacts are not available in this run.</p>}</div></details>;
  })}</div> : <p className="audit-empty-copy">No reproduction attempts recorded. Findings remain in their reported proof state.</p>}<p className="audit-help">“Not reproduced” and “inconclusive” are reproduction outcomes, not product-wide passing results.</p></section>;
}

function TimelineEvent({ event, run }: { event: ActionEvent; run: Run }) {
  const [open, setOpen] = useState(false);
  return <details className="audit-event" onToggle={change => setOpen(change.currentTarget.open)}>
    <summary><time dateTime={event.timestamp} title={dateTime(event.timestamp)}>{clock(event.timestamp)}</time><span className="audit-event-node" /><span className="audit-event-content"><span className="audit-event-labels"><strong>{agentName(run, event.actorId)}</strong><span>{event.type}</span></span><span className="audit-event-message">{event.message}</span></span><CaretRight size={13} className="audit-chevron" /></summary>
    {open && <div className="audit-event-body">
      <dl className="audit-facts"><div><dt>Phase</dt><dd>{event.phase}</dd></div><div><dt>Timestamp</dt><dd><RecordedTime value={event.timestamp} /></dd></div><div className="audit-fact-wide"><dt>Event ID</dt><dd><code>{event.id}</code></dd></div>{event.actorId && <div className="audit-fact-wide"><dt>Agent ID</dt><dd><code>{event.actorId}</code></dd></div>}{event.sessionId && <div className="audit-fact-wide"><dt>Session ID</dt><dd><code>{event.sessionId}</code></dd></div>}</dl>
      {event.details !== undefined && event.details !== null ? <pre>{serialize(event.details)}</pre> : <p className="audit-help">No additional tool details were recorded.</p>}
      {isErrorEvent(event) && <CopyFixPrompt run={run} event={event} />}
      {event.artifactIds.length > 0 && <><ArtifactList artifacts={run.artifacts.filter(artifact => event.artifactIds.includes(artifact.id))} run={run} />{event.artifactIds.some(id => !run.artifacts.some(artifact => artifact.id === id)) && <p className="audit-help">Some referenced artifacts are not available in this run.</p>}</>}
    </div>}
  </details>;
}

function AuditTimeline({ run }: { run: Run }) {
  const [actor, setActor] = useState('all');
  const [grouped, setGrouped] = useState(true);
  const [limit, setLimit] = useState(30);
  const actorIds = [...new Set([...(run.audit?.agents.map(agent => agent.id) ?? []), ...run.events.flatMap(event => event.actorId ? [event.actorId] : [])])];
  const events = useMemo(() => run.events.filter(event => actor === 'all' || (actor === 'system' ? !event.actorId : event.actorId === actor)).sort((a, b) => timestamp(b.timestamp) - timestamp(a.timestamp)), [run.events, actor]);
  const visible = events.slice(0, limit);
  const groups = new Map<string, ActionEvent[]>();
  for (const event of visible) { const id = event.actorId || ''; groups.set(id, [...(groups.get(id) ?? []), event]); }
  return <section className="audit-timeline"><SectionTitle title="Activity trail" detail={`${run.events.length.toLocaleString()} loaded${run.eventCount !== undefined && run.eventCount > run.events.length ? ` / ${run.eventCount.toLocaleString()} total` : ''} events`} />
    <div className="audit-timeline-controls"><div className="audit-field"><label htmlFor="audit-timeline-agent">Event source</label><select id="audit-timeline-agent" value={actor} onChange={event => { setActor(event.target.value); setLimit(30); }}><option value="all">All agents & system</option><option value="system">Run system</option>{actorIds.map(id => <option key={id} value={id}>{agentName(run, id)}</option>)}</select></div><div className="audit-filter-tabs" role="group" aria-label="Timeline grouping"><button type="button" aria-pressed={!grouped} onClick={() => setGrouped(false)}>Latest</button><button type="button" aria-pressed={grouped} onClick={() => setGrouped(true)}>By agent</button></div></div>
    <p className="audit-timeline-caption"><ArrowDown size={12} /> {grouped ? 'Groups ordered by latest activity · newest events first' : 'Newest events first'}<span>{visible.length} shown</span></p>
    {events.length ? grouped ? <div>{[...groups].map(([id, items]) => <section className="audit-event-group" key={id}><h3>{agentName(run, id || undefined)}<span>{items.length} shown</span></h3>{items.map(event => <TimelineEvent key={event.id} event={event} run={run} />)}</section>)}</div> : <div>{visible.map(event => <TimelineEvent key={event.id} event={event} run={run} />)}</div> : <EmptyState icon={<TerminalWindow size={24} />} title="No recorded activity in this view">Actual actions and tool results appear here when supplied by the run. Choose another event source to inspect its activity.</EmptyState>}
    {events.length > limit && <button className="audit-load-more" type="button" onClick={() => setLimit(value => value + 30)}>Load earlier events <span>{events.length - limit} remaining</span><ArrowDown size={14} /></button>}
    {run.eventCount !== undefined && run.eventCount > run.events.length && <p className="audit-help">This response contains a partial event history. Saved trace and log artifacts may contain additional activity.</p>}
  </section>;
}

function Coverage({ run }: { run: Run }) {
  const agents = run.audit?.agents ?? [];
  const urls = new Set(agents.flatMap(agent => agent.visitedUrls));
  const restricted = agents.filter(agent => ['blocked', 'failed', 'budget-exhausted', 'cancelled'].includes(agent.status) || ['verification-required', 'local-only', 'failed'].includes(agent.signup));
  const unreported = Math.max(0, (run.audit?.requestedAgents ?? 0) - agents.length);
  return <aside className="audit-coverage"><SectionTitle title="Coverage & limits" /><div className="audit-coverage-head"><GlobeHemisphereWest size={23} /><div><strong>{urls.size}</strong><span>distinct visited URLs reported</span></div></div><p className="audit-coverage-intro">A visit establishes reachability, not correctness. Unvisited features, restricted sessions, and checks without evidence remain unknown.</p>
    <div className="audit-coverage-scope"><span className="audit-label">RESTRICTED OR INTERRUPTED WORK</span>{restricted.length ? <ul className="audit-restriction-list">{restricted.map(agent => <li key={agent.id}><div><strong>{agent.name}</strong><AgentBadge agent={agent} /></div><p>{agent.error || (agent.signup !== 'verified' ? SIGNUP_DETAIL[agent.signup] : agent.summary || `Agent work ended with status: ${AGENT_STATUS[agent.status].toLowerCase()}. Review its recorded coverage.`)}</p></li>)}</ul> : <p className="audit-help">No restricted agent outcomes reported so far. This is not evidence of complete coverage.</p>}{unreported > 0 && <p className="audit-help">{unreported} requested agents do not yet have a state record.</p>}</div>
    {run.limitations && run.limitations.length > 0 && <div className="audit-coverage-scope"><span className="audit-label">RUN LIMITATIONS</span><ul className="audit-coverage-notes">{run.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></div>}
    <div className="audit-coverage-scope"><span className="audit-label">EXPLICIT CHECK RESULTS</span>{run.checks?.length ? <div className="audit-checks">{run.checks.map((check, index) => <div key={`${check.name}-${index}`}><div><strong>{check.name}</strong><Status value={check.status} /></div><p>{check.observed}</p></div>)}</div> : <p className="audit-help">No standalone pass/fail checks reported. Agent completion alone does not count as a passing product check.</p>}</div>
  </aside>;
}

function AllArtifacts({ run }: { run: Run }) {
  const [open, setOpen] = useState(false);
  const [actor, setActor] = useState('all');
  const [kind, setKind] = useState('all');
  const actorIds = [...new Set(run.artifacts.flatMap(artifact => artifact.actorId ? [artifact.actorId] : []))];
  const artifacts = run.artifacts.filter(artifact => (actor === 'all' || (actor === 'system' ? !artifact.actorId : artifact.actorId === actor)) && (kind === 'all' || artifact.kind === kind));
  return <details className="audit-all-artifacts" onToggle={event => setOpen(event.currentTarget.open)}><summary><DownloadSimple size={19} /><span>Evidence library<small>Download original screenshots, traces, and tool records</small></span><span className="audit-count">{run.artifacts.length}</span><CaretRight size={15} className="audit-chevron" /></summary>{open && <div className="audit-evidence-body"><div className="audit-evidence-filters"><div className="audit-field"><label htmlFor="audit-artifact-agent">Artifact source</label><select id="audit-artifact-agent" value={actor} onChange={event => setActor(event.target.value)}><option value="all">All sources</option><option value="system">Run system / unattributed</option>{actorIds.map(id => <option key={id} value={id}>{agentName(run, id)}</option>)}</select></div><div className="audit-field"><label htmlFor="audit-artifact-kind">Artifact type</label><select id="audit-artifact-kind" value={kind} onChange={event => setKind(event.target.value)}><option value="all">All types</option>{(['screenshot', 'trace', 'log', 'network', 'assertion', 'test'] as const).map(value => <option key={value} value={value}>{value}</option>)}</select></div></div><ArtifactList key={`${actor}-${kind}`} artifacts={artifacts} run={run} showActor /></div>}</details>;
}

function AuditWorkspace({ run, onCancel, cancelling, connection, actionError }: AuditRunProps) {
  const audit = run.audit;
  const agents = audit?.agents ?? [];
  const active = isActive(run.status);
  const completed = agents.filter(agent => agent.status === 'completed').length;
  const settled = agents.filter(agent => TERMINAL.has(agent.status)).length;
  const queued = agents.filter(agent => agent.status === 'queued').length;
  const working = agents.filter(agent => ['signing-up', 'running', 'reviewing'].includes(agent.status)).length;
  const steps = agents.reduce((total, agent) => total + agent.stepCount, 0);
  const tokens = run.tokens ? run.tokens.input + run.tokens.output : undefined;
  const exportUrl = useRef<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  useEffect(() => () => { if (exportUrl.current) URL.revokeObjectURL(exportUrl.current); }, []);
  function downloadRun() {
    setExportError(null);
    try {
      if (exportUrl.current) URL.revokeObjectURL(exportUrl.current);
      exportUrl.current = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = exportUrl.current;
      link.download = `probe-audit-${run.id.replace(/[^a-z0-9_-]/gi, '-')}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch { setExportError('The run record could not be downloaded. Try again from the saved run.'); }
  }
  const connectionLabel = connection === 'live' ? active ? 'Live updates' : 'Synced' : connection === 'connecting' ? 'Connecting' : connection === 'reconnecting' ? 'Reconnecting' : connection === 'offline' ? 'Updates paused' : connection || 'Connection unknown';

  return <div className="audit-page audit-run">
    <header className="audit-heading audit-run-heading"><div><span className="audit-eyebrow"><span className="audit-cross" aria-hidden="true" /> {active ? 'AUDIT IN PROGRESS' : 'RECORDED AUDIT'}<span className="audit-heading-id" title={run.id}>{shortId(run.id)}</span></span><h1>{run.name || 'Full-product audit'}</h1><p>{run.goal || 'No investigation goal recorded.'}</p></div><div className="audit-heading-actions"><Status value={run.status} /><div><button type="button" className="button button-secondary button-small" onClick={downloadRun}><DownloadSimple size={15} />Export record</button>{active && <button type="button" className="button button-secondary button-small" onClick={onCancel} disabled={cancelling}><Stop size={14} />{cancelling ? 'Cancelling…' : 'Cancel run'}</button>}</div></div></header>
    <div className="audit-run-target"><span><GlobeHemisphereWest size={15} /><code>{run.targetUrl}</code></span><span><Browser size={15} />TrueForge<span className="audit-target-divider">/</span><code>{audit?.model || 'Model not reported'}</code></span><span className="audit-connection" data-live={connection === 'live'}>{connection === 'live' ? <WifiHigh size={15} /> : <Pause size={14} />}{connectionLabel}</span></div>
    {actionError && <ErrorNotice>{actionError}</ErrorNotice>}{run.error && <><ErrorNotice>{run.error}</ErrorNotice><CopyFixPrompt run={run} error={run.error} /></>}{exportError && <ErrorNotice>{exportError}</ErrorNotice>}
    {(connection === 'offline' || connection === 'reconnecting') && <div className="audit-notice" role="status"><WarningCircle size={17} /><p>{connection === 'offline' ? 'Live updates are paused.' : 'Reconnecting to the run.'} Showing the last received agent states and evidence.</p></div>}
    {cancelling && <div className="audit-notice" role="status"><Stop size={16} /><p>Cancellation requested. Agent states stay as last reported until the server confirms the outcome.</p></div>}
    {!audit && <div className="audit-notice" role="status"><WarningCircle size={17} /><p>No audit state is present in this response. Agent counts, signup outcomes, and stage are unknown.</p></div>}
    <dl className="audit-metrics">
      <div><dt>Verified accounts</dt><dd>{audit?.accountCount ?? '—'}<small>{audit ? `/ ${audit.requestedAgents}` : ''}</small></dd><p>Backend-reported account count</p></div>
      <div><dt>Agents settled</dt><dd>{audit ? settled : '—'}<small>{audit ? `/ ${audit.requestedAgents}` : ''}</small></dd><p>{audit ? `${completed} completed · ${settled - completed} other outcomes` : 'Agent state unknown'}</p></div>
      <div><dt>Actual steps</dt><dd>{audit ? steps.toLocaleString() : '—'}</dd><p>{audit ? `${audit.maxStepsPerAgent} max per agent` : 'Step limit unknown'}</p></div>
      <div><dt>Tokens used</dt><dd className="audit-metric-tokens">{tokens === undefined ? 'Not reported' : tokens.toLocaleString()}</dd><p>{audit ? audit.maxTotalTokens == null ? 'Unlimited token budget' : `${audit.maxTotalTokens.toLocaleString()} historical budget` : 'Token policy unknown'}</p></div>
      <div><dt>Duration</dt><dd><RunDuration run={run} /></dd><p>{audit ? `${audit.deadlineMinutes} min ceiling` : 'Time limit unknown'}</p></div>
      <div><dt>{active ? 'Remaining queue' : 'Queue at stop'}</dt><dd>{audit ? queued : '—'}</dd><p>{audit ? `${working} reported active · ${audit.concurrency} concurrency limit` : 'Queue unknown'}</p></div>
    </dl>
    {run.tokens && <p className="audit-token-detail">Actual token accounting: {run.tokens.input.toLocaleString()} input / {run.tokens.output.toLocaleString()} output.</p>}
    <div className="audit-stage-area"><ol className="audit-stages" aria-label={`Audit workflow; reported stage: ${audit?.stage || 'unknown'}. Stages are not passing checks.`}>{STAGES.map((stage, index) => <li key={stage.key} aria-current={audit?.stage === stage.key ? 'step' : undefined}><span className="audit-stage-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{stage.label}</strong><small>{stage.detail}</small></span></li>)}</ol>{audit && <div className="audit-completion"><div><span>Agent outcomes recorded</span><strong>{settled} / {audit.requestedAgents}</strong></div><progress max={Math.max(1, audit.requestedAgents)} value={Math.min(settled, audit.requestedAgents)} aria-label="Agents with a terminal outcome" /><p>Includes blocked, failed, cancelled, and budget-exhausted agents. Completion is not a passing verdict.</p></div>}</div>
    <div className="audit-run-times"><span>Started <RecordedTime value={run.startedAt} /></span>{run.finishedAt && <span>Finished <RecordedTime value={run.finishedAt} /></span>}</div>
    <AgentPool run={run} />
    <AuditFindings run={run} />
    <Reproductions run={run} />
    <div className="audit-report-grid"><AuditTimeline run={run} /><Coverage run={run} /></div>
    <AllArtifacts run={run} />
    <footer className="audit-footer"><span className="audit-eyebrow">PROBE / FULL-PRODUCT AUDIT</span><span><Clock size={13} />Timestamps in your local timezone</span></footer>
  </div>;
}

export function AuditRun(props: AuditRunProps) {
  return <AuditWorkspace key={props.run.id} {...props} />;
}
