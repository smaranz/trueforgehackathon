import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowClockwise, ArrowRight, ArrowUpRight, Brain, CheckCircle, Code, Crosshair, Flask, Gauge, Lightning, MagnifyingGlass, Play, ShieldCheck, Stop, Wrench, X } from '@phosphor-icons/react';
import type { AgentMemory, Diagnostic, WorkbenchConfig, WorkbenchJob } from '../shared/workbench';
import { Brand, ErrorNotice } from './components';
import { errorMessage } from './api';
import { dateTime, duration } from './lib';
import { workbenchApi as api } from './workbench-api';
import './workbench.css';

const selectedFromHash = () => /^#dashboard\/([a-f0-9-]{36})$/.exec(window.location.hash)?.[1];
const label = (kind: WorkbenchJob['kind']) => ({ scan: 'Page scan', investigate: 'Deep investigation', stress: 'Stress test', propose: 'Fix proposal', build: 'Build fix' })[kind];

export function Workbench() {
  const [config, setConfig] = useState<WorkbenchConfig>();
  const [jobs, setJobs] = useState<WorkbenchJob[]>([]);
  const [memory, setMemory] = useState<AgentMemory[]>([]);
  const [selectedId, setSelectedId] = useState(selectedFromHash);
  const [job, setJob] = useState<WorkbenchJob>();
  const [findingId, setFindingId] = useState<string>();
  const [target, setTarget] = useState('');
  const [prompt, setPrompt] = useState('');
  const [point, setPoint] = useState<{ x: number; y: number }>();
  const [tab, setTab] = useState<'diagnostics' | 'stress' | 'memory'>('diagnostics');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [requests, setRequests] = useState(40), [concurrency, setConcurrency] = useState(3), [rps, setRps] = useState(5);
  const lock = useRef(false);
  const screenshot = useRef<HTMLImageElement>(null);
  const current = job?.id === selectedId ? job : undefined;
  const active = jobs.find(item => item.status === 'running');
  const busy = pending || Boolean(active);
  const finding = current?.findings.find(item => item.id === findingId) || current?.findings[0];
  const falsePositives = current?.findings.filter(item => item.feedback?.verdict === 'false-positive').length || 0;

  const refresh = useCallback(async () => {
    const [configuration, history, learned] = await Promise.all([api.config(), api.jobs(), api.memory()]);
    setConfig(configuration); setJobs(history); setMemory(learned); setTarget(value => value || configuration.targetUrl);
  }, []);
  useEffect(() => { let alive = true; void refresh().catch(cause => { if (alive) setError(errorMessage(cause)); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [refresh]);
  useEffect(() => {
    document.title = 'Diagnostics & repairs · Probe';
    const update = () => { setSelectedId(selectedFromHash()); setFindingId(undefined); setPoint(undefined); setError(undefined); };
    window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    if (!selectedId) { setJob(undefined); return; }
    const controller = new AbortController();
    void api.job(selectedId, controller.signal).then(value => { setJob(value); setTarget(value.targetUrl); }).catch(cause => { if (!controller.signal.aborted) setError(errorMessage(cause)); });
    return () => controller.abort();
  }, [selectedId]);
  useEffect(() => {
    if (!active && current?.status !== 'running') return;
    let alive = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const history = await api.jobs(); if (!alive) return; setJobs(history);
        if (selectedId) { const latest = await api.job(selectedId); if (alive) setJob(latest); }
      } catch (cause) { if (alive) setError(errorMessage(cause)); }
      if (alive) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 1000); return () => { alive = false; clearTimeout(timer); };
  }, [active?.id, current?.status, selectedId]);

  function accept(value: WorkbenchJob) {
    setJob(value); setJobs(previous => [value, ...previous.filter(item => item.id !== value.id)]);
    window.location.hash = `dashboard/${value.id}`; setSelectedId(value.id);
  }
  async function action(run: () => Promise<WorkbenchJob>) {
    if (lock.current) return;
    lock.current = true; setPending(true); setError(undefined);
    try { accept(await run()); } catch (cause) { setError(errorMessage(cause)); }
    finally { lock.current = false; setPending(false); }
  }
  async function feedback(verdict: 'false-positive' | 'accepted', reason: string) {
    if (!current || !finding) return;
    await action(() => api.feedback(current.id, finding.id, verdict, reason));
    try { setMemory(await api.memory()); } catch (cause) { setError(errorMessage(cause)); }
  }
  const pinAvailable = Boolean(current?.screenshotUrl && current.elements && current.targetUrl === target);
  const pinpoint = point && current?.elements?.filter(({ rect: r }) => point.x * 1280 >= r.x && point.x * 1280 <= r.x + r.width && point.y * 800 >= r.y && point.y * 800 <= r.y + r.height).sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];

  return <div className="wb-shell">
    <aside className="wb-sidebar">
      <Brand />
      <a className="wb-nav active" href="#dashboard"><Gauge size={19} />Diagnostics & repairs</a>
      <a className="wb-nav" href="#new/audit"><Flask size={19} />Multi-agent audit<ArrowUpRight size={14} /></a>
      <div className="wb-history-title"><span className="eyebrow">RECENT OPERATIONS</span><button type="button" className="icon-button" aria-label="Refresh operations" onClick={() => void refresh().catch(cause => setError(errorMessage(cause)))}><ArrowClockwise size={16} /></button></div>
      <nav className="wb-history" aria-label="Recent operations">
        {!jobs.length && <p className="muted">Your scans, investigations and builds will appear here.</p>}
        {jobs.map(item => <a key={item.id} href={`#dashboard/${item.id}`} className={selectedId === item.id ? 'selected' : ''} aria-current={selectedId === item.id ? 'page' : undefined} onClick={() => setTab(item.kind === 'stress' ? 'stress' : 'diagnostics')}><span className={`wb-dot ${item.status}`} /><div><strong>{label(item.kind)}</strong><small>{new URL(item.targetUrl).pathname} · {dateTime(item.startedAt)}</small></div></a>)}
      </nav>
      <div className="wb-local"><ShieldCheck size={20} /><div><strong>Local by design</strong><span>Loopback-only · private workspace</span></div></div>
    </aside>
    <main className="wb-main">
      <header className="wb-topbar"><span>WORKSPACE <span className="muted">/</span> DIAGNOSTICS</span><span className="wb-chip"><span className="wb-dot completed" />LOCAL ONLY</span></header>
      <div className="wb-content">
        <div className="wb-heading"><div><span className="eyebrow">FIND IT. UNDERSTAND IT. FIX IT.</span><h1>A better build starts here.</h1><p>Evidence-backed diagnostics, a second pair of eyes, and fixes you can build.</p></div><span className="wb-heading-icon"><Wrench size={28} /></span></div>
        {error && <ErrorNotice onRetry={() => { setError(undefined); void refresh().catch(cause => setError(errorMessage(cause))); }}>{error}</ErrorNotice>}
        <form className="wb-target" onSubmit={event => { event.preventDefault(); setTab('diagnostics'); void action(() => api.scan(target)); }}>
          <label htmlFor="wb-target"><span className="eyebrow">LOCAL TARGET</span><input id="wb-target" type="url" value={target} required maxLength={2000} placeholder="http://localhost:3000/signup" onChange={event => { setTarget(event.target.value); setPoint(undefined); }} /></label>
          <button className="button button-primary" disabled={busy || loading} type="submit"><MagnifyingGlass size={18} />Scan page</button>
        </form>
        <div className="wb-target-meta"><span>Approved: {config?.allowedOrigins.join(', ') || 'Loading local configuration…'}</span><span><Code size={14} />{config?.sourceConnected ? `Source: ${config.sourceLabel}` : 'Connect source to enable Build fix'}</span></div>
        <div className="wb-metrics"><div><span>Findings in this operation</span><strong>{current?.findings.length ?? '—'}</strong></div><div><span>High priority</span><strong>{current?.findings.filter(item => item.severity === 'High' && item.feedback?.verdict !== 'false-positive').length ?? '—'}</strong></div><div><span>Marked false positive</span><strong>{falsePositives}</strong></div><div><span>Lessons remembered</span><strong>{memory.length}<Brain size={21} /></strong></div></div>
        <nav className="wb-tabs" aria-label="Dashboard sections">{([{ id: 'diagnostics', name: 'Diagnostics', icon: <MagnifyingGlass size={17} /> }, { id: 'stress', name: 'Stress testing', icon: <Lightning size={17} /> }, { id: 'memory', name: 'Personal agent', icon: <Brain size={17} /> }] as const).map(item => <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}>{item.icon}{item.name}</button>)}</nav>
        {active && <div className="wb-progress" role="status"><span className="wb-spinner" /><div><strong>{label(active.kind)} in progress</strong><span>{current?.id === active.id ? current.stage : active.stage}</span></div>{current?.id !== active.id && <a href={`#dashboard/${active.id}`}>View operation</a>}<button type="button" className="button button-secondary" disabled={pending} onClick={() => void action(() => api.cancel(active.id))}><Stop size={15} />Cancel</button></div>}
        {current && current.status !== 'running' && <div className={`wb-result ${current.status}`} role="status"><strong>{current.status === 'completed' ? <CheckCircle size={18} /> : <ShieldCheck size={18} />}{current.stage}</strong><span>{current.error || `${label(current.kind)} · ${dateTime(current.startedAt)}${current.finishedAt ? ` · ${duration(new Date(current.finishedAt).getTime() - new Date(current.startedAt).getTime())}` : ''}`}</span></div>}

        {tab === 'diagnostics' && <>
          <section className="wb-investigate"><div><span className="wb-section-icon"><Crosshair size={22} /></span><h2>Think we missed something?</h2><p>Point to it on the captured page, tell your agent what seems wrong, and investigate deeper.</p></div><form onSubmit={event => { event.preventDefault(); void action(() => api.investigate({ targetUrl: target, prompt, ...(pinAvailable ? { parentId: current!.id, point } : {}) })); }}><label className="sr-only" htmlFor="wb-prompt">Describe the suspected problem</label><textarea id="wb-prompt" value={prompt} required minLength={5} maxLength={3000} placeholder="The submit button looks enabled, but I suspect this form has no accessible label…" onChange={event => setPrompt(event.target.value)} />{point && pinAvailable && <div className="wb-pin-label"><Crosshair size={14} /><code>{pinpoint?.selector || `Page at ${Math.round(point.x * 1280)}, ${Math.round(point.y * 800)}`}</code><button type="button" className="icon-button" aria-label="Clear pinpoint" onClick={() => setPoint(undefined)}><X size={14} /></button></div>}<button className="button button-secondary" type="submit" disabled={busy || !target || prompt.trim().length < 5}><Brain size={17} />Investigate deeper<ArrowRight size={16} /></button></form></section>
          {current?.screenshotUrl && <section className="wb-preview"><div className="wb-section-heading"><h2><Crosshair size={18} />Click to pinpoint</h2><span>Captured viewport · 1280 × 800</span></div><button type="button" className="wb-pin-canvas" disabled={!pinAvailable || busy} aria-label="Pinpoint a suspected issue. Click the screenshot, or use arrow keys and Enter to select a location." onKeyDown={event => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); setPoint(value => ({ x: Math.min(1, Math.max(0, (value?.x ?? .5) + (event.key === 'ArrowLeft' ? -.02 : event.key === 'ArrowRight' ? .02 : 0))), y: Math.min(1, Math.max(0, (value?.y ?? .5) + (event.key === 'ArrowUp' ? -.02 : event.key === 'ArrowDown' ? .02 : 0))) })); }
          }} onClick={event => {
            const rect = screenshot.current?.getBoundingClientRect(); if (!rect) return;
            setPoint(event.detail === 0 ? point || { x: .5, y: .5 } : { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) });
          }}><img ref={screenshot} src={current.screenshotUrl} alt="Captured target page. Select a location to focus your investigation." />{point && <span className="wb-pin" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}><Crosshair size={28} /></span>}</button><p className="field-help">This is a saved screenshot. Pinpointing maps the location to a captured DOM selector; the agent opens a fresh browser to recheck it.</p></section>}
          {current?.findings.length ? <section className="wb-findings"><div className="wb-findings-list"><div className="wb-section-heading"><h2>Findings</h2><span>{current.findings.length} observed</span></div>{current.findings.map(item => <button key={item.id} type="button" className={`wb-finding ${finding?.id === item.id ? 'selected' : ''}`} onClick={() => setFindingId(item.id)}><span className={`wb-severity ${item.severity.toLowerCase()}`}>{item.severity}</span><strong>{item.title}</strong><small>{item.feedback?.verdict === 'false-positive' ? 'Marked false positive' : item.status} · {item.category}</small></button>)}</div>{finding && <FindingPanel key={finding.id} finding={finding} busy={busy} connected={Boolean(config?.sourceConnected)} onPropose={() => void action(() => api.propose(current.id, finding.id))} onFeedback={feedback} />}</section> : !busy && <div className="wb-empty"><MagnifyingGlass size={32} /><h2>{current ? 'No findings recorded' : 'Give your app a fresh pair of eyes.'}</h2><p>{current ? 'No issues were captured in this operation. That is not a guarantee of full coverage. Describe a concern above to look deeper.' : 'Scan a local page to capture a screenshot, inspect errors and accessibility, and get actionable fixes.'}</p></div>}
          {current?.proposal && <section className="wb-proposal"><div className="wb-section-heading"><h2><Code size={19} />Proposed source fix</h2><span>{current.proposal.files.length} files</span></div><p>{current.proposal.summary}</p><pre className="wb-code" tabIndex={0}>{current.proposal.diff}</pre><div className="wb-build-bar"><p>Build and tests run in an isolated Git worktree. Passing changes are applied to your connected source.</p><button className="button button-primary" type="button" disabled={busy || current.status !== 'completed' || current.kind === 'build'} onClick={() => void action(() => api.build(current.id))}><Play size={17} weight="fill" />Build fix</button></div></section>}
          {current?.build && <section className="wb-proposal"><h2>{current.build.applied ? 'Fix applied to local source' : 'Build verification'}</h2><p>{current.build.verification}</p><ul>{current.build.changedFiles.map(path => <li key={path}><code>{path}</code></li>)}</ul><pre className="wb-code" tabIndex={0}>{current.build.log || 'Waiting for build output…'}</pre>{current.build.applied && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void action(() => api.scan(current.targetUrl))}><ArrowClockwise size={16} />Rescan live page</button>}</section>}
          {!config?.sourceConnected && <div className="wb-setup"><Code size={21} /><div><strong>Connect your app’s source to build fixes</strong><p>Set <code>PROBE_SOURCE_ROOT=/absolute/path/to/your/app</code> in <code>.env</code>, then restart Probe. The repository must be clean. Its build and test scripts verify repairs before source changes are applied.</p><p>Agent investigations and proposals use your configured TrueForge model. Page scans and stress tests work without it.</p></div></div>}
        </>}

        {tab === 'stress' && <section className="wb-stress"><div className="wb-section-heading"><h2><Lightning size={22} />Find the breaking point, gently.</h2><span>Local GET requests only</span></div><p>Measure response time, errors and rate-limit behavior with a controlled burst against the selected local URL.</p><form onSubmit={event => { event.preventDefault(); void action(() => api.stress({ targetUrl: target, requests, concurrency, rps })); }}><div className="wb-stress-fields"><label>Total requests<input type="number" min={1} max={200} required value={requests} onChange={event => setRequests(Number(event.target.value))} /><small>Up to 200</small></label><label>Concurrent workers<input type="number" min={1} max={5} required value={concurrency} onChange={event => setConcurrency(Number(event.target.value))} /><small>Up to 5</small></label><label>Requests per second<input type="number" min={1} max={10} required value={rps} onChange={event => setRps(Number(event.target.value))} /><small>Shared across workers · up to 10</small></label></div><button className="button button-primary" disabled={busy || !target} type="submit"><Play size={17} />Run stress test</button></form><p className="field-help">Automatically stops on a redirect, HTTP 429/503, or a 20% failure rate after ten samples. One operation runs at a time.</p>{current?.stress && <><div className="wb-stress-results"><div><span>Requests completed</span><strong>{current.stress.completed}/{current.stress.requested}</strong></div><div><span>p50 latency</span><strong>{current.stress.p50Ms}<small> ms</small></strong></div><div><span>p95 latency</span><strong>{current.stress.p95Ms}<small> ms</small></strong></div><div><span>Throughput</span><strong>{current.stress.throughput}<small> req/s</small></strong></div><div><span>Network / server errors</span><strong>{current.stress.errors}</strong></div><div><span>Rate-limited responses</span><strong>{current.stress.rateLimited}</strong></div></div><h3>Response breakdown</h3><div className="wb-response-bars">{Object.entries(current.stress.statuses).map(([status, count]) => <div key={status}><code>{status}</code><span><i style={{ width: `${count / Math.max(1, current.stress!.completed) * 100}%` }} /></span><strong>{count}</strong></div>)}</div><p>{current.stress.stoppedEarly ? 'The test stopped before sending the full request budget.' : 'The full request budget completed.'} No 429 at this load does not prove rate limiting is missing.</p></>}</section>}

        {tab === 'memory' && <section className="wb-memory"><div className="wb-section-heading"><h2><Brain size={22} />Your agent, with context.</h2><span>{memory.length} saved lessons</span></div><p>Explain a false positive once. Probe remembers your correction for that origin, route, rule and element, and includes it in future agent investigations. Evidence stays visible. This is persistent local memory, not model-weight training.</p>{!memory.length && <div className="wb-empty"><Brain size={32} /><h3>Your agent is ready to learn.</h3><p>Open a finding, mark it as a false positive or accept it, and explain why.</p></div>}{memory.map(item => <article key={item.id} className="wb-memory-item"><div><span className="wb-chip">{item.verdict === 'false-positive' ? 'False-positive correction' : 'Accepted finding'}</span><h3>{item.rule}</h3><code>{item.origin}{item.path}{item.selector ? ` · ${item.selector}` : ''}</code><p>{item.reason}</p><small>{dateTime(item.createdAt)}</small></div><button className="button button-secondary" type="button" disabled={pending} onClick={async () => { setPending(true); try { await api.forget(item.id); setMemory(await api.memory()); } catch (cause) { setError(errorMessage(cause)); } finally { setPending(false); } }}>Forget</button></article>)}</section>}
        {current?.notes.length ? <details className="wb-notes"><summary>Evidence, coverage & investigation notes</summary>{current.notes.map((note, i) => <p key={i}>{note}</p>)}</details> : null}
        <footer className="wb-footer"><span>PROBE</span><span>Every conclusion has a trail.</span></footer>
      </div>
    </main>
  </div>;
}

