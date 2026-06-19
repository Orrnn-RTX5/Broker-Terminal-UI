import { useEffect, useState } from 'react';
import {
  FALLBACK_DESKTOP_RELEASE,
  loadLatestDesktopRelease,
  type DesktopRelease,
} from '../services/desktopRelease';

export type DesktopReleaseStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseDesktopReleaseResult {
  release: DesktopRelease;
  status: DesktopReleaseStatus;
  error: Error | null;
}

export const useDesktopRelease = (options: { enabled?: boolean } = {}): UseDesktopReleaseResult => {
  const enabled = options.enabled ?? true;
  const [release, setRelease] = useState<DesktopRelease>(FALLBACK_DESKTOP_RELEASE);
  const [status, setStatus] = useState<DesktopReleaseStatus>(enabled ? 'loading' : 'idle');
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      setStatus('idle');
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    setStatus('loading');
    setError(null);

    loadLatestDesktopRelease()
      .then((latestRelease) => {
        if (cancelled) return;
        setRelease(latestRelease);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRelease(FALLBACK_DESKTOP_RELEASE);
        setError(err instanceof Error ? err : new Error('Desktop release lookup failed'));
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { release, status, error };
};
