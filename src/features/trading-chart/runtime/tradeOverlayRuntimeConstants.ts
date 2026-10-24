import type { Timeframe } from '../../../types/chart';
import type { TradeSide } from '../presentation/tradeOverlayPresentation';

export const TRADE_BUY_COLOR = '#22c55e';
export const TRADE_SELL_COLOR = '#ef4444';
export const TRADE_ENTRY_LINE_BUY_COLOR = '#2962ff';
export const TRADE_ENTRY_LINE_SELL_COLOR = '#ef4444';
export const TRADE_PENDING_BUY_LINE_COLOR = '#ea580c';
export const TRADE_PENDING_SELL_LINE_COLOR = '#ec4899';

export const getEntryLineColor = (
  side: TradeSide,
  kind?: 'position' | 'pending',
): string => {
  if (kind === 'pending') {
    return side === 'BUY' ? TRADE_PENDING_BUY_LINE_COLOR : TRADE_PENDING_SELL_LINE_COLOR;
  }
  return side === 'BUY' ? TRADE_ENTRY_LINE_BUY_COLOR : TRADE_ENTRY_LINE_SELL_COLOR;
};

export const getFrozenEntryTimeKey = (
  tradeKey: number | string,
  chartTimeframe: Timeframe | string,
): string => `${String(tradeKey)}::${String(chartTimeframe)}`;
