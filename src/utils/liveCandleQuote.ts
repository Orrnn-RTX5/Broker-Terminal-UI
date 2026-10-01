import type { CandleHistoryCandle } from './candleHistory';
import { normalizeBrokerTimestampSeconds } from './brokerStreamSemantics';
import { getRawQuoteSides, type SpreadMarkupQuoteTag } from './spreadMarkup';
import { getTimeframePeriodSeconds, type BoundaryTimeframe } from './timeframeBoundary';

type LiveQuote = { symbol: string; bid: number; ask: number; sourceTimestamp?: number } & SpreadMarkupQuoteTag;

/** Forming chart Close follows the exact raw Bid; completed broker OHLC stays authoritative. */
export const resolveFormingCandleLiveClose = <T extends CandleHistoryCandle>(
  candle: T,
  quote: LiveQuote | undefined,
  symbol: string,
  timeframe: BoundaryTimeframe,
  boundaryOffsetSeconds = 0,
): T => {
  if (candle.closed === true || quote?.symbol.trim().toUpperCase() !== symbol.trim().toUpperCase()) return candle;
  const time = normalizeBrokerTimestampSeconds(quote.sourceTimestamp);
  const bid = getRawQuoteSides(quote)?.bid;
  if (time === undefined || bid === undefined || !Number.isFinite(bid) || bid <= 0) return candle;
  const period = getTimeframePeriodSeconds(time, timeframe, boundaryOffsetSeconds);
  if (period?.startTime !== candle.time) return candle;
  return { ...candle, close: bid, high: Math.max(candle.high, bid), low: Math.min(candle.low, bid) };
};
