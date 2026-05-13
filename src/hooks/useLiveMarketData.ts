import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient, ApiError } from '../api/client';
import { API_V2_BASE_URL, MARKET_WS_URL } from '../config/api';
import { getEnhancedWebSocketService } from '../services/websocket-enhanced';
import { useAppStore, type Tick as AppTick } from '../store/useAppStore';
import { type Tick, useMarketDataStore } from '../store/useMarketDataStore';
import { useWatchlistStore } from '../store/useWatchlistStore';

export interface MarketInstrument {
  symbol: string;
  description?: string;
  category?: string;
  digits?: number;
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

const normalizeInstrument = (raw: any): MarketInstrument | null => {
  const symbol = normalizeSymbol(raw?.symbol ?? raw?.name ?? raw?.id ?? raw);
  if (!symbol) return null;

  return {
    symbol,
    description: raw?.description ?? raw?.display_name ?? raw?.name,
    category: raw?.category ?? raw?.asset_class ?? raw?.type,
    digits: raw?.digits !== undefined ? toNumber(raw.digits) : undefined,
    contractSize: raw?.contract_size !== undefined ? toNumber(raw.contract_size) : toNumber(raw?.contractSize, undefined as any),
    tradingEnabled: raw?.trading_enabled ?? raw?.tradingEnabled ?? raw?.enabled,
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
  useMarketDataStore.getState().updateTick(tick.symbol, tick);
  useAppStore.getState().setTick(tick.symbol, tick as AppTick);
};

const toV2Endpoint = (endpoint: string): string =>
  endpoint.replace(/^\/api\/v2(?=\/|$)/, '') || '/';

const fetchJson = async <T,>(endpoint: string, params?: Record<string, unknown>): Promise<T> =>
  apiClient.get<T>(toV2Endpoint(endpoint), { baseUrl: API_V2_BASE_URL, params });

const putJson = async <T,>(endpoint: string, body: unknown): Promise<T> =>
  apiClient.put<T>(toV2Endpoint(endpoint), body, { baseUrl: API_V2_BASE_URL });

const sameSymbols = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((symbol, index) => symbol === b[index]);

export function useMarketInstruments() {
  const [symbols, setSymbols] = useState<MarketInstrument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);

    const endpoints = ['/api/v2/instruments'];
    try {
      for (const endpoint of endpoints) {
        try {
          const response = await fetchJson<any>(endpoint);
          const raw = Array.isArray(response) ? response : response?.symbols ?? response?.instruments ?? [];
          const next = raw.map(normalizeInstrument).filter(Boolean) as MarketInstrument[];
          if (next.length > 0) {
            setSymbols(next);
            return;
          }
        } catch (err) {
          if (endpoint === endpoints[endpoints.length - 1]) {
            setError(err instanceof ApiError ? err.message : 'Failed to load symbols');
          }
        }
      }

      setSymbols([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    reload().finally(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  return { symbols, loading, error, reload };
}

export function useLiveQuotes(symbols: string[]) {
  const normalizedSymbols = useMemo(
    () => Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean))),
    [symbols.join('|')]
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (normalizedSymbols.length === 0) return;

    let cancelled = false;
    const loadQuotes = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchJson<any>('/api/v2/quotes', {
          symbols: normalizedSymbols.join(','),
        });
        const quotes = Array.isArray(response) ? response : response?.quotes ?? [];
        quotes.forEach((quote: any) => {
          const tick = normalizeTick(quote);
          if (tick) upsertTick(tick);
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load quotes');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadQuotes();
    const interval = window.setInterval(loadQuotes, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [normalizedSymbols.join('|')]);

  useEffect(() => {
    if (normalizedSymbols.length === 0) return;

    const ws = getEnhancedWebSocketService(MARKET_WS_URL);
    ws.connect();

    const unsubscribers: Array<() => void> = [];

    normalizedSymbols.forEach((symbol) => {
      const channel = `ticks.${symbol}`;
      unsubscribers.push(ws.subscribe(channel, (message) => {
        const tick = normalizeTick(message, symbol);
        if (tick) upsertTick(tick);
      }));
      useMarketDataStore.getState().subscribeSymbol(symbol);
    });

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      normalizedSymbols.forEach((symbol) => {
        useMarketDataStore.getState().unsubscribeSymbol(symbol);
      });
    };
  }, [normalizedSymbols.join('|')]);

  return { loading, error };
}

export function useLiveOrderBook(symbol: string, depth: number) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const [orderBook, setOrderBook] = useState<LiveOrderBook | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!normalizedSymbol) return;
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
  }, [normalizedSymbol, depth]);

  useEffect(() => {
    reload();
    const interval = window.setInterval(reload, 15000);
    return () => window.clearInterval(interval);
  }, [reload]);

  useEffect(() => {
    if (!normalizedSymbol) return;

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
  }, [normalizedSymbol]);

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

  const reload = useCallback(async () => {
    if (!activeWatchlistId) return;
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
      setError(err instanceof ApiError ? err.message : 'Failed to load watchlist');
      hasLoadedRef.current = true;
    } finally {
      setLoading(false);
    }
  }, [activeWatchlistId]);

  useEffect(() => {
    hasLoadedRef.current = false;
    applyingRemoteRef.current = false;
    reload();
  }, [reload]);

  useEffect(() => {
    if (!activeWatchlistId || !hasLoadedRef.current || applyingRemoteRef.current) return;
    const cleanSymbols = Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));
    const timeout = window.setTimeout(() => {
      putJson('/api/v2/watchlist', { symbols: cleanSymbols }).catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Failed to save watchlist');
      });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [activeWatchlistId, symbols.join('|')]);

  return { loading, error, reload };
}
