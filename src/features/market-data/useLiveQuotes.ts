import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { apiClient, ApiError } from '../../api/client';
import { API_V2_BASE_URL } from '../../config/api';
import { resolveTickFromLookup, useAppStore } from '../../store/useAppStore';
import { useMarketDataStore } from '../../store/useMarketDataStore';
import { useQuoteSubscription } from '../../hooks/useQuoteSubscription';
import {
  captureApiSession,
  getApiSessionDescriptor,
  getCapturedRequestOptions,
  useBrokerSessionRevision,
} from './marketDataSession';
import {
  dispatchStaleMarketSymbols,
  getSourceTickTimestamp,
  getStaleQuoteFailure,
  normalizeSymbol,
  normalizeTick,
  uniqueSymbols,
  upsertTick,
} from './marketDataNormalization';
import { getLiveQuoteRestBatches } from './useActiveMarketSymbols';

const extractQuoteRows = (response: unknown): unknown[] => {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== 'object') return [];
  const rows = (response as Record<string, unknown>).quotes;
  return Array.isArray(rows) ? rows : [];
};

export function useLiveQuotes(symbols: string[]) {
  const quoteDemandId = useId();
  const normalizedSymbolsKey = JSON.stringify(Array.from(new Set(
    symbols.map(normalizeSymbol).filter(Boolean),
  )));
  const normalizedSymbols = useMemo(
    () => JSON.parse(normalizedSymbolsKey) as string[],
    [normalizedSymbolsKey],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const failureRef = useRef<{
    symbols: string[];
    isStale: boolean;
    tickTimestampsAtFailure: Record<string, number>;
  } | null>(null);
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);
  const accountId = useAppStore((state) => state.accountId);
  const storeAuthToken = useAppStore((state) => state.authToken);
  const storeRefreshToken = useAppStore((state) => state.refreshToken);
  const sessionRevision = useBrokerSessionRevision();
  const quoteSessionDescriptor = useMemo(
    () => {
      void sessionRevision;
      return isAuthenticated ? getApiSessionDescriptor(accountId || 'authenticated') : null;
    },
    [accountId, isAuthenticated, sessionRevision],
  );
  const quoteRequestSession = useMemo(
    () => quoteSessionDescriptor
      ? captureApiSession(quoteSessionDescriptor, storeAuthToken, storeRefreshToken)
      : null,
    [quoteSessionDescriptor, storeAuthToken, storeRefreshToken],
  );
  const quoteApiBaseUrl = quoteSessionDescriptor?.v2BaseUrl ?? API_V2_BASE_URL;

  // Visible quote consumers subscribe immediately in both browser and desktop.
  // QuoteSocketManager selects the public or authenticated broker transport.
  const isQuoteConnected = useQuoteSubscription(normalizedSymbols, `live-quotes:${quoteDemandId}`)?.isConnected ?? false;
  const wasQuoteConnected = useRef(isQuoteConnected);
  const [snapshotRevision, setSnapshotRevision] = useState(0);
  useEffect(() => {
    if (isQuoteConnected && !wasQuoteConnected.current) setSnapshotRevision(value => value + 1);
    wasQuoteConnected.current = isQuoteConnected;
  }, [isQuoteConnected]);

  // Authenticated REST supplies the initial account-scoped quote snapshot.
  // Guests are seeded by the public instrument catalog and updated by the feed;
  // some deployed brokers do not support anonymous v2 quote requests.
  useEffect(() => {
    if (!isAuthenticated) {
      failureRef.current = null;
      setError(null);
      setLoading(false);
      return;
    }

    if (normalizedSymbols.length === 0) {
      setLoading(false);
      if (!failureRef.current?.isStale) {
        failureRef.current = null;
        setError(null);
      }
      return;
    }

    const previousFailure = failureRef.current;
    if (
      previousFailure
      && !previousFailure.isStale
      && !previousFailure.symbols.some((symbol) => normalizedSymbols.includes(symbol))
    ) {
      failureRef.current = null;
      setError(null);
    }

    let cancelled = false;
    const controller = new AbortController();
    const batches = getLiveQuoteRestBatches(normalizedSymbols);

    const loadInitialQuoteBatch = async () => {
      if (cancelled || batches.length === 0) return;
      setLoading(true);
      try {
        // FIX: Load every bounded batch under one captured session; previously
        // only the first 50 symbols received a deterministic REST seed.
        const responses = await Promise.all(batches.map((batch) => apiClient.get<unknown>('/quotes', {
          // FIX: Quotes can be public during the short login handoff. Pin the
          // URL either way; attach captured credentials only when available.
          ...(quoteRequestSession
            ? getCapturedRequestOptions(quoteRequestSession, quoteRequestSession.v2BaseUrl, controller.signal)
            : { baseUrl: quoteApiBaseUrl, skipDynamicUrl: true, skipAuth: true }),
          signal: controller.signal,
          params: { symbols: batch.join(',') },
        })));
        if (cancelled) return;

        const quotes = responses.flatMap(extractQuoteRows);
        const failureAtResponse = failureRef.current;
        const recoveredSymbols = new Set<string>();
        const recoveryTimestamps = new Map<string, number>();
        quotes.forEach((quote) => {
          const tick = normalizeTick(quote);
          if (tick) {
            recoveredSymbols.add(tick.symbol);
            const sourceTimestamp = getSourceTickTimestamp(quote);
            if (sourceTimestamp !== undefined) {
              recoveryTimestamps.set(tick.symbol, sourceTimestamp);
            }

            const marketTick = useMarketDataStore.getState().symbolData[tick.symbol]?.currentTick;
            const appState = useAppStore.getState();
            const existingTick = marketTick
              ?? resolveTickFromLookup(appState.ticks, appState.tickLookup, tick.symbol);
            // FIX: Timestamp-less REST/catalog data may seed an empty symbol,
            // but can never supersede an authoritative WebSocket observation.
            if (sourceTimestamp === undefined && existingTick?.sourceTimestamp !== undefined) return;

            // A timestamp-less REST row may still update prices, but it cannot
            // masquerade as a fresh websocket tick after a stale-symbol error.
            // Preserve the failure-time timestamp until either REST supplies an
            // authoritative newer value or an actual newer live tick arrives.
            const failureTimestamp = failureAtResponse?.isStale
              && failureAtResponse.symbols.includes(tick.symbol)
              && sourceTimestamp === undefined
              ? failureAtResponse.tickTimestampsAtFailure[tick.symbol] ?? 0
              : undefined;
            upsertTick(failureTimestamp === undefined
              ? tick
              : { ...tick, timestamp: failureTimestamp });
          }
        });

        const failure = failureRef.current;
        const allFailedSymbolsRecovered = failure?.symbols.every((symbol) => {
          if (!recoveredSymbols.has(symbol)) return false;
          if (!failure.isStale) return true;

          const recoveryTimestamp = recoveryTimestamps.get(symbol);
          return recoveryTimestamp !== undefined
            && recoveryTimestamp > (failure.tickTimestampsAtFailure[symbol] ?? 0);
        });
        if (failure && failure.symbols.length > 0 && allFailedSymbolsRecovered) {
          failureRef.current = null;
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          const staleFailure = getStaleQuoteFailure(err, normalizedSymbols);
          const failedSymbols = staleFailure.symbols.length > 0
            ? staleFailure.symbols
            : normalizedSymbols;
          const symbolData = useMarketDataStore.getState().symbolData;
          failureRef.current = {
            symbols: uniqueSymbols(failedSymbols),
            isStale: staleFailure.isStale,
            tickTimestampsAtFailure: Object.fromEntries(
              uniqueSymbols(failedSymbols).map((symbol) => [
                symbol,
                symbolData[symbol]?.currentTick?.sourceTimestamp
                  ?? symbolData[symbol]?.currentTick?.timestamp
                  ?? 0,
              ]),
            ),
          };
          if (staleFailure.isStale) dispatchStaleMarketSymbols(staleFailure.symbols);
          setError(err instanceof ApiError ? err.message : 'Failed to load quotes');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadInitialQuoteBatch();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [normalizedSymbols, isAuthenticated, quoteRequestSession, quoteApiBaseUrl, snapshotRevision]);

  // Subscribe in MarketDataStore for aggregation tracking
  useEffect(() => {
    void sessionRevision;
    if (normalizedSymbols.length === 0) return;

    normalizedSymbols.forEach((symbol) => {
      useMarketDataStore.getState().subscribeSymbol(symbol);
    });

    return () => {
      normalizedSymbols.forEach((symbol) => {
        useMarketDataStore.getState().unsubscribeSymbol(symbol);
      });
    };
  }, [normalizedSymbols, sessionRevision]);

  // Clear a stale failure only after every failed symbol receives a fresh
  // websocket tick. Healthy ticks for other symbols must not hide the failure.
  useEffect(() => {
    if (normalizedSymbols.length === 0) return;

    const unsub = useMarketDataStore.subscribe((state) => {
      const failure = failureRef.current;
      if (!failure?.isStale || failure.symbols.length === 0) return;

      const now = Date.now();
      const failedSymbolsInScope = failure.symbols.filter((symbol) => normalizedSymbols.includes(symbol));
      if (failedSymbolsInScope.length !== failure.symbols.length) return;

      const allFailedSymbolsRecovered = failedSymbolsInScope.every((symbol) => {
        const tick = state.symbolData[symbol]?.currentTick;
        const sourceTimestamp = tick?.sourceTimestamp;
        return Boolean(
          tick
          && tick.bid > 0
          && tick.ask > 0
          && sourceTimestamp !== undefined
          && sourceTimestamp > now - 60000
          && sourceTimestamp > (failure.tickTimestampsAtFailure[symbol] ?? 0)
        );
      });

      if (allFailedSymbolsRecovered && failureRef.current === failure) {
        failureRef.current = null;
        setError(null);
      }
    });

    return unsub;
  }, [normalizedSymbols]);

  return { loading, error };
}
