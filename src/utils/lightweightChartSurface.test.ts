import { describe, expect, it, vi } from 'vitest';
import { refreshLightweightChartSurface } from './lightweightChartSurface';

describe('refreshLightweightChartSurface', () => {
  it('forces a same-size repaint while preserving active autoSize', () => {
    const chart = {
      autoSizeActive: vi.fn(() => true),
      applyOptions: vi.fn(),
      resize: vi.fn(),
      chartElement: () => ({ style: { width: '900px', height: '502px' } }),
    };

    expect(refreshLightweightChartSurface(chart as never, 901.8, 503.4)).toBe(true);
    expect(chart.applyOptions.mock.calls).toEqual([
      [{ autoSize: false, width: 901, height: 503 }],
      [{}],
      [{ autoSize: true }],
    ]);
    expect(chart.resize).toHaveBeenCalledWith(901, 503, true);
  });

  it('forces repaint directly when autoSize is already inactive', () => {
    const chart = {
      autoSizeActive: vi.fn(() => false),
      applyOptions: vi.fn(),
      resize: vi.fn(),
    };

    expect(refreshLightweightChartSurface(chart as never, 800, 420)).toBe(true);
    expect(chart.resize).toHaveBeenCalledWith(800, 420, true);
    expect(chart.applyOptions).toHaveBeenCalledOnce();
    expect(chart.applyOptions).toHaveBeenCalledWith({});
  });

  it('leaves an already-sized surface and its ResizeObserver alone during repeated activation checks', () => {
    const chart = {
      autoSizeActive: vi.fn(() => true),
      applyOptions: vi.fn(),
      resize: vi.fn(),
      chartElement: () => ({ style: { width: '900px', height: '502px' } }),
    };

    for (let pass = 0; pass < 5; pass++) {
      expect(refreshLightweightChartSurface(chart as never, 901.8, 503.4, { forceRepaint: false })).toBe(true);
    }
    expect(chart.autoSizeActive).not.toHaveBeenCalled();
    expect(chart.applyOptions).not.toHaveBeenCalled();
    expect(chart.resize).not.toHaveBeenCalled();
  });

  it('repairs changed dimensions once, then skips unchanged follow-up frames', () => {
    const style = { width: '900px', height: '502px' };
    const chart = {
      autoSizeActive: vi.fn(() => true),
      applyOptions: vi.fn(),
      resize: vi.fn((width: number, height: number) => {
        style.width = `${width - width % 2}px`;
        style.height = `${height - height % 2}px`;
      }),
      chartElement: () => ({ style }),
    };

    expect(refreshLightweightChartSurface(chart as never, 450, 300, { forceRepaint: false })).toBe(true);
    expect(chart.resize).toHaveBeenCalledExactlyOnceWith(450, 300, true);
    expect(chart.applyOptions).toHaveBeenLastCalledWith({ autoSize: true });
    chart.resize.mockClear();
    chart.applyOptions.mockClear();
    expect(refreshLightweightChartSurface(chart as never, 450, 300, { forceRepaint: false })).toBe(true);
    expect(chart.resize).not.toHaveBeenCalled();
    expect(chart.applyOptions).not.toHaveBeenCalled();

    // Theme changes still repaint an unchanged canvas, including after a
    // successful ordinary resize. They must never use the dimension shortcut.
    expect(refreshLightweightChartSurface(chart as never, 450, 300, { forceRepaint: true })).toBe(true);
    expect(chart.resize).toHaveBeenCalledExactlyOnceWith(450, 300, true);
    expect(chart.applyOptions).toHaveBeenCalledTimes(3);
  });

  it('retains the repair path if chart dimensions are unavailable', () => {
    const chart = {
      autoSizeActive: vi.fn(() => true),
      applyOptions: vi.fn(),
      resize: vi.fn(),
    };

    expect(refreshLightweightChartSurface(chart as never, 900, 500, { forceRepaint: false })).toBe(true);
    expect(chart.resize).toHaveBeenCalledExactlyOnceWith(900, 500, true);
    expect(chart.applyOptions).toHaveBeenLastCalledWith({ autoSize: true });
  });

  it('ignores zero-size containers without touching the chart', () => {
    const chart = {
      autoSizeActive: vi.fn(() => true),
      applyOptions: vi.fn(),
      resize: vi.fn(),
    };

    expect(refreshLightweightChartSurface(chart as never, 0, 420)).toBe(false);
    expect(chart.autoSizeActive).not.toHaveBeenCalled();
    expect(chart.resize).not.toHaveBeenCalled();
  });

  it('restores autoSize when repaint races with chart disposal', () => {
    const chart = {
      autoSizeActive: vi.fn(() => true),
      applyOptions: vi.fn(),
      resize: vi.fn(() => { throw new Error('disposed'); }),
    };

    expect(refreshLightweightChartSurface(chart as never, 900, 500)).toBe(false);
    expect(chart.applyOptions).toHaveBeenLastCalledWith({ autoSize: true });
  });
});
