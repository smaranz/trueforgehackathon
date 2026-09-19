import { useState } from 'react';
import { ArrowDown, ArrowRight, ArrowSquareOut, CaretRight, Circle, Clock, FileMagnifyingGlass, ImageSquare, ListChecks, Pause, Stop, TerminalWindow, WarningCircle, WifiHigh } from '@phosphor-icons/react';
import type { ActionEvent, Actor, Run } from '../shared/types';
import { ArtifactImage, ArtifactLink, ConnectionNotice, EmptyState, ErrorNotice, RunDuration, SectionTitle, Status } from './components';
import { clock, dateTime, initials, isActive, modeLabel, runHash, shortId } from './lib';
import type { Connection } from './useRun';
import { Verification } from './Verification';
import { AuditRun } from './AuditRun';
import { CopyFixPrompt, isErrorEvent } from './CopyFixPrompt';

interface Props {
  run: Run;
  connection: Connection;
  attempt: number;
  streamError: string | null;
  retry: () => void;
  cancelling: boolean;
  verifying: boolean;
  actionError: string | null;
  onCancel: () => void;
  onVerify: () => void;
}

function ActorPanel({ actor, run }: { actor: Actor; run: Run }) {
  const screenshot = run.artifacts.find(artifact => artifact.id === actor.screenshotId && artifact.kind === 'screenshot');
  return <article className="actor-panel"><div className="actor-panel-header"><span className={`avatar avatar-${actor.role}`}>{initials(actor.name)}</span><div className="actor-identity"><strong>{actor.name}</strong><span>{run.scenario === 'signup-surface' ? 'Unauthenticated visitor' : actor.role}</span></div><Status value={actor.status} /></div>
    <div className="actor-snapshot">{screenshot ? <ArtifactImage key={screenshot.id} artifact={screenshot} /> : <div className="waiting-snapshot"><span className="snapshot-outline"><ImageSquare size={25} /></span><strong>{isActive(run.status) ? 'Waiting for the first snapshot' : 'No snapshot captured'}</strong><span>{isActive(run.status) ? 'Browser evidence will appear after an action.' : 'This actor has no screenshot artifact in this run.'}</span></div>}</div>
    <div className="actor-caption"><span>{screenshot ? <><span className="snapshot-label">Snapshot after action</span>{screenshot.label}</> : actor.currentAction || 'No action reported'}</span>{screenshot && <time className="mono" dateTime={screenshot.timestamp} title={dateTime(screenshot.timestamp)}>{clock(screenshot.timestamp)}</time>}</div>{screenshot && actor.currentAction && <p className="actor-current-action"><span>Latest action</span>{actor.currentAction}</p>}<div className="actor-session"><span>SESSION</span><code title={actor.sessionId}>{actor.sessionId || 'Not assigned yet'}</code></div>
  </article>;
}

function EventRow({ event, run, index }: { event: ActionEvent; run: Run; index: number }) {
  const artifacts = run.artifacts.filter(artifact => event.artifactIds.includes(artifact.id));
  const hasDetails = event.details !== undefined && event.details !== null;
  const detail = hasDetails ? typeof event.details === 'string' ? event.details : JSON.stringify(event.details, null, 2) : '';
  return <details className="event-row"><summary><span className="event-node"><span /></span><time dateTime={event.timestamp} className="event-time mono">{clock(event.timestamp)}</time><div className="event-content"><div className="event-labels"><span className={`event-actor ${event.actor || 'system'}`}>{event.actor || 'System'}</span><span className="event-type">{event.type}</span></div><p>{event.message}</p></div><span className="event-number mono">{String(index + 1).padStart(2, '0')}</span><CaretRight className="event-chevron" size={14} /></summary><div className="event-expanded"><dl><div><dt>Phase</dt><dd>{event.phase}</dd></div>{event.sessionId && <div><dt>Session</dt><dd className="mono">{event.sessionId}</dd></div>}<div><dt>Event ID</dt><dd className="mono">{event.id}</dd></div></dl>{hasDetails ? <pre>{detail}</pre> : <p className="muted">No additional tool details for this event.</p>}{isErrorEvent(event) && <CopyFixPrompt run={run} event={event} />}{artifacts.length > 0 && <div className="event-artifacts">{artifacts.map(artifact => <ArtifactLink key={artifact.id} artifact={artifact} />)}</div>}</div></details>;
}

