import type { IChartApi } from 'lightweight-charts';
import { describe, expect, it, vi } from 'vitest';
import {
  createChartWheelSmoothing,
  normalizeChartWheelInput,
  type ChartWheelInput,
} from './chartWheelSmoothing';

const input = (deltaY = 0, deltaX = 0, deltaMode = 0): ChartWheelInput => ({
  deltaY, deltaX, deltaMode,
});

function frameClock() {
  let timestamp = 0;
  let nextId = 0;
  const pending = new Map<number, FrameRequestCallback>();
  return {
    requestFrame: (callback: FrameRequestCallback) => {
      const id = ++nextId;
      pending.set(id, callback);
      return id;
    },
    cancelFrame: (id: number) => { pending.delete(id); },
    step: (beforeFrame: () => void, milliseconds = 1000 / 60) => {
      beforeFrame();
      timestamp += milliseconds;
      const current = [...pending.values()];
      pending.clear();
      current.forEach(callback => callback(timestamp));
    },
    pendingCount: () => pending.size,
  };
}

function fixture({
  spacing = 8,
  width = 800,
  minimum = 0.5,
  maximum = 0,
  rightBarStaysOnScroll = true,
  offset = 5,
} = {}) {
  const clock = frameClock();
  const state = {
    spacing, width, minimum, maximum, offset, rightBarStaysOnScroll,
    active: true,
    scaleEnabled: true,
    scrollEnabled: true,
    hasData: true,
    disposed: false,
  };
  let pendingOptions: { barSpacing?: number; rightOffset?: number } | null = null;
  const commits: Array<{ spacing: number; offset: number }> = [];
  const commit = () => {
    if (!pendingOptions) return;
    if (pendingOptions.barSpacing !== undefined) {
      state.spacing = Math.max(state.minimum, Math.min(
        state.maximum > 0 ? state.maximum : state.width / 2,
        pendingOptions.barSpacing,
      ));
    }
    if (pendingOptions.rightOffset !== undefined) state.offset = pendingOptions.rightOffset;
    commits.push({ spacing: state.spacing, offset: state.offset });
    pendingOptions = null;
  };
  const timeScale = {
    getVisibleLogicalRange: vi.fn(() => {
      if (state.disposed) throw new Error('Disposed chart');
      if (!state.hasData) return null;
      const to = 999 + state.offset;
      return { from: to - state.width / state.spacing + 1, to };
    }),
    options: () => ({
      barSpacing: state.spacing,
      minBarSpacing: state.minimum,
      maxBarSpacing: state.maximum,
      rightOffset: state.offset,
      rightBarStaysOnScroll: state.rightBarStaysOnScroll,
    }),
    width: () => state.width,
    scrollPosition: () => state.offset,
    applyOptions: vi.fn((options: { barSpacing?: number; rightOffset?: number }) => {
      // Lightweight Charts applies time-scale options on its rendering frame.
      // Leave reads unchanged until the next frame, rather than pretending the
      // chart synchronously accepts writes from the smoothing callback.
      pendingOptions = { ...pendingOptions, ...options };
    }),
  };
  const priceScale = vi.fn(() => { throw new Error('Wheel must never mutate the price scale'); });
  const chart = {
    timeScale: () => timeScale,
    options: () => ({
      handleScale: { mouseWheel: state.scaleEnabled },
      handleScroll: { mouseWheel: state.scrollEnabled },
    }),
    priceScale,
  } as unknown as IChartApi;
  const onActivity = vi.fn();
  const onFrame = vi.fn();
  const smoothing = createChartWheelSmoothing({
    chart,
    canInteract: () => state.active && !state.disposed,
    onActivity,
    onFrame,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
  });
  const step = (milliseconds?: number) => clock.step(commit, milliseconds);
  const finish = () => {
    let frames = 0;
    while (clock.pendingCount() > 0 && frames < 60) {
      step();
      frames += 1;
    }
    commit();
    expect(clock.pendingCount()).toBe(0);
    return frames;
  };
  return {
    state, timeScale, priceScale, smoothing, onActivity, onFrame, clock,
    step, finish, commit, commits,
    hoverIndex: (anchorX: number) => 999 + state.offset - (state.width - 1 - anchorX) / state.spacing,
  };
}

