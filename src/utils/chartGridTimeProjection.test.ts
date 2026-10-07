import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ITimeScaleApi, LogicalRange, Time } from 'lightweight-charts';
import type { Timeframe } from '../types/chart';
import { createChartGridTimeProjection, MAX_CHART_GRID_PROJECTION_POINTS } from './chartGridTimeProjection';

afterEach(() => vi.unstubAllGlobals());

const createFixture = (timeframe: Timeframe = 'M1', latestTime = Date.UTC(2024, 0, 1) / 1000) => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  const initialCandles = Object.freeze(Array.from({ length: 100 }, (_, index) => Object.freeze({
    time: latestTime - (99 - index) * 60, open: 100, high: 105, low: 99, close: 102,
  })));
  const state = {
    mainData: initialCandles as readonly typeof initialCandles[number][],
    hostData: [] as { time: number }[],
    enabled: true,
    invalidLatest: false,
    timeframe,
    boundaryOffsetSeconds: 0,
    range: { from: 0, to: 199 } as LogicalRange,
    barSpacing: 10,
    rightOffset: 100,
    width: 2000,
    disturbViewport: false,
  };
  let listener: (() => void) | null = null;
  const getLatestIndex = () => {
    const allTimes = [...new Set([...state.mainData.map(point => point.time), ...state.hostData.map(point => point.time)])].sort((a, b) => a - b);
    return allTimes.indexOf(state.mainData[state.mainData.length - 1].time);
  };
  const timeScale = {
    getVisibleLogicalRange: vi.fn(() => ({ ...state.range })),
    setVisibleLogicalRange: vi.fn((range: LogicalRange) => { state.range = { ...range }; listener?.(); }),
    subscribeVisibleLogicalRangeChange: vi.fn((callback: () => void) => { listener = callback; }),
    unsubscribeVisibleLogicalRangeChange: vi.fn(() => { listener = null; }),
    timeToIndex: vi.fn(() => getLatestIndex()),
    options: vi.fn(() => ({ barSpacing: state.barSpacing })),
    applyOptions: vi.fn(({ barSpacing, rightOffset }: { barSpacing: number; rightOffset: number }) => {
      state.barSpacing = barSpacing;
      state.rightOffset = rightOffset;
      const to = getLatestIndex() + rightOffset;
      state.range = { from: to - state.width / barSpacing + 1, to } as LogicalRange;
      listener?.();
    }),
    scrollPosition: vi.fn(() => state.rightOffset),
  };
  const hostSeries = {
    setData: vi.fn((data: { time: Time }[]) => {
      const previousIndex = getLatestIndex();
      state.hostData = data.map(point => ({ time: Number(point.time) }));
      const indexShift = getLatestIndex() - previousIndex;
      state.range = { from: state.range.from + indexShift, to: state.range.to + indexShift } as LogicalRange;
      if (state.disturbViewport) {
        state.barSpacing = 2;
        state.rightOffset = 0;
        state.range = { from: 90, to: 120 } as LogicalRange;
      }
      listener?.();
    }),
  };
  const projection = createChartGridTimeProjection({
    timeScale: timeScale as unknown as ITimeScaleApi<Time>,
    hostSeries,
    getLatestPoint: () => state.invalidLatest ? null : ({ time: state.mainData[state.mainData.length - 1].time, index: getLatestIndex() }),
    getTimeframe: () => state.timeframe,
    getBoundaryOffsetSeconds: () => state.boundaryOffsetSeconds,
    isEnabled: () => state.enabled,
  });
  const flush = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  };
  const pan = (from: number, to: number) => {
    state.range = { from, to } as LogicalRange;
    state.rightOffset = to - getLatestIndex();
    state.width = (to - from + 1) * state.barSpacing;
    listener?.();
  };
  return { state, projection, hostSeries, timeScale, initialCandles, flush, pan, frames, getLatestIndex };
};

