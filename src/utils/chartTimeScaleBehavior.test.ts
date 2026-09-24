import { describe, expect, it } from 'vitest';
import {
  computeTradingChartTimeScaleWeights,
  getTradingChartTimeScaleLabelLevels,
} from './chartTimeScaleBehavior';

const MINUTE = 60;
const BASE = Date.UTC(2026, 8, 24, 10, 0, 0) / 1000;

const series = (count: number, stepSec: number, start = BASE) =>
  Array.from({ length: count }, (_, index) => start + index * stepSec);

const labelTimesAtLevel = (
  times: number[],
  weights: number[],
  minWeight: number,
) => times.filter((_, index) => weights[index] >= minWeight)
  .map(time => new Date(time * 1000).toISOString().slice(11, 16));

describe('getTradingChartTimeScaleLabelLevels', () => {
  it('starts every intraday timeframe at one label per bar', () => {
    expect(getTradingChartTimeScaleLabelLevels('M1')!.map(level => level.seconds / MINUTE))
      .toEqual([1, 5, 15, 30, 60, 180, 360, 720]);
    expect(getTradingChartTimeScaleLabelLevels('M5')!.map(level => level.seconds / MINUTE))
      .toEqual([5, 15, 30, 60, 180, 360, 720]);
    expect(getTradingChartTimeScaleLabelLevels('M15')![0]).toMatchObject({ seconds: 15 * MINUTE, bars: 1 });
    expect(getTradingChartTimeScaleLabelLevels('M30')![0]).toMatchObject({ seconds: 30 * MINUTE, bars: 1 });
    expect(getTradingChartTimeScaleLabelLevels('H1')!.map(level => level.bars)).toEqual([1, 3, 6, 12]);
    expect(getTradingChartTimeScaleLabelLevels('H4')!.map(level => level.bars)).toEqual([1, 3]);
  });

  it('leaves daily and higher timeframes to the library', () => {
    expect(getTradingChartTimeScaleLabelLevels('D1')).toBeNull();
    expect(getTradingChartTimeScaleLabelLevels('W1')).toBeNull();
    expect(getTradingChartTimeScaleLabelLevels('MN')).toBeNull();
  });
});

describe('computeTradingChartTimeScaleWeights', () => {
  it('gives M1 bars regular 1m, 5m and 15m label levels', () => {
    const levels = getTradingChartTimeScaleLabelLevels('M1')!;
    const times = series(31, MINUTE);
    const weights = computeTradingChartTimeScaleWeights(times, levels, 0, 0, []);

    expect(labelTimesAtLevel(times, weights, levels[0].weight)).toHaveLength(31);
    expect(labelTimesAtLevel(times, weights, levels[1].weight))
      .toEqual(['10:00', '10:05', '10:10', '10:15', '10:20', '10:25', '10:30']);
    expect(labelTimesAtLevel(times, weights, levels[2].weight)).toEqual(['10:00', '10:15', '10:30']);
  });

  it('gives M5 bars regular 5m then 15m label levels', () => {
    const levels = getTradingChartTimeScaleLabelLevels('M5')!;
    const times = series(7, 5 * MINUTE);
    const weights = computeTradingChartTimeScaleWeights(times, levels, 0, 0, []);

    expect(labelTimesAtLevel(times, weights, levels[0].weight)).toHaveLength(7);
    expect(labelTimesAtLevel(times, weights, levels[1].weight)).toEqual(['10:00', '10:15', '10:30']);
  });

  it('demotes a mark that a data gap pushed too close to its neighbour', () => {
    const levels = getTradingChartTimeScaleLabelLevels('M1')!;
    // 10:06-10:09 are missing, so 10:05 and 10:10 are only one bar apart.
    const times = series(11, MINUTE).filter(time => {
      const minute = new Date(time * 1000).getUTCMinutes();
      return minute < 6 || minute > 9;
    });
    const weights = computeTradingChartTimeScaleWeights(times, levels, 0, 0, []);

    expect(labelTimesAtLevel(times, weights, levels[1].weight)).toEqual(['10:00', '10:05']);
    // Every remaining 5m-level pair stays at least five bars apart.
    const fiveMinuteIndexes = weights.flatMap((weight, index) => (weight >= levels[1].weight ? [index] : []));
    fiveMinuteIndexes.slice(1).forEach((index, i) => expect(index - fiveMinuteIndexes[i]).toBeGreaterThanOrEqual(5));
  });

  it('keeps day boundaries and clears crowded intraday marks before them', () => {
    const levels = getTradingChartTimeScaleLabelLevels('M5')!;
    const friday = Date.UTC(2026, 8, 25, 23, 40) / 1000;
    const monday = Date.UTC(2026, 8, 28, 0, 0) / 1000;
    const times = [...series(3, 5 * MINUTE, friday), ...series(3, 5 * MINUTE, monday)];
    const weights = computeTradingChartTimeScaleWeights(times, levels, 0, 0, []);

    expect(weights[3]).toBe(50);
    // 23:45 is two bars before the day mark, so it cannot stay a 15m label.
    expect(weights[1]).toBe(levels[0].weight);
  });

  it('produces the same weights for incremental appends as for a full refill', () => {
    const levels = getTradingChartTimeScaleLabelLevels('M1')!;
    const times = series(90, MINUTE);
    const full = computeTradingChartTimeScaleWeights(times, levels, 0, 0, []);
    const partial = computeTradingChartTimeScaleWeights(times.slice(0, 60), levels, 0, 0, []);
    const appended = computeTradingChartTimeScaleWeights(times, levels, 0, 60, partial);

    expect(appended).toEqual(full);
  });

  it('aligns hour steps to broker display time', () => {
    const levels = getTradingChartTimeScaleLabelLevels('H1')!;
    const times = series(12, 60 * MINUTE, Date.UTC(2026, 8, 24, 1, 0) / 1000);
    const weights = computeTradingChartTimeScaleWeights(times, levels, 3 * 60 * MINUTE, 0, []);
    const threeHourLevel = levels.find(level => level.seconds === 3 * 60 * MINUTE)!;

    const labels = times
      .filter((_, index) => weights[index] >= threeHourLevel.weight)
      .map(time => new Date((time + 3 * 60 * MINUTE) * 1000).toISOString().slice(11, 16));
    expect(labels).toEqual(['06:00', '09:00', '12:00', '15:00']);
  });
});
