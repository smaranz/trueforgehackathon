import { ArrowLeft, ArrowRight, BookOpenText, CheckCircle, FileCode, Flag, ListNumbers, ShieldWarning } from '@phosphor-icons/react';
import type { Finding, Run } from '../shared/types';
import { ErrorNotice, EvidenceGallery, SectionTitle, Status } from './components';
import { runHash, shortId } from './lib';
import { Verification } from './Verification';
import { useState } from 'react';
import { workbenchApi } from './workbench-api';
import { errorMessage } from './api';
import { CopyFixPrompt } from './CopyFixPrompt';

export function FindingDetail({ finding, run, verifying, onVerify, error }: { finding: Finding; run: Run; verifying: boolean; onVerify: () => void; error: string | null }) {
  const [opening, setOpening] = useState(false);
  const [repairError, setRepairError] = useState<string>();
  const evidence = run.artifacts.filter(artifact => finding.evidenceIds.includes(artifact.id));
  const missingEvidence = finding.evidenceIds.filter(id => !run.artifacts.some(artifact => artifact.id === id));
  return <div className="finding-detail-page"><a className="back-link" href={runHash(run.id)}><ArrowLeft size={16} />Back to run workspace</a><div className="finding-heading"><div className="eyebrow"><Flag size={14} />FINDING {String(run.findings.findIndex(item => item.id === finding.id) + 1).padStart(2, '0')}<span className="eyebrow-divider">/</span><span className="mono" title={finding.id}>{shortId(finding.id)}</span></div><h1>{finding.title}</h1><div className="finding-meta"><Status value={finding.status} /><Status value={finding.severity} dot={false} /><span>{finding.scenario}</span><span className="finding-actors">{finding.actors.join(' ↔ ')}</span></div></div>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {repairError && <ErrorNotice>{repairError}</ErrorNotice>}
    <div className="finding-detail-actions">
      <button type="button" className="button button-secondary" disabled={opening} onClick={async () => {
        setOpening(true); setRepairError(undefined);
        try { const job = await workbenchApi.importFinding(run.id, finding.id); window.location.hash = `dashboard/${job.id}`; }
        catch (cause) { setRepairError(errorMessage(cause)); }
        finally { setOpening(false); }
      }}><FileCode size={17} />{opening ? 'Opening investigation…' : 'Investigate & propose a fix'}</button>
      <CopyFixPrompt run={run} finding={finding} />
    </div>
    <div className="finding-report-grid"><div className="finding-report-main">
      <section className="expectation-section"><SectionTitle title="The expectation gap" /><div className="expectation-comparison"><div className="expectation expected"><span className="eyebrow"><CheckCircle size={15} />EXPECTED</span><p>{finding.expected}</p></div><span className="comparison-arrow" aria-hidden="true"><ArrowRight size={16} /></span><div className="expectation actual"><span className="eyebrow"><ShieldWarning size={15} />ACTUAL</span><p>{finding.actual}</p></div></div><div className="expectation-source"><BookOpenText size={16} /><div><strong>Expectation source</strong><p>{finding.expectationSource}</p></div></div></section>
      <section className="reproduction-section"><SectionTitle title="Reproduce the finding" /><h3 className="minor-heading">Preconditions</h3>{finding.preconditions.length ? <ul className="preconditions">{finding.preconditions.map((condition, index) => <li key={index}><CheckCircle size={15} /><span>{condition}</span></li>)}</ul> : <p className="muted">No preconditions recorded.</p>}<h3 className="minor-heading steps-heading"><ListNumbers size={16} />Steps to reproduce</h3>{finding.steps.length ? <ol className="repro-steps">{finding.steps.map((step, index) => <li key={index}><span className="step-number mono">{String(index + 1).padStart(2, '0')}</span><p>{step}</p></li>)}</ol> : <p className="muted">Reproduction steps have not been recorded yet.</p>}</section>
      <section className="finding-evidence"><SectionTitle title="Evidence" detail={`${evidence.length} artifacts`} /><EvidenceGallery artifacts={evidence} />{missingEvidence.length > 0 && <p className="field-help">{missingEvidence.length} referenced {missingEvidence.length === 1 ? 'artifact is' : 'artifacts are'} not available in this run yet.</p>}</section>
    </div><aside className="finding-report-aside"><section className="severity-section"><span className="eyebrow">WHY IT MATTERS</span><div className="severity-heading"><ShieldWarning size={21} /><h2>{finding.severity} severity</h2></div><p>{finding.rationale}</p></section><section className="test-location"><div className="minor-heading"><FileCode size={16} />Regression test</div>{finding.regressionTest ? <><code>{finding.regressionTest}</code><p>The saved test is used for prepared-fix verification.</p></> : <p>No regression test has been generated yet.</p>}</section><section className="finding-provenance"><span className="eyebrow">INVESTIGATION</span><dl><div><dt>Run</dt><dd><a href={runHash(run.id)}>{run.name || shortId(run.id)}<ArrowRight size={13} /></a></dd></div><div><dt>Execution</dt><dd>{run.mode === 'trueforge' ? 'TrueForge agent investigation' : 'Deterministic browser proof'}</dd></div><div><dt>Prepared fixture</dt><dd className="capitalize">{run.variant}</dd></div></dl></section></aside></div>
    {run.scenario !== 'full-audit' && <Verification run={run} pending={verifying} onVerify={onVerify} />}
    <div className="page-foot"><span>PROBE</span><span>Every conclusion has a trail.</span></div>
  </div>;
}
