import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canZoomChartOut, useChartZoomStore } from './useChartZoomStore';

beforeEach(() => useChartZoomStore.setState({ byContext: {} }));

describe('chart zoom availability', () => {
  it('tracks the baseline independently for each panel and tolerates round-trip rounding', () => {
    const { syncSpacing } = useChartZoomStore.getState();
    syncSpacing('a', 30, true);
    syncSpacing('b', 8, true);
    syncSpacing('a', 36);
    expect(canZoomChartOut(useChartZoomStore.getState().byContext.a)).toBe(true);
    expect(canZoomChartOut(useChartZoomStore.getState().byContext.b)).toBe(false);
    syncSpacing('a', 30.000000000000004);
    expect(canZoomChartOut(useChartZoomStore.getState().byContext.a)).toBe(false);
  });

  it('resets zoom availability with the viewport and clears disposed chart state', () => {
    const { syncSpacing, clearContext } = useChartZoomStore.getState();
    syncSpacing('a', 8);
    syncSpacing('a', 16);
    syncSpacing('a', 10, true);
    expect(canZoomChartOut(useChartZoomStore.getState().byContext.a)).toBe(false);
    clearContext('a');
    expect(useChartZoomStore.getState().byContext.a).toBeUndefined();
  });

  it('avoids sidebar updates while panning at the same spacing and ignores invalid values', () => {
    const { syncSpacing } = useChartZoomStore.getState();
    syncSpacing('a', 8);
    const listener = vi.fn();
    const unsubscribe = useChartZoomStore.subscribe(listener);
    syncSpacing('a', 8);
    syncSpacing('a', 0);
    syncSpacing('a', NaN);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
