import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTradingChartTradeRuntime } from './useTradingChartTradeRuntime';
import { useTradingChartTradeOverlayRenderer } from './useTradingChartTradeOverlayRenderer';

vi.mock('../../../services/drawingManager', () => ({ drawingManager: {} }));
vi.mock('./useTradingChartTradeOverlayRenderer', () => ({ useTradingChartTradeOverlayRenderer: vi.fn() }));
vi.mock('./useTradingChartTradeLevelDrag', () => ({ useTradingChartTradeLevelDrag: vi.fn() }));

const ref = <T,>(current: T) => ({ current });
function fixture() {
  const container = document.createElement('div'), overlay = document.createElement('div');
  container.appendChild(overlay);
  let width = 600, height = 400, scale = 60, y = 100;
  const widthRead = vi.fn(() => width), heightRead = vi.fn(() => height);
  Object.defineProperties(container, { offsetWidth: { get: widthRead }, offsetHeight: { get: heightRead } });
  const coordinate = vi.fn(() => y);
  const options = {
    symbol: 'BTCUSD', timeframe: 'M1', candlesLoadedRev: 0,
    containerRef: ref(container), overlayRef: ref(overlay),
    seriesRef: ref({ priceScale: () => ({ width: () => scale }), priceToCoordinate: coordinate }),
    chartRef: ref({ timeScale: () => ({ height: () => 30, timeToCoordinate: () => 50 }) }),
    chartSettingsRef: ref({ showBidPriceLine: false }),
    candlesRef: ref([]), currentCandleRef: ref(null), prevTimeframeRef: ref('M1'),
    repaintTradeOverlayGeometryRef: ref(() => {}), postInteractionCallbacksRef: ref({}),
    activeTradeSnapshotsRef: ref(new Map()), tradeLevelCrossCloseCandidatesRef: ref(new Map()),
    tradeLevelCrossRefreshPendingRef: ref(new Set()),
    isDisposedRef: ref(false), tr: (value: unknown) => value, hideLivePriceOverlay: vi.fn(),
  } as unknown as Parameters<typeof useTradingChartTradeRuntime>[0];
  const hook = renderHook(() => useTradingChartTradeRuntime(options));
  const renderer = vi.mocked(useTradingChartTradeOverlayRenderer).mock.lastCall![0];
  const node = document.createElement('div');
  renderer.activeOverlayNodesRef.current = [node];
  renderer.activeOverlayNodeDataRef.current = [{ kind: 'horizontal-line', price: 100 }];
  const topWrite = vi.spyOn(node.style, 'top', 'set');
  const repaint = () => options.repaintTradeOverlayGeometryRef.current();
  return { repaint, node, coordinate, topWrite, widthRead, heightRead, hook, options, renderer,
    resize: (w: number, h: number, s: number) => { width = w; height = h; scale = s; },
    move: (value: number) => { y = value; } };
}
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
describe('trade overlay geometry presentation', () => {
  it('does not repeat unchanged geometry setters while still projecting every repaint', () => {
    const f = fixture(); f.repaint(); f.repaint(); f.repaint();
    expect(f.topWrite).toHaveBeenCalledTimes(1);
    expect(f.coordinate).toHaveBeenCalledTimes(3);
    // Fresh measurements deliberately retained: no asynchronous size cache.
    expect(f.widthRead).toHaveBeenCalledTimes(3); expect(f.heightRead).toHaveBeenCalledTimes(3);
    f.hook.unmount();
  });
  it('applies pan/zoom/price-axis coordinate changes and repairs external drag style changes', () => {
    const f = fixture(); f.repaint(); f.move(140); f.repaint();
    expect(f.node.style.top).toBe('140px');
    f.node.style.top = '25px'; f.repaint();
    expect(f.node.style.top).toBe('140px');
    f.hook.unmount();
  });
  it('uses current border-box dimensions on resize, including hidden then revealed', () => {
    const f = fixture(); f.repaint(); f.resize(0, 0, 60); f.move(200); f.repaint();
    expect(f.node.style.top).toBe('100px');
    f.resize(900, 500, 80); f.repaint();
    expect(f.node.style.top).toBe('200px'); expect(f.node.style.right).toBe('80px');
    f.hook.unmount();
  });
  it('does not retain geometry for replaced position nodes and releases repaint on unmount', () => {
    const f = fixture(); f.repaint();
    const replacement = document.createElement('div'); f.renderer.activeOverlayNodesRef.current = [replacement];
    f.move(180); f.repaint(); expect(replacement.style.top).toBe('180px');
    f.hook.unmount(); f.move(190); f.repaint(); expect(replacement.style.top).toBe('180px');
  });
  it('shares one candle index across marker fallbacks and rebuilds it on the next layout pass', () => {
    const f = fixture();
    let reads = 0;
    const validTimes = new Set<number>();
    f.options.candlesRef.current = Array.from({ length: 200 }, (_, index) => {
      const time = 1000 + index * 60;
      validTimes.add(time);
      return { get time() { reads++; return time; }, open: 100, high: 101, low: 99, close: 100, volume: 1 };
    });
    f.options.chartRef.current!.timeScale = (() => ({
      height: () => 30,
      timeToCoordinate: (time: number) => validTimes.has(time) ? 50 : null,
    })) as typeof f.options.chartRef.current.timeScale;
    f.renderer.activeOverlayNodesRef.current = Array.from({ length: 40 }, () => document.createElement('div'));
    f.renderer.activeOverlayNodeDataRef.current = Array.from({ length: 40 }, (_, index) => ({
      kind: 'marker' as const, price: 100, time: 1001 + index * 60,
    }));
    f.repaint();
    // One 200-candle build plus bounded result reads; never 40 full scans.
    expect(reads).toBeGreaterThanOrEqual(200);
    expect(reads).toBeLessThanOrEqual(200 + 40 * 3);
    const firstPassReads = reads;
    f.repaint();
    expect(reads - firstPassReads).toBeGreaterThanOrEqual(200);
    expect(reads - firstPassReads).toBeLessThanOrEqual(200 + 40 * 3);
    f.hook.unmount();
  });
});
