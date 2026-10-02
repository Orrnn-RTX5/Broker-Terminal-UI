// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAreaPointHoverLabel, installChartAreaHover, type AreaPointHoverModel } from './chartAreaHover';

const model = (overrides: Partial<AreaPointHoverModel> = {}): AreaPointHoverModel => ({
  price: '22,708.50',
  date: "29 Sep '26",
  time: '11:38 UTC+5:30',
  x: 120,
  y: 80,
  color: '#ef5350',
  plotTop: 0,
  plotBottom: 400,
  plotLeft: 0,
  plotRight: 600,
  ...overrides,
});

describe('area chart point hover', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  const installImmediateFrames = () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  };

  it('formats the close with grouped digits and the broker clock', () => {
    const timestamp = Math.floor(Date.UTC(2026, 8, 29, 6, 8, 0, 0) / 1000);
    expect(buildAreaPointHoverLabel(timestamp, 22708.5, 2, 'M1', 5.5 * 60 * 60)).toEqual({
      price: '22,708.50',
      date: "29 Sep '26",
      time: '11:38 UTC+5:30',
    });
  });

  it('shows the point card while the pointer moves and hides when it leaves', () => {
    installImmediateFrames();
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    const read = vi.fn(() => model());
    const release = installChartAreaHover(wrapper, read);

    wrapper.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 50, bubbles: true }));
    expect(read).toHaveBeenCalledWith({ clientX: 40, clientY: 50 });
    const layer = wrapper.querySelector<HTMLElement>('.rtx-area-hover');
    expect(layer?.dataset.visible).toBe('true');
    expect(layer?.querySelector('.rtx-area-hover__price')?.textContent).toBe('22,708.50');
    expect(layer?.querySelector('.rtx-area-hover__date')?.textContent).toBe("29 Sep '26");
    expect(layer?.querySelector('.rtx-area-hover__time')?.textContent).toBe('11:38 UTC+5:30');
    const dot = layer?.querySelector<HTMLElement>('.rtx-area-hover__dot');
    expect(dot?.style.background).toMatch(/ef5350|239,\s*83,\s*80/i);
    wrapper.dispatchEvent(new PointerEvent('pointerleave'));
    expect(layer?.dataset.visible).toBe('false');
    release();
    expect(wrapper.querySelector('.rtx-area-hover')).toBeNull();
  });

  it('hides the card when the chart is not showing an area point', () => {
    installImmediateFrames();
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    const release = installChartAreaHover(wrapper, () => null);
    wrapper.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10, bubbles: true }));
    expect(wrapper.querySelector<HTMLElement>('.rtx-area-hover')?.dataset.visible).toBe('false');
    release();
  });

  it('cancels a queued hover frame when a drag starts', () => {
    let callback: FrameRequestCallback | null = null;
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => {
      callback = next;
      return 7;
    });
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    const read = vi.fn(() => model());
    const release = installChartAreaHover(wrapper, read);

    wrapper.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 50, bubbles: true }));
    wrapper.dispatchEvent(new PointerEvent('pointermove', { clientX: 42, clientY: 52, buttons: 1, bubbles: true }));

    expect(cancel).toHaveBeenCalledWith(7);
    callback?.(0);
    expect(read).not.toHaveBeenCalled();
    expect(wrapper.querySelector<HTMLElement>('.rtx-area-hover')?.dataset.visible).toBe('false');
    release();
  });
});
