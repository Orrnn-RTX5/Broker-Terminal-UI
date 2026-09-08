import { useEffect, useMemo, useState } from 'react';
import { chartDataService } from '../services/chartDataService';
import {
  readMarketWatchDailyChange,
  readMarketWatchDailyChanges,
  rememberMarketWatchDailyChange,
  resolveCompletedDailyChange,
} from '../services/marketWatchDailyChangeCache';
import { normalizeExactBrokerSymbol } from '../utils/exactBrokerSymbol';

export const CLOSED_MARKET_DAILY_CHANGE_MAX_CONCURRENCY = 4;

export interface UseClosedMarketDailyChangesOptions {
  enabled: boolean;
  scopeKey: string | null;
  symbols: readonly string[];
}

interface HistoryValuesState {
  requestKey: string;
  values: Record<string, number>;
}

const EMPTY_VALUES: Record<string, number> = Object.freeze({});

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
);

/**
 * Resolves display-only Daily Change fallbacks for closed Market Watch rows.
 *
 * The caller owns market-status and asset-class eligibility. This hook only
 * hydrates the supplied exact broker symbols from their account-scoped cache,
 * then refreshes those values from the two latest completed D1 candles. It
 * deliberately does not publish ticks or change any trading eligibility.
 */
export function useClosedMarketDailyChanges({
  enabled,
  scopeKey,
  symbols,
}: UseClosedMarketDailyChangesOptions): ReadonlyMap<string, number> {
  const normalizedSymbolsKey = Array.from(new Set(
    symbols.map(normalizeExactBrokerSymbol).filter(Boolean),
  )).join('\u0000');
  const normalizedSymbols = useMemo(
    () => normalizedSymbolsKey ? normalizedSymbolsKey.split('\u0000') : [],
    [normalizedSymbolsKey],
  );
  const activeScopeKey = typeof scopeKey === 'string' && scopeKey.trim() ? scopeKey : null;
  const requestKey = JSON.stringify([
    enabled && activeScopeKey ? activeScopeKey : null,
    enabled ? normalizedSymbols : [],
  ]);

  const cachedValues = useMemo(() => {
    if (!enabled || !activeScopeKey || normalizedSymbols.length === 0) return EMPTY_VALUES;
    return readMarketWatchDailyChanges(activeScopeKey, normalizedSymbols);
  }, [activeScopeKey, enabled, normalizedSymbols]);

  const [historyState, setHistoryState] = useState<HistoryValuesState>({
    requestKey: '',
    values: EMPTY_VALUES,
  });

  useEffect(() => {
    if (!enabled || !activeScopeKey || normalizedSymbols.length === 0) return undefined;

    const controller = new AbortController();
    let disposed = false;
    let nextSymbolIndex = 0;

    const publishPersistedValue = (symbol: string): void => {
      if (disposed || controller.signal.aborted) return;
      const persisted = readMarketWatchDailyChange(activeScopeKey, symbol);
      if (!isFiniteNumber(persisted)) return;

      setHistoryState((current) => ({
        requestKey,
        values: {
          ...(current.requestKey === requestKey ? current.values : EMPTY_VALUES),
          [symbol]: persisted,
        },
      }));
    };

    const loadNext = async (): Promise<void> => {
      while (!disposed && !controller.signal.aborted) {
        const symbolIndex = nextSymbolIndex;
        nextSymbolIndex += 1;
        if (symbolIndex >= normalizedSymbols.length) return;

        const symbol = normalizedSymbols[symbolIndex];
        try {
          const candles = await chartDataService.fetchCandles({
            symbol,
            timeframe: 'D1',
            count: 8,
            signal: controller.signal,
          });
          if (disposed || controller.signal.aborted) return;

          const resolved = resolveCompletedDailyChange(candles);
          if (!resolved || !isFiniteNumber(resolved.value)) continue;

          rememberMarketWatchDailyChange(
            activeScopeKey,
            symbol,
            resolved.value,
            resolved.asOf,
            'history',
          );
          publishPersistedValue(symbol);
        } catch {
          // Closed-market history is a best-effort display fallback. Cached
          // values remain authoritative when a broker history request fails.
        }
      }
    };

    const workerCount = Math.min(
      CLOSED_MARKET_DAILY_CHANGE_MAX_CONCURRENCY,
      normalizedSymbols.length,
    );
    void Promise.all(Array.from({ length: workerCount }, () => loadNext()));

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [activeScopeKey, enabled, normalizedSymbols, requestKey]);

  return useMemo(() => {
    if (!enabled || !activeScopeKey) return new Map<string, number>();

    const historyValues = historyState.requestKey === requestKey
      ? historyState.values
      : EMPTY_VALUES;
    const values = new Map<string, number>();

    normalizedSymbols.forEach((symbol) => {
      const historyValue = historyValues[symbol];
      const cachedValue = cachedValues[symbol];
      const value = isFiniteNumber(historyValue) ? historyValue : cachedValue;
      if (isFiniteNumber(value)) values.set(symbol, value);
    });

    return values;
  }, [activeScopeKey, cachedValues, enabled, historyState, normalizedSymbols, requestKey]);
}
