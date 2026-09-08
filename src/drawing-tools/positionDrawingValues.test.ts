import { describe, expect, it } from 'vitest';
import { calculatePositionPnl, calculatePositionSizing, positionQuantityText } from './positionDrawingValues';
import { updateDrawingCandle } from './drawingCandleUpdates';
import { barVolume, buildVolumeProfile, calculateAnchoredVwap } from './forecastingMeasurementRenderer';

const settings = { accountSize: 2500, risk: 2, riskMode: 'percent' as const, pointValue: 1, lotSize: 1 };
const prices = [
  { time: 1, open: 100, high: 102, low: 99, close: 101, volume: 10 },
  { time: 2, open: 101, high: 104, low: 100, close: 103, volume: 20 },
  { time: 3, open: 103, high: 106, low: 102, close: 105, volume: 30 },
];
const pnl = { long: true, entry: 100, target: 110, stop: 90, startTime: 1, endTime: 2, series: prices, latestPrice: 105 };

describe('position drawing values from actual inputs', () => {
  it('uses editable account/risk inputs and retains unrounded quantity for amounts', () => {
    const result = calculatePositionSizing(4394.642, 4398.933, 4390.351, settings);
    expect(result.quantity).toBeCloseTo(50 / 4.291);
    expect(positionQuantityText(result.quantity, 0)).toBe('11');
    expect(result.targetAmount).toBeCloseTo(2550);
    expect(result.stopAmount).toBeCloseTo(2450);
  });
  it('supports fractional quantities without exceeding risk', () => {
    const result = calculatePositionSizing(1000, 1500, 500, { ...settings, riskMode: 'amount', risk: 250 });
    expect(result.quantity).toBe(.5);
    expect(positionQuantityText(result.quantity, 2)).toBe('0.5');
    expect(result.stopAmount).toBe(2250);
  });
  it('accounts for point value, lot size, and notional leverage limits', () => {
    const result = calculatePositionSizing(100, 110, 90, { ...settings, pointValue: 10, lotSize: 2, leverage: .1 });
    expect(result.quantity).toBe(.125);
    expect(result.targetAmount).toBe(2525);
    expect(result.stopAmount).toBe(2475);
  });
  it.each([undefined, {}, { ...settings, pointValue: undefined }, { ...settings, risk: -1 }])('does not invent missing or invalid sizing inputs', value => {
    expect(calculatePositionSizing(100, 110, 90, value).quantity).toBeNull();
  });
  it('uses the historical right-edge close rather than the latest candle or quantity', () => {
    expect(calculatePositionPnl(pnl)).toEqual({ status: 'open', value: 3 });
  });
  it('mirrors historical price offsets for short positions', () => {
    expect(calculatePositionPnl({ ...pnl, long: false, target: 90, stop: 110 })).toEqual({ status: 'open', value: -3 });
  });
  it('uses the latest known price for a future drawing', () => {
    expect(calculatePositionPnl({ ...pnl, startTime: 10, endTime: 20 })).toEqual({ status: 'open', value: 5 });
  });
  it('does not close a position before an entry candle is reached', () => {
    expect(calculatePositionPnl({ ...pnl, entry: 120, target: 130, stop: 110 })).toEqual({ status: 'open', value: -17 });
  });
  it.each([
    [true, 110, 90, 112, 101, 10], [true, 110, 90, 103, 89, -10],
    [false, 90, 110, 112, 101, -10], [false, 90, 110, 103, 89, 10],
  ])('closes on the first reached target/stop after entry', (long, target, stop, high, low, expected) => {
    expect(calculatePositionPnl({ ...pnl, long: long as boolean, target: target as number, stop: stop as number,
      series: [prices[0], { ...prices[1], high: high as number, low: low as number }] })).toEqual({ status: 'closed', value: expected });
  });
  it('does not claim an intrabar order when OHLC touches both levels', () => {
    expect(calculatePositionPnl({ ...pnl, series: [prices[0], { ...prices[1], high: 112, low: 89 }] })).toEqual({ status: 'ambiguous', value: null });
  });
  it('does not invent a zero PnL without prices', () => {
    expect(calculatePositionPnl({ ...pnl, series: [], latestPrice: undefined })).toEqual({ status: 'unavailable', value: null });
  });
  it('updates studies and PnL from replaced and appended candles, preserving history', () => {
    const candles = prices.map(bar => ({ ...bar }));
    const before = calculateAnchoredVwap(candles).at(-1)!.value;
    updateDrawingCandle(candles, { ...prices[2], high: 109, close: 108 });
    expect(candles).toHaveLength(3);
    expect(calculateAnchoredVwap(candles).at(-1)!.value).toBeGreaterThan(before);
    updateDrawingCandle(candles, { ...prices[2], time: 4, high: 112, close: 111 });
    expect(candles).toHaveLength(4);
    expect(calculatePositionPnl({ ...pnl, endTime: 4, series: candles })).toEqual({ status: 'closed', value: 10 });
    expect(candles[0]).toEqual(prices[0]);
  });
  it('does not invent volume or prices for VWAP/profile calculations', () => {
    expect(barVolume({ time: 1 })).toBe(0);
    expect(calculateAnchoredVwap([{ time: 1, volume: 100 }])).toEqual([]);
    expect(buildVolumeProfile([{ time: 1, high: 10, low: 1 }])).toEqual([]);
  });
  it('distributes OHLCV profile estimates across the candle range and conserves volume', () => {
    const bins = buildVolumeProfile([{ time: 1, low: 10, high: 14, close: 14, volume: 80 }], 4);
    expect(bins.map(bin => bin.volume)).toEqual([20, 20, 20, 20]);
  });
});