export function RunTimeline({ run }: { run: Run }) {
  const [filter, setFilter] = useState<'all' | 'owner' | 'editor' | 'viewer' | 'system'>('all');
  const filters = ['all', 'owner', 'editor', ...(run.events.some(event => event.actor === 'viewer') ? ['viewer' as const] : []), 'system'] as const;
  const events = run.events.filter(event => filter === 'all' || (filter === 'system' ? !event.actor : event.actor === filter));
  return <section className="timeline-section"><SectionTitle title="Run timeline" detail={`${run.events.length} events`} /><div className="timeline-toolbar"><div className="filter-group" role="group" aria-label="Filter timeline">{filters.map(value => <button key={value} type="button" aria-pressed={filter === value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value === 'all' ? 'All events' : value}</button>)}</div><span className="timeline-order"><ArrowDown size={12} /> Oldest first</span></div>
    {events.length ? <div className="timeline-list">{events.map(event => <EventRow key={event.id} event={event} run={run} index={run.events.indexOf(event)} />)}</div> : <EmptyState icon={<TerminalWindow size={25} />} title={run.events.length ? 'No matching events' : 'The story starts here'}>{run.events.length ? 'Choose another actor to view their events.' : isActive(run.status) ? 'Actions, tool results, and evidence will appear as the run progresses.' : 'No events were recorded for this run.'}</EmptyState>}
  </section>;
}

function FindingsList({ run }: { run: Run }) {
  return <section className="findings-section"><SectionTitle title="Findings"><span className="count-badge mono">{run.findings.length}</span></SectionTitle>{run.findings.length ? <div className="findings-list">{run.findings.map((finding, index) => <article className="finding-card" key={finding.id}><a className="finding-card-link" href={runHash(run.id, finding.id)}><div className="finding-card-top"><span className="eyebrow">FINDING {String(index + 1).padStart(2, '0')}</span><Status value={finding.severity} dot={false} /></div><h3>{finding.title}</h3><p>{finding.actual}</p><div className="finding-card-bottom"><Status value={finding.status} /><ArrowRight size={18} /></div></a><div className="finding-card-actions"><CopyFixPrompt run={run} finding={finding} /></div></article>)}</div> : <EmptyState icon={<FileMagnifyingGlass size={25} />} title={isActive(run.status) ? 'Evidence before conclusions.' : 'No findings recorded'}>{isActive(run.status) ? 'Findings appear when there is something to inspect. Nothing is assumed.' : run.status === 'completed' ? 'This run completed without a reported finding. Review the timeline for the checks performed.' : 'Check the run status and timeline for what happened.'}</EmptyState>}
    <div className="run-context"><span className="eyebrow">RUN CONTEXT</span><dl><div><dt>Scenario</dt><dd>{run.scenario === 'signup-surface' ? 'Signup surface checks' : 'Revoked access'}</dd></div><div><dt>Mode</dt><dd>{modeLabel(run.mode)}</dd></div>{run.variant && <div><dt>Prepared variant</dt><dd className="capitalize">{run.variant}</dd></div>}<div><dt>Started</dt><dd>{dateTime(run.startedAt)}</dd></div>{run.finishedAt && <div><dt>Finished</dt><dd>{dateTime(run.finishedAt)}</dd></div>}</dl><p>{run.variant ? 'Variants are operator-provided demo fixtures.' : 'Explicitly authorized local target. No account creation.'}</p></div>
  </section>;
}

const phases = [
  { key: 'preconditions', label: 'Set up' },
  { key: 'share', label: 'Share' },
  { key: 'open', label: 'Open' },
  { key: 'revoke', label: 'Revoke' },
  { key: 'check', label: 'Check' },
  { key: 'assess', label: 'Assess' },
  { key: 'reproduce', label: 'Reproduce' },
  { key: 'verify', label: 'Verify' },
  { key: 'complete', label: 'Complete' },
] as const;

function PhaseTrack({ run }: { run: Run }) {
  const observed = new Set(run.events.map(event => event.phase));
  const visiblePhases = run.scenario === 'signup-surface' ? phases.filter(phase => ['preconditions', 'check', 'complete'].includes(phase.key)) : phases;
  return <div className="phase-track" role="list" aria-label={`Run phases. Current phase: ${run.phase}. Highlighted steps have recorded events, not necessarily passing checks.`}>{visiblePhases.map((phase, index) => <div key={phase.key} role="listitem" aria-current={run.phase === phase.key ? 'step' : undefined} className={`phase-step ${run.phase === phase.key ? 'current' : observed.has(phase.key) ? 'observed' : ''}`}><span className="phase-marker">{run.phase === phase.key && isActive(run.status) ? <Circle size={9} weight="fill" /> : <span className="mono">{index + 1}</span>}</span><span>{phase.label}</span></div>)}</div>;
}

