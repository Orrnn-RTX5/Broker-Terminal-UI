// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTradingChartTradeLevelDrag } from './useTradingChartTradeLevelDrag';

const { modifyPosition } = vi.hoisted(() => ({ modifyPosition: vi.fn(() => new Promise(() => undefined)) }));
vi.mock('../../../services/api', () => ({ default: { positions: { modifyPosition } } }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({ positions: [], accountId: 123 }) } }));
vi.mock('../../../utils/tradeHistoryLevelCache', () => ({ rememberTradeHistoryPositionLevels: vi.fn() }));

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

function harness(role: 'SL' | 'TP' | 'ENTRY', offset: number, docked = false) {
  const wrapper = document.createElement('div');
  wrapper.className = 'rtx-chart-wrapper';
  const container = document.createElement('div');
  const overlay = document.createElement('div');
  const bar = document.createElement('div');
  bar.className = 'rtx-trade-controls rtx-trade-level-badge';
  bar.dataset.tradeKey = 'trade:987';
  bar.dataset.role = docked ? 'ENTRY' : role;
  bar.dataset.priceAnchorOffsetY = String(offset);
  bar.dataset.priceAnchorY = String(docked || role === 'ENTRY' ? 100 : role === 'SL' ? 150 : 50);
  const target = docked ? document.createElement('div') : bar;
  if (docked) {
    target.className = 'rtx-trade-level-badge rtx-trade-dock-chip';
    target.dataset.tradeKey = 'trade:987';
    target.dataset.role = role;
    bar.appendChild(target);
  }
  wrapper.append(container, overlay, bar);
  document.body.append(wrapper);
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ top: 100, left: 0, width: 800, height: 400 } as DOMRect);
  const coordinateToPrice = vi.fn((y: number) => 1000 - y);
  const ref = <T,>(current: T) => ({ current });
  const trade = {
    key: 'trade:987', symbol: 'XAUUSD', side: 'BUY' as const, volume: 1,
    entryPrice: 900, currentPrice: 900, entryTime: 1000, entryExecutionTime: 1000, currentTime: 1100,
    sl: 850, tp: 950,
  };
  const options = {
    activeToolRef: ref(null), activeTradeSnapshotsRef: ref(new Map([[trade.key, trade]])),
    brokerAccountSessionScope: 'test-only', chartRef: ref({ applyOptions: vi.fn() }),
    chartSettingsRef: ref({ showTradeLevels: true }), containerRef: ref(container), isActive: true,
    isChartInteractionActiveRef: ref(false), isChartSurfaceLight: () => true, overlayRef: ref(overlay),
    pendingTradeLevelModifyRequestsRef: ref(new Map()), persistTradeLevelOverrides: vi.fn(),
    resolvedPriceDigitsRef: ref(2),
    seriesRef: ref({ coordinateToPrice, priceToCoordinate: (price: number) => 1000 - price, priceScale: () => ({ width: () => 60 }) }),
    tr: <T,>(source: T) => source, tradeAllowed: true,
    tradeLevelLastKnownLevelsRef: ref(new Map()), tradeLevelModifyRequestSeqRef: ref(0),
    tradeLevelOptimisticGraceUntilRef: ref(new Map()), tradeLevelOverridesRef: ref(new Map()),
  } as unknown as Parameters<typeof useTradingChartTradeLevelDrag>[0];
  renderHook(() => useTradingChartTradeLevelDrag(options));
  const send = (type: string, y: number, eventTarget: HTMLElement | Window = window) => act(() => {
    eventTarget.dispatchEvent(new MouseEvent(type, { clientY: y + 100 + offset, button: 0, bubbles: true, cancelable: true }));
  });
  return { bar, target, send, coordinateToPrice };
}

describe('displaced trade control gestures', () => {
  it.each([-42, 58])('keeps SL preview and committed price identical with offset %s', offset => {
    const h = harness('SL', offset);
    h.send('pointerdown', 150, h.target);
    h.bar.dataset.priceAnchorOffsetY = '999';
    h.send('pointermove', 157);
    expect(h.coordinateToPrice).toHaveBeenLastCalledWith(157);
    h.send('pointerup', 157);
    expect(modifyPosition).toHaveBeenCalledExactlyOnceWith(987, { price_sl: 843 });
  });

  it('keeps an upward entry gesture a TP when the bar was moved below the entry line', () => {
    const h = harness('ENTRY', 58);
    h.send('pointerdown', 100, h.target);
    h.send('pointermove', 93);
    h.send('pointerup', 93);
    expect(modifyPosition).toHaveBeenCalledExactlyOnceWith(987, { price_tp: 907 });
  });

  it('reads the parent entry-strip offset for its nested bracket shortcut', () => {
    const h = harness('TP', 58, true);
    h.send('pointerdown', 100, h.target);
    h.send('pointermove', 93);
    h.send('pointerup', 93);
    expect(modifyPosition).toHaveBeenCalledExactlyOnceWith(987, { price_tp: 907 });
  });

  it('does not turn a click on a displaced level into a modification', () => {
    const h = harness('SL', 58);
    h.send('pointerdown', 150, h.target);
    h.send('pointerup', 150);
    expect(modifyPosition).not.toHaveBeenCalled();
  });

  it('starts at the price anchor when grabbing the upper edge of a wrapped bar', () => {
    const h = harness('SL', 58);
    h.send('pointerdown', 138, h.target);
    h.send('pointermove', 145);
    h.send('pointerup', 145);
    expect(modifyPosition).toHaveBeenCalledExactlyOnceWith(987, { price_sl: 843 });
  });
});
