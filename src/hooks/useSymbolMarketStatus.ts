import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';

import { marketV2Api } from '../api/trade';
import { INSTRUMENT_CATALOGUE_CHANGED_EVENT, INSTRUMENT_CATALOGUE_REFRESHED_EVENT } from '../services/instrumentCatalogueEvents';
import {
  createUnavailableMarketStatus,
  normalizeMarketStatus,
  type NormalizedMarketStatus,
} from '../utils/marketStatus';
import { recordBrokerServerTime } from '../services/brokerServerClock';
import { getCommittedBrokerAccountSessionScope, getCommittedBrokerAccountSessionScopeKey, onCommittedBrokerAccountSessionScopeChange } from '../services/brokerSession';
import { useBrokerAccountSessionScope } from './useBrokerAccountSessionScope';
import { useLiveSymbolTradingStatus } from './useLiveSymbolTradingStatus';

export interface SymbolMarketStatusState extends NormalizedMarketStatus {
  loading: boolean;
  error: string | null;
  refreshedAt: number | null;
  sessionScope?: string;
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
let scopeGeneration = 0;
const invalidateStatusCache = () => {
  scopeGeneration += 1;
  statusCache.clear();
  inflightRequests.clear();
};
onCommittedBrokerAccountSessionScopeChange(invalidateStatusCache);
if (typeof window !== 'undefined') {
  window.addEventListener(INSTRUMENT_CATALOGUE_CHANGED_EVENT, invalidateStatusCache);
  window.addEventListener(INSTRUMENT_CATALOGUE_REFRESHED_EVENT, invalidateStatusCache);
}

const normalizeSymbolKey = (symbol: unknown): string => String(symbol ?? '').trim().toUpperCase();
const currentScope = () => getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope());
const cacheKey = (symbol: string, scope = currentScope()) => `${scope}:${normalizeSymbolKey(symbol)}`;

const toState = (
  status: NormalizedMarketStatus,
  overrides: Partial<Pick<SymbolMarketStatusState, 'loading' | 'error' | 'refreshedAt'>> = {},
): SymbolMarketStatusState => ({
  ...status,
  loading: overrides.loading ?? false,
  error: overrides.error ?? null,
  refreshedAt: overrides.refreshedAt ?? null,
  sessionScope: currentScope(),
});

export const getCachedSymbolMarketStatus = (symbol: string): SymbolMarketStatusState | null => {
  const key = normalizeSymbolKey(symbol);
  if (!key) return null;
  const cached = statusCache.get(cacheKey(key));
  if (cached && Date.now() - cached.refreshedAt >= CACHE_TTL_MS) return null;
  return cached ? toState(cached.status, { refreshedAt: cached.refreshedAt }) : null;
};

export const fetchSymbolMarketStatus = async (
  symbol: string,
  options: FetchSymbolMarketStatusOptions = {},
): Promise<NormalizedMarketStatus> => {
  const key = normalizeSymbolKey(symbol);
  if (!key) return createUnavailableMarketStatus(symbol);

  const scope = currentScope();
  const generation = scopeGeneration;
  const requestKey = cacheKey(key, scope);
  const cached = statusCache.get(requestKey);
  if (!options.force && cached && Date.now() - cached.refreshedAt < CACHE_TTL_MS) {
    return cached.status;
  }

  const existingRequest = inflightRequests.get(requestKey);
  if (existingRequest) return existingRequest;

  const requestStartedAt = Date.now();
  const request = marketV2Api.getSymbolStatus(key)
    .then(payload => {
      if (generation !== scopeGeneration || currentScope() !== scope) return createUnavailableMarketStatus(key);
      recordBrokerServerTime((payload as { server_time?: unknown } | null)?.server_time, requestStartedAt);
      const normalized = normalizeMarketStatus(payload, { symbol: key });
      statusCache.set(requestKey, { status: normalized, refreshedAt: Date.now() });
      return normalized;
    })
    .finally(() => {
      if (inflightRequests.get(requestKey) === request) inflightRequests.delete(requestKey);
    });

  inflightRequests.set(requestKey, request);
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
  const sessionScope = useBrokerAccountSessionScope();
  const feedTradable = useLiveSymbolTradingStatus(normalizedSymbol, sessionScope);
  const requestSeqRef = useRef(0);
  const [snapshot, setSnapshot] = useState(() => ({
    scope: sessionScope,
    state: getCachedSymbolMarketStatus(normalizedSymbol)
      ?? toState(createUnavailableMarketStatus(normalizedSymbol), {
        loading: Boolean(enabled && normalizedSymbol),
      }),
  }));
  const state = snapshot.state;
  const setState = useCallback((next: SetStateAction<SymbolMarketStatusState>) => {
    setSnapshot(previous => ({
      scope: sessionScope,
      state: typeof next === 'function'
        ? next(previous.scope === sessionScope
          ? previous.state : toState(createUnavailableMarketStatus(normalizedSymbol)))
        : next,
    }));
  }, [normalizedSymbol, sessionScope]);

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
      if (requestSeqRef.current === requestId && currentScope() === sessionScope) {
        setState(toState(nextStatus, { refreshedAt }));
      }
      return nextStatus;
    } catch (error) {
      const unavailable = createUnavailableMarketStatus(normalizedSymbol);
      if (requestSeqRef.current === requestId && currentScope() === sessionScope) {
        setState(toState(unavailable, {
          error: error instanceof Error ? error.message : 'Failed to load market status',
          refreshedAt: Date.now(),
        }));
      }
      return unavailable;
    }
  }, [enabled, normalizedSymbol, sessionScope, setState]);

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
    const handleCatalogueChange = () => {
      statusCache.delete(cacheKey(normalizedSymbol));
      requestSeqRef.current += 1;
      setState(toState(createUnavailableMarketStatus(normalizedSymbol), { loading: true }));
    };
    const handleCatalogueRefreshed = () => { if (!disposed && isVisible) void refresh(true); };
    window.addEventListener(INSTRUMENT_CATALOGUE_CHANGED_EVENT, handleCatalogueChange);
    window.addEventListener(INSTRUMENT_CATALOGUE_REFRESHED_EVENT, handleCatalogueRefreshed);

    return () => {
      disposed = true;
      requestSeqRef.current += 1;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener(INSTRUMENT_CATALOGUE_CHANGED_EVENT, handleCatalogueChange);
      window.removeEventListener(INSTRUMENT_CATALOGUE_REFRESHED_EVENT, handleCatalogueRefreshed);
    };
  }, [enabled, normalizedSymbol, refresh, setState, visiblePollMs]);

  const selectedState = normalizeSymbolKey(state.symbol) !== normalizedSymbol || snapshot.scope !== sessionScope || state.sessionScope !== sessionScope
    ? getCachedSymbolMarketStatus(normalizedSymbol)
      ?? toState(createUnavailableMarketStatus(normalizedSymbol), {
        loading: Boolean(enabled && normalizedSymbol),
      })
    : state;
  // A fresh explicit hub permission resolves missing schedules; a price alone
  // never grants permission and a known closed/pre/after session still wins.
  return selectedState.status === 'unknown' && feedTradable === true
    ? { ...selectedState, status: 'open', isOpen: true, isTradeBlocked: false, label: 'Market Open' }
    : selectedState;
};
