// @vitest-environment jsdom
import { StrictMode } from 'react';
import { cleanup, renderHook } from '@testing-library/react';
import type { IChartApi } from 'lightweight-charts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChartInitializationLifetime, useChartInitializationLifetime } from './useChartInitializationLifetime';

const fixture = () => {
  const refs = {
    chartRef: { current: null as IChartApi | null },
    containerRef: { current: document.createElement('div') as HTMLDivElement | null },
    isDisposedRef: { current: false },
  };
  const removed: IChartApi[] = [];
  const initialize = vi.fn(() => {
    const chart = {} as IChartApi;
    refs.chartRef.current = chart;
    return () => { removed.push(chart); refs.chartRef.current = null; };
  });
  return { refs, initialize, removed, lifetime: createChartInitializationLifetime(refs) };
};

afterEach(async () => { cleanup(); await Promise.resolve(); });

describe('chart initialization lifetime', () => {
  it('retains one instance through React StrictMode replay and disposes on final unmount', async () => {
    const { refs, initialize, removed } = fixture();
    const view = renderHook(() => useChartInitializationLifetime(initialize, refs), { wrapper: StrictMode });
    const chart = refs.chartRef.current;
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(refs.isDisposedRef.current).toBe(false);
    await Promise.resolve();
    expect(removed).toEqual([]);
    expect(refs.chartRef.current).toBe(chart);

    view.unmount();
    expect(refs.isDisposedRef.current).toBe(true);
    expect(removed).toEqual([]);
    await Promise.resolve();
    expect(removed).toEqual([chart]);
    expect(refs.chartRef.current).toBeNull();
  });

  it('cancels every stale release and makes repeated cleanup harmless', async () => {
    const { refs, initialize, removed, lifetime } = fixture();
    const setupIdentity = {};
    const firstRelease = lifetime.acquire(setupIdentity, initialize)!;
    const chart = refs.chartRef.current;
    firstRelease();
    const secondRelease = lifetime.acquire(setupIdentity, initialize)!;
    firstRelease();
    secondRelease();
    const finalRelease = lifetime.acquire(setupIdentity, initialize)!;
    await Promise.resolve();
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(refs.isDisposedRef.current).toBe(false);
    expect(removed).toEqual([]);
    finalRelease();
    finalRelease();
    await Promise.resolve();
    expect(removed).toEqual([chart]);
  });

  it.each(['setup', 'container', 'chart'] as const)('reinitializes after a %s identity change', async (change) => {
    const { refs, initialize, removed, lifetime } = fixture();
    const setupIdentity = {};
    const firstRelease = lifetime.acquire(setupIdentity, initialize)!;
    const firstChart = refs.chartRef.current;
    firstRelease();
    if (change === 'container') refs.containerRef.current = document.createElement('div');
    if (change === 'chart') refs.chartRef.current = {} as IChartApi;
    const finalRelease = lifetime.acquire(change === 'setup' ? {} : setupIdentity, initialize)!;
    const replacement = refs.chartRef.current;
    expect(removed).toEqual([firstChart]);
    expect(replacement).not.toBe(firstChart);
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(refs.isDisposedRef.current).toBe(false);
    await Promise.resolve();
    expect(removed).toEqual([firstChart]);
    expect(refs.chartRef.current).toBe(replacement);
    finalRelease();
    await Promise.resolve();
    expect(removed).toEqual([firstChart, replacement]);
  });

  it('disposes after a real release even when the container is detached', async () => {
    const { refs, initialize, removed, lifetime } = fixture();
    const setupIdentity = {};
    const release = lifetime.acquire(setupIdentity, initialize)!;
    const chart = refs.chartRef.current;
    release();
    refs.containerRef.current = null;
    expect(lifetime.acquire(setupIdentity, initialize)).toBeUndefined();
    await Promise.resolve();
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(removed).toEqual([chart]);
    expect(refs.isDisposedRef.current).toBe(true);
  });
});
