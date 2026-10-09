// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { readTradeControlSize, rememberTradeControlResize, type TradeControlSizeCache } from './tradeControlSizeCache';

const fixture = () => {
  const element = document.createElement('div');
  element.style.width = 'max-content';
  element.style.maxWidth = '600px';
  const width = vi.spyOn(element, 'offsetWidth', 'get').mockReturnValue(180);
  const height = vi.spyOn(element, 'offsetHeight', 'get').mockReturnValue(24);
  const cache: TradeControlSizeCache = new WeakMap();
  const resize = (inlineSize: number, blockSize: number) => rememberTradeControlResize(cache, {
    target: element, borderBoxSize: [{ inlineSize, blockSize }],
  } as unknown as ResizeObserverEntry);
  return { element, width, height, cache, resize };
};

describe('observed trade control sizes', () => {
  it('measures a new bar once and reuses its dimensions on following price ticks', () => {
    const { element, width, height, cache } = fixture();
    expect(readTradeControlSize(cache, element, true)).toMatchObject({ width: 180, height: 24 });
    expect(readTradeControlSize(cache, element, true)).toMatchObject({ width: 180, height: 24 });
    expect(width).toHaveBeenCalledTimes(1);
    expect(height).toHaveBeenCalledTimes(1);
  });

  it('uses observed border boxes after metric text or font sizes change', () => {
    const { element, width, height, cache, resize } = fixture();
    resize(243.75, 27.2);
    expect(readTradeControlSize(cache, element, true)).toMatchObject({ width: 244, height: 27 });
    expect(width).not.toHaveBeenCalled();
    expect(height).not.toHaveBeenCalled();
    resize(190, 24);
    expect(readTradeControlSize(cache, element, true)).toMatchObject({ width: 190, height: 24 });
  });

  it('remeasures a changed width constraint before a resize notification arrives', () => {
    const { element, width, cache, resize } = fixture();
    resize(244, 24);
    element.style.maxWidth = '140px';
    width.mockReturnValue(140);
    expect(readTradeControlSize(cache, element, true).width).toBe(140);
    expect(width).toHaveBeenCalledTimes(1);
    readTradeControlSize(cache, element, true);
    expect(width).toHaveBeenCalledTimes(1);
  });

  it('invalidates hidden controls and measures their size when they return', () => {
    const { element, width, cache, resize } = fixture();
    resize(244, 24);
    resize(0, 0);
    width.mockReturnValue(210);
    expect(readTradeControlSize(cache, element, true).width).toBe(210);
    expect(width).toHaveBeenCalledTimes(1);
  });

  it('falls back to full border-box measurement when the observer lacks borderBoxSize', () => {
    const { element, width, cache, resize } = fixture();
    resize(244, 24);
    rememberTradeControlResize(cache, { target: element, contentRect: { width: 100, height: 10 } } as unknown as ResizeObserverEntry);
    expect(readTradeControlSize(cache, element, true)).toMatchObject({ width: 180, height: 24 });
    expect(width).toHaveBeenCalledTimes(1);
  });

  it('keeps measuring when resize observation is unavailable', () => {
    const { element, width, cache, resize } = fixture();
    resize(244, 24);
    expect(readTradeControlSize(cache, element, false).width).toBe(180);
    width.mockReturnValue(220);
    expect(readTradeControlSize(cache, element, false).width).toBe(220);
    expect(width).toHaveBeenCalledTimes(2);
  });
});
