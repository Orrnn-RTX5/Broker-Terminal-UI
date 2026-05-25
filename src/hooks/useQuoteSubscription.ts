/**
 * useQuoteSubscription — React hook for Section 2 (Quotes /ws/feed)
 *
 * Registers demand with QuoteSocketManager. On mount, symbols are added to the
 * merged demand set. On unmount, they're removed (triggering unsubscribe if
 * no other consumer needs them).
 *
 * Usage:
 *   const { isConnected } = useQuoteSubscription(['EURUSD', 'GBPUSD'], 'watchlist-main');
 */

import { useEffect, useRef, useMemo } from 'react';
import { getQuoteSocketManager } from '../services/quoteSocketManager';
import { useAppStore } from '../store/useAppStore';

const normalizeSymbol = (v: unknown): string =>
  typeof v === 'string' ? v.trim().toUpperCase() : '';

export interface UseQuoteSubscriptionReturn {
  isConnected: boolean;
}

export function useQuoteSubscription(
  symbols: string[],
  sourceId: string,
): UseQuoteSubscriptionReturn {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  // Stable normalized symbol list
  const normalizedSymbols = useMemo(
    () => Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbols.join('|')],
  );

  const managerRef = useRef(getQuoteSocketManager());

  // Register/update demand when symbols change
  useEffect(() => {
    console.log(`[useQuoteSubscription] effect — isAuthenticated=${isAuthenticated}, symbols=${normalizedSymbols.length}, sourceId=${sourceId}`);

    if (!isAuthenticated || normalizedSymbols.length === 0) {
      managerRef.current.removeDemand(sourceId);
      return;
    }

    managerRef.current.setDemand(sourceId, normalizedSymbols);

    return () => {
      managerRef.current.removeDemand(sourceId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedSymbols.join('|'), sourceId, isAuthenticated]);

  return {
    isConnected: managerRef.current.isConnected(),
  };
}
