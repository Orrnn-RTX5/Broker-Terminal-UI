import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { ApiError } from '../../api/client';
import { MARKET_WS_URL } from '../../config/api';
import {
  getAccountSpreadMarkupMap,
  onAccountSpreadMarkupChange,
} from '../../services/accountSpreadMarkup';
import { getEnhancedWebSocketService } from '../../services/websocket-enhanced';
import { useAppStore } from '../../store/useAppStore';
import {
  applySpreadMarkupToBookLevels,
  normalizeSpreadMarkupSymbol,
  roundPriceToDigits,
  type SpreadMarkupMap,
} from '../../utils/spreadMarkup';
import { fetchMarketDataJson } from './marketDataSession';
import {
  getSpreadPips,
  normalizeOrderBook,
  normalizeSymbol,
} from './marketDataNormalization';
import type { LiveOrderBook } from './marketDataTypes';

/** Depth levels widened like the account's top-of-book quote. */
export const applySpreadMarkupToOrderBook = (
  orderBook: LiveOrderBook | null,
  markupMap: SpreadMarkupMap,
): LiveOrderBook | null => {
  if (!orderBook) return orderBook;
  const entry = markupMap.get(normalizeSpreadMarkupSymbol(orderBook.symbol));
  if (!entry) return orderBook;
  const bids = applySpreadMarkupToBookLevels(orderBook.bids, 'bid', entry);
  const asks = applySpreadMarkupToBookLevels(orderBook.asks, 'ask', entry);
  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const spread = bestBid > 0 && bestAsk > 0
    ? roundPriceToDigits(bestAsk - bestBid, entry.digits)
    : 0;
  return {
    ...orderBook,
    bids,
    asks,
    spread,
    spreadPips: getSpreadPips(orderBook.symbol, spread, entry.digits),
  };
};

const useAccountSpreadMarkupMap = (): SpreadMarkupMap =>
  useSyncExternalStore(onAccountSpreadMarkupChange, getAccountSpreadMarkupMap, getAccountSpreadMarkupMap);

export function useLiveOrderBook(symbol: string, depth: number) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const [rawOrderBook, setOrderBook] = useState<LiveOrderBook | null>(null);
  const spreadMarkupMap = useAccountSpreadMarkupMap();
  const orderBook = useMemo(
    () => applySpreadMarkupToOrderBook(rawOrderBook, spreadMarkupMap),
    [rawOrderBook, spreadMarkupMap],
  );
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
      const response = await fetchMarketDataJson<unknown>(`/api/v2/depth/${encodeURIComponent(normalizedSymbol)}`, {
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
    void reload();
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
