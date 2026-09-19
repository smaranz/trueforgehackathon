import type { AgentMemory, WorkbenchConfig, WorkbenchJob } from '../shared/workbench';
import { request } from './api';

const base = '/api/workbench';
const post = <T>(path: string, body?: unknown) => request<T>(`${base}${path}`, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
export const workbenchApi = {
  config: () => request<WorkbenchConfig>(`${base}/config`),
  jobs: () => request<WorkbenchJob[]>(`${base}/jobs`),
  job: (id: string, signal?: AbortSignal) => request<WorkbenchJob>(`${base}/jobs/${encodeURIComponent(id)}`, { signal }),
  scan: (targetUrl: string) => post<WorkbenchJob>('/scan', { targetUrl }),
  investigate: (body: { targetUrl: string; prompt: string; parentId?: string; point?: { x: number; y: number } }) => post<WorkbenchJob>('/investigate', body),
  stress: (body: { targetUrl: string; requests: number; concurrency: number; rps: number }) => post<WorkbenchJob>('/stress', body),
  cancel: (id: string) => post<WorkbenchJob>(`/jobs/${encodeURIComponent(id)}/cancel`),
  propose: (id: string, findingId: string) => post<WorkbenchJob>(`/jobs/${encodeURIComponent(id)}/propose`, { findingId }),
  build: (id: string) => post<WorkbenchJob>(`/jobs/${encodeURIComponent(id)}/build`),
  feedback: (id: string, findingId: string, verdict: 'false-positive' | 'accepted', reason: string) => post<WorkbenchJob>(`/jobs/${encodeURIComponent(id)}/feedback`, { findingId, verdict, reason }),
  memory: () => request<AgentMemory[]>(`${base}/memory`),
  forget: (id: string) => request(`${base}/memory/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  importFinding: (runId: string, findingId: string) => post<WorkbenchJob>('/import', { runId, findingId }),
};
