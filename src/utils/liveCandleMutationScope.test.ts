import { describe, expect, it } from 'vitest';
import { getStartupHistoryMutationFloor, selectLiveCandleMutationScope } from './liveCandleMutationScope';
import { mergeHistoricalCandlesWithBufferedLive, selectCandlesMutatedAfterGeneration } from './candleHistory';

const candle = (time: number, close: number) => ({ time, open: 100, high: close, low: 100, close, volume: 1 });
const firstScope = { selectionKey: 'broker-a|account-a|EURUSD|M1', generationFloor: 0 };

describe('startup history live mutation scope', () => {
  it('keeps current-selection ticks accepted before its history request starts', () => {
    const scope = selectLiveCandleMutationScope(firstScope, 'broker-a|account-a|BTCUSD|M1', 7);
    const floor = getStartupHistoryMutationFloor(scope, scope.selectionKey, 9);
    const live = candle(180, 105);
    const selected = selectCandlesMutatedAfterGeneration([live], new Map([[180, 8]]), floor);
    expect(mergeHistoricalCandlesWithBufferedLive([candle(180, 102)], selected)[0].close).toBe(105);
  });

  it.each([
    'broker-a|account-a|BTCUSD|M1',
    'broker-a|account-a|EURUSD|M5',
    'broker-a|account-b|EURUSD|M1',
    'broker-b|account-a|EURUSD|M1',
  ])('excludes previous selection mutations with matching timestamps: %s', (selectionKey) => {
    const scope = selectLiveCandleMutationScope(firstScope, selectionKey, 7);
    const staleCached = candle(180, 180);
    const authoritative = candle(180, 103);
    const selected = selectCandlesMutatedAfterGeneration(
      [staleCached], new Map([[180, 7]]), getStartupHistoryMutationFloor(scope, selectionKey, 9),
    );
    expect(mergeHistoricalCandlesWithBufferedLive([authoritative], selected)).toEqual([authoritative]);
  });

  it('does not reuse a previous activation when switching back to the same symbol', () => {
    const second = selectLiveCandleMutationScope(firstScope, 'broker-a|account-a|BTCUSD|M1', 7);
    const returned = selectLiveCandleMutationScope(second, firstScope.selectionKey, 12);
    expect(selectCandlesMutatedAfterGeneration(
      [candle(180, 109)], new Map([[180, 6]]), getStartupHistoryMutationFloor(returned, returned.selectionKey, 14),
    )).toEqual([]);
  });

  it('does not advance the floor when the same selection renders again', () => {
    const scope = selectLiveCandleMutationScope(firstScope, firstScope.selectionKey, 7);
    expect(getStartupHistoryMutationFloor(scope, firstScope.selectionKey, 7)).toBe(0);
  });

  it('uses request-time protection when selection and request do not match', () => {
    expect(getStartupHistoryMutationFloor(firstScope, 'other-symbol', 7)).toBe(7);
  });

  it('continues to honor a backend-finalized candle over a current-selection tick', () => {
    const final = { ...candle(180, 102), closed: true };
    const selected = selectCandlesMutatedAfterGeneration([candle(180, 109)], new Map([[180, 1]]), 0);
    expect(mergeHistoricalCandlesWithBufferedLive([final], selected)).toEqual([final]);
  });
});
