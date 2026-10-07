import { describe, expect, it } from 'vitest';
import type { IChartApi } from 'lightweight-charts';
import { shouldScrollToRealtime } from '../features/trading-chart/runtime/chartRuntime';
import {
  getLeftVisibleTimeFromLogicalRange,
  getVisibleLogicalRangeAnchoredToTime,
} from './TradingChart.helpers';

const createFixture = (rightOffset: number, scrollPosition = rightOffset) => {
  const candles = Array.from({ length: 100 }, (_, index) => ({ time: 1_000 + index * 60 }));
  let latestIndex = candles.length - 1;
  let range = { from: latestIndex + scrollPosition - 30.5, to: latestIndex + scrollPosition };
  const chart = {
    timeScale: () => ({ scrollPosition: () => range.to - latestIndex }),
  } as unknown as IChartApi;
  const render = (nextCandles: typeof candles, eligibleToFollow = true) => {
    // The decision belongs to the old viewport; setData can add enough bars
    // that a decision made afterwards incorrectly treats live following as a pan.
    const wasFollowing = eligibleToFollow && shouldScrollToRealtime(chart, true, true, rightOffset);
    const leftTime = getLeftVisibleTimeFromLogicalRange(candles, range);
    const previousRange = { ...range };
    latestIndex = nextCandles.length - 1;
    const followingAfterData = shouldScrollToRealtime(chart, true, true, rightOffset);
    range = getVisibleLogicalRangeAnchoredToTime(nextCandles, leftTime, previousRange, {
      wasFollowing,
      previousLatestTime: candles[candles.length - 1].time,
      rightOffset,
    }) ?? previousRange;
    return { followingAfterData, previousRange, range };
  };
  return { candles, chart, render };
};

describe('full chart render live viewport', () => {
  it.each([0, 8])('follows a delayed snapshot adding eleven bars with right offset %s and keeps the zoom', (rightOffset) => {
    const fixture = createFixture(rightOffset);
    const nextCandles = [
      ...fixture.candles,
      ...Array.from({ length: 11 }, (_, index) => ({ time: 7_000 + index * 60 })),
    ];
    const result = fixture.render(nextCandles);

    expect(result.followingAfterData).toBe(false);
    expect(result.range.to).toBe(nextCandles.length - 1 + rightOffset);
    expect(result.range.to - result.range.from).toBe(result.previousRange.to - result.previousRange.from);
    expect(shouldScrollToRealtime(fixture.chart, true, true, rightOffset)).toBe(true);
  });

  it('keeps a user pan on the same historical candle when newer bars arrive', () => {
    const fixture = createFixture(0, -20);
    const nextCandles = [...fixture.candles, { time: 7_000 }, { time: 7_060 }, { time: 7_120 }];
    const result = fixture.render(nextCandles);

    expect(result.range).toEqual({ from: 48, to: 78.5 });
    expect(shouldScrollToRealtime(fixture.chart, true, true, 0)).toBe(false);
  });

  it('preserves the historical range for a prepend without jumping to the latest candle', () => {
    const fixture = createFixture(8);
    const nextCandles = [{ time: 880 }, { time: 940 }, ...fixture.candles];
    const result = fixture.render(nextCandles, false);

    expect(result.range).toEqual({ from: 78, to: 108.5 });
  });

  it('does not follow when auto scroll is disabled, even if the old viewport was at the latest candle', () => {
    const fixture = createFixture(0);
    const nextCandles = [...fixture.candles, { time: 7_000 }, { time: 7_060 }, { time: 7_120 }];
    const result = fixture.render(nextCandles, false);

    expect(result.range).toEqual({ from: 68, to: 98.5 });
  });

  it.each([0, 8])('keeps a sparse refresh baseline at the live edge when history ends on the same candle (offset %s)', (rightOffset) => {
    const latest = { time: 7_000 };
    const previousRange = { from: rightOffset - 56, to: rightOffset };
    const nextCandles = [
      ...Array.from({ length: 500 }, (_, index) => ({ time: latest.time - (500 - index) * 60 })),
      latest,
    ];
    const leftTime = getLeftVisibleTimeFromLogicalRange([latest], previousRange);
    expect(leftTime).toBeNull();
    const nextRange = getVisibleLogicalRangeAnchoredToTime(nextCandles, leftTime, previousRange, {
      wasFollowing: true, previousLatestTime: latest.time, rightOffset,
    });
    expect(nextRange).toEqual({ from: 444 + rightOffset, to: 500 + rightOffset });
  });

  it('keeps following on same-bar corrections and on background history expansion', () => {
    const fixture = createFixture(8);
    const corrected = fixture.render(fixture.candles);
    expect(corrected.range).toEqual(corrected.previousRange);

    const expanded = createFixture(8);
    const result = expanded.render([{ time: 880 }, { time: 940 }, ...expanded.candles]);
    expect(result.range.to).toBe(109);
    expect(result.range.to - result.range.from).toBe(result.previousRange.to - result.previousRange.from);
  });

  it('keeps an older snapshot endpoint anchored to its existing time', () => {
    const fixture = createFixture(8);
    const result = fixture.render(fixture.candles.slice(0, 99));
    expect(result.range).toEqual({ from: 76, to: 106.5 });
  });
});
