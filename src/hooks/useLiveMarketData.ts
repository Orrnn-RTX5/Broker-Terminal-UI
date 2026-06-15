import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient, ApiError } from '../api/client';
import { API_V2_BASE_URL, MARKET_WS_URL } from '../config/api';
import { getEnhancedWebSocketService } from '../services/websocket-enhanced';
import { enqueueLiveTick } from '../services/liveTickDispatcher';
import { resolveTickFromLookup, useAppStore, type Tick as AppTick } from '../store/useAppStore';
import { type Tick, useMarketDataStore } from '../store/useMarketDataStore';
import { useWatchlistStore } from '../store/useWatchlistStore';
import { useQuoteSubscription } from './useQuoteSubscription';

export interface MarketInstrument {
  symbol: string;
  description?: string;
  category?: string;
  digits?: number;
  bid?: number;
  ask?: number;
  contractSize?: number;
  tradingEnabled?: boolean;
}

export interface OrderBookLevel {
  price: number;
  volume: number;
  total: number;
}

export interface LiveOrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spread: number;
  spreadPips: number;
  timestamp: number;
}

const normalizeSymbol = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toUpperCase() : '';

const toNumber = (value: unknown, fallback = 0): number => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const toOptionalNumber = (value: unknown): number | undefined => {
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
};

const timestampToMs = (value: unknown): number => {
  const raw = toNumber(value, Date.now());
  return raw > 1_000_000_000_000 ? raw : raw * 1000;
};

const getSymbolDigits = (symbol: string): number => {
  if (symbol.includes('JPY')) return 3;
  if (symbol.startsWith('BTC') || symbol.startsWith('ETH')) return 2;
  if (symbol.startsWith('XAU') || symbol.startsWith('XAG')) return 2;
  return 5;
};

const getSpreadPips = (symbol: string, spread: number): number => {
  const digits = getSymbolDigits(symbol);
  const pipFactor = digits >= 5 ? 10000 : Math.pow(10, digits);
  return spread * pipFactor;
};

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on', 'enabled', 'enable', 'active', 'available', 'tradable', 'trading']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'off', 'disabled', 'disable', 'inactive', 'suspended', 'halted', 'blocked', 'readonly', 'read_only', 'deleted', 'delisted', 'expired', 'close_only']);

const hasOwn = (value: unknown, key: string): boolean =>
  Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));

const parseBooleanish = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    if (value === 0) return false;
    if (value === 1) return true;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!normalized) return undefined;
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
  }
  return undefined;
};

export const normalizeInstrumentEnabled = (raw: any): boolean | undefined => {
  const enabledKeys = ['trading_enabled', 'tradingEnabled', 'enabled', 'is_enabled', 'isEnabled'];

  for (const key of enabledKeys) {
    if (!hasOwn(raw, key)) continue;
    const parsed = parseBooleanish(raw?.[key]);
    if (parsed !== undefined) return parsed;
  }

  if (hasOwn(raw, 'status')) {
    return parseBooleanish(raw?.status);
  }

  return undefined;
};

const normalizeInstrument = (raw: any): MarketInstrument | null => {
  const symbol = normalizeSymbol(raw?.symbol ?? raw?.name ?? raw?.id ?? raw);
  if (!symbol) return null;

  return {
    symbol,
    description: raw?.description ?? raw?.display_name ?? raw?.name,
    category: raw?.category ?? raw?.asset_class ?? raw?.type,
    digits: toOptionalNumber(raw?.digits),
    bid: toOptionalNumber(raw?.bid),
    ask: toOptionalNumber(raw?.ask),
    contractSize: toOptionalNumber(raw?.contract_size ?? raw?.contractSize),
    tradingEnabled: normalizeInstrumentEnabled(raw),
  };
};