export function RunDetail({ run, connection, attempt, streamError, retry, cancelling, verifying, actionError, onCancel, onVerify }: Props) {
  if (run.scenario === 'full-audit') return <><ConnectionNotice connection={connection} attempt={attempt} retry={retry} />{streamError && <ErrorNotice onRetry={retry}>{streamError}</ErrorNotice>}<AuditRun run={run} connection={connection} cancelling={cancelling} onCancel={onCancel} actionError={actionError} /></>;
  const active = isActive(run.status);
  return <div className="run-detail-page"><div className="run-heading"><div><div className="eyebrow"><span className={`health-dot ${active ? 'available' : ''}`} />{active ? 'LIVE RUN' : 'RECORDED RUN'}<span className="eyebrow-divider">/</span><span className="mono" title={run.id}>{shortId(run.id)}</span></div><h1>{run.name || 'Revoked-access investigation'}</h1><p>{run.goal}</p></div><div className="run-heading-actions"><Status value={run.status} />{active && <button className="button button-secondary button-small" onClick={onCancel} disabled={cancelling} type="button"><Stop size={14} />{cancelling ? 'Cancelling…' : 'Cancel run'}</button>}{!active && <a className="button button-secondary button-small" href="#new">New run<ArrowRight size={14} /></a>}</div></div>
    <div className="run-target"><span><GlobeIcon />{run.targetUrl}</span><span className="run-target-mode">{run.mode === 'trueforge' ? 'TrueForge agent' : 'Deterministic proof'}<span>·</span><span className="capitalize">{run.variant ? `${run.variant} fixture` : 'Read-only signup check'}</span></span></div>
    {actionError && <ErrorNotice>{actionError}</ErrorNotice>}
    {run.error && <><ErrorNotice>{run.error}</ErrorNotice><CopyFixPrompt run={run} error={run.error} /></>}
    {!active && run.mode === 'trueforge' && <div className="notice notice-warning"><InfoIcon /><span>These actor browsers are closed. You can request a <strong>fresh signup check</strong> in the saved chat or <a href="#new/signup">open the signup test profile</a>. The original authenticated browsers are never reused. Use the saved <strong>probe</strong> agent in TrueForge for a new coordinated demo.</span></div>}
    {run.checks && <section className="surface-checks"><SectionTitle title="Signup surface checks" detail={`${run.checks.filter(check => check.status === 'passed').length}/${run.checks.length} passed`} />{run.checks.map(check => <div className="surface-check-row" key={check.name}><div><strong>{check.name}</strong><p>{check.observed}</p></div><Status value={check.status} /></div>)}{run.limitations && <div className="surface-limitations"><strong>Scope of this check</strong><ul>{run.limitations.map(limit => <li key={limit}>{limit}</li>)}</ul></div>}</section>}
    <ConnectionNotice connection={connection} attempt={attempt} retry={retry} />
    {streamError && <ErrorNotice onRetry={retry}>{streamError}</ErrorNotice>}
    <div className="run-stat-strip"><div><span>Duration</span><strong className="mono"><RunDuration run={run} /></strong></div><div><span>Events</span><strong className="mono">{run.events.length}</strong></div><div><span>Findings</span><strong className="mono">{run.findings.length}</strong></div><div><span>Tokens <small>in / out</small></span><strong className={`mono ${!run.tokens ? 'stat-unavailable' : ''}`}>{run.tokens ? `${run.tokens.input.toLocaleString()} / ${run.tokens.output.toLocaleString()}` : run.mode === 'deterministic' ? 'Not used' : 'Unavailable'}</strong></div><div><span>Cost</span><strong className="stat-unavailable">Unavailable</strong></div></div>
    <PhaseTrack run={run} />
    <section className="actors-section"><SectionTitle title={run.scenario === 'signup-surface' ? 'A fresh visitor’s perspective' : 'Two sides of the same action'} detail="Snapshots after browser actions"><span className={`connection-label ${connection === 'live' ? 'green' : ''}`}>{connection === 'live' ? <WifiHigh size={15} /> : connection === 'offline' ? <Pause size={15} /> : <Circle size={12} />}{connection === 'live' ? active ? 'Live updates' : 'Synced' : connection === 'connecting' ? 'Connecting' : connection === 'offline' ? 'Paused' : 'Reconnecting'}</span></SectionTitle><div className={`actor-grid ${run.actors.length === 1 ? 'single-actor' : ''}`}>{run.actors.length ? run.actors.map(actor => <ActorPanel actor={actor} run={run} key={actor.id} />) : <div className="actors-waiting"><UsersIcon /><strong>{active ? 'Setting up actor sessions' : 'No actor sessions recorded'}</strong><p>Actor identities and snapshots appear when supplied by the run.</p></div>}</div></section>
    <div className="run-body-grid"><RunTimeline run={run} /><FindingsList run={run} /></div>
    {(run.findings.length > 0 || run.verifications.length > 0) && <Verification run={run} pending={verifying} onVerify={onVerify} />}
    {run.artifacts.length > 0 && <details className="all-artifacts"><summary><ListChecks size={17} />All run artifacts<span className="count-badge mono">{run.artifacts.length}</span><CaretRight size={14} /></summary><div className="artifact-files">{run.artifacts.map(artifact => <ArtifactLink artifact={artifact} key={artifact.id} />)}</div></details>}
    <div className="page-foot"><span>PROBE</span><span><Clock size={13} />Timestamps shown in your local timezone</span></div>
  </div>;
}

function GlobeIcon() { return <ArrowSquareOut size={14} aria-hidden="true" />; }
function UsersIcon() { return <WarningCircle size={23} aria-hidden="true" />; }
function InfoIcon() { return <WarningCircle size={18} aria-hidden="true" />; }
