import { useAppStore } from '../store/useAppStore';
import { assertTerminalCloseQuote, assertTerminalQuoteFresh, terminalQuoteFreshnessEnabled } from './terminalQuoteFreshness';

export type PositionCloseContext = {
  ticketId: number;
  symbol: string;
  isCurrent: () => boolean;
};

function storedExecutionSymbol(kind: 'positions' | 'orders', id: string | number, context?: PositionCloseContext): string {
  if (context && (kind !== 'positions' || String(context.ticketId) !== String(id) || !context.isCurrent())) {
    throw new Error('Trading session changed; close cancelled');
  }
  const row = useAppStore.getState()[kind].find((item) => String(item.id) === String(id));
  return row?.symbol ?? context?.symbol ?? '';
}

/** Modification and pending-order guards continue requiring verified local age. */
export function assertStoredExecutionQuoteFresh(kind: 'positions' | 'orders', id: string | number, context?: PositionCloseContext): void {
  const symbol = storedExecutionSymbol(kind, id, context);
  if (terminalQuoteFreshnessEnabled()) assertTerminalQuoteFresh(symbol);
}

/** Close keeps identity and hard quote vetoes; uncertain age is checked by execution. */
export function assertStoredPositionCloseQuote(id: string | number, context?: PositionCloseContext): void {
  const symbol = storedExecutionSymbol('positions', id, context);
  if (terminalQuoteFreshnessEnabled()) assertTerminalCloseQuote(symbol);
}
