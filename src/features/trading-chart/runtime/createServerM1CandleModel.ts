import { candleAggregationService, type Timeframe as AggTimeframe } from '../../../services/candleAggregationService';
import type { CandleCacheSource } from '../../../services/candleCache';
import { useAppStore } from '../../../store/useAppStore';
import type { Candle, Timeframe } from '../../../types/chart';
import { formatHistoryForOhlcv } from '../../../utils/candleHistory';
import { resolveFormingCandleLiveClose } from '../../../utils/liveCandleQuote';
import { getTimeframePeriodSeconds } from '../../../utils/timeframeBoundary';
import { resolveCandleFinalityFromActivePeriod } from '../../../components/TradingChart.helpers';

interface ServerM1CandleModelOptions {
  symbol: string;
  normalizedSymbol: string;
  getDisplayedTimeframe: () => Timeframe;
  getBrokerTimeOffsetSeconds: () => number;
  getSynchronizedChartMarketNowMs: () => number;
  applyServerCandle: (candle: Candle, source: CandleCacheSource, timeframe: AggTimeframe) => void;
}

/** Shared server M1 classification, quote reconciliation and higher-timeframe delivery. */
export function createServerM1CandleModel({
  symbol, normalizedSymbol, getDisplayedTimeframe, getBrokerTimeOffsetSeconds,
  getSynchronizedChartMarketNowMs, applyServerCandle,
}: ServerM1CandleModelOptions) {
  const getDisplayedStreamTimeframe = (): AggTimeframe => (
    (getDisplayedTimeframe() || 'M1') as AggTimeframe
  );
  const classifyServerM1CandleFinality = (candle: Candle): Candle => {
    if (typeof candle.closed === 'boolean') return candle;
    const marketNowSeconds = getSynchronizedChartMarketNowMs() / 1000;
    const activeM1Period = getTimeframePeriodSeconds(
      marketNowSeconds,
      'M1',
      getBrokerTimeOffsetSeconds(),
    );
    // FIX: Legacy updates without finality metadata are classified against
    // broker-synchronized M1 time, not arrival order or the local PC clock.
    return resolveCandleFinalityFromActivePeriod(candle, activeM1Period?.startTime);
  };
  const resolveServerM1LiveClose = (candle: Candle): Candle => {
    const quote = window.rtxTickCache?.get(normalizedSymbol)
      ?? useAppStore.getState().ticks[normalizedSymbol];
    // Recovery snapshots update the price overlay, never broker candle OHLC.
    if (quote?.quoteDeliveryKind === 'snapshot') return candle;
    return resolveFormingCandleLiveClose(candle, quote, symbol, 'M1', getBrokerTimeOffsetSeconds());
  };
  const reconcileServerM1Candle = (candle: Candle): Candle => {
    const classifiedCandle = resolveServerM1LiveClose(classifyServerM1CandleFinality(candle));
    const [m1] = formatHistoryForOhlcv([classifiedCandle]);
    if (!m1) return classifiedCandle;
    candleAggregationService.reconcileServerCandle(
      symbol,
      'M1',
      m1,
      classifiedCandle.closed === true,
    );
    return classifiedCandle;
  };
  const applyLatestM1DerivedServerCandle = () => {
    const displayedStreamTimeframe = getDisplayedStreamTimeframe();
    if (displayedStreamTimeframe === 'M1') return;
    const derivedCandles = candleAggregationService.getCandles(
      symbol,
      displayedStreamTimeframe,
      true,
      false,
    );
    const latest = derivedCandles[derivedCandles.length - 1];
    if (latest) {
      applyServerCandle(
        { ...latest, tickVolume: latest.volume, closed: latest.isComplete === true },
        'derived-m1',
        displayedStreamTimeframe,
      );
    }
  };
  return {
    getDisplayedStreamTimeframe,
    classifyServerM1CandleFinality,
    resolveServerM1LiveClose,
    reconcileServerM1Candle,
    applyLatestM1DerivedServerCandle,
  };
}

/** Returns a real pending boundary without creating a price or candle. */
export function resolvePendingLiveCandleBoundary(
  currentCandle: Candle,
  timeframe: AggTimeframe,
  marketNowSeconds: number,
  brokerOffsetSeconds: number,
): number | null {
  const currentPeriod = getTimeframePeriodSeconds(marketNowSeconds, timeframe, brokerOffsetSeconds);
  if (!currentPeriod || currentPeriod.startTime <= Number(currentCandle.time)) return null;
  // Pending time supports stale-tick rejection/countdown only. A real source
  // event remains responsible for creating the new bar.
  return currentPeriod.startTime;
}