function FindingPanel({ finding, busy, connected, onPropose, onFeedback }: { finding: Diagnostic; busy: boolean; connected: boolean; onPropose: () => void; onFeedback: (verdict: 'false-positive' | 'accepted', reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  return <article className="wb-finding-detail"><div className="wb-detail-meta"><span className={`wb-severity ${finding.severity.toLowerCase()}`}>{finding.severity}</span><span>{finding.status}</span><span>{finding.category}</span></div><h2>{finding.title}</h2><code className="wb-location">{finding.url}{finding.selector ? `\n${finding.selector}` : ''}</code><dl><div><dt>Exact problem</dt><dd>{finding.actual}</dd></div><div><dt>Expected behavior</dt><dd>{finding.expected}</dd></div><div><dt>Proposed fix</dt><dd>{finding.suggestion}</dd></div></dl><details><summary>View captured evidence</summary><ul>{finding.evidence.map((evidence, index) => <li key={index}>{evidence}</li>)}</ul></details>{finding.feedback && <div className="wb-feedback-saved"><Brain size={18} /><div><strong>{finding.feedback.verdict === 'false-positive' ? 'Marked false positive by you' : 'Accepted by you'}</strong><p>{finding.feedback.reason}</p><small>Scoped lesson remembered. Original evidence is preserved.</small></div></div>}<button type="button" className="button button-primary" disabled={busy || !connected || finding.feedback?.verdict === 'false-positive'} onClick={onPropose}><Wrench size={17} />Propose source fix<ArrowRight size={15} /></button><div className="wb-feedback"><h3>Is this a real issue?</h3><p>Tell your personal agent why, so it can avoid the same mistake.</p><label className="sr-only" htmlFor={`feedback-${finding.id}`}>Reason for feedback</label><textarea id={`feedback-${finding.id}`} value={reason} minLength={5} maxLength={2000} placeholder="This image is decorative; an empty alt is intentional…" onChange={event => setReason(event.target.value)} /><div><button type="button" className="button button-secondary" disabled={busy || reason.trim().length < 5} onClick={() => void onFeedback('false-positive', reason)}>False positive</button><button type="button" className="button button-secondary" disabled={busy || reason.trim().length < 5} onClick={() => void onFeedback('accepted', reason)}><CheckCircle size={16} />Real issue</button></div></div></article>;
}
