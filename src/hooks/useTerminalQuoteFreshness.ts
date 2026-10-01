import { useCallback, useSyncExternalStore } from 'react';
import { getTerminalQuoteFreshness, subscribeTerminalQuoteFreshness, terminalQuoteFreshnessEnabled } from '../services/terminalQuoteFreshness';

const noopSubscribe = () => () => {};

export function useTerminalQuoteFreshness(symbol: string) {
  const enabled = terminalQuoteFreshnessEnabled();
  // Unrelated symbols must not rerender every chart/row on every wire tick.
  // Prices have their own selector; freshness renders only on state/age changes.
  const snapshot = useCallback(() => {
    if (!enabled) return 'disabled';
    const state = getTerminalQuoteFreshness(symbol);
    return `${state.live}:${state.reason}:${state.clockStatus}:${state.ageMs === null ? -1 : Math.floor(state.ageMs / 100)}`;
  }, [enabled, symbol]);
  useSyncExternalStore(enabled ? subscribeTerminalQuoteFreshness : noopSubscribe, snapshot, snapshot);
  return getTerminalQuoteFreshness(symbol);
}
