// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  readTradeOverlayContainerSize,
  rememberTradeOverlayContainerResize,
  type TradeOverlayContainerSizeCache,
} from './tradeOverlayContainerSizeCache';

const fixture = () => {
  const element = document.createElement('div');
  const width = vi.spyOn(element, 'offsetWidth', 'get').mockReturnValue(800);
  const height = vi.spyOn(element, 'offsetHeight', 'get').mockReturnValue(480);
  const cache: TradeOverlayContainerSizeCache = new WeakMap();
  const resize = (inlineSize: number, blockSize: number) => rememberTradeOverlayContainerResize(cache, {
    target: element,
    borderBoxSize: [{ inlineSize, blockSize }],
    contentRect: { width: inlineSize - 20, height: blockSize - 20 },
  } as unknown as ResizeObserverEntry);
  const read = (observed = true) => readTradeOverlayContainerSize(cache, element, observed);
  return { element, width, height, cache, resize, read };
};

describe('observed trade overlay container size', () => {
  it('does not reread layout during repeated quote-driven relayouts', () => {
    const { element, width, height, read } = fixture();
    expect(read()).toEqual({ width: 800, height: 480 });
    for (let tick = 0; tick < 10; tick += 1) {
      element.style.transform = `translateX(${tick}px)`;
      expect(read()).toEqual({ width: 800, height: 480 });
    }
    expect(width).toHaveBeenCalledTimes(1);
    expect(height).toHaveBeenCalledTimes(1);
  });

  it('updates dock geometry from rounded border boxes without reading layout', () => {
    const { width, height, resize, read } = fixture();
    resize(820.7, 502.2);
    expect(read()).toEqual({ width: 821, height: 502 });
    resize(640, 360);
    expect(read()).toEqual({ width: 640, height: 360 });
    expect(width).not.toHaveBeenCalled();
    expect(height).not.toHaveBeenCalled();
  });

  it('retains collapsed sizes and restores geometry when a pane reappears', () => {
    const { width, height, resize, read } = fixture();
    resize(800, 480);
    resize(0, 0);
    expect(read()).toEqual({ width: 0, height: 0 });
    expect(read()).toEqual({ width: 0, height: 0 });
    resize(640, 360);
    expect(read()).toEqual({ width: 640, height: 360 });
    expect(width).not.toHaveBeenCalled();
    expect(height).not.toHaveBeenCalled();
  });

  it('remeasures the full border box after a legacy content-box notification', () => {
    const { element, width, height, cache, resize, read } = fixture();
    resize(900, 600);
    rememberTradeOverlayContainerResize(cache, {
      target: element, contentRect: { width: 780, height: 460 },
    } as unknown as ResizeObserverEntry);
    expect(read()).toEqual({ width: 800, height: 480 });
    expect(read()).toEqual({ width: 800, height: 480 });
    expect(width).toHaveBeenCalledTimes(1);
    expect(height).toHaveBeenCalledTimes(1);
  });

  it('keeps reading current dimensions when resize observation is unavailable', () => {
    const { width, height, resize, read } = fixture();
    resize(900, 600);
    expect(read(false)).toEqual({ width: 800, height: 480 });
    width.mockReturnValue(620);
    height.mockReturnValue(350);
    expect(read(false)).toEqual({ width: 620, height: 350 });
    expect(width).toHaveBeenCalledTimes(2);
    expect(height).toHaveBeenCalledTimes(2);
  });

  it('does not leak cached geometry to a replaced or missing chart container', () => {
    const { cache, resize } = fixture();
    resize(900, 600);
    const replacement = document.createElement('div');
    vi.spyOn(replacement, 'offsetWidth', 'get').mockReturnValue(500);
    vi.spyOn(replacement, 'offsetHeight', 'get').mockReturnValue(300);
    expect(readTradeOverlayContainerSize(cache, replacement, true)).toEqual({ width: 500, height: 300 });
    expect(readTradeOverlayContainerSize(cache, null, true)).toEqual({ width: 0, height: 0 });
  });
});