const normalizeTick = (raw: any, fallbackSymbol?: string): (Tick & Partial<AppTick>) | null => {
  const payload = raw?.data?.quote ?? raw?.data?.tick ?? raw?.data ?? raw?.quote ?? raw?.tick ?? raw;
  const symbol = normalizeSymbol(payload?.symbol ?? raw?.symbol ?? fallbackSymbol);
  if (!symbol) return null;

  const bid = toNumber(payload?.bid);
  const ask = toNumber(payload?.ask, bid);
  if (bid <= 0 && ask <= 0) return null;

  const spread = toNumber(payload?.spread, ask - bid);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : bid || ask;
  const previousClose = toNumber(payload?.previous_close ?? payload?.previousClose);
  const dailyOpen = toNumber(payload?.daily_open ?? payload?.dailyOpen ?? payload?.open);
  const dailyReference = previousClose > 0 ? previousClose : dailyOpen;
  const session = payload?.session ?? {};
  const sessionHigh = Math.max(
    toNumber(session?.high_bid),
    toNumber(session?.high_ask),
    toNumber(payload?.high)
  );
  const sessionLowValues = [
    toNumber(session?.low_bid),
    toNumber(session?.low_ask),
    toNumber(payload?.low),
  ].filter((value) => value > 0);
  const sessionLow = sessionLowValues.length > 0 ? Math.min(...sessionLowValues) : undefined;

  return {
    symbol,
    bid,
    ask,
    spread,
    timestamp: timestampToMs(payload?.timestamp ?? payload?.time ?? raw?.timestamp),
    lp: payload?.lp,
    volume: toNumber(payload?.volume, 1),
    dailyChange: payload?.dailyChange !== undefined
      ? toNumber(payload.dailyChange)
      : dailyReference > 0
        ? ((mid - dailyReference) / dailyReference) * 100
        : undefined,
    high24h: payload?.high24h !== undefined ? toNumber(payload.high24h) : sessionHigh || undefined,
    low24h: payload?.low24h !== undefined ? toNumber(payload.low24h) : sessionLow,
    high: payload?.high !== undefined ? toNumber(payload.high) : undefined,
    low: payload?.low !== undefined ? toNumber(payload.low) : undefined,
    open: dailyOpen || undefined,
    close: (previousClose > 0 || payload?.close !== undefined) ? toNumber(payload?.close ?? previousClose) : undefined,
  };
};

const withTotals = (levels: any[]): OrderBookLevel[] => {
  let runningTotal = 0;
  return levels
    .map((level) => {
      const price = toNumber(Array.isArray(level) ? level[0] : level?.price);
      const volume = toNumber(Array.isArray(level) ? level[1] : level?.volume);
      runningTotal += volume;
      return { price, volume, total: toNumber(level?.total, runningTotal) };
    })
    .filter((level) => level.price > 0 && level.volume >= 0);
};

export const normalizeOrderBook = (raw: any, fallbackSymbol?: string): LiveOrderBook | null => {
  const payload = raw?.data?.orderBook ?? raw?.data?.depth ?? raw?.data ?? raw?.orderBook ?? raw?.depth ?? raw;
  const symbol = normalizeSymbol(payload?.symbol ?? raw?.symbol ?? fallbackSymbol);
  const bids = withTotals(Array.isArray(payload?.bids) ? payload.bids : []);
  const asks = withTotals(Array.isArray(payload?.asks) ? payload.asks : []);
  if (!symbol || (bids.length === 0 && asks.length === 0)) return null;

  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const spread = bestBid > 0 && bestAsk > 0 ? bestAsk - bestBid : 0;

  return {
    symbol,
    bids,
    asks,
    spread,
    spreadPips: getSpreadPips(symbol, spread),
    timestamp: timestampToMs(payload?.timestamp ?? payload?.time ?? raw?.timestamp),
  };
};

const upsertTick = (tick: Tick & Partial<AppTick>): void => {
  enqueueLiveTick(tick.symbol, tick);
};

const hasUsablePrice = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const upsertInstrumentTickSnapshot = (instrument: MarketInstrument): void => {
  if (!hasUsablePrice(instrument.bid) && !hasUsablePrice(instrument.ask)) return;

  const appState = useAppStore.getState();
  const existingTick = resolveTickFromLookup(appState.ticks, appState.tickLookup, instrument.symbol);
  if (existingTick && (existingTick.bid > 0 || existingTick.ask > 0)) return;

  const bid = hasUsablePrice(instrument.bid) ? instrument.bid : instrument.ask!;
  const ask = hasUsablePrice(instrument.ask) ? instrument.ask : instrument.bid!;

  upsertTick({
    symbol: instrument.symbol,
    bid,
    ask,
    spread: Math.max(0, ask - bid),
    timestamp: Date.now(),
    volume: 1,
    digits: instrument.digits,
  });
};

const upsertInstrumentTickSnapshots = (instruments: MarketInstrument[]): void => {
  instruments.forEach(upsertInstrumentTickSnapshot);
};

const toV2Endpoint = (endpoint: string): string =>
  endpoint.replace(/^\/api\/v2(?=\/|$)/, '') || '/';