describe('chart wheel normalization', () => {
  it.each([
    [-120, 0, 1],
    [120, 0, -1],
    [-10, 0, 0.1],
    [-1, 1, 0.32],
    [1, 1, -0.32],
    [-1, 2, 1],
  ])('normalizes vertical delta %s in mode %s to native zoom %s', (deltaY, deltaMode, zoom) => {
    expect(normalizeChartWheelInput(input(deltaY, 0, deltaMode), {
      windowsChromium: false,
      devicePixelRatio: 1,
    })).toEqual({ zoom, panPixels: 0 });
  });

  it('preserves tiny trackpad deltas and horizontal-only input', () => {
    expect(normalizeChartWheelInput(input(-0.25, 0.5), { windowsChromium: false }))
      .toEqual({ zoom: 0.0025, panPixels: 0.4 });
    expect(normalizeChartWheelInput(input(0, 30), { windowsChromium: false }))
      .toEqual({ zoom: 0, panPixels: 24 });
  });

  it('corrects Windows Chromium pixel input for device pixel ratio only', () => {
    expect(normalizeChartWheelInput(input(-100, 50), { windowsChromium: true, devicePixelRatio: 2 }))
      .toEqual({ zoom: 0.5, panPixels: 20 });
    expect(normalizeChartWheelInput(input(-1, 1, 1), { windowsChromium: true, devicePixelRatio: 2 }))
      .toEqual({ zoom: 0.32, panPixels: 25.6 });
    expect(normalizeChartWheelInput(input(-100, 50), { windowsChromium: false, devicePixelRatio: 2 }))
      .toEqual({ zoom: 1, panPixels: 40 });
  });

  it.each([
    input(), input(NaN), input(Infinity), input(0, NaN), input(0, Infinity), input(1, 0, 7),
  ])('ignores zero, malformed, and unsupported wheel input: %j', event => {
    expect(normalizeChartWheelInput(event)).toBeNull();
  });
});

