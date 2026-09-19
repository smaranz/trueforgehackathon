import { useCallback, useEffect, useRef, useState } from 'react';
import type { Health, Run } from '../shared/types';
import { api, errorMessage } from './api';

const newestFirst = (runs: Run[]) => runs.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

export function useWorkspace() {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const healthRequest = useRef<AbortController | null>(null);
  const runsRequest = useRef<AbortController | null>(null);
  const updates = useRef(new Map<string, number>());
  const revision = useRef(0);

  const upsertRun = useCallback((run: Run) => {
    updates.current.set(run.id, ++revision.current);
    setRuns(previous => newestFirst([run, ...previous.filter(item => item.id !== run.id)]));
  }, []);

  const refreshHealth = useCallback(async () => {
    healthRequest.current?.abort();
    const controller = new AbortController();
    healthRequest.current = controller;
    setHealthLoading(true);
    setHealthError(null);
    try {
      const result = await api.health(controller.signal);
      if (!controller.signal.aborted) setHealth(result);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setHealth(null);
        setHealthError(errorMessage(cause));
      }
    } finally {
      if (!controller.signal.aborted) setHealthLoading(false);
    }
  }, []);

  const refreshRuns = useCallback(async () => {
    runsRequest.current?.abort();
    const controller = new AbortController();
    const beforeFetch = revision.current;
    runsRequest.current = controller;
    setRunsLoading(true);
    setRunsError(null);
    try {
      const result = await api.runs(controller.signal);
      if (!Array.isArray(result)) throw new Error('Run history could not be read. Please refresh.');
      if (!controller.signal.aborted) setRuns(previous => {
        // A live event or action response received during this request is newer.
        const recent = previous.filter(run => (updates.current.get(run.id) ?? 0) > beforeFetch);
        const recentIds = new Set(recent.map(run => run.id));
        return newestFirst([...recent, ...result.filter(run => !recentIds.has(run.id))]);
      });
    } catch (cause) {
      if (!controller.signal.aborted) setRunsError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted) setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
    void refreshRuns();
    return () => { healthRequest.current?.abort(); runsRequest.current?.abort(); };
  }, [refreshHealth, refreshRuns]);

  return { health, healthLoading, healthError, refreshHealth, runs, runsLoading, runsError, refreshRuns, upsertRun };
}
