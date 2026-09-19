import type { EvidenceArtifact, Run, RunStatus } from '../shared/types';

export const isActive = (status: RunStatus) => ['queued', 'running', 'reproducing'].includes(status);
export const isVerifying = (run: Run) => isActive(run.status) && run.phase === 'verify';
export const modeLabel = (mode: Run['mode']) => mode === 'trueforge' ? 'TrueForge agent investigation' : 'Deterministic browser proof';
export const initials = (name: string) => name.split(/\s+/).slice(0, 2).map(part => part[0]).join('');
export const shortId = (id: string) => id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;

export function duration(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.max(0, Math.round(milliseconds))}ms`;
  if (milliseconds < 10000) return `${(milliseconds / 1000).toFixed(1)}s`;
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function clock(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function artifactUrl(artifact: EvidenceArtifact): string | undefined {
  // Honor the artifact URL supplied by the API, including an absolute API origin.
  // Only browser-safe web protocols may become clickable evidence links.
  try {
    if (!artifact.url.trim()) return undefined;
    const url = new URL(artifact.url, window.location.origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.href;
  } catch { return undefined; }
}

export function statusTone(status: string): 'green' | 'amber' | 'red' | 'neutral' {
  const value = status.toLowerCase();
  if (['completed', 'passed', 'not reproduced', 'available', 'corrected'].includes(value)) return 'green';
  if (['confirmed', 'failed', 'error', 'high', 'broken'].includes(value)) return 'red';
  if (['running', 'queued', 'reproducing', 'suspected', 'inconclusive', 'blocked', 'medium'].includes(value)) return 'amber';
  return 'neutral';
}

export type Route = { page: 'new' } | { page: 'run'; id: string; findingId?: string };

export function readRoute(): Route {
  const parts = window.location.hash.slice(1).split('/');
  try {
    if (parts[0] === 'run' && parts[1]) return { page: 'run', id: decodeURIComponent(parts[1]), findingId: parts[2] === 'finding' && parts[3] ? decodeURIComponent(parts[3]) : undefined };
  } catch { /* A malformed URL opens the setup screen. */ }
  return { page: 'new' };
}

export const runHash = (id: string, findingId?: string) => `#run/${encodeURIComponent(id)}${findingId ? `/finding/${encodeURIComponent(findingId)}` : ''}`;
