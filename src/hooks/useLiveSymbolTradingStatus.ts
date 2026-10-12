import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { getCommittedBrokerAccountSessionScope, getCommittedBrokerAccountSessionScopeKey } from '../services/brokerSession';
import { getBrokerServerNowMs } from '../services/brokerServerClock';
import { isCurrentQuoteTradingStatus, QUOTE_TRADING_STATUS_TTL_MS } from '../utils/quoteTradingStatus';

/** Publish only permission changes, not a React render for every quote. */
export const useLiveSymbolTradingStatus = (symbol: string, sessionScope: string): boolean | null => {
  const key = symbol.trim().toUpperCase();
  const [state, setState] = useState<{ symbol: string; scope: string; tradable: boolean | null } | null>(null);
  const publishedRef = useRef(state);
  useEffect(() => {
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const update = () => {
      if (disposed) return;
      clearTimeout(expiry);
      const scope = getCommittedBrokerAccountSessionScope();
      const tick = useAppStore.getState().ticks[key];
      const now = Date.now();
      const brokerNow = getBrokerServerNowMs(now) ?? now;
      const valid = getCommittedBrokerAccountSessionScopeKey(scope) === sessionScope
        && tick?.symbol.trim().toUpperCase() === key
        && tick.tradingStatus?.sessionScope === sessionScope
        && isCurrentQuoteTradingStatus(tick.tradingStatus, scope.brokerId, tick.sourceTimestamp,
          now, brokerNow);
      const tradable = valid ? tick!.tradingStatus!.tradable : null;
      // Do not dispatch a React update for a steady permission. This hook also
      // lives in App, where even a queued no-op can join other pending updates
      // and repeatedly traverse the terminal during a burst of quotes.
      const previous = publishedRef.current;
      if (previous?.symbol !== key || previous.scope !== sessionScope || previous.tradable !== tradable) {
        const next = { symbol: key, scope: sessionScope, tradable };
        publishedRef.current = next;
        setState(next);
      }
      if (valid) expiry = setTimeout(update, Math.max(1, Math.min(
        QUOTE_TRADING_STATUS_TTL_MS - (now - tick!.tradingStatus!.receivedAt),
        QUOTE_TRADING_STATUS_TTL_MS - Math.max(0, brokerNow - tick!.sourceTimestamp!),
      )));
    };
    update();
    const unsubscribe = useAppStore.subscribe((next, previous) => {
      // Account packets, history and other symbols cannot change this quote's
      // permission or expiry. Fresh timestamps for this symbol still renew it.
      if (next.ticks[key] !== previous.ticks[key]) update();
    });
    return () => { disposed = true; unsubscribe(); clearTimeout(expiry); };
  }, [key, sessionScope]);
  return state?.symbol === key && state.scope === sessionScope ? state.tradable : null;
};
