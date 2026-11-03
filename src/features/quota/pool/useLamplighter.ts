/**
 * Live Lamplighter readings for the quota page.
 *
 * Reads only the plugin's stored data, never the providers, so it can poll freely: every
 * 30 seconds while the tab is visible, and at once when the tab comes back. A failed poll
 * keeps the last good readings on screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, lamplighterApi } from '@/services/api';
import type { ApiError, LamplighterHistory, LamplighterRange, LamplighterStatus } from '@/types';

export type LamplighterFeed =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready';
      status: LamplighterStatus;
      history: LamplighterHistory | null;
      recent: LamplighterHistory | null;
      /** Message of the latest failed poll while older readings stay on screen. */
      pollError: string;
    };

const POLL_MS = 30_000;

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message : String(error);

export function useLamplighter(range: LamplighterRange, enabled: boolean) {
  const [feed, setFeed] = useState<LamplighterFeed>({ phase: 'loading' });
  const [syncing, setSyncing] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    const revision = apiClient.getConnectionRevision();
    const isCurrent = () =>
      requestId === requestRef.current && revision === apiClient.getConnectionRevision();

    const [status, history, recent] = await Promise.allSettled([
      lamplighterApi.status(),
      lamplighterApi.history(range),
      lamplighterApi.history('6h'),
    ]);
    if (!isCurrent()) return;
    if (status.status === 'rejected') {
      if ((status.reason as ApiError)?.status === 404) {
        setFeed({ phase: 'missing' });
        return;
      }
      const message = errorMessage(status.reason);
      setFeed((previous) =>
        previous.phase === 'ready'
          ? { ...previous, pollError: message }
          : { phase: 'error', message }
      );
      return;
    }
    setFeed((previous) => ({
      phase: 'ready',
      status: status.value,
      // A failed history read keeps the previous one rather than blanking the chart.
      history:
        history.status === 'fulfilled'
          ? history.value
          : previous.phase === 'ready'
            ? previous.history
            : null,
      recent:
        recent.status === 'fulfilled'
          ? recent.value
          : previous.phase === 'ready'
            ? previous.recent
            : null,
      pollError: history.status === 'rejected' ? errorMessage(history.reason) : '',
    }));
  }, [range]);

  useEffect(() => {
    if (!enabled) return;
    void load();
    const poll = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = window.setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
      requestRef.current += 1;
    };
  }, [enabled, load]);

  /** Ask the plugin to read every account now, then show the new readings. */
  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      await lamplighterApi.refreshAll();
    } finally {
      setSyncing(false);
      void load();
    }
  }, [load]);

  return { feed, syncing, syncNow, reload: load };
}
