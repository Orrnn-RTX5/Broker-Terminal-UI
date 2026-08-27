import { describe, expect, it, vi } from 'vitest';
import { refreshLightweightChartSurface } from './lightweightChartSurface';

describe('refreshLightweightChartSurface', () => {
  it('forces a same-size repaint while preserving active autoSize', () => {
    const chart = {
      autoSizeActive: vi.fn(() => true),
      applyOptions: vi.fn(),
      resize: vi.fn(),
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
