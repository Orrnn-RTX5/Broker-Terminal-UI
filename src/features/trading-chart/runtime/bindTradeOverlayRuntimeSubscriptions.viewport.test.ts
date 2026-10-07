// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindTradeOverlayRuntimeSubscriptions } from './bindTradeOverlayRuntimeSubscriptions';

vi.mock('../../../store/useAppStore', () => ({ useAppStore: { subscribe: () => () => undefined } }));
vi.mock('../../../store/useChartSettingsStore', () => ({ useChartSettingsStore: { subscribe: () => () => undefined } }));
vi.mock('../../../store/useChartObjectStateStore', () => ({
  useChartObjectStateStore: { subscribe: () => () => undefined }, getChartObjectState: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());

function harness() {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (frameId: number) => frames.delete(frameId));
  let onRangeChange: () => void = () => undefined;
  const timeScale = {
    subscribeVisibleLogicalRangeChange: vi.fn((handler: () => void) => { onRangeChange = handler; }),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
  };
  const renderTradeOverlay = vi.fn();
  const isActiveRef = { current: true };
  const cleanup = bindTradeOverlayRuntimeSubscriptions({
    chartRef: { current: { timeScale: () => timeScale } },
    renderTradeOverlay, isActiveRef, clearTradeOverlayVisualRuntime: vi.fn(),
  } as unknown as Parameters<typeof bindTradeOverlayRuntimeSubscriptions>[0]);
  const flush = () => {
    const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback(0);
  };
  return { frames, onRangeChange: () => onRangeChange(), renderTradeOverlay, isActiveRef, cleanup, flush, timeScale };
}

describe('viewport-driven trade history DOM', () => {
  it('reselects visible history after pan and zoom, coalescing range notifications', () => {
    const h = harness();
    expect(h.renderTradeOverlay).toHaveBeenCalledOnce();
    for (let i = 0; i < 20; i++) h.onRangeChange();
    expect(h.frames.size).toBe(1);
    expect(h.renderTradeOverlay).toHaveBeenCalledOnce();
    h.flush();
    expect(h.renderTradeOverlay).toHaveBeenCalledTimes(2);
    h.onRangeChange(); h.flush();
    expect(h.renderTradeOverlay).toHaveBeenCalledTimes(3);
    h.cleanup();
  });

  it('does not rebuild hidden charts and cancels pending viewport work on disposal', () => {
    const h = harness();
    h.onRangeChange(); h.isActiveRef.current = false; h.flush();
    expect(h.renderTradeOverlay).toHaveBeenCalledOnce();
    h.onRangeChange();
    h.cleanup();
    expect(h.frames.size).toBe(0);
    expect(h.timeScale.unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledOnce();
  });
});
