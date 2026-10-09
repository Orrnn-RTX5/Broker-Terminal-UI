import { describe, expect, it, vi } from 'vitest';
import { SymbolCandleBuilder, type OHLCV } from './candleAggregationService';

const start = Date.UTC(2026, 9, 9, 10) / 1000;
const candle = (time: number, overrides: Partial<OHLCV> = {}): OHLCV => ({
  time, open: 100, high: 102, low: 98, close: 101, volume: 10, isComplete: false, ...overrides,
});
const fixture = () => {
  const builder = new SymbolCandleBuilder('BTCUSD.r');
  builder.loadHistoricalCandles('M1', [
    candle(start, { isComplete: true }), candle(start + 60),
  ]);
  const rebuild = vi.spyOn(builder as unknown as { rebuildHigherTimeframes: () => void }, 'rebuildHigherTimeframes');
  return { builder, rebuild };
};

describe('shared authoritative M1 updates', () => {
  it('rebuilds a changed forming message once across six chart consumers', () => {
    const { builder, rebuild } = fixture();
    const next = candle(start + 60, { close: 102, high: 103, volume: 12 });
    for (let consumer = 0; consumer < 6; consumer += 1) builder.reconcileServerCandle('M1', { ...next }, false);
    expect(rebuild).toHaveBeenCalledOnce();
    expect(builder.getCandles('M5')).toEqual([expect.objectContaining({
      time: start, open: 100, high: 103, low: 98, close: 102, volume: 22,
    })]);
  });

  it.each([
    { open: 99 }, { high: 104 }, { low: 97 }, { close: 100.5 }, { volume: 15 },
  ])('keeps a changed forming correction authoritative: %j', correction => {
    const { builder, rebuild } = fixture();
    const changed = candle(start + 60, correction);
    builder.reconcileServerCandle('M1', changed, false);
    expect(rebuild).toHaveBeenCalledOnce();
    expect(builder.getCandles('M1').at(-1)).toMatchObject(changed);
  });

  it('seals once for six owners and still applies a later closed correction that narrows extrema', () => {
    const { builder, rebuild } = fixture();
    const final = candle(start + 60);
    for (let owner = 0; owner < 6; owner += 1) builder.reconcileServerCandle('M1', final, true);
    expect(rebuild).toHaveBeenCalledOnce();
    expect(builder.getLastClosedCandle('M1')).toMatchObject({ time: start + 60, isComplete: true });
    const correction = candle(start + 60, { high: 101, low: 99, close: 100.5, volume: 8 });
    builder.reconcileServerCandle('M1', correction, true);
    expect(rebuild).toHaveBeenCalledTimes(2);
    expect(builder.getLastClosedCandle('M1')).toMatchObject({ ...correction, isComplete: true });
    expect(builder.getCandles('M5').at(-1)?.volume).toBe(18);
  });

  it('rebuilds equal values when the boundary contract changes', () => {
    const { builder, rebuild } = fixture();
    builder.setBoundaryOffsetSeconds(120);
    builder.reconcileServerCandle('M1', candle(start + 60), false);
    expect(rebuild).toHaveBeenCalledOnce();
    expect(builder.getCandles('M5')[0].time).toBe(start - 120);
    builder.reconcileServerCandle('M1', candle(start + 60), false);
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it('retains a newer forming minute when the preceding final update repeats', () => {
    const { builder, rebuild } = fixture();
    const final = candle(start + 60);
    builder.reconcileServerCandle('M1', final, true);
    builder.reconcileServerCandle('M1', candle(start + 120, { close: 102 }), false);
    rebuild.mockClear();
    builder.reconcileServerCandle('M1', final, true);
    expect(rebuild).not.toHaveBeenCalled();
    expect(builder.getCandles('M1').at(-1)).toMatchObject({ time: start + 120, isComplete: false, close: 102 });
  });

  it('does not confuse a native higher-frame override with the M1 derived state', () => {
    const { builder, rebuild } = fixture();
    builder.loadHistoricalCandles('H1', [candle(start, { close: 101.5 })]);
    builder.reconcileServerCandle('M1', candle(start + 60), false);
    expect(rebuild).toHaveBeenCalledOnce();
    expect(builder.getCandles('H1').at(-1)?.close).toBe(101);
  });
});
