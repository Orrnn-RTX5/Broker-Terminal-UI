/**
 * useQuoteSubscription - React hook for Section 2 (public Quotes /ws/v2)
 *
 * Registers demand with QuoteSocketManager. On mount, symbols are added to the
 * merged demand set. On unmount, they're removed when no other consumer needs them.
 *
 * Usage:
 *   const { isConnected } = useQuoteSubscription(['EURUSD', 'GBPUSD'], 'watchlist-main');
 *   const hiddenChart = useQuoteSubscription(['EURUSD'], 'chart:1', { enabled: false });
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { getQuoteSocketManager } from '../services/quoteSocketManager';
import { onSessionChange } from '../services/brokerSession';
import { debugLog } from '../utils/debugLogging';
import { useAppStore } from '../store/useAppStore';
import { isDesktopBackendTarget } from '../config/backendTarget.js';

const normalizeSymbol = (v: unknown): string =>
  typeof v === 'string' ? v.trim().toUpperCase() : '';

export interface UseQuoteSubscriptionReturn {
  isConnected: boolean;
}

export interface UseQuoteSubscriptionOptions {
  enabled?: boolean;
}

export function useQuoteSubscription(
  symbols: string[],
  sourceId: string,
  options: UseQuoteSubscriptionOptions = {},
): UseQuoteSubscriptionReturn {
  const authenticated = useAppStore(state => state.isAuthenticated);
  const enabled = options.enabled !== false && (authenticated || isDesktopBackendTarget());
  const [sessionRevision, setSessionRevision] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    return onSessionChange(() => setSessionRevision((revision) => revision + 1));
  }, [enabled]);

  const normalizedSymbols = useMemo(
    () => Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbols.join('|')],
  );

  const managerRef = useRef(getQuoteSocketManager());

  useEffect(() => {
    if (!enabled) return undefined;

    const manager = managerRef.current;
    debugLog(`[useQuoteSubscription] public v2 demand - symbols=${normalizedSymbols.length}, sourceId=${sourceId}`);

    if (normalizedSymbols.length === 0) {
      manager.removeDemand(sourceId);
      return;
    }

    manager.setDemand(sourceId, normalizedSymbols);

    return () => {
      manager.removeDemand(sourceId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, normalizedSymbols.join('|'), sourceId, sessionRevision]);

  return {
    isConnected: managerRef.current.isConnected(),
  };
}