describe('smooth chart wheel interaction', () => {
  it('spreads a mouse notch over several frames and preserves its native final zoom', () => {
    const chart = fixture();
    expect(chart.smoothing.handleWheel(input(-120), 400)).toBe(true);
    expect(chart.timeScale.applyOptions).not.toHaveBeenCalled();
    expect(chart.state.spacing).toBe(8);
    chart.step();
    chart.commit();
    expect(chart.state.spacing).toBeGreaterThan(8);
    expect(chart.state.spacing).toBeLessThan(8.8);
    expect(chart.finish()).toBeGreaterThan(1);
    expect(chart.state.spacing).toBeCloseTo(8.8, 8);
    const spacings = chart.commits.map(frame => frame.spacing);
    expect(spacings.every((value, index) => index === 0 || value >= spacings[index - 1])).toBe(true);
    expect(Math.max(...spacings)).toBeLessThanOrEqual(8.8);
    expect(chart.onActivity).toHaveBeenCalled();
    expect(chart.onFrame).toHaveBeenCalled();
    expect(chart.priceScale).not.toHaveBeenCalled();
  });

  it('coalesces rapid notches into one animation while preserving their combined native zoom', () => {
    const chart = fixture();
    for (let index = 0; index < 4; index += 1) chart.smoothing.handleWheel(input(-120), 400);
    expect(chart.clock.pendingCount()).toBe(1);
    chart.finish();
    expect(chart.state.spacing).toBeCloseTo(8 * 1.1 ** 4, 8);
    expect(chart.timeScale.applyOptions.mock.calls.length).toBeLessThan(40);
  });

  it.each([60, 120])('retains the final zoom at a %s Hz frame cadence', refreshRate => {
    const chart = fixture();
    chart.smoothing.handleWheel(input(-120), 400);
    let frames = 0;
    while (chart.clock.pendingCount() > 0 && frames < 60) {
      chart.step(1000 / refreshRate);
      frames += 1;
    }
    chart.commit();
    expect(chart.clock.pendingCount()).toBe(0);
    expect(frames).toBeGreaterThan(1);
    expect(frames * 1000 / refreshRate).toBeLessThanOrEqual(200);
    expect(chart.state.spacing).toBeCloseTo(8.8, 8);
  });

  it('settles expired motion on the next frame after a main-thread stall', () => {
    const chart = fixture();
    chart.smoothing.handleWheel(input(-120), 400);
    chart.step();
    chart.commit();
    expect(chart.state.spacing).toBeLessThan(8.8);
    chart.step(500);
    chart.commit();
    expect(chart.clock.pendingCount()).toBe(0);
    expect(chart.state.spacing).toBeCloseTo(8.8, 8);
  });

  it('preserves an accumulated stream of fractional trackpad zoom events', () => {
    const chart = fixture();
    for (let index = 0; index < 20; index += 1) chart.smoothing.handleWheel(input(-5), 230);
    chart.finish();
    expect(chart.state.spacing).toBeCloseTo(8 * 1.005 ** 20, 8);
  });

  it('reverses promptly from the visible viewport rather than consuming previous momentum', () => {
    const chart = fixture();
    for (let index = 0; index < 5; index += 1) chart.smoothing.handleWheel(input(-120), 400);
    chart.step();
    chart.commit();
    const reversedFrom = chart.state.spacing;
    chart.smoothing.handleWheel(input(120), 400);
    chart.step();
    chart.commit();
    expect(chart.state.spacing).toBeLessThan(reversedFrom);
    chart.finish();
    expect(chart.state.spacing).toBeCloseTo(reversedFrom * 0.9, 8);
  });

  it('pans smoothly for horizontal-only input without changing spacing or the price scale', () => {
    const chart = fixture();
    chart.smoothing.handleWheel(input(0, 100), 400);
    chart.step();
    chart.commit();
    expect(chart.state.offset).toBeGreaterThan(5);
    expect(chart.state.offset).toBeLessThan(15);
    chart.finish();
    expect(chart.state.offset).toBeCloseTo(15, 8);
    expect(chart.state.spacing).toBe(8);
    expect(chart.timeScale.applyOptions.mock.calls.every(([options]) => options.barSpacing === undefined)).toBe(true);
    expect(chart.priceScale).not.toHaveBeenCalled();
  });

  it('keeps the right logical edge fixed under the terminal default wheel anchor', () => {
    const chart = fixture({ offset: -100 });
    const rightEdge = chart.timeScale.getVisibleLogicalRange()?.to;
    chart.smoothing.handleWheel(input(-120), 75);
    chart.finish();
    expect(chart.timeScale.getVisibleLogicalRange()?.to).toBe(rightEdge);
    expect(chart.state.offset).toBe(-100);
  });

  it('keeps the logical point under the cursor fixed when cursor anchoring is enabled', () => {
    const chart = fixture({ rightBarStaysOnScroll: false });
    const anchorX = 215;
    const before = chart.hoverIndex(anchorX);
    chart.smoothing.handleWheel(input(-120), anchorX);
    chart.finish();
    expect(chart.hoverIndex(anchorX)).toBeCloseTo(before, 8);
    expect(chart.state.spacing).toBeCloseTo(8.8, 8);
  });

  it.each([
    { spacing: 0.5, minimum: 0.5, maximum: 0, deltaY: 120, expected: 0.5 },
    { spacing: 399, minimum: 0.5, maximum: 0, deltaY: -120, expected: 400 },
    { spacing: 19, minimum: 0.5, maximum: 20, deltaY: -120, expected: 20 },
  ])('respects native spacing limits: %j', ({ deltaY, expected, ...options }) => {
    const chart = fixture(options);
    chart.smoothing.handleWheel(input(deltaY), 400);
    chart.finish();
    expect(chart.state.spacing).toBeCloseTo(expected, 8);
  });

  it('allows horizontal pan with zoom disabled and zoom with horizontal pan disabled', () => {
    const pan = fixture();
    pan.state.scaleEnabled = false;
    expect(pan.smoothing.handleWheel(input(-120, 100), 400)).toBe(true);
    pan.finish();
    expect(pan.state.spacing).toBe(8);
    expect(pan.state.offset).toBeCloseTo(15, 8);
    const zoom = fixture();
    zoom.state.scrollEnabled = false;
    expect(zoom.smoothing.handleWheel(input(-120, 100), 400)).toBe(true);
    zoom.finish();
    expect(zoom.state.spacing).toBeCloseTo(8.8, 8);
    expect(zoom.state.offset).toBe(5);
  });

  it('rejects drawing-locked input and stops pending motion when the lock starts', () => {
    const chart = fixture();
    chart.smoothing.handleWheel(input(-120), 400);
    chart.step();
    chart.commit();
    const lockedSpacing = chart.state.spacing;
    chart.state.scaleEnabled = false;
    chart.state.scrollEnabled = false;
    chart.finish();
    expect(chart.state.spacing).toBe(lockedSpacing);
    expect(chart.smoothing.handleWheel(input(-120, 100), 400)).toBe(false);
    expect(chart.clock.pendingCount()).toBe(0);
    chart.state.scaleEnabled = true;
    chart.state.scrollEnabled = true;
    chart.smoothing.handleWheel(input(-120), 400);
    chart.finish();
    expect(chart.state.spacing).toBeCloseTo(lockedSpacing * 1.1, 8);
  });

  it.each(['inactive', 'empty', 'disposed'] as const)('does not interact with an %s chart', kind => {
    const chart = fixture();
    if (kind === 'inactive') chart.state.active = false;
    if (kind === 'empty') chart.state.hasData = false;
    if (kind === 'disposed') chart.state.disposed = true;
    expect(chart.smoothing.handleWheel(input(-120), 400)).toBe(false);
    expect(chart.clock.pendingCount()).toBe(0);
    expect(chart.timeScale.applyOptions).not.toHaveBeenCalled();
    expect(chart.onActivity).not.toHaveBeenCalled();
  });

  it('cancels queued movement before a new chart context and starts cleanly afterward', () => {
    const chart = fixture();
    chart.smoothing.handleWheel(input(-120), 400);
    chart.smoothing.cancel();
    chart.state.spacing = 40;
    chart.step();
    chart.finish();
    expect(chart.state.spacing).toBe(40);
    expect(chart.timeScale.applyOptions).not.toHaveBeenCalled();
    chart.smoothing.handleWheel(input(120), 400);
    chart.finish();
    expect(chart.state.spacing).toBeCloseTo(36, 8);
  });

  it.each([
    { event: input(), anchorX: 400 },
    { event: input(NaN), anchorX: 400 },
    { event: input(0, Infinity), anchorX: 400 },
    { event: input(-120), anchorX: NaN },
  ])('cancels residual motion when the next input is unusable: %j', ({ event, anchorX }) => {
    const chart = fixture();
    chart.smoothing.handleWheel(input(-120), 400);
    chart.step();
    chart.commit();
    const stoppedSpacing = chart.state.spacing;
    expect(chart.smoothing.handleWheel(event, anchorX)).toBe(false);
    expect(chart.clock.pendingCount()).toBe(0);
    chart.finish();
    expect(chart.state.spacing).toBe(stoppedSpacing);
  });

  it('cancels on deactivation during animation and resumes from the actual viewport', () => {
    const chart = fixture();
    chart.smoothing.handleWheel(input(-120), 400);
    chart.step();
    chart.commit();
    const pausedSpacing = chart.state.spacing;
    chart.state.active = false;
    chart.finish();
    expect(chart.state.spacing).toBe(pausedSpacing);
    chart.state.active = true;
    chart.smoothing.handleWheel(input(-120), 400);
    chart.finish();
    expect(chart.state.spacing).toBeCloseTo(pausedSpacing * 1.1, 8);
  });

  it('disposes pending frames and rejects future input without touching a destroyed chart', () => {
    const chart = fixture();
    chart.smoothing.handleWheel(input(-120), 400);
    chart.smoothing.dispose();
    chart.state.disposed = true;
    chart.step();
    expect(chart.clock.pendingCount()).toBe(0);
    expect(chart.timeScale.applyOptions).not.toHaveBeenCalled();
    expect(chart.smoothing.handleWheel(input(-120), 400)).toBe(false);
  });
});
