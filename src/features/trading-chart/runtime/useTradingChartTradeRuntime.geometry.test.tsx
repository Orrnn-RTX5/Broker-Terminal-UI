// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTradingChartTradeRuntime } from './useTradingChartTradeRuntime';
import { useTradingChartTradeOverlayRenderer } from './useTradingChartTradeOverlayRenderer';

vi.mock('./useTradingChartTradeOverlayRenderer', () => ({ useTradingChartTradeOverlayRenderer: vi.fn() }));
vi.mock('./useTradingChartTradeLevelDrag', () => ({ useTradingChartTradeLevelDrag: vi.fn() }));
vi.mock('../../../services/drawingManager', () => ({ drawingManager: {} }));

const ref = <T,>(current: T) => ({ current });
const frames = new Map<number, FrameRequestCallback>();
let resizeCallback: ResizeObserverCallback;
let frameId = 0;
beforeEach(() => {
  vi.clearAllMocks();
  frames.clear();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++frameId, callback); return frameId; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

const fixture = () => {
  const wrapper = document.createElement('div');
  const container = document.createElement('div');
  const overlay = document.createElement('div');
  wrapper.append(container, overlay);
  document.body.append(wrapper);
  vi.spyOn(container, 'offsetWidth', 'get').mockReturnValue(800);
  vi.spyOn(container, 'offsetHeight', 'get').mockReturnValue(400);
  const priceToCoordinate = vi.fn(() => 100);
  const repaint = ref(() => undefined);
  const options = {
    activeChartSourceId: 'chart-a', brokerAccountSessionScope: 'account-a', symbol: 'BTCUSD', timeframe: 'M1',
    activeTradeSnapshotsRef: ref(new Map()), containerRef: ref(container), overlayRef: ref(overlay),
    candlesRef: ref([]), currentCandleRef: ref(null), candlesLoadedRev: 0,
    chartRef: ref({ timeScale: () => ({ height: () => 20 }) }),
    seriesRef: ref({ priceScale: () => ({ width: () => 60 }), priceToCoordinate }),
    chartSettingsRef: ref({ showBidPriceLine: false }), postInteractionCallbacksRef: ref({}),
    hideLivePriceOverlay: vi.fn(),
    repaintTradeOverlayGeometryRef: repaint, tr: <T,>(source: T) => source,
  } as unknown as Parameters<typeof useTradingChartTradeRuntime>[0];
  renderHook(() => useTradingChartTradeRuntime(options));
  const runtime = vi.mocked(useTradingChartTradeOverlayRenderer).mock.lastCall![0];
  const bar = document.createElement('div');
  bar.className = 'rtx-trade-controls rtx-trade-level-badge';
  Object.assign(bar.dataset, { tradeKey: 'trade:1', role: 'ENTRY', align: 'right', display: 'inline-flex' });
  const width = vi.spyOn(bar, 'offsetWidth', 'get').mockReturnValue(180);
  const height = vi.spyOn(bar, 'offsetHeight', 'get').mockReturnValue(24);
  wrapper.append(bar);
  runtime.activeOverlayNodesRef.current = [bar];
  runtime.activeOverlayNodeDataRef.current = [{ kind: 'price-badge', price: 100 }];
  const flushFrames = () => act(() => {
    const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0));
  });
  const resize = (inlineSize: number, blockSize: number) => act(() => resizeCallback([
    { target: bar, borderBoxSize: [{ inlineSize, blockSize }] } as unknown as ResizeObserverEntry,
  ], {} as ResizeObserver));
  return { bar, runtime, width, height, repaint, flushFrames, resize, priceToCoordinate };
};

describe('trade control geometry', () => {
  it('places a right-aligned entry once and reuses observed sizes during quote-driven relayout', () => {
    const { bar, width, height, repaint, flushFrames, resize } = fixture();
    const left = vi.spyOn(bar.style, 'left', 'set');
    const right = vi.spyOn(bar.style, 'right', 'set');
    const top = vi.spyOn(bar.style, 'top', 'set');
    flushFrames();
    expect(left).toHaveBeenCalledExactlyOnceWith('544px');
    expect(right).toHaveBeenCalledExactlyOnceWith('auto');
    expect(top).toHaveBeenCalledExactlyOnceWith('100px');
    expect(bar.dataset.priceAnchorY).toBe('100');
    expect(bar.dataset.priceAnchorOffsetY).toBe('0');
    act(() => repaint.current());
    expect(width).toHaveBeenCalledTimes(1);
    expect(height).toHaveBeenCalledTimes(1);

    // Wider live metrics reposition the bar from the observed border box.
    resize(240, 24);
    flushFrames();
    expect(bar.style.left).toBe('484px');
    expect(bar.style.top).toBe('100px');
    expect(width).toHaveBeenCalledTimes(1);
    expect(height).toHaveBeenCalledTimes(1);
  });

  it('restores the control display mode and fresh size after leaving the price pane', () => {
    const { bar, width, repaint, flushFrames, resize, priceToCoordinate } = fixture();
    flushFrames();
    priceToCoordinate.mockReturnValue(500);
    act(() => repaint.current());
    expect(bar.style.display).toBe('none');
    resize(0, 0);
    priceToCoordinate.mockReturnValue(100);
    width.mockReturnValue(200);
    act(() => repaint.current());
    expect(bar.style.display).toBe('inline-flex');
    expect(bar.style.left).toBe('524px');
    expect(bar.style.top).toBe('100px');
    expect(width).toHaveBeenCalledTimes(2);
  });
});
