import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useQuoteSubscription } from './useQuoteSubscription';

export const OPEN_POSITIONS_QUOTE_SOURCE = 'open-positions';

/**
 * Sorted, de-duplicated symbols of every open position, joined into one string
 * so a store selector can return it by value: a price tick on a held position
 * changes the positions array but not this key, so it neither re-renders the
 * caller nor re-registers quote demand.
 */
export const openPositionSymbolKey = (
  positions: readonly { symbol?: unknown }[] | null | undefined,
): string => {
  if (!Array.isArray(positions)) return '';
  const symbols = new Set<string>();
  for (const position of positions) {
    const symbol = typeof position?.symbol === 'string' ? position.symbol.trim().toUpperCase() : '';
    if (symbol) symbols.add(symbol);
  }
  return Array.from(symbols).sort().join('|');
};

/**
 * Keeps a live quote stream for every symbol the account holds.
 *
 * Live quotes used to follow only Market Watch rows, the visible chart and an
 * open order dialog. A position in any other symbol had no stream, so when the
 * user closed it the terminal had no quote fresh enough for the execution
 * gate, fell back to a REST quote that often arrived too old, and gave up
 * without ever sending the close. Seven GBPUSD positions failed exactly that
 * way on 2026-09-23 while the BTCUSD ones, on the visible chart, closed.
 *
 * Deliberately independent of which Toolbox tab or row is visible: a position
 * exists, so its symbol is subscribed; the last position in a symbol closes,
 * so its demand is released.
 */
export function useOpenPositionQuoteDemand(): void {
  const symbolKey = useAppStore((state) => openPositionSymbolKey(state.positions));
  const symbols = useMemo(() => (symbolKey ? symbolKey.split('|') : []), [symbolKey]);
  useQuoteSubscription(symbols, OPEN_POSITIONS_QUOTE_SOURCE);
}
