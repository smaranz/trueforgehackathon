import { useEffect, useRef, useState } from 'react';
import { ArrowClockwise, ArrowLeft, ArrowUpRight, CaretRight, ClockCounterClockwise, Flask, List, Plus, Robot, TerminalWindow, X } from '@phosphor-icons/react';
import type { Run } from '../shared/types';
import { api, errorMessage } from './api';
import { Brand, ConnectionNotice, EmptyState, ErrorNotice, RunSkeleton } from './components';
import { FindingDetail } from './FindingDetail';
import { dateTime, isActive, readRoute, runHash, statusTone } from './lib';
import { NewRun } from './NewRun';
import { RunDetail } from './RunDetail';
import { useRun } from './useRun';
import { useWorkspace } from './useWorkspace';

export function App() {
  const [route, setRoute] = useState(readRoute);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [actions, setActions] = useState<Record<string, 'cancel' | 'verify'>>({});
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const pendingActions = useRef(new Set<string>());
  const main = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const workspace = useWorkspace();
  const id = route.page === 'run' ? route.id : undefined;
  const selected = useRun(id, workspace.upsertRun, workspace.refreshRuns);
  // Never flash a previous run while the selection effect is being installed.
  const run = selected.run?.id === id ? selected.run : null;
  const finding = route.page === 'run' && route.findingId ? run?.findings.find(item => item.id === route.findingId) : undefined;
  const ready = Boolean(workspace.health?.trueforge.reachable && workspace.health.trueforge.ready);

  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, '', '#new');
    const navigate = () => {
      setRoute(readRoute());
      setNavigationOpen(false);
      setActionError(null);
      window.scrollTo(0, 0);
      main.current?.focus({ preventScroll: true });
    };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);

  useEffect(() => {
    document.title = `${route.page === 'new' ? 'New run' : finding?.title || run?.name || 'Run workspace'} · Probe`;
  }, [route.page, finding?.title, run?.name]);

  function started(value: Run) {
    workspace.upsertRun(value);
    window.location.hash = runHash(value.id);
  }

  async function performAction(type: 'cancel' | 'verify') {
    if (!run || pendingActions.current.has(run.id)) return;
    const runId = run.id;
    pendingActions.current.add(runId);
    setActions(previous => ({ ...previous, [runId]: type }));
    setActionError(null);
    try {
      const result = await api[type](runId);
      workspace.upsertRun(result);
      selected.accept(result);
    } catch (cause) {
      setActionError({ id: runId, message: errorMessage(cause) });
    } finally {
      pendingActions.current.delete(runId);
      setActions(previous => {
        const next = { ...previous };
        delete next[runId];
        return next;
      });
    }
  }

  const verifying = Boolean(id && actions[id] === 'verify');
  const cancelling = Boolean(id && actions[id] === 'cancel');
  const currentActionError = actionError?.id === id ? actionError?.message ?? null : null;

  return <div className="app-shell">
    <a className="skip-link" href="#workspace" onClick={event => { event.preventDefault(); main.current?.focus(); }}>Skip to workspace</a>
    <aside className={`app-sidebar ${navigationOpen ? 'navigation-open' : ''}`} aria-label="Workspace navigation" onKeyDown={event => {
      if (event.key === 'Escape') { setNavigationOpen(false); menuButton.current?.focus(); }
    }}>
      <div className="sidebar-brand-row"><Brand /><button ref={menuButton} type="button" className="icon-button mobile-menu" aria-label={navigationOpen ? 'Close run history' : 'Open run history'} aria-expanded={navigationOpen} aria-controls="sidebar-content" onClick={() => setNavigationOpen(value => !value)}>{navigationOpen ? <X size={22} /> : <List size={22} />}</button></div>
      <div id="sidebar-content" className="sidebar-content">
        <a href="#new" className={`new-run-link ${route.page === 'new' ? 'selected' : ''}`} aria-current={route.page === 'new' ? 'page' : undefined} onClick={() => setNavigationOpen(false)}><Plus size={18} /><span>New run</span><ArrowUpRight size={16} /></a>
        <div className="history-heading"><span className="eyebrow">RUN HISTORY</span>{(workspace.runs.length > 0 || (!workspace.runsLoading && !workspace.runsError)) && <span className="history-count mono">{workspace.runs.length}</span>}<button className="icon-button" type="button" aria-label="Refresh run history" disabled={workspace.runsLoading} onClick={() => void workspace.refreshRuns()}><ArrowClockwise size={15} /></button></div>
        <nav className="run-history" aria-label="Run history" aria-busy={workspace.runsLoading}>
          {workspace.runsError && <div className="history-error" role="status"><strong>History unavailable</strong><p>{workspace.runsError}</p><button type="button" className="text-button" onClick={() => void workspace.refreshRuns()} disabled={workspace.runsLoading}>Try again<ArrowClockwise size={13} /></button></div>}
          {workspace.runsLoading && !workspace.runs.length && !workspace.runsError ? <div className="history-skeleton" aria-label="Loading history">{[0, 1, 2].map(item => <div key={item} className="skeleton" />)}</div> : !workspace.runs.length && !workspace.runsError ? <div className="history-empty"><ClockCounterClockwise size={22} /><strong>A clean slate.</strong><p>Your investigations will live here. Start your first run to build a history.</p></div> : workspace.runs.map(item => <a key={item.id} href={runHash(item.id)} className={`history-item ${id === item.id ? 'selected' : ''}`} aria-current={id === item.id ? 'page' : undefined} onClick={() => setNavigationOpen(false)}>
            <div className="history-item-title"><span className={`history-dot tone-${statusTone(item.status)}`} /><strong>{item.name || 'Revoked-access investigation'}</strong></div>
            <div className="history-item-meta"><span>{item.mode === 'trueforge' ? <Robot size={12} /> : <TerminalWindow size={12} />}{item.status}</span><time dateTime={item.startedAt}>{dateTime(item.startedAt)}</time></div>
          </a>)}
        </nav>
        <div className="sidebar-bottom"><div className="sidebar-note"><span className="sidebar-note-mark" aria-hidden="true">↳</span><p>Good software considers<br /><strong>both sides of the story.</strong></p></div><div className="sidebar-service"><span className={`health-dot ${ready ? 'available' : ''}`} /><div><strong>{workspace.healthLoading ? 'Checking TrueForge' : ready ? 'TrueForge configured' : 'TrueForge unavailable'}</strong><span>{workspace.health?.trueforge.model || 'Local agent service'}</span></div><button type="button" className="icon-button" onClick={() => void workspace.refreshHealth()} disabled={workspace.healthLoading} aria-label="Recheck TrueForge health"><ArrowClockwise size={14} /></button></div><div className="sidebar-version"><span>LOCAL WORKSPACE</span><span className="mono">{workspace.health?.version ? `v${workspace.health.version}` : 'PROBE'}</span></div></div>
      </div>
    </aside>

    <div className="workspace-shell">
      <header className="workspace-header"><nav className="breadcrumbs" aria-label="Breadcrumb"><a href="#new">Workspace</a><CaretRight size={12} />{route.page === 'new' ? <span aria-current="page">New run</span> : <><a href={runHash(route.id)} aria-current={!route.findingId ? 'page' : undefined}>Run detail</a>{route.findingId && <><CaretRight size={12} /><span aria-current="page">Finding</span></>}</>}</nav><span className="workspace-context"><Flask size={15} />Authorized local targets<span className="header-divider" />Multi-agent testing</span></header>
      <main className="workspace-main" id="workspace" tabIndex={-1} ref={main}>
        {run && route.page === 'run' && route.findingId && <ConnectionNotice connection={selected.connection} attempt={selected.attempt} retry={selected.retry} />}
        {route.page === 'new' ? <NewRun health={workspace.health} healthLoading={workspace.healthLoading} healthError={workspace.healthError} refreshHealth={() => void workspace.refreshHealth()} onStarted={started} /> : !run ? <>
          {selected.error ? <div className="page-error"><span className="eyebrow">RUN WORKSPACE</span><h1>We couldn’t load this run.</h1><p>The URL is saved. Retry to fetch its latest state.</p><ErrorNotice onRetry={selected.retry}>{selected.error}</ErrorNotice><a href="#new" className="back-link"><ArrowLeft size={16} />Back to new run</a></div> : <RunSkeleton />}
        </> : route.findingId ? finding ? <><div className="sr-only" role="status">Run {run.status}. Finding {finding.status}.</div>{selected.error && <ErrorNotice onRetry={selected.retry}>{selected.error}</ErrorNotice>}<FindingDetail key={finding.id} finding={finding} run={run} verifying={verifying} onVerify={() => void performAction('verify')} error={currentActionError} /></> : <div className="missing-finding"><EmptyState icon={<ClockCounterClockwise size={25} />} title="Finding not available">{isActive(run.status) ? 'This finding has not arrived yet. Return to the run to inspect its latest state.' : 'This run does not contain the finding in this URL.'}</EmptyState><a className="button button-secondary" href={runHash(run.id)}><ArrowLeft size={16} />Back to run</a></div> : <><div className="sr-only" role="status">Run {run.status}. {run.findings.length} findings.</div><RunDetail key={run.id} run={run} connection={selected.connection} attempt={selected.attempt} streamError={selected.error} retry={selected.retry} cancelling={cancelling} verifying={verifying} actionError={currentActionError} onCancel={() => void performAction('cancel')} onVerify={() => void performAction('verify')} /></>}
      </main>
    </div>
  </div>;
}
