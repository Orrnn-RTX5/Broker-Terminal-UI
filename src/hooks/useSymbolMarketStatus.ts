import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { marketV2Api } from '../api/trade';
import {
  createUnavailableMarketStatus,
  normalizeMarketStatus,
  type NormalizedMarketStatus,
} from '../utils/marketStatus';

export interface SymbolMarketStatusState extends NormalizedMarketStatus {
  loading: boolean;
  error: string | null;
  refreshedAt: number | null;
}

interface UseSymbolMarketStatusOptions {
  enabled?: boolean;
  pollMs?: number;
}

interface FetchSymbolMarketStatusOptions {
  force?: boolean;
}

const CACHE_TTL_MS = 15_000;
const DEFAULT_POLL_MS = 60_000;
const MIN_VISIBLE_POLL_MS = 1_000;

const statusCache = new Map<string, { status: NormalizedMarketStatus; refreshedAt: number }>();
const inflightRequests = new Map<string, Promise<NormalizedMarketStatus>>();

const normalizeSymbolKey = (symbol: unknown): string => String(symbol ?? '').trim().toUpperCase();

const toState = (
  status: NormalizedMarketStatus,
  overrides: Partial<Pick<SymbolMarketStatusState, 'loading' | 'error' | 'refreshedAt'>> = {},
): SymbolMarketStatusState => ({
  ...status,
  loading: overrides.loading ?? false,
  error: overrides.error ?? null,
  refreshedAt: overrides.refreshedAt ?? null,
});

export const getCachedSymbolMarketStatus = (symbol: string): SymbolMarketStatusState | null => {
  const key = normalizeSymbolKey(symbol);
  if (!key) return null;
  const cached = statusCache.get(key);
  return cached ? toState(cached.status, { refreshedAt: cached.refreshedAt }) : null;
};

export const fetchSymbolMarketStatus = async (
  symbol: string,
  options: FetchSymbolMarketStatusOptions = {},
): Promise<NormalizedMarketStatus> => {
  const key = normalizeSymbolKey(symbol);
  if (!key) return createUnavailableMarketStatus(symbol);

  const cached = statusCache.get(key);
  if (!options.force && cached && Date.now() - cached.refreshedAt < CACHE_TTL_MS) {
    return cached.status;
  }

  const existingRequest = inflightRequests.get(key);
  if (existingRequest) return existingRequest;

  const request = marketV2Api.getSymbolStatus(key)
    .then(payload => {
      const normalized = normalizeMarketStatus(payload, { symbol: key });
      statusCache.set(key, { status: normalized, refreshedAt: Date.now() });
      return normalized;
    })
    .finally(() => {
      inflightRequests.delete(key);
    });

  inflightRequests.set(key, request);
  return request;
};

export const useSymbolMarketStatus = (
  symbol: string,
  options: UseSymbolMarketStatusOptions = {},
): SymbolMarketStatusState => {
  const enabled = options.enabled ?? true;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const visiblePollMs = pollMs > 0 ? Math.max(MIN_VISIBLE_POLL_MS, pollMs) : 0;
  const normalizedSymbol = useMemo(() => normalizeSymbolKey(symbol), [symbol]);
  const requestSeqRef = useRef(0);
  const [state, setState] = useState<SymbolMarketStatusState>(() => (
    getCachedSymbolMarketStatus(normalizedSymbol)
    ?? toState(createUnavailableMarketStatus(normalizedSymbol), {
      loading: Boolean(enabled && normalizedSymbol),
    })
  ));

  const refresh = useCallback(async (force = false): Promise<NormalizedMarketStatus> => {
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;

    if (!enabled || !normalizedSymbol) {
      const unavailable = createUnavailableMarketStatus(normalizedSymbol);
      setState(toState(unavailable));
      return unavailable;
    }

    const cached = !force ? getCachedSymbolMarketStatus(normalizedSymbol) : null;
    if (cached) {
      setState(cached);
      return cached;
    }

    setState(prev => (
      normalizeSymbolKey(prev.symbol) === normalizedSymbol
        ? {
          ...prev,
          loading: true,
          error: null,
        }
        : toState(createUnavailableMarketStatus(normalizedSymbol), { loading: true })
    ));

    try {
      const nextStatus = await fetchSymbolMarketStatus(normalizedSymbol, { force });
      const refreshedAt = Date.now();
      if (requestSeqRef.current === requestId) {
        setState(toState(nextStatus, { refreshedAt }));
      }
      return nextStatus;
    } catch (error) {
      const unavailable = createUnavailableMarketStatus(normalizedSymbol);
      if (requestSeqRef.current === requestId) {
        setState(toState(unavailable, {
          error: error instanceof Error ? error.message : 'Failed to load market status',
          refreshedAt: Date.now(),
        }));
      }
      return unavailable;
    }
  }, [enabled, normalizedSymbol]);

  useEffect(() => {
    if (!enabled || !normalizedSymbol) {
      // Preserve the last authoritative state while a mounted chart tab is
      // hidden, but invalidate any in-flight result owned by that tab.
      requestSeqRef.current += 1;
      return undefined;
    }

    let disposed = false;
    let intervalId: number | null = null;
    let isVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden';

    const stopPolling = () => {
      if (intervalId === null) return;
      window.clearInterval(intervalId);
      intervalId = null;
    };

    const startPolling = () => {
      if (disposed || !isVisible || visiblePollMs <= 0 || intervalId !== null) return;
      intervalId = window.setInterval(() => {
        if (!disposed && isVisible && document.visibilityState !== 'hidden') {
          void refresh(true);
        }
      }, visiblePollMs);
    };

    // Refresh on activation without synchronously cascading a state update from
    // the effect body. Cleanup invalidates both the queued and in-flight work.
    if (isVisible) {
      void Promise.resolve().then(() => {
        if (!disposed && isVisible) void refresh(false);
      });
    }
    startPolling();

    const handleVisibilityChange = () => {
      const nextVisible = document.visibilityState !== 'hidden';
      if (nextVisible === isVisible) return;

      isVisible = nextVisible;
      if (!isVisible) {
        stopPolling();
        return;
      }

      // One recovery snapshot per hidden -> visible transition.
      void refresh(true);
      startPolling();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      requestSeqRef.current += 1;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, normalizedSymbol, refresh, visiblePollMs]);

  if (normalizeSymbolKey(state.symbol) !== normalizedSymbol) {
    return getCachedSymbolMarketStatus(normalizedSymbol)
      ?? toState(createUnavailableMarketStatus(normalizedSymbol), {
        loading: Boolean(enabled && normalizedSymbol),
      });
  }

  return state;
};
