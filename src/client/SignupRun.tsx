import { useState, type FormEvent } from 'react';
import { ArrowRight, Browser, GlobeHemisphereWest, LockKey, ShieldCheck } from '@phosphor-icons/react';
import type { Run } from '../shared/types';
import { api, errorMessage } from './api';
import { ErrorNotice, SectionTitle } from './components';

export function SignupRun({ onStarted }: { onStarted: (run: Run) => void }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start(event: FormEvent) {
    event.preventDefault();
    if (starting) return;
    setStarting(true); setError(null);
    try { onStarted(await api.startSignup()); }
    catch (error) { setError(errorMessage(error)); setStarting(false); }
  }
  return <form className="signup-setup" onSubmit={start}>
    <section className="setup-section">
      <SectionTitle number="01" title="Your signup page" detail="Approved local target" />
      <div className="field"><label htmlFor="signup-target">Target URL</label><div className="url-input-wrap"><GlobeHemisphereWest size={18} /><input id="signup-target" value="http://localhost:3000/signup" readOnly aria-describedby="signup-target-help" /><LockKey size={14} /></div><p id="signup-target-help" className="field-help">Publick · explicitly authorized local signup page</p></div>
    </section>
    <section className="setup-section">
      <SectionTitle number="02" title="A fresh visitor" />
      <div className="scenario-selected"><span className="scenario-icon"><Browser size={20} /></span><div><strong>New browser. No existing login.</strong><p>Every check starts in a clean, unauthenticated context. Archived owner/editor browsers are never reused.</p></div></div>
    </section>
    <section className="setup-section">
      <SectionTitle number="03" title="What Probe checks" detail="Deterministic browser procedure" />
      <ul className="signup-check-list"><li>Page load and visible form labels</li><li>Required fields, email format and password length</li><li>Password visibility and the sign-in link</li><li>Desktop/mobile layout and uncaught page errors</li></ul>
      <div className="surface-limitations"><strong>Scope</strong><p>No account is created. Form submission, Google OAuth, email verification and backend authentication are not tested. Screenshots and actual check results are saved in run history.</p></div>
    </section>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    <div className="launch-row"><p><ShieldCheck size={16} />Fresh browser · no network writes</p><button type="submit" className="button button-primary" disabled={starting}>{starting ? 'Checking signup page…' : 'Start signup check'}<ArrowRight size={17} /></button></div>
    {starting && <p className="field-help" role="status">The browser check is running. Your report will open when the results are saved.</p>}
  </form>;
}
