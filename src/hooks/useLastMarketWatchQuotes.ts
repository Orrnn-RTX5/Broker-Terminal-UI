import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { apiClient, type ApiRequestContext, type ApiRequestOptions } from '../api/client';
import { API_V2_BASE_URL, toLocalDevProxyUrl } from '../config/api';
import {
  getAccessToken,
  getCommittedBrokerAccountSessionScope,
  getCommittedBrokerAccountSessionScopeKey,
  getServerUrl,
} from '../services/brokerSession';
import {
  readMarketWatchQuotes,
  rememberMarketWatchQuote,
} from '../services/marketWatchQuoteCache';
import { useAppStore } from '../store/useAppStore';
import { asUnknownRecord, readBrokerTimestampMs } from '../utils/brokerStreamSemantics';
import { normalizeExactBrokerSymbol } from '../utils/exactBrokerSymbol';

export type MarketWatchLastPrice =
  | { kind: 'quote'; bid: number; ask: number; asOf: number }
  | { kind: 'close'; close: number; asOf: number };

export const LAST_MARKET_WATCH_PRICE_MAX_CONCURRENCY = 4;
const MAX_HISTORY_AGE_MS = 14 * 24 * 60 * 60 * 1000;

interface Options {
  enabled: boolean;
  scopeKey: string | null;
  symbols: readonly string[];
  /** Only confirmed inactive, non-crypto rows may use a candle close. */
  candleSymbols: readonly string[];
}

export interface HydrateLastMarketWatchQuotesOptions {
  scopeKey: string;
  symbols: readonly string[];
  candleSymbols: readonly string[];
  signal?: AbortSignal;
}

const symbolsKey = (symbols: readonly string[]) => Array.from(new Set(
  symbols.map(normalizeExactBrokerSymbol).filter(Boolean),
)).join('\u0000');

const historyRows = (response: unknown, symbol: string, field: 'ticks' | 'candles'): unknown[] => {
  if (Array.isArray(response)) return response;
  const record = asUnknownRecord(response);
  if (!record) return [];
  if (record.symbol && normalizeExactBrokerSymbol(record.symbol) !== symbol) return [];
  if (field === 'candles' && record.timeframe && record.timeframe !== 'M1') return [];
  const rows = record[field] ?? record.data;
  return Array.isArray(rows) ? rows : [];
};

/** Historical prices are display data; they never enter the live tick stores. */
export const resolveLastMarketWatchPrice = (
  response: unknown,
  symbol: string,
  kind: 'quote' | 'close',
  now = Date.now(),
): MarketWatchLastPrice | undefined => {
  const exactSymbol = normalizeExactBrokerSymbol(symbol);
  let latest: MarketWatchLastPrice | undefined;
  for (const value of historyRows(response, exactSymbol, kind === 'quote' ? 'ticks' : 'candles')) {
    const row = asUnknownRecord(value);
    if (!row || (row.symbol && normalizeExactBrokerSymbol(row.symbol) !== exactSymbol)) continue;
    const asOf = readBrokerTimestampMs([row]);
    if (asOf === undefined || asOf > now || asOf < now - MAX_HISTORY_AGE_MS) continue;
    if (latest && latest.asOf >= asOf) continue;
    if (kind === 'quote') {
      const bid = Number(row.bid);
      const ask = Number(row.ask);
      if (Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0) {
        latest = { kind, bid, ask, asOf };
      }
    } else {
      const close = Number(row.close);
      // Some gateways leave the final pre-close minute marked isClosed:false
      // when no next tick arrives. Its recorded close is still usable after
      // that minute has elapsed; a currently forming minute is never used.
      if (Number.isFinite(close) && close > 0 && asOf + 60_000 <= now) {
        latest = { kind, close, asOf };
      }
    }
  }
  return latest;
};

