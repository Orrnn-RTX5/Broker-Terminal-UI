import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { getCommittedBrokerAccountSessionScope, getCommittedBrokerAccountSessionScopeKey } from '../services/brokerSession';
import { getBrokerServerNowMs } from '../services/brokerServerClock';
import { isCurrentQuoteTradingStatus, QUOTE_TRADING_STATUS_TTL_MS } from '../utils/quoteTradingStatus';

/** Publish only permission changes, not a React render for every quote. */
export const useLiveSymbolTradingStatus = (symbol: string, sessionScope: string): boolean | null => {
  const key = symbol.trim().toUpperCase();
  const [state, setState] = useState<{ symbol: string; scope: string; tradable: boolean | null } | null>(null);
  useEffect(() => {
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
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
      setState(previous => previous?.symbol === key && previous.scope === sessionScope && previous.tradable === tradable
        ? previous : { symbol: key, scope: sessionScope, tradable });
      if (valid) expiry = setTimeout(update, Math.max(1, Math.min(
        QUOTE_TRADING_STATUS_TTL_MS - (now - tick!.tradingStatus!.receivedAt),
        QUOTE_TRADING_STATUS_TTL_MS - Math.max(0, brokerNow - tick!.sourceTimestamp!),
      )));
    };
    update();
    const unsubscribe = useAppStore.subscribe(update);
    return () => { unsubscribe(); clearTimeout(expiry); };
  }, [key, sessionScope]);
  return state?.symbol === key && state.scope === sessionScope ? state.tradable : null;
};
