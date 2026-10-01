import { useAppStore } from '../store/useAppStore';
import { assertTerminalQuoteFresh, terminalQuoteFreshnessEnabled } from './terminalQuoteFreshness';

export type PositionCloseContext = {
  ticketId: number;
  symbol: string;
  isCurrent: () => boolean;
};

/** A server-discovered close carries its symbol and captured account session. */
export function assertStoredExecutionQuoteFresh(kind: 'positions' | 'orders', id: string | number, context?: PositionCloseContext): void {
  if (context && (kind !== 'positions' || String(context.ticketId) !== String(id) || !context.isCurrent())) {
    throw new Error('Trading session changed; close cancelled');
  }
  if (!terminalQuoteFreshnessEnabled()) return;
  const row = useAppStore.getState()[kind].find((item) => String(item.id) === String(id));
  assertTerminalQuoteFresh(row?.symbol ?? context?.symbol ?? '');
}