const getApiRootBaseUrl = (): string => API_V2_BASE_URL.replace(/\/api\/v2\/?$/, '');

const resolveRestEndpoint = (endpoint: string): { baseUrl: string; endpoint: string } =>
  endpoint.startsWith('/api/v2')
    ? { baseUrl: API_V2_BASE_URL, endpoint: toV2Endpoint(endpoint) }
    : { baseUrl: getApiRootBaseUrl(), endpoint };

const fetchJson = async <T,>(endpoint: string, params?: Record<string, unknown>): Promise<T> =>
  {
    const request = resolveRestEndpoint(endpoint);
    return apiClient.get<T>(request.endpoint, { baseUrl: request.baseUrl, params });
  };

const putJson = async <T,>(endpoint: string, body: unknown): Promise<T> =>
  apiClient.put<T>(toV2Endpoint(endpoint), body, { baseUrl: API_V2_BASE_URL });

const sameSymbols = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((symbol, index) => symbol === b[index]);

export const LIVE_QUOTES_REST_BATCH_SIZE = 50;
export const LIVE_QUOTES_REST_POLL_INTERVAL_MS = 15000;

export const getLiveQuoteRestBatches = (
  symbols: string[],
  batchSize = LIVE_QUOTES_REST_BATCH_SIZE
): string[][] => {
  const size = Math.max(1, Math.floor(batchSize));
  const batches: string[][] = [];

  for (let index = 0; index < symbols.length; index += size) {
    batches.push(symbols.slice(index, index + size));
  }

  return batches;
};

const extractInstrumentRows = (response: any): any[] => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.symbols)) return response.symbols;
  if (Array.isArray(response?.instruments)) return response.instruments;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.result)) return response.result;
  return [];
};

