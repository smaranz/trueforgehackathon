import { ArrowRight, FileCode, ShieldCheck } from '@phosphor-icons/react';
import type { Run, VerificationRun } from '../shared/types';
import { ArtifactLink, SectionTitle, Status } from './components';
import { dateTime, duration, isActive, isVerifying } from './lib';

function VerificationCard({ verification, variant, run }: { verification?: VerificationRun; variant: 'broken' | 'corrected'; run: Run }) {
  const artifacts = verification ? run.artifacts.filter(artifact => verification.artifactIds.includes(artifact.id)) : [];
  return <div className={`verification-card ${verification ? 'has-result' : ''}`}><div className="verification-card-heading"><span className="eyebrow">{variant === 'broken' ? 'BEFORE · BROKEN' : 'AFTER · CORRECTED'}</span>{verification ? <Status value={verification.status} /> : <span className="awaiting-label">Not run</span>}</div>
    {verification ? <><dl className="verification-facts"><div><dt>Duration</dt><dd className="mono">{duration(verification.durationMs)}</dd></div><div><dt>Exit code</dt><dd className="mono">{verification.exitCode ?? 'Unavailable'}</dd></div><div className="full-fact"><dt>Test hash</dt><dd className="mono test-hash" title={verification.testHash}>{verification.testHash || 'Unavailable'}</dd></div><div className="full-fact"><dt>Test location</dt><dd className="mono test-path">{verification.testPath || 'Unavailable'}</dd></div></dl><div className="verification-links">{artifacts.length ? artifacts.map(artifact => <ArtifactLink key={artifact.id} artifact={artifact} />) : <span className="muted">No artifacts attached.</span>}</div><time className="verification-time" dateTime={verification.startedAt}>{dateTime(verification.startedAt)}</time></> : <div className="verification-empty"><FileCode size={22} /><p>{isVerifying(run) ? 'Verification is running. Results will appear here.' : variant === 'broken' ? 'The regression test result for the prepared broken variant will appear here.' : 'Verify the prepared fix to check the corrected variant.'}</p></div>}
  </div>;
}

export function Verification({ run, pending, onVerify }: { run: Run; pending: boolean; onVerify: () => void }) {
  const broken = run.verifications.filter(item => item.variant === 'broken');
  const corrected = run.verifications.filter(item => item.variant === 'corrected');
  const latestBroken = broken.at(-1);
  const latestCorrected = corrected.at(-1);
  const busy = pending || isVerifying(run);
  const hasTest = run.findings.some(finding => finding.regressionTest) || run.artifacts.some(artifact => artifact.kind === 'test') || run.verifications.length > 0;
  const disabled = busy || isActive(run.status) || !hasTest || latestBroken?.status !== 'failed' || latestCorrected?.status === 'passed';
  const sameTest = latestBroken && latestCorrected && latestBroken.testHash && latestBroken.testHash === latestCorrected.testHash;

  return <section className="verification-section"><SectionTitle title="Prepared-fix verification"><button className="button button-secondary button-small" type="button" disabled={disabled} onClick={onVerify}><ShieldCheck size={16} />{busy ? 'Verifying prepared fix…' : 'Verify prepared fix'}{!busy && <ArrowRight size={14} />}</button></SectionTitle><p className="section-description">Run the saved regression test against the prepared variants. The corrected fixture is operator-provided.</p><div className="verification-grid"><VerificationCard verification={latestBroken} variant="broken" run={run} /><VerificationCard verification={latestCorrected} variant="corrected" run={run} /></div>
    {sameTest && <p className="verification-note green"><ShieldCheck size={15} />Both results use the same test hash.</p>}
    {latestBroken && latestCorrected && !sameTest && <p className="verification-note">Test hashes differ or are unavailable; these results are not a like-for-like proof.</p>}
    {!hasTest && <p className="field-help">Verification becomes available when the run produces a regression test.</p>}
    {run.verifications.length > 2 && <details className="verification-history"><summary>All verification attempts <span className="mono">{run.verifications.length}</span></summary><div>{run.verifications.map(item => <div className="verification-history-row" key={item.id}><span>{item.variant}</span><Status value={item.status} /><span className="mono">{duration(item.durationMs)}</span><time dateTime={item.startedAt}>{dateTime(item.startedAt)}</time><div>{run.artifacts.filter(artifact => item.artifactIds.includes(artifact.id)).map(artifact => <ArtifactLink key={artifact.id} artifact={artifact} />)}</div></div>)}</div></details>}
  </section>;
}
