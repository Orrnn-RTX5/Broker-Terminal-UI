import type { IChartApi, LogicalRange } from 'lightweight-charts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindChartKeyboardScroll } from './chartKeyboardScroll';

const disposers: Array<() => void> = [];
afterEach(() => { disposers.splice(0).forEach((dispose) => dispose()); });

const fixture = (contextId = 'chart-a', initialRange: { from: number; to: number } | null = { from: 100, to: 200 }) => {
  const state = { followLive: true, remembered: null as LogicalRange | null };
  const beforeScroll = vi.fn(() => { state.followLive = false; });
  const onScrolled = vi.fn((range: LogicalRange) => { state.remembered = range; });
  const getVisibleLogicalRange = vi.fn(() => initialRange);
  const setVisibleLogicalRange = vi.fn(() => { expect(state.followLive).toBe(false); });
  const timeScale = { getVisibleLogicalRange, setVisibleLogicalRange };
  const chart = { timeScale: () => timeScale } as unknown as IChartApi;
  let active = 'chart-a';
  const getChart = vi.fn((): IChartApi | null => chart);
  const dispose = bindChartKeyboardScroll({
    getChart,
    isTarget: (request) => (request.targetContextId || active) === contextId,
    beforeScroll,
    onScrolled,
  });
  disposers.push(dispose);
  return { state, beforeScroll, onScrolled, getChart, timeScale, dispose, activate: (id: string) => { active = id; } };
};
const scroll = (detail: unknown) => window.dispatchEvent(new CustomEvent('chart-scroll', { detail }));

describe('scoped chart keyboard scrolling', () => {
  it.each([['left', 90, 190], ['right', 110, 210]] as const)('pans %s by ten percent while retaining visible width and disabling follow-live', (direction, from, to) => {
    const chart = fixture();
    scroll({ direction, targetContextId: 'chart-a' });
    expect(chart.timeScale.setVisibleLogicalRange).toHaveBeenCalledExactlyOnceWith({ from, to });
    expect(chart.state.followLive).toBe(false);
    expect(chart.state.remembered).toEqual({ from, to });
    expect(to - from).toBe(100);
  });

  it('moves only the requested chart in a multi-chart workspace', () => {
    const a = fixture('chart-a'); const b = fixture('chart-b');
    scroll({ direction: 'left', targetContextId: 'chart-b' });
    expect(a.timeScale.setVisibleLogicalRange).not.toHaveBeenCalled();
    expect(a.state.followLive).toBe(true);
    expect(b.timeScale.setVisibleLogicalRange).toHaveBeenCalledOnce();
  });

  it('uses the current active chart for legacy unscoped events', () => {
    const chart = fixture('chart-b');
    scroll({ direction: 'right' }); expect(chart.onScrolled).not.toHaveBeenCalled();
    chart.activate('chart-b'); scroll({ direction: 'right' });
    expect(chart.onScrolled).toHaveBeenCalledOnce();
  });

  it.each([null, { from: NaN, to: 100 }, { from: 100, to: Infinity }, { from: 100, to: 100 }, { from: 200, to: 100 }])('leaves policy unchanged when no usable range exists: %j', (range) => {
    const chart = fixture('chart-a', range);
    scroll({ direction: 'left' });
    expect(chart.beforeScroll).not.toHaveBeenCalled();
    expect(chart.onScrolled).not.toHaveBeenCalled();
    expect(chart.timeScale.setVisibleLogicalRange).not.toHaveBeenCalled();
  });

  it('ignores missing/disposed charts, invalid directions and events after cleanup', () => {
    const chart = fixture();
    chart.getChart.mockReturnValueOnce(null); scroll({ direction: 'left' });
    expect(chart.beforeScroll).not.toHaveBeenCalled();
    chart.timeScale.getVisibleLogicalRange.mockImplementationOnce(() => { throw new Error('Disposed'); });
    expect(() => scroll({ direction: 'right' })).not.toThrow();
    scroll({ direction: 'up' }); scroll(null);
    chart.dispose(); scroll({ direction: 'left' });
    expect(chart.beforeScroll).not.toHaveBeenCalled();
    expect(chart.onScrolled).not.toHaveBeenCalled();
  });
});