/** Hydrate every requested export row while keeping recovery out of live stores. */
export async function hydrateLastMarketWatchQuotes({
  scopeKey,
  symbols,
  candleSymbols,
  signal,
}: HydrateLastMarketWatchQuotesOptions): Promise<ReadonlyMap<string, MarketWatchLastPrice>> {
  const normalizedSymbols = symbolsKey(symbols).split('\u0000').filter(Boolean);
  const candleSet = new Set(symbolsKey(candleSymbols).split('\u0000').filter(Boolean));
  const ownsScope = () => !signal?.aborted
    && getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope()) === scopeKey;
  if (!ownsScope()) return new Map<string, MarketWatchLastPrice>();
  const cached = readMarketWatchQuotes(scopeKey, normalizedSymbols);
  const values = new Map<string, MarketWatchLastPrice>(
    Object.entries(cached).map(([symbol, quote]) => [symbol, { kind: 'quote' as const, ...quote }]),
  );
  const serverUrl = getServerUrl().replace(/\/+$/, '');
  const baseUrl = serverUrl ? `${toLocalDevProxyUrl(serverUrl)}/api/v2` : API_V2_BASE_URL;
  const state = useAppStore.getState();
  const requestContext: ApiRequestContext = Object.freeze({
    // ApiClient single-flights token refreshes by this identity. Every symbol
    // in one captured broker/account session must therefore share the key.
    key: `market-watch-export:${scopeKey}`,
    backendOrigin: baseUrl.replace(/\/api\/v2\/?$/, ''),
    refreshEndpoint: `${baseUrl}/auth/refresh`,
    refreshToken: state.refreshToken,
  });
  const createRequestOptions = (): ApiRequestOptions => {
    // Token rotation does not change broker/account ownership. Read the latest
    // token for each queued request so workers do not keep replaying the token
    // that triggered a shared refresh earlier in this same export.
    const authToken = getAccessToken() || useAppStore.getState().authToken;
    return {
      baseUrl,
      skipDynamicUrl: true,
      authToken,
      skipAuth: !authToken,
      signal,
      requestContext,
    };
  };
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (ownsScope()) {
      const symbolIndex = nextIndex;
      nextIndex += 1;
      if (symbolIndex >= normalizedSymbols.length) return;
      const symbol = normalizedSymbols[symbolIndex];

      let historicalQuote: MarketWatchLastPrice | undefined;
      try {
        const response = await apiClient.get<unknown>(`/ticks/${encodeURIComponent(symbol)}`, {
          ...createRequestOptions(),
          params: { limit: 1 },
        });
        if (!ownsScope()) return;
        historicalQuote = resolveLastMarketWatchPrice(response, symbol, 'quote');
      } catch {
        // Some brokers retain candles but not tick history.
      }
      if (!ownsScope()) return;
      if (historicalQuote?.kind === 'quote') {
        rememberMarketWatchQuote(scopeKey, symbol, historicalQuote);
        const retained = readMarketWatchQuotes(scopeKey, [symbol])[symbol];
        values.set(symbol, { kind: 'quote', ...(retained ?? historicalQuote) });
        continue;
      }
      if (!candleSet.has(symbol)) continue;
      try {
        const response = await apiClient.get<unknown>(`/candles/${encodeURIComponent(symbol)}`, {
          ...createRequestOptions(),
          params: { timeframe: 'M1', limit: 3 },
        });
        if (!ownsScope()) return;
        const close = resolveLastMarketWatchPrice(response, symbol, 'close');
        const retained = readMarketWatchQuotes(scopeKey, [symbol])[symbol];
        if (close && (!retained || close.asOf > retained.asOf)) values.set(symbol, close);
      } catch {
        // Export remains usable with the values that were available.
      }
    }
  };

  await Promise.all(Array.from({
    length: Math.min(LAST_MARKET_WATCH_PRICE_MAX_CONCURRENCY, normalizedSymbols.length),
  }, () => worker()));
  return ownsScope() ? values : new Map<string, MarketWatchLastPrice>();
}

