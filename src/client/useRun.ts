import { useCallback, useEffect, useRef, useState } from 'react';
import type { Run } from '../shared/types';
import { api, errorMessage } from './api';
import { isActive } from './lib';

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'offline';
const refreshDelays = [1500, 3000, 6000, 10000, 15000];

/** One selected run, one event stream, and a finite backoff on disconnection. */
export function useRun(id: string | undefined, onUpdate: (run: Run) => void, onFinished: () => void) {
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [attempt, setAttempt] = useState(0);
  const [revision, setRevision] = useState(0);
  const updateRef = useRef(onUpdate);
  const finishedRef = useRef(onFinished);
  const acceptRef = useRef<(value: Run) => void>(() => {});
  updateRef.current = onUpdate;
  finishedRef.current = onFinished;

  useEffect(() => {
    setRun(previous => previous?.id === id ? previous : null);
    setError(null);
    setLoading(Boolean(id));
    setConnection('connecting');
    setAttempt(0);
    if (!id) return;

    let disposed = false;
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryCount = 0;
    let fallbackActive = false;
    let generation = 0;
    let terminalSignature = '';
    const controller = new AbortController();

    const accept = (value: Run) => {
      if (disposed || value.id !== id) return;
      generation += 1;
      setRun(value);
      setLoading(false);
      setError(null);
      updateRef.current(value);
      if (!isActive(value.status)) {
        const signature = `${value.status}:${value.finishedAt}:${value.verifications.length}`;
        if (signature !== terminalSignature) {
          terminalSignature = signature;
          finishedRef.current();
        }
      } else terminalSignature = '';
    };
    acceptRef.current = accept;

    const fetchLatest = async () => {
      const beforeFetch = generation;
      try {
        const value = await api.run(id, AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]));
        // An event arriving during this request is newer than its HTTP snapshot.
        if (beforeFetch === generation) accept(value);
      } catch (cause) {
        if (!disposed && beforeFetch === generation) { setError(errorMessage(cause)); setLoading(false); }
      }
    };

    const scheduleFallback = () => {
      if (disposed || timer || !fallbackActive) return;
      if (retryCount >= refreshDelays.length) {
        source?.close();
        setConnection('offline');
        return;
      }
      timer = setTimeout(async () => {
        timer = undefined;
        if (disposed || !fallbackActive) return;
        retryCount += 1;
        setAttempt(retryCount);
        await fetchLatest();
        scheduleFallback();
      }, refreshDelays[retryCount]);
    };

    const connect = () => {
      if (disposed) return;
      source = new EventSource(api.eventsUrl(id));
      source.onopen = () => {
        if (disposed) return;
        fallbackActive = false;
        retryCount = 0;
        if (timer) { clearTimeout(timer); timer = undefined; }
        setConnection('live');
        setAttempt(0);
        // Refresh on reconnect even when the server doesn't replay its last event.
        void fetchLatest();
      };
      source.addEventListener('run', event => {
        try {
          const value = JSON.parse((event as MessageEvent<string>).data) as Run;
          if (value?.id === id && Array.isArray(value.events) && Array.isArray(value.actors) && Array.isArray(value.findings) && Array.isArray(value.artifacts) && Array.isArray(value.verifications)) accept(value);
          else throw new Error('Invalid run update');
        } catch {
          setError('A live update could not be read. Refresh to retrieve the latest run.');
        }
      });
      source.onerror = () => {
        if (disposed) return;
        setConnection('reconnecting');
        fallbackActive = true;
        scheduleFallback();
      };
    };

    void fetchLatest().then(connect);
    return () => {
      disposed = true;
      controller.abort();
      source?.close();
      if (timer) clearTimeout(timer);
      acceptRef.current = () => {};
    };
  }, [id, revision]);

  return {
    run, loading, error, connection, attempt,
    retry: useCallback(() => setRevision(value => value + 1), []),
    accept: useCallback((value: Run) => acceptRef.current(value), []),
  };
}