describe('native grid future time projection', () => {
  it('continues time coordinates through a panned future plot without creating candles or moving the viewport', () => {
    const fixture = createFixture();
    fixture.flush();
    const originalCandles = fixture.initialCandles;
    fixture.pan(1000, 1500);
    const viewport = { ...fixture.state.range };
    const offset = fixture.state.rightOffset;
    fixture.flush();
    const latest = originalCandles[originalCandles.length - 1];
    const futureSteps = Math.ceil(viewport.to - 99);
    expect(fixture.state.hostData[futureSteps - 1].time).toBe(latest.time + futureSteps * 60);
    expect(fixture.state.hostData.every(point => Object.keys(point).join() === 'time' && point.time > latest.time)).toBe(true);
    expect(fixture.state.mainData).toBe(originalCandles);
    expect(fixture.state.mainData[99]).toEqual(latest);
    expect(fixture.getLatestIndex()).toBe(99);
    expect(fixture.state.range).toEqual(viewport);
    expect(fixture.state.rightOffset).toBe(offset);
    expect(fixture.state.barSpacing).toBe(10);
    fixture.projection.dispose();
  });

  it('coalesces repeated pans and refreshes, reusing existing time coordinates until capacity is exhausted', () => {
    const fixture = createFixture();
    fixture.flush();
    const firstPoints = [...fixture.state.hostData];
    for (let index = 0; index < 20; index++) {
      fixture.pan(10 + index, 220 + index);
      fixture.projection.refresh();
    }
    expect(fixture.frames.size).toBe(1);
    fixture.flush();
    expect(fixture.hostSeries.setData).toHaveBeenCalledOnce();
    fixture.pan(800, 1300);
    fixture.pan(900, 1400);
    fixture.flush();
    expect(fixture.hostSeries.setData).toHaveBeenCalledTimes(2);
    expect(fixture.state.hostData.slice(0, firstPoints.length)).toEqual(firstPoints);
    expect(fixture.frames.size).toBe(0);
    fixture.projection.dispose();
  });

  it('preserves zoom and scroll when the host update changes viewport state', () => {
    const fixture = createFixture();
    fixture.state.disturbViewport = true;
    const range = { ...fixture.state.range };
    fixture.flush();
    expect(fixture.state.range).toEqual(range);
    expect(fixture.state.barSpacing).toBe(10);
    expect(fixture.state.rightOffset).toBe(100);
    expect(fixture.timeScale.applyOptions).toHaveBeenCalledWith({ barSpacing: 10, rightOffset: 100 });
    expect(fixture.frames.size).toBe(0);
    fixture.projection.dispose();
  });

  it('removes obsolete projections across a real-data gap while keeping the new true candle in place', () => {
    const fixture = createFixture();
    fixture.flush();
    const nextTime = fixture.initialCandles[99].time + 60 * 60;
    fixture.state.mainData = [...fixture.initialCandles, { ...fixture.initialCandles[99], time: nextTime }];
    const beforeIndex = fixture.getLatestIndex();
    fixture.pan(beforeIndex - 100, beforeIndex + 200);
    const offset = fixture.state.rightOffset;
    fixture.projection.refresh();
    fixture.flush();
    expect(fixture.state.hostData.every(point => point.time > nextTime)).toBe(true);
    expect(fixture.getLatestIndex()).toBe(100);
    expect(fixture.state.mainData).toHaveLength(101);
    expect(fixture.state.mainData[100].time).toBe(nextTime);
    expect(fixture.state.rightOffset).toBe(offset);
    expect(fixture.state.range.to - fixture.getLatestIndex()).toBe(200);
    fixture.projection.dispose();
  });

  it('clears invalid latest data, resets on timeframe changes, and uses calendar months across leap years', () => {
    const fixture = createFixture('MN');
    fixture.flush();
    expect(fixture.state.hostData.slice(0, 3).map(point => point.time)).toEqual([
      Date.UTC(2024, 1, 1) / 1000, Date.UTC(2024, 2, 1) / 1000, Date.UTC(2024, 3, 1) / 1000,
    ]);
    fixture.state.timeframe = 'H4';
    fixture.projection.refresh();
    fixture.flush();
    expect(fixture.state.hostData[0].time).toBe(fixture.initialCandles[99].time + 4 * 3600);
    fixture.state.invalidLatest = true;
    fixture.projection.refresh();
    fixture.flush();
    expect(fixture.state.hostData).toEqual([]);
    fixture.projection.dispose();
  });

  it('keeps monthly guides on broker calendar boundaries and rebuilds after an offset change', () => {
    const fixture = createFixture('MN', Date.UTC(2024, 8, 30, 21) / 1000);
    fixture.flush();
    fixture.state.boundaryOffsetSeconds = 3 * 3600;
    fixture.projection.refresh();
    fixture.flush();
    expect(fixture.state.hostData.slice(0, 3).map(point => point.time)).toEqual([
      Date.UTC(2024, 9, 31, 21) / 1000,
      Date.UTC(2024, 10, 30, 21) / 1000,
      Date.UTC(2024, 11, 31, 21) / 1000,
    ]);
    expect(fixture.hostSeries.setData).toHaveBeenCalledTimes(2);
    fixture.projection.dispose();
  });

  it('clears the previous symbol projection while the replacement viewport is not initialized', () => {
    const fixture = createFixture();
    fixture.flush();
    fixture.state.mainData = [{ ...fixture.initialCandles[99], time: Date.UTC(2025, 0, 1) / 1000 }];
    fixture.timeScale.getVisibleLogicalRange.mockReturnValue(null);
    fixture.projection.refresh();
    fixture.flush();
    expect(fixture.state.hostData).toEqual([]);
    fixture.projection.dispose();
  });

  it.each<[Timeframe, number]>([
    ['M1', 60], ['M5', 300], ['M15', 900], ['M30', 1800], ['H1', 3600], ['H4', 14_400], ['D1', 86_400], ['W1', 604_800],
  ])('projects %s time coordinates at its actual interval', (timeframe, seconds) => {
    const fixture = createFixture(timeframe);
    fixture.flush();
    expect(fixture.state.hostData[0].time - fixture.initialCandles[99].time).toBe(seconds);
    expect(fixture.state.hostData[1].time - fixture.state.hostData[0].time).toBe(seconds);
    fixture.projection.dispose();
  });

  it('bounds extreme requested horizons while covering a roughly 3000-bar visible plot', () => {
    const fixture = createFixture();
    fixture.state.barSpacing = 0.5;
    fixture.pan(0, 3000);
    fixture.flush();
    expect(fixture.state.hostData.length).toBeGreaterThan(3000 - fixture.getLatestIndex());
    fixture.pan(0, 100_000);
    fixture.flush();
    expect(fixture.state.hostData).toHaveLength(MAX_CHART_GRID_PROJECTION_POINTS);
    fixture.projection.dispose();
  });

  it('cancels pending work, unsubscribes and clears on disable, re-enables cleanly, and disposes once', () => {
    const fixture = createFixture();
    fixture.flush();
    fixture.pan(2000, 2500);
    const viewport = { ...fixture.state.range };
    fixture.state.enabled = false;
    fixture.projection.refresh();
    expect(fixture.frames.size).toBe(0);
    expect(fixture.state.hostData).toEqual([]);
    expect(fixture.state.range).toEqual(viewport);
    expect(fixture.timeScale.unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledOnce();
    fixture.state.enabled = true;
    fixture.projection.refresh();
    fixture.flush();
    expect(fixture.state.hostData.length).toBeGreaterThan(0);
    expect(fixture.timeScale.subscribeVisibleLogicalRangeChange).toHaveBeenCalledTimes(2);
    fixture.projection.dispose();
    fixture.projection.dispose();
    const writes = fixture.hostSeries.setData.mock.calls.length;
    fixture.pan(3000, 3500);
    fixture.projection.refresh();
    fixture.flush();
    expect(fixture.frames.size).toBe(0);
    expect(fixture.state.hostData).toEqual([]);
    expect(fixture.hostSeries.setData).toHaveBeenCalledTimes(writes);
    expect(fixture.timeScale.unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledTimes(2);
  });
});