export function useLastMarketWatchQuotes({ enabled, scopeKey, symbols, candleSymbols }: Options): ReadonlyMap<string, MarketWatchLastPrice> {
  const demandId = useId();
  const normalizedKey = symbolsKey(symbols);
  const candleKey = symbolsKey(candleSymbols);
  const normalizedSymbols = useMemo(() => normalizedKey ? normalizedKey.split('\u0000') : [], [normalizedKey]);
  const candleSet = useMemo(() => new Set(candleKey ? candleKey.split('\u0000') : []), [candleKey]);
  const activeScope = enabled && scopeKey ? scopeKey : null;
  const requestKey = JSON.stringify([activeScope, normalizedKey, candleKey]);
  const [loaded, setLoaded] = useState<{ scopeKey: string | null; values: Map<string, MarketWatchLastPrice> }>({
    scopeKey: null, values: new Map(),
  });
  const loadedRef = useRef(loaded);
  const cached = useMemo(() => activeScope
    ? readMarketWatchQuotes(activeScope, normalizedSymbols)
    : {}, [activeScope, normalizedSymbols]);

  useEffect(() => {
    if (loadedRef.current.scopeKey !== activeScope) {
      loadedRef.current = { scopeKey: activeScope, values: new Map() };
    }
    // Retain recovery only while the symbol still needs it. A live period,
    // removal, or logout must not pin an old close when the symbol returns;
    // it needs a new request to the current broker. Unchanged neighboring
    // rows retain their values and do not trigger redundant history requests.
    const demandedSymbols = new Set(normalizedSymbols);
    loadedRef.current = {
      scopeKey: activeScope,
      values: new Map([...loadedRef.current.values].filter(([symbol]) => (
        activeScope !== null && demandedSymbols.has(symbol)
      ))),
    };
    if (!activeScope || normalizedSymbols.length === 0) return;
    const controller = new AbortController();
    const serverUrl = getServerUrl().replace(/\/+$/, '');
    const baseUrl = serverUrl ? `${toLocalDevProxyUrl(serverUrl)}/api/v2` : API_V2_BASE_URL;
    const state = useAppStore.getState();
    const authToken = getAccessToken() || state.authToken;
    // Capture routing and credentials once: workers must not follow a later
    // account switch while requests for the previous account are completing.
    const options: ApiRequestOptions = {
      baseUrl,
      skipDynamicUrl: true,
      authToken,
      skipAuth: !authToken,
      signal: controller.signal,
      requestContext: {
        key: `market-watch-history:${demandId}:${requestKey}`,
        backendOrigin: baseUrl.replace(/\/api\/v2\/?$/, ''),
        refreshEndpoint: `${baseUrl}/auth/refresh`,
        refreshToken: state.refreshToken,
      },
    };
    let nextIndex = 0;
    const publish = (symbol: string, price: MarketWatchLastPrice) => {
      if (controller.signal.aborted) return;
      const next = {
        scopeKey: activeScope,
        values: new Map(loadedRef.current.values).set(symbol, price),
      };
      loadedRef.current = next;
      setLoaded(next);
    };
    const worker = async () => {
      while (!controller.signal.aborted && nextIndex < normalizedSymbols.length) {
        const symbol = normalizedSymbols[nextIndex++];
        // A neighboring row receiving its first tick or scrolling out of view
        // must not erase and refetch already recovered closing prices.
        const existing = loadedRef.current.values.get(symbol);
        if (existing && (existing.kind === 'quote' || candleSet.has(symbol))) continue;
        let historicalQuote: MarketWatchLastPrice | undefined;
        try {
          const response = await apiClient.get<unknown>(`/ticks/${encodeURIComponent(symbol)}`, {
            ...options, params: { limit: 1 },
          });
          if (controller.signal.aborted) return;
          historicalQuote = resolveLastMarketWatchPrice(response, symbol, 'quote');
        } catch {
          // Brokers may retain candles even when their tick history is absent.
        }
        if (controller.signal.aborted) return;
        if (historicalQuote?.kind === 'quote') {
          rememberMarketWatchQuote(activeScope, symbol, historicalQuote);
          const retained = readMarketWatchQuotes(activeScope, [symbol])[symbol];
          publish(symbol, { kind: 'quote', ...(retained ?? historicalQuote) });
          continue;
        }
        if (!candleSet.has(symbol)) continue;
        try {
          const response = await apiClient.get<unknown>(`/candles/${encodeURIComponent(symbol)}`, {
            ...options, params: { timeframe: 'M1', limit: 3 },
          });
          if (controller.signal.aborted) return;
          const close = resolveLastMarketWatchPrice(response, symbol, 'close');
          const retained = readMarketWatchQuotes(activeScope, [symbol])[symbol];
          if (close && (!retained || close.asOf > retained.asOf)) publish(symbol, close);
        } catch {
          // Existing backend quotes remain visible if optional history fails.
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(LAST_MARKET_WATCH_PRICE_MAX_CONCURRENCY, normalizedSymbols.length) }, worker));
    return () => controller.abort();
  }, [activeScope, candleSet, demandId, normalizedSymbols, requestKey]);

  return useMemo(() => {
    const values = new Map<string, MarketWatchLastPrice>();
    if (!activeScope) return values;
    for (const symbol of normalizedSymbols) {
      const quote = cached[symbol];
      if (quote) values.set(symbol, { kind: 'quote', ...quote });
      const history = loaded.scopeKey === activeScope ? loaded.values.get(symbol) : undefined;
      if (history && (history.kind === 'quote' || candleSet.has(symbol))
        && (!quote || history.asOf >= quote.asOf)) values.set(symbol, history);
    }
    return values;
  }, [activeScope, cached, candleSet, loaded, normalizedSymbols]);
}
