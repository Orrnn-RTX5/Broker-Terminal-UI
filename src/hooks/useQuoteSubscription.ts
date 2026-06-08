/**
 * useQuoteSubscription - React hook for Section 2 (Quotes /ws/feed)
 *
 * Registers demand with QuoteSocketManager. On mount, symbols are added to the
 * merged demand set. On unmount, they're removed when no other consumer needs them.
 *
 * Usage:
 *   const { isConnected } = useQuoteSubscription(['EURUSD', 'GBPUSD'], 'watchlist-main');
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { getQuoteSocketManager } from '../services/quoteSocketManager';
import { useAppStore } from '../store/useAppStore';
import { getAccessToken, getServerUrl, onSessionChange } from '../services/brokerSession';
import { debugLog } from '../utils/debugLogging';

const normalizeSymbol = (v: unknown): string =>
  typeof v === 'string' ? v.trim().toUpperCase() : '';

export interface UseQuoteSubscriptionReturn {
  isConnected: boolean;
}

const hasReadyStoredBrokerSession = (): boolean =>
  Boolean(getServerUrl() && getAccessToken());

export function useQuoteSubscription(
  symbols: string[],
  sourceId: string,
): UseQuoteSubscriptionReturn {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const storeAuthToken = useAppStore((s) => s.authToken);
  const [sessionRevision, setSessionRevision] = useState(0);

  useEffect(() => {
    return onSessionChange(() => setSessionRevision((revision) => revision + 1));
  }, []);

  const normalizedSymbols = useMemo(
    () => Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbols.join('|')],
  );

  const managerRef = useRef(getQuoteSocketManager());
  const storedBrokerSessionReady = hasReadyStoredBrokerSession();
  const canSubscribe = isAuthenticated || storedBrokerSessionReady;

  useEffect(() => {
    const manager = managerRef.current;
    debugLog(`[useQuoteSubscription] effect - isAuthenticated=${isAuthenticated}, storedSession=${storedBrokerSessionReady}, symbols=${normalizedSymbols.length}, sourceId=${sourceId}`);

    if (!canSubscribe || normalizedSymbols.length === 0) {
      manager.removeDemand(sourceId);
      return;
    }

    manager.setDemand(sourceId, normalizedSymbols);

    return () => {
      manager.removeDemand(sourceId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedSymbols.join('|'), sourceId, canSubscribe, storeAuthToken, sessionRevision]);

  return {
    isConnected: managerRef.current.isConnected(),
  };
}
