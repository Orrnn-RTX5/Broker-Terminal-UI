import { useEffect, useState } from 'react';
import { runAfterTerminalReady } from '../startup/runAfterTerminalReady';
import {
  RELEASE_CHANNEL_UNAVAILABLE_MESSAGE,
  isReleaseChannelConfigured,
  loadLatestDesktopRelease,
  type DesktopRelease,
} from '../services/desktopRelease';

export type DesktopReleaseStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseDesktopReleaseResult {
  /** Latest release when loaded; null while idle/loading or when the deployment configures no release source. */
  release: DesktopRelease | null;
  status: DesktopReleaseStatus;
  error: Error | null;
  /**
   * Whether the download UI may render. False when the deployment configures
   * no release source — callers must HIDE download affordances in that case
   * instead of linking a compiled-in fallback.
   */
  available: boolean;
}

export const useDesktopRelease = (options: { enabled?: boolean } = {}): UseDesktopReleaseResult => {
  const configured = isReleaseChannelConfigured();
  const enabled = (options.enabled ?? true) && configured;
  const [release, setRelease] = useState<DesktopRelease | null>(null);
  const [status, setStatus] = useState<DesktopReleaseStatus>(enabled ? 'loading' : 'idle');
  const [error, setError] = useState<Error | null>(
    enabled || configured ? null : new Error(RELEASE_CHANNEL_UNAVAILABLE_MESSAGE),
  );

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      setStatus('idle');
      setRelease(null);
      setError(configured ? null : new Error(RELEASE_CHANNEL_UNAVAILABLE_MESSAGE));
      return () => {
        cancelled = true;
      };
    }

    setStatus('loading');
    setError(null);

    const cancelScheduledLookup = runAfterTerminalReady(() => {
      void loadLatestDesktopRelease()
        .then((latestRelease) => {
          if (cancelled) return;
          setRelease(latestRelease);
          setStatus('ready');
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setRelease(null);
          setError(err instanceof Error ? err : new Error('Desktop release lookup failed'));
          setStatus('error');
        });
    });

    return () => {
      cancelled = true;
      cancelScheduledLookup();
    };
  }, [enabled, configured]);

  return { release, status, error, available: configured };
};
