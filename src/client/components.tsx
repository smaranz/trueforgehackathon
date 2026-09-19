import { useEffect, useState, type ReactNode } from 'react';
import { ArrowSquareOut, ArrowClockwise, ArrowsClockwise, CheckCircle, FileCode, FileText, ImageSquare, WarningCircle, WifiSlash } from '@phosphor-icons/react';
import type { EvidenceArtifact, Run } from '../shared/types';
import { artifactUrl, clock, duration, isActive, statusTone } from './lib';
import type { Connection } from './useRun';

export function Brand({ small = false }: { small?: boolean }) {
  return <a href="#dashboard" className={`brand ${small ? 'brand-small' : ''}`} aria-label="Probe home">
    <img className="brand-mark" src="/brand/probe-mark.svg" width="42" height="42" alt="" />
    <span className="brand-wordmark">Probe</span>
  </a>;
}

export function Status({ value, dot = true }: { value: string; dot?: boolean }) {
  return <span className={`status status-${statusTone(value)}`}>{dot && <span className="status-dot" />}{value}</span>;
}

export function ErrorNotice({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return <div className="notice notice-error" role="alert"><WarningCircle size={18} /><span>{children}</span>{onRetry && <button type="button" className="text-button" onClick={onRetry}><ArrowClockwise size={15} /> Retry</button>}</div>;
}

export function ConnectionNotice({ connection, attempt, retry }: { connection: Connection; attempt: number; retry: () => void }) {
  if (connection !== 'reconnecting' && connection !== 'offline') return null;
  return <div className="notice notice-warning" role="status">{connection === 'offline' ? <WifiSlash size={18} /> : <ArrowsClockwise size={18} />}<span><strong>{connection === 'offline' ? 'Live connection paused.' : 'Reconnecting to this run…'}</strong> {connection === 'offline' ? 'Automatic refresh stopped after 5 attempts. Showing the last received data.' : `Showing the last received data. ${attempt ? `Refresh attempt ${attempt} of 5.` : 'Waiting to retry.'}`}</span><button type="button" className="text-button" onClick={retry}>Reconnect</button></div>;
}

export function SectionTitle({ number, title, detail, children }: { number?: string; title: string; detail?: string; children?: ReactNode }) {
  return <div className="section-heading"><div className="section-heading-label">{number && <span className="section-number">{number}</span>}<h2>{title}</h2>{detail && <span className="section-detail">{detail}</span>}</div>{children}</div>;
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{children}</p></div>;
}

export function RunSkeleton() {
  return <div className="run-skeleton" role="status" aria-label="Loading run"><span className="eyebrow">Retrieving run</span><div className="skeleton skeleton-title" /><div className="skeleton skeleton-line" /><div className="skeleton-pair"><div className="skeleton skeleton-panel" /><div className="skeleton skeleton-panel" /></div><p className="muted">Loading saved events and evidence…</p></div>;
}

export function RunDuration({ run }: { run: Run }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isActive(run.status)) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run.id, run.status]);
  const end = run.finishedAt ? Date.parse(run.finishedAt) : isActive(run.status) ? now : undefined;
  return <>{end !== undefined && Number.isFinite(end) && Number.isFinite(Date.parse(run.startedAt)) ? duration(end - Date.parse(run.startedAt)) : 'Unavailable'}</>;
}

export function ArtifactLink({ artifact }: { artifact: EvidenceArtifact }) {
  const href = artifactUrl(artifact);
  const Icon = artifact.kind === 'test' ? FileCode : artifact.kind === 'screenshot' ? ImageSquare : FileText;
  if (!href) return <span className="artifact-link muted"><Icon size={16} /> {artifact.label} <span>(link unavailable)</span></span>;
  return <a className="artifact-link" href={href} target="_blank" rel="noreferrer"><Icon size={16} /><span>{artifact.label}</span><ArrowSquareOut size={13} /></a>;
}

export function ArtifactImage({ artifact, className = '' }: { artifact: EvidenceArtifact; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const href = artifactUrl(artifact);
  useEffect(() => { setFailed(false); setLoaded(false); }, [artifact.url]);
  if (!href || failed) return <div className={`image-unavailable ${className}`}><ImageSquare size={24} /><span>Snapshot unavailable</span><small>{href ? 'The image could not be loaded.' : 'No valid artifact URL was supplied.'}</small>{href && <button className="text-button" type="button" onClick={() => setFailed(false)}>Retry image</button>}</div>;
  return <a className={`artifact-image ${className}`} href={href} target="_blank" rel="noreferrer" aria-label={`Open full screenshot: ${artifact.label}`}>
    {!loaded && <span className="image-loading">Loading snapshot…</span>}
    <img src={href} alt={artifact.label} loading="lazy" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
    <span className="image-open"><ArrowSquareOut size={14} /> Open snapshot</span>
  </a>;
}

export function EvidenceGallery({ artifacts }: { artifacts: EvidenceArtifact[] }) {
  if (!artifacts.length) return <div className="inline-empty"><ImageSquare size={20} /><span>No evidence has been attached yet.</span></div>;
  const screenshots = artifacts.filter(artifact => artifact.kind === 'screenshot');
  const files = artifacts.filter(artifact => artifact.kind !== 'screenshot');
  return <div className="evidence-gallery">{screenshots.length > 0 && <div className="evidence-images">{screenshots.map(artifact => <figure key={artifact.id}>
    <ArtifactImage artifact={artifact} />
    <figcaption><span>{artifact.label}</span><time dateTime={artifact.timestamp} className="mono">{clock(artifact.timestamp)}</time></figcaption>
  </figure>)}</div>}{files.length > 0 && <div className="artifact-files">{files.map(artifact => <ArtifactLink artifact={artifact} key={artifact.id} />)}</div>}</div>;
}

export function SuccessNote({ children }: { children: ReactNode }) {
  return <span className="success-note" role="status"><CheckCircle size={15} weight="fill" />{children}</span>;
}
