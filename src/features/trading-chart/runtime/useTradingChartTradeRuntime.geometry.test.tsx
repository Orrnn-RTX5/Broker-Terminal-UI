import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTradingChartTradeRuntime } from './useTradingChartTradeRuntime';
import { useTradingChartTradeOverlayRenderer } from './useTradingChartTradeOverlayRenderer';
import { layoutRebuiltTradeOverlay } from './layoutRebuiltTradeOverlay';
import { createTradeOverlayRelayoutQueue } from './createTradeOverlayRelayoutQueue';
import { tradeMarkerTooltipLayouts } from '../presentation/tradeOverlayPresentation';

vi.mock('../../../services/drawingManager', () => ({ drawingManager: {} }));
vi.mock('./useTradingChartTradeOverlayRenderer', () => ({ useTradingChartTradeOverlayRenderer: vi.fn() }));
vi.mock('./useTradingChartTradeLevelDrag', () => ({ useTradingChartTradeLevelDrag: vi.fn() }));

const ref = <T,>(current: T) => ({ current });
function fixture() {
  const container = document.createElement('div'), overlay = document.createElement('div');
  container.appendChild(overlay);
  let width = 600, height = 400, scale = 60;
  let y: number | null = 100;
  const widthRead = vi.fn(() => width), heightRead = vi.fn(() => height);
  Object.defineProperties(container, { offsetWidth: { get: widthRead }, offsetHeight: { get: heightRead } });
  const coordinate = vi.fn((_price: number) => y);
  const options = {
    symbol: 'BTCUSD', timeframe: 'M1', candlesLoadedRev: 0,
    containerRef: ref(container), overlayRef: ref(overlay),
    seriesRef: ref({ priceScale: () => ({ width: () => scale }), priceToCoordinate: coordinate }),
    chartRef: ref({ timeScale: () => ({ height: () => 30, timeToCoordinate: () => 50 }) }),
    chartSettingsRef: ref({ showBidPriceLine: false }),
    livePriceRef: ref(100), livePriceLineRef: ref(document.createElement('div')),
    livePriceBadgeRef: ref(document.createElement('div')),
    livePriceOverlayColorsRef: ref({ lineColor: 'red', badgeBackground: 'black', badgeTextColor: 'white' }),
    applyLivePriceHorizontalGeometry: vi.fn(),
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
    move: (value: number | null) => { y = value; } };
}
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe('trade overlay geometry presentation', () => {
  it('a committed chart draw fulfils pending model geometry/metrics once, while axis repaints stay separate', () => {
    const frames=new Map<number,FrameRequestCallback>();let id=0;
    vi.stubGlobal('requestAnimationFrame',vi.fn((fn:FrameRequestCallback)=>{frames.set(++id,fn);return id;}));
    vi.stubGlobal('cancelAnimationFrame',vi.fn((key:number)=>frames.delete(key)));
    const f=fixture(), metrics=vi.fn();f.renderer.tradeControlLiveUpdatersRef.current=[metrics];
    const scheduler=createTradeOverlayRelayoutQueue({frameRef:{current:null},isCurrent:()=>true,isInteracting:()=>false,
      requestPostInteraction:vi.fn(),project:f.renderer.updateLabelPositions});
    f.renderer.committedTradeOverlayLayoutRef.current=scheduler.projectCommittedGeometry;
    scheduler.queue();const pending=frames.values().next().value!;
    f.options.repaintTradeOverlayGeometryRef.current(true);
    expect(f.node.style.top).toBe('100px');expect(f.widthRead).toHaveBeenCalledTimes(1);expect(metrics).toHaveBeenCalledTimes(1);
    pending(0);expect(f.widthRead).toHaveBeenCalledTimes(1);expect(frames.size).toBe(0);
    scheduler.queue();f.move(150);f.repaint();
    expect(f.node.style.top).toBe('150px');expect(frames.size).toBe(1);expect(metrics).toHaveBeenCalledTimes(1);
    f.options.repaintTradeOverlayGeometryRef.current(true);expect(frames.size).toBe(0);expect(metrics).toHaveBeenCalledTimes(2);
    // With no installed owner callback (effect setup/cleanup), committed geometry
    // still uses current refs, preserving the pre-existing primitive fallback.
    f.renderer.committedTradeOverlayLayoutRef.current=null;f.move(180);
    f.options.repaintTradeOverlayGeometryRef.current(true);expect(f.node.style.top).toBe('180px');
    expect(metrics).toHaveBeenCalledTimes(2);scheduler.dispose();f.hook.unmount();
  });
  it('projects the live price again after metric callbacks can change the scale', () => {
    const f = fixture();
    f.options.chartSettingsRef.current.showBidPriceLine = true;
    f.renderer.tradeControlLiveUpdatersRef.current = [() => f.move(180)];
    f.renderer.updateLabelPositions();
    expect(f.node.style.top).toBe('100px');
    expect(f.options.livePriceLineRef.current?.style.top).toBe('180px');
    expect(f.options.livePriceBadgeRef.current?.style.top).toBe('180px');
    expect(f.coordinate).toHaveBeenCalledTimes(2);
    f.hook.unmount();
  });
  it('memoizes repeated exact endpoint coordinates only within each geometry pass', () => {
    const f = fixture();
    let factor = 1;
    const timeToCoordinate = vi.fn((time: number) => (time - 1000) * factor + 50);
    f.coordinate.mockImplementation(price => Math.log(price) * 20 * factor);
    f.options.chartRef.current!.timeScale = (() => ({ height: () => 30, timeToCoordinate })) as typeof f.options.chartRef.current.timeScale;
    const resolveEndPrice = vi.fn(() => 101), resolveEndTime = vi.fn(() => 1060);
    f.renderer.activeOverlayNodesRef.current = Array.from({ length: 50 }, () => document.createElement('div'));
    f.renderer.activeOverlayNodeDataRef.current = Array.from({ length: 50 }, () => ({
      kind: 'segment', price: 100, time: 1000, resolveEndPrice, resolveEndTime,
    }));
    f.repaint();
    expect(f.coordinate.mock.calls).toEqual([[100], [101]]);
    expect(timeToCoordinate.mock.calls).toEqual([[1000], [1060]]);
    expect(resolveEndPrice).toHaveBeenCalledTimes(50); expect(resolveEndTime).toHaveBeenCalledTimes(50);
    const firstTop = f.renderer.activeOverlayNodesRef.current[0].style.top;
    factor = 2; f.repaint();
    expect(f.coordinate).toHaveBeenCalledTimes(4); expect(timeToCoordinate).toHaveBeenCalledTimes(4);
    expect(resolveEndPrice).toHaveBeenCalledTimes(100); expect(resolveEndTime).toHaveBeenCalledTimes(100);
    expect(f.renderer.activeOverlayNodesRef.current[0].style.top).not.toBe(firstTop);
    f.hook.unmount();
  });

  it('shares null results without losing retry and refreshes candle anchors on the next pass', () => {
    const f = fixture();
    const candle = { time: 1000, open: 100, high: 110, low: 90, close: 100, volume: 1 };
    f.options.currentCandleRef.current = candle;
    f.renderer.activeOverlayNodesRef.current = [document.createElement('div'), document.createElement('div')];
    f.renderer.activeOverlayNodeDataRef.current = Array.from({ length: 2 }, () => ({
      kind: 'marker', price: 100, time: 1000, markerSide: 'BUY', markerAnchor: 'candle',
    }));
    f.move(null);
    expect(f.renderer.updateLabelPositions()).toBe(true);
    expect(f.coordinate.mock.calls).toEqual([[90]]);
    candle.low = 80; f.coordinate.mockImplementation(price => price);
    expect(f.renderer.updateLabelPositions()).toBe(false);
    expect(f.coordinate.mock.calls).toEqual([[90], [80]]);
    expect(f.renderer.activeOverlayNodesRef.current.every(node => node.style.top === '80px')).toBe(true);
    f.hook.unmount();
  });

  it('validates an unchanged node style once per pass and repairs a full external style replacement', () => {
    const f = fixture(); f.repaint();
    const getters = ['display', 'top', 'left', 'right'].map(property => vi.spyOn(f.node.style, property as 'top', 'get'));
    const attribute = vi.spyOn(f.node, 'getAttribute');
    f.repaint();
    expect(getters.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBe(0);
    expect(attribute).toHaveBeenCalledExactlyOnceWith('style');
    f.node.style.cssText = 'top:25px;left:200px;display:none'; f.repaint();
    expect(f.node.style.top).toBe('100px'); expect(f.node.style.left).toBe('0px'); expect(f.node.style.display).toBe('block');
    f.hook.unmount();
  });

  it('shares direct null time and nearest-candle projection without caching either across passes', () => {
    const f = fixture();
    f.options.candlesRef.current = [{ time: 1000, open: 100, high: 101, low: 99, close: 100, volume: 1 }];
    const timeToCoordinate = vi.fn((time: number): number | null => time === 1000 ? 50 : null);
    f.options.chartRef.current!.timeScale = (() => ({ height: () => 30, timeToCoordinate })) as typeof f.options.chartRef.current.timeScale;
    f.renderer.activeOverlayNodesRef.current = Array.from({ length: 20 }, () => document.createElement('div'));
    f.renderer.activeOverlayNodeDataRef.current = Array.from({ length: 20 }, () => ({ kind: 'marker', price: 100, time: 1001 }));
    expect(f.renderer.updateLabelPositions()).toBe(false);
    expect(timeToCoordinate.mock.calls).toEqual([[1001], [1000]]);
    timeToCoordinate.mockImplementation(time => time === 1001 ? 75 : null);
    expect(f.renderer.updateLabelPositions()).toBe(false);
    expect(timeToCoordinate.mock.calls).toEqual([[1001], [1000], [1001]]);
    expect(f.renderer.activeOverlayNodesRef.current.every(node => node.style.left === '75px')).toBe(true);
    f.hook.unmount();
  });

  it('publishes hover geometry without a tooltip and reflows a lazily added visible tooltip', () => {
    const f = fixture();
    f.node.className = 'rtx-trade-marker-hover-target';
    f.renderer.activeOverlayNodeDataRef.current = [{ kind: 'marker', price: 100, time: 1000, markerSide: 'BUY' }];
    f.repaint();
    expect(tradeMarkerTooltipLayouts.get(f.node)).toMatchObject({ x: 50, markerY: 100, plotWidth: 540, plotHeight: 370 });
    const tooltip = document.createElement('span'); tooltip.className = 'rtx-trade-marker__price-tooltip';
    tooltip.style.visibility = 'visible'; f.node.appendChild(tooltip);
    f.resize(800, 500, 80); f.move(180); f.repaint();
    expect(tradeMarkerTooltipLayouts.get(f.node)).toMatchObject({ markerY: 180, plotWidth: 720, plotHeight: 470 });
    expect(tooltip.style.transform).toBe('none');
    f.hook.unmount();
  });
  it('queues rebuilt geometry without synchronous projection, then places current nodes at paint', () => {
    const f = fixture(), queue = vi.fn();
    layoutRebuiltTradeOverlay(queue);
    expect(f.coordinate).not.toHaveBeenCalled();expect(queue).toHaveBeenCalledExactlyOnceWith({ retryOnce: true });
    f.repaint();
    expect(f.node.style.top).toBe('100px');
    expect(f.coordinate).toHaveBeenCalledTimes(1);
    // A later committed chart transform still projects through the existing hook.
    f.move(175); f.repaint(); expect(f.node.style.top).toBe('175px');
    f.hook.unmount();
  });
  it('reports unresolved new nodes for the bounded queue retry and preserves placed nodes across gaps', () => {
    const f = fixture();
    f.move(null);
    expect(f.renderer.updateLabelPositions()).toBe(true);
    expect(f.node.style.display).toBe('none');
    f.move(160); f.repaint(); expect(f.node.style.top).toBe('160px');
    f.move(null); expect(f.renderer.updateLabelPositions()).toBe(true);
    expect(f.node.style.top).toBe('160px'); expect(f.node.style.display).toBe('block');
    f.hook.unmount();
  });
  it('distinguishes intentional offscreen geometry from unresolved zero-size containers', () => {
    const f = fixture();
    f.move(-200); expect(f.renderer.updateLabelPositions()).toBe(false);
    expect(f.node.style.display).toBe('none');
    f.resize(0, 0, 60);expect(f.renderer.updateLabelPositions()).toBe(true);
    f.resize(600, 400, 60); f.move(120); f.repaint(); expect(f.node.style.top).toBe('120px');
    f.hook.unmount();
  });
  it('leaves an independent queued geometry pass intact after structural scheduling', () => {
    const f = fixture(); let pending: (() => boolean) | undefined = f.renderer.updateLabelPositions;
    const queue = vi.fn(() => { pending ??= f.renderer.updateLabelPositions; });
    layoutRebuiltTradeOverlay(queue);
    expect(pending).toBe(f.renderer.updateLabelPositions);
    f.move(180); pending!(); expect(f.node.style.top).toBe('180px');
    f.coordinate.mockClear();layoutRebuiltTradeOverlay(queue);
    expect(f.coordinate).not.toHaveBeenCalled();expect(queue).toHaveBeenCalledTimes(2);
    f.hook.unmount();
  });
  it('retries unavailable marker time coordinates but not invalid times or clipped segments', () => {
    const f = fixture();
    const timeToCoordinate = vi.fn((): number | null => null);
    f.options.chartRef.current!.timeScale = (() => ({ height: () => 30, timeToCoordinate })) as typeof f.options.chartRef.current.timeScale;
    f.renderer.activeOverlayNodeDataRef.current = [{ kind: 'marker', price: 100, time: 1000 }];
    expect(f.renderer.updateLabelPositions()).toBe(true);
    timeToCoordinate.mockReturnValue(50); expect(f.renderer.updateLabelPositions()).toBe(false);
    expect(f.node.style.left).toBe('50px');
    f.renderer.activeOverlayNodeDataRef.current = [{ kind: 'marker', price: 100, time: -1 }];
    expect(f.renderer.updateLabelPositions()).toBe(false);
    f.node.className = 'rtx-trade-history-line';
    f.renderer.activeOverlayNodeDataRef.current = [{ kind: 'segment', price: 100, time: 1000, endPrice: 100, endTime: 1060 }];
    // Both valid ends project to one point: normal minimum-length clipping.
    expect(f.renderer.updateLabelPositions()).toBe(false);
    f.hook.unmount();
  });
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
