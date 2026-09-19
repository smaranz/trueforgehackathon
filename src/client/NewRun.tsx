import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, Check, CheckCircle, Circle, Flask, GlobeHemisphereWest, Info, LockKey, PlugsConnected, Robot, ShieldCheck, SlidersHorizontal, TerminalWindow, UsersThree } from '@phosphor-icons/react';
import type { Health, Mode, Run, Variant } from '../shared/types';
import { api, errorMessage } from './api';
import { ErrorNotice, SectionTitle, SuccessNote } from './components';
import { SignupRun } from './SignupRun';
import { AuditSetup } from './AuditSetup';

interface Props {
  health: Health | null;
  healthLoading: boolean;
  healthError: string | null;
  refreshHealth: () => void;
  onStarted: (run: Run) => void;
}

export function NewRun({ health, healthLoading, healthError, refreshHealth, onStarted }: Props) {
  const fromHash = () => window.location.hash === '#new/signup' ? 'signup' : window.location.hash === '#new/demo' ? 'demo' : 'audit';
  const [profile, setProfile] = useState(fromHash);
  useEffect(() => {
    const changed = () => setProfile(fromHash());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const [goal, setGoal] = useState('Verify that an editor loses access to a shared document after the owner revokes their permission, including in an already-open session.');
  const [mode, setMode] = useState<Mode>('trueforge');
  const [variant, setVariant] = useState<Variant>('broken');
  const [loadedUrl, setLoadedUrl] = useState('');
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [starting, setStarting] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const targetUrl = loadedUrl || health?.demoUrl || '';
  const agentReady = Boolean(health?.trueforge.reachable && health.trueforge.ready);
  const unavailableReason = health?.trueforge.reason || (health ? 'TrueForge is not ready. Check the local agent service and its model configuration.' : 'Availability has not been checked.');
  const busy = starting || loadingDemo;
  const canStart = Boolean(targetUrl && goal.trim() && !busy && (mode === 'deterministic' || agentReady));

  async function loadDemo() {
    setLoadingDemo(true);
    setDemoError(null);
    try {
      const result = await api.loadDemo();
      if (!result.url) throw new Error('The demo did not return a workspace URL. Try loading it again.');
      setLoadedUrl(result.url);
    } catch (error) { setDemoError(errorMessage(error)); }
    finally { setLoadingDemo(false); }
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canStart) return;
    setStarting(true);
    setStartError(null);
    try {
      const run = await api.start({ mode, variant, goal: goal.trim(), targetUrl, scenario: 'revoked-access' });
      onStarted(run);
    } catch (error) { setStartError(errorMessage(error)); setStarting(false); }
  }

  return <div className="new-run-page">
    {profile !== 'audit' && <div className="page-intro">
      <div><span className="eyebrow"><span className="tiny-cross" /> MEET PROBE</span><h1>Your first team of users.<br /><span className="muted-heading">Before your real users.</span></h1><p>Put a real handoff to the test. See what happens on both sides.</p></div>
      <span className="intro-index mono" aria-hidden="true">01 / SET UP</span>
    </div>}

    <div className="profile-switch" role="group" aria-label="Choose test target"><button type="button" aria-pressed={profile === 'audit'} onClick={() => { setProfile('audit'); window.location.hash = 'new/audit'; }} disabled={busy}><Robot size={18} /><span>Full product audit<small>30 specialists · real accounts</small></span></button><button type="button" aria-pressed={profile === 'demo'} onClick={() => { setProfile('demo'); window.location.hash = 'new/demo'; }} disabled={busy}><UsersThree size={18} /><span>Fieldnotes collaboration<small>Coordinated owner + editor</small></span></button><button type="button" aria-pressed={profile === 'signup'} onClick={() => { setProfile('signup'); window.location.hash = 'new/signup'; }} disabled={busy}><GlobeHemisphereWest size={18} /><span>Quick form check<small>Read-only · signup page only</small></span></button></div>
    {profile === 'audit' ? <AuditSetup onStarted={onStarted} health={health} /> : profile === 'signup' ? <SignupRun onStarted={onStarted} /> : <form onSubmit={start} className="setup-layout">
      <div className="setup-main">
        <section className="setup-section">
          <SectionTitle number="01" title="The workspace" />
          <div className="field"><label htmlFor="target-url">Target URL <span className="label-tag"><ShieldCheck size={12} /> Approved demo</span></label>
            <div className="url-input-wrap"><GlobeHemisphereWest size={18} /><input id="target-url" readOnly value={targetUrl} placeholder={healthLoading ? 'Loading approved workspace…' : 'Load a demo workspace to get started'} aria-describedby="target-help" /><LockKey size={14} /></div>
            <div className="field-under"><p id="target-help">Fieldnotes · our own multi-user demo workspace</p><button type="button" className="text-button" onClick={loadDemo} disabled={busy}><PlugsConnected size={15} />{loadingDemo ? 'Loading workspace…' : 'Load demo workspace'}<ArrowUpRight size={13} /></button></div>
            {loadedUrl && <SuccessNote>Demo workspace loaded</SuccessNote>}
            {demoError && <ErrorNotice onRetry={loadDemo}>{demoError}</ErrorNotice>}
          </div>
          <div className="field goal-field"><label htmlFor="run-goal">What should your team try?</label><textarea id="run-goal" value={goal} onChange={event => setGoal(event.target.value)} rows={3} required minLength={5} maxLength={2000} disabled={starting} aria-describedby="goal-help" /><p id="goal-help" className="field-help">Describe the expected behavior. The scenario below defines the implemented flow.</p></div>
        </section>

        <section className="setup-section">
          <SectionTitle number="02" title="Your first two users" detail="Separate browser sessions" />
          <div className="account-grid">
            <div className="account-card"><span className="avatar avatar-owner">MV</span><div><strong>Mara Vale</strong><span>owner@fieldnotes.test</span></div><span className="role-label">Owner</span></div>
            <div className="account-card"><span className="avatar avatar-editor">EP</span><div><strong>Ellis Park</strong><span>editor@fieldnotes.test</span></div><span className="role-label">Editor</span></div>
          </div>
          <p className="deferred-note"><UsersThree size={14} /><span>Viewer participation is deferred. This run uses the owner and editor only.</span></p>
        </section>

        <section className="setup-section">
          <SectionTitle number="03" title="Choose a scenario" />
          <div className="scenario-selected"><span className="scenario-icon"><LockKey size={19} /></span><div><strong>Revoked access</strong><p>Share a document, revoke permission, then check the editor’s open session.</p></div><CheckCircle size={20} weight="fill" className="green" /><input type="hidden" name="scenario" value="revoked-access" /></div>
          <div className="planned-scenarios"><button type="button" disabled><span>Role downgrade</span><span className="planned-label">Planned</span></button><button type="button" disabled><span>Concurrent edits</span><span className="planned-label">Planned</span></button></div>
        </section>

        <section className="setup-section execution-section">
          <SectionTitle number="04" title="How to run it" />
          <fieldset className="mode-options" disabled={starting}><legend className="sr-only">Investigation mode</legend>
            <label className={`mode-option ${mode === 'trueforge' ? 'selected' : ''}`}><input type="radio" name="mode" value="trueforge" checked={mode === 'trueforge'} onChange={() => setMode('trueforge')} /><Robot size={20} /><span><strong>TrueForge agent investigation</strong><span>Agents investigate through real browser tools.</span></span></label>
            <label className={`mode-option ${mode === 'deterministic' ? 'selected' : ''}`}><input type="radio" name="mode" value="deterministic" checked={mode === 'deterministic'} onChange={() => setMode('deterministic')} /><TerminalWindow size={20} /><span><strong>Deterministic browser proof</strong><span>A scripted browser flow. No AI investigation or token usage.</span></span></label>
          </fieldset>
          <div className={`agent-health ${agentReady ? 'agent-health-ready' : ''}`}>
            <span className={`health-dot ${agentReady ? 'available' : ''}`} /><div><strong>{healthLoading ? 'Checking TrueForge…' : agentReady ? 'TrueForge configured' : 'TrueForge missing / unavailable'}</strong><p>{healthLoading ? 'Checking the agent service and configured model.' : agentReady ? `${health?.trueforge.model || 'Configured model'} · ${health?.trueforge.verified ? 'Agent execution verified' : 'Agent execution not yet verified'}` : healthError || unavailableReason}</p></div><button type="button" className="text-button" onClick={refreshHealth} disabled={healthLoading}>Recheck</button>
          </div>
          {agentReady && health?.trueforge.reason && <ErrorNotice>{health.trueforge.reason}</ErrorNotice>}
        </section>

      </div>

      <aside className="setup-aside">
        <div className="run-preview"><div className="preview-heading"><span className="eyebrow">THE HANDOFF</span><span className="mono">OWNER → EDITOR</span></div><div className="handoff-diagram" aria-hidden="true"><span className="diagram-user">MV<small>OWNER</small></span><span className="handoff-line"><span /><LockKey size={15} /><span /></span><span className="diagram-user diagram-editor">EP<small>EDITOR</small></span></div><h3>One permission change.<br />Two perspectives.</h3><p>A passing owner-side action doesn’t tell the whole story.</p><ol className="flow-list"><li><span>1</span><div><strong>Share & open</strong><p>Mara shares. Ellis opens the document.</p></div></li><li><span>2</span><div><strong>Revoke access</strong><p>Mara removes the editor’s permission.</p></div></li><li><span>3</span><div><strong>Check both sides</strong><p>Does the open editor session still have access?</p></div></li></ol><div className="preview-foot"><Check size={14} /> Browser evidence, not assumptions.</div></div>

        <section className="operator-section"><div className="operator-title"><SlidersHorizontal size={16} /><h2>Operator controls</h2></div><p>Prepared demo variants. This selects the fixture, not a fix made by an agent.</p><fieldset disabled={starting}><legend>Starting variant</legend><label className={`variant-option ${variant === 'broken' ? 'chosen' : ''}`}><input type="radio" name="variant" value="broken" checked={variant === 'broken'} onChange={() => setVariant('broken')} /><span><strong>Broken</strong><small>Prepared access-control fault</small></span>{variant === 'broken' ? <CheckCircle size={16} weight="fill" /> : <Circle size={16} />}</label><label className={`variant-option ${variant === 'corrected' ? 'chosen' : ''}`}><input type="radio" name="variant" value="corrected" checked={variant === 'corrected'} onChange={() => setVariant('corrected')} /><span><strong>Corrected</strong><small>Prepared permission check</small></span>{variant === 'corrected' ? <CheckCircle size={16} weight="fill" /> : <Circle size={16} />}</label></fieldset><div className="operator-note"><Info size={14} /><span>Verification compares the saved test against the prepared variants.</span></div></section>
        <p className="setup-footnote"><Flask size={15} /> Purpose-built for this demo.<br />More scenarios are on the way.</p>
      </aside>
      <div className="launch-section">
        {startError && <ErrorNotice>{startError}</ErrorNotice>}
        <div className="launch-row"><p><ShieldCheck size={16} />First-party demo. Isolated actor sessions.</p><button className="button button-primary start-button" type="submit" disabled={!canStart}>{starting ? 'Starting run…' : mode === 'trueforge' ? 'Start investigation' : 'Start browser proof'}<ArrowRight size={17} /></button></div>
        {!goal.trim() && <p className="launch-hint">Add a goal describing the behavior to investigate.</p>}
        {!targetUrl && !healthLoading && <p className="launch-hint">Load the approved demo workspace before starting.</p>}
        {mode === 'trueforge' && !agentReady && !healthLoading && <p className="launch-hint">TrueForge must be available for agent mode. Select deterministic browser proof to run the scripted flow.</p>}
      </div>
    </form>}
  </div>;
}