export function useMarketInstruments() {
  const [symbols, setSymbols] = useState<MarketInstrument[]>([]);
  const [disabledSymbols, setDisabledSymbols] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);

  const reload = useCallback(async () => {
    if (!isAuthenticated) {
      setSymbols([]);
      setDisabledSymbols([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const endpoints = ['/api/v2/instruments', '/api/v1/market/symbols', '/api/v1/market/symbol-list'];
    try {
      for (const endpoint of endpoints) {
        try {
          const response = await fetchJson<any>(endpoint);
          const raw = extractInstrumentRows(response);
          const normalized = raw.map(normalizeInstrument).filter(Boolean) as MarketInstrument[];
          if (normalized.length > 0) {
            const disabled = normalized
              .filter((instrument) => instrument.tradingEnabled === false)
              .map((instrument) => instrument.symbol);
            const next = normalized.filter((instrument) => instrument.tradingEnabled !== false);
            setDisabledSymbols(disabled);
            setSymbols(next);
            upsertInstrumentTickSnapshots(next);
            return;
          }
        } catch (err) {
          if (endpoint === endpoints[endpoints.length - 1]) {
            setError(err instanceof ApiError ? err.message : 'Failed to load symbols');
          }
        }
      }

      setSymbols([]);
      setDisabledSymbols([]);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    let cancelled = false;
    reload().finally(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  return { symbols, disabledSymbols, loading, error, reload };
}

export function useLiveQuotes(symbols: string[]) {
  const normalizedSymbols = useMemo(
    () => Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean))),
    [symbols.join('|')]
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);

  // Section 2: Use QuoteSocketManager via useQuoteSubscription for /ws/feed
  useQuoteSubscription(normalizedSymbols, 'live-quotes');

  // REST polling fallback (still needed for initial quote snapshot)
  useEffect(() => {
    if (normalizedSymbols.length === 0 || !isAuthenticated) {
      setError(null);
      return;
    }

    let cancelled = false;
    let batchIndex = 0;
    let inFlight = false;
    const batches = getLiveQuoteRestBatches(normalizedSymbols);

    const loadNextQuoteBatch = async () => {
      if (cancelled || inFlight || batches.length === 0) return;
      const batch = batches[batchIndex % batches.length];
      batchIndex = (batchIndex + 1) % batches.length;

      inFlight = true;
      setLoading(true);
      setError(null);
      try {
        const response = await fetchJson<any>('/api/v2/quotes', {
          symbols: batch.join(','),
        });
        const quotes = Array.isArray(response) ? response : response?.quotes ?? [];
        quotes.forEach((quote: any) => {
          const tick = normalizeTick(quote);
          if (tick) upsertTick(tick);
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load quotes');
      } finally {
        inFlight = false;
        if (!cancelled) setLoading(false);
      }
    };

    void loadNextQuoteBatch();
    const interval = window.setInterval(() => {
      void loadNextQuoteBatch();
    }, LIVE_QUOTES_REST_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [normalizedSymbols.join('|'), isAuthenticated]);

  // Subscribe in MarketDataStore for aggregation tracking
  useEffect(() => {
    if (normalizedSymbols.length === 0 || !isAuthenticated) return;

    normalizedSymbols.forEach((symbol) => {
      useMarketDataStore.getState().subscribeSymbol(symbol);
    });

    return () => {
      normalizedSymbols.forEach((symbol) => {
        useMarketDataStore.getState().unsubscribeSymbol(symbol);
      });
    };
  }, [normalizedSymbols.join('|'), isAuthenticated]);

  return { loading, error };
}

export function useLiveOrderBook(symbol: string, depth: number) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const [orderBook, setOrderBook] = useState<LiveOrderBook | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);
  const authToken = useAppStore((state) => state.authToken);

  const reload = useCallback(async () => {
    if (!normalizedSymbol || !isAuthenticated) {
      setOrderBook(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetchJson<any>(`/api/v2/depth/${encodeURIComponent(normalizedSymbol)}`, {
        limit: depth,
      });
      const next = normalizeOrderBook(response, normalizedSymbol);
      setOrderBook(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load order book');
      setOrderBook(null);
    } finally {
      setLoading(false);
    }
  }, [normalizedSymbol, depth, isAuthenticated]);

  useEffect(() => {
    reload();
    const interval = window.setInterval(reload, 15000);
    return () => window.clearInterval(interval);
  }, [reload]);

  useEffect(() => {
    if (!normalizedSymbol || !isAuthenticated) return;

    const ws = getEnhancedWebSocketService(MARKET_WS_URL);
    ws.connect();
    const channel = `depth.${normalizedSymbol}`;
    const unsubscribe = ws.subscribe(channel, (message) => {
      const next = normalizeOrderBook(message, normalizedSymbol);
      if (next) setOrderBook(next);
    });

    return () => {
      unsubscribe();
    };
  }, [normalizedSymbol, isAuthenticated, authToken]);

  return { orderBook, loading, error, reload };
}

export function useRemoteWatchlistSync(watchlistId?: string) {
  const symbols = useWatchlistStore((state) => {
    const active = state.watchlists.find((watchlist) => watchlist.id === (watchlistId || state.activeWatchlistId));
    return active?.symbols ?? [];
  });
  const activeWatchlistId = useWatchlistStore((state) => watchlistId || state.activeWatchlistId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const applyingRemoteRef = useRef(false);
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);

  const reload = useCallback(async () => {
    if (!activeWatchlistId || !isAuthenticated) {
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetchJson<any>('/api/v2/watchlist');
      const remoteSymbols = (Array.isArray(response) ? response : response?.items ?? [])
        .map((item: any) => normalizeSymbol(item?.symbol ?? item))
        .filter(Boolean);

      if (!sameSymbols(remoteSymbols, useWatchlistStore.getState().getWatchlistById(activeWatchlistId)?.symbols ?? [])) {
        applyingRemoteRef.current = true;
        useWatchlistStore.getState().reorderSymbols(activeWatchlistId, remoteSymbols);
        window.setTimeout(() => {
          applyingRemoteRef.current = false;
        }, 0);
      }
      hasLoadedRef.current = true;
    } catch (err) {
      console.warn('[Watchlist Sync] Failed to load remote watchlist:', err);
      setError(err instanceof ApiError ? err.message : 'Failed to load watchlist');
      hasLoadedRef.current = true;
    } finally {
      setLoading(false);
    }
  }, [activeWatchlistId, isAuthenticated]);

  useEffect(() => {
    hasLoadedRef.current = false;
    applyingRemoteRef.current = false;
    reload();
  }, [reload]);

  useEffect(() => {
    if (!activeWatchlistId || !hasLoadedRef.current || applyingRemoteRef.current || !isAuthenticated) return;
    const cleanSymbols = Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));
    const timeout = window.setTimeout(() => {
      putJson('/api/v2/watchlist', { symbols: cleanSymbols }).catch((err) => {
        console.warn('[Watchlist Sync] Failed to save remote watchlist:', err);
        setError(err instanceof ApiError ? err.message : 'Failed to save watchlist');
      });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [activeWatchlistId, symbols.join('|'), isAuthenticated]);

  return { loading, error, reload };
}
