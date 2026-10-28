import { describe, expect, it, vi } from 'vitest';
import { createTradeOverlayModelRuntime } from './createTradeOverlayModelRuntime';
import type { ActiveTradeSnapshot, TradeLevelOverride } from './tradeRuntimeContracts';

vi.mock('../../../services/candleAggregationService', () => ({ getTimeframeSeconds: () => 60 }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({}) } }));

const trade = (ticket: number, levels: TradeLevelOverride): ActiveTradeSnapshot => ({
  key: `trade:${ticket}`, symbol: 'BTCUSD', side: 'BUY', volume: 0.01,
  entryPrice: 83073.21, entryTime: 1791468000, entryExecutionTime: 1791468010,
  currentPrice: 83100, currentTime: 1791468060, ...levels,
});

const harness = () => {
  const overrides = new Map<string, TradeLevelOverride>();
  const lastKnown = new Map<string, TradeLevelOverride>();
  const pending = new Map<string, number>();
  const grace = new Map<string, number>();
  const runtime = createTradeOverlayModelRuntime({
    digits: 2, tradeLevelOverridesRef: { current: overrides },
    tradeLevelLastKnownLevelsRef: { current: lastKnown },
    pendingTradeLevelModifyRequestsRef: { current: pending },
    tradeLevelOptimisticGraceUntilRef: { current: grace },
    persistTradeLevelOverrides: vi.fn(),
  } as unknown as Parameters<typeof createTradeOverlayModelRuntime>[0]);
  const modify = (owner: ActiveTradeSnapshot, levels: TradeLevelOverride, requestId: number) => {
    runtime.setTradeLevelState(overrides, owner, levels);
    runtime.getTradeLevelStateKeys(owner).forEach(key => {
      pending.set(key, requestId);
      grace.set(key, Date.now() + 15_000);
    });
  };
  return { runtime, overrides, lastKnown, pending, grace, modify };
};

describe('chart trade level ticket ownership', () => {
  it('keeps identical-entry tickets independent during an optimistic level change', () => {
    const h = harness();
    const first = trade(14154795, { sl: 75000, tp: 90000 });
    const second = trade(14154799, { sl: 82494.59, tp: 83364.97 });
    const third = trade(14154803, { sl: 0, tp: 83523.76 });
    h.modify(second, { sl: 82000, tp: 84000 }, 1);

    expect(h.runtime.resolveTradeLevels(second)).toEqual({ sl: 82000, tp: 84000 });
    expect(h.runtime.resolveTradeLevels(first)).toEqual({ sl: 75000, tp: 90000 });
    expect(h.runtime.resolveTradeLevels(third)).toEqual({ sl: 0, tp: 83523.76 });
    expect(h.overrides.has(first.key)).toBe(false);
    expect(h.overrides.has(third.key)).toBe(false);
  });

  it('does not suppress another ticket\'s SL while an identical-entry ticket removes its SL', () => {
    const h = harness();
    const first = trade(14154799, { sl: 82494.59, tp: 83364.97 });
    const second = trade(14154803, { sl: 81000, tp: 83523.76 });
    h.modify(first, { sl: 0, tp: first.tp! }, 1);

    expect(h.runtime.resolveTradeLevels(first)).toEqual({ sl: 0, tp: 83364.97 });
    expect(h.runtime.resolveTradeLevels(second)).toEqual({ sl: 81000, tp: 83523.76 });
  });

  it('keeps concurrent ticket requests and their cleanup independent', () => {
    const h = harness();
    const first = trade(14154799, { sl: 82494.59, tp: 83364.97 });
    const second = trade(14154803, { sl: 81000, tp: 83523.76 });
    const third = trade(14154807, { sl: 80000, tp: 87000 });
    h.modify(first, { sl: 82000, tp: 84000 }, 1);
    h.modify(second, { sl: 81500, tp: 85000 }, 2);
    h.runtime.clearTradeLevelRuntimeState(first);

    expect(h.runtime.resolveTradeLevels(second)).toEqual({ sl: 81500, tp: 85000 });
    expect(h.runtime.resolveTradeLevels(third)).toEqual({ sl: 80000, tp: 87000 });
    for (const key of h.runtime.getTradeLevelStateKeys(second)) {
      expect(h.pending.get(key)).toBe(2);
      expect(h.grace.get(key)).toBeGreaterThan(Date.now());
    }
    expect(h.overrides.has(first.key)).toBe(false);
  });

  it('guards null digits without rounding to 0 decimals or widening priceTolerance to 1.0', () => {
    const runtime = createTradeOverlayModelRuntime({
      digits: null,
      tradeLevelOverridesRef: { current: new Map() },
      tradeLevelLastKnownLevelsRef: { current: new Map() },
      pendingTradeLevelModifyRequestsRef: { current: new Map() },
      tradeLevelOptimisticGraceUntilRef: { current: new Map() },
      persistTradeLevelOverrides: vi.fn(),
    } as unknown as Parameters<typeof createTradeOverlayModelRuntime>[0]);

    expect(runtime.formatTradeLevelBadgePrice(1.08453)).toBe('1.08453');
    expect(runtime.formatSignaturePrice(1.08453)).toBe('1.08453');
    expect(runtime.priceTolerance).toBe(Number.EPSILON);
  });
});
