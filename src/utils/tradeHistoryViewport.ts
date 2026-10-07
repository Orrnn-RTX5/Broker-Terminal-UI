import type { LogicalRangeLike } from './candleHistory';

export interface TradeHistoryTimeRange { from: number; to: number }

/** Include two neighboring candles so arrows enter smoothly at the pane edge. */
export const getTradeHistoryTimeRange = (
  candles: readonly { time: number }[],
  logicalRange: LogicalRangeLike | null,
): TradeHistoryTimeRange | null => {
  if (!candles.length || !logicalRange
    || !Number.isFinite(logicalRange.from) || !Number.isFinite(logicalRange.to)) return null;
  const first = Math.max(0, Math.min(candles.length - 1, Math.floor(logicalRange.from) - 2));
  const last = Math.max(first, Math.min(candles.length - 1, Math.ceil(logicalRange.to) + 2));
  return { from: candles[first].time, to: candles[last].time };
};

/** Keep paths crossing the pane even when both execution arrows are outside it. */
export const isTradeHistoryInTimeRange = (
  trade: { entryTime: number; exitTime: number },
  range: TradeHistoryTimeRange | null,
): boolean => range !== null
  && Math.min(trade.entryTime, trade.exitTime) <= range.to
  && Math.max(trade.entryTime, trade.exitTime) >= range.from;
