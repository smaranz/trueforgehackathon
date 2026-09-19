import type { Health, NewRunInput, Run } from '../shared/types';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const body = data as { error?: unknown; message?: unknown } | null;
    const message = typeof body?.error === 'string' ? body.error : typeof body?.message === 'string' ? body.message : null;
    throw new Error(message || `Request failed (${response.status}). Check that the API is available on port 4310.`);
  }
  if (data === null) throw new Error('The API returned an empty or invalid response. Please try again.');
  return data as T;
}

const runPath = (id: string) => `/api/runs/${encodeURIComponent(id)}`;

export const api = {
  health: (signal?: AbortSignal) => request<Health>('/api/health', { signal }),
  runs: (signal?: AbortSignal) => request<Run[]>('/api/runs', { signal }),
  run: (id: string, signal?: AbortSignal) => request<Run>(runPath(id), { signal }),
  loadDemo: () => request<{ url: string }>('/api/demo/load', { method: 'POST' }),
  start: (input: NewRunInput) => request<Run>('/api/runs', { method: 'POST', body: JSON.stringify(input) }),
  startSignup: () => request<Run>('/api/signup/run', { method: 'POST', body: JSON.stringify({ url: 'http://localhost:3000/signup' }) }),
  cancel: (id: string) => request<Run>(`${runPath(id)}/cancel`, { method: 'POST' }),
  verify: (id: string) => request<Run>(`${runPath(id)}/verify`, { method: 'POST' }),
  eventsUrl: (id: string) => `${runPath(id)}/events`,
};

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return 'The request timed out. Please try again.';
    if (error.message === 'Failed to fetch') return 'Cannot reach the API. Check the connection and try again.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
