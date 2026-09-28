import type { Timeframe } from '../../../types/chart';
import type { TradeSide } from '../presentation/tradeOverlayPresentation';

export const TRADE_BUY_COLOR = '#22c55e';
export const TRADE_SELL_COLOR = '#ef4444';
export const TRADE_ENTRY_LINE_BUY_COLOR = '#2962ff';
export const TRADE_ENTRY_LINE_SELL_COLOR = '#ef4444';

export const getEntryLineColor = (side: TradeSide): string => (
  side === 'BUY' ? TRADE_ENTRY_LINE_BUY_COLOR : TRADE_ENTRY_LINE_SELL_COLOR
);

export const getFrozenEntryTimeKey = (
  tradeKey: number | string,
  chartTimeframe: Timeframe | string,
): string => `${String(tradeKey)}::${String(chartTimeframe)}`;
