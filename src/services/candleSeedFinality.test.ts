import { afterEach, describe, expect, it, vi } from 'vitest';
import { candleAggregationService, type OHLCV } from './candleAggregationService';
import { formatHistoryForOhlcv } from '../utils/candleHistory';

const serverBucket = Date.UTC(2026, 9, 5, 10) / 1000;
const candle = (isComplete?: boolean): OHLCV => ({
  time: serverBucket, open: 100, high: 110, low: 90, close: 105, volume: 7,
  ...(isComplete === undefined ? {} : { isComplete }),
});
afterEach(() => { candleAggregationService.clearSymbol('BTCUSD'); vi.restoreAllMocks(); });

describe('authoritative seed finality under an untrusted local clock', () => {
  it('keeps an explicitly final broker candle sealed when the PC clock is behind', () => {
    vi.spyOn(Date, 'now').mockReturnValue((serverBucket - 120) * 1000);
    const final = candle(true);
    candleAggregationService.loadHistoricalCandles('BTCUSD', 'M1', [final]);
    candleAggregationService.processTick({ symbol: 'BTCUSD', bid: 130, ask: 131, timestamp: (serverBucket + 30) * 1000, volume: 1 });
    expect(candleAggregationService.getCandles('BTCUSD', 'M1', true, false)).toStrictEqual([final]);
  });

  it('keeps explicit forming metadata when the PC clock is ahead and accepts a real same-bucket tick', () => {
    vi.spyOn(Date, 'now').mockReturnValue((serverBucket + 120) * 1000);
    candleAggregationService.loadHistoricalCandles('BTCUSD', 'M1', [candle(false)]);
    candleAggregationService.processTick({ symbol: 'BTCUSD', bid: 108, ask: 109, timestamp: (serverBucket + 30) * 1000, volume: 1 });
    expect(candleAggregationService.getCandles('BTCUSD', 'M1', true, false)).toStrictEqual([
      { ...candle(false), close: 108, volume: 8 },
    ]);
  });

  it('carries classified backend closed metadata through the actual history-to-builder adapter', () => {
    const { isComplete: _ignored, ...raw } = candle();
    const rows = formatHistoryForOhlcv([{ ...raw, closed: true }, { ...raw, time: serverBucket + 60, closed: false }, { ...raw, time: serverBucket + 120 }]);
    expect(rows).toStrictEqual([
      { ...raw, isComplete: true },
      { ...raw, time: serverBucket + 60, isComplete: false },
      { ...raw, time: serverBucket + 120 },
    ]);
  });

  it('retains the existing local-time fallback only for metadata-free legacy seeds', () => {
    vi.spyOn(Date, 'now').mockReturnValue((serverBucket + 120) * 1000);
    candleAggregationService.loadHistoricalCandles('BTCUSD', 'M1', [candle()]);
    expect(candleAggregationService.getCandles('BTCUSD', 'M1', true, false)).toStrictEqual([{ ...candle(), isComplete: true }]);
  });
  it('does not reopen an older uncovered bucket behind the completed tail but admits the next real minute', () => {
    vi.spyOn(Date, 'now').mockReturnValue((serverBucket - 120) * 1000);
    const final = candle(true);
    candleAggregationService.loadHistoricalCandles('BTCUSD', 'M1', [final]);
    candleAggregationService.processTick({ symbol: 'BTCUSD', bid: 130, ask: 131, timestamp: (serverBucket - 30) * 1000, volume: 1 });
    expect(candleAggregationService.getCandles('BTCUSD', 'M1', true, false)).toStrictEqual([final]);
    candleAggregationService.processTick({ symbol: 'BTCUSD', bid: 108, ask: 109, timestamp: (serverBucket + 60) * 1000, volume: 1 });
    expect(candleAggregationService.getCandles('BTCUSD', 'M1', true, false)).toStrictEqual([
      final, { time: serverBucket + 60, open: 108, high: 108, low: 108, close: 108, volume: 1, isComplete: false },
    ]);
  });

});
