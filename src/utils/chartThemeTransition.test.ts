import { describe, expect, it, vi } from 'vitest';
import { scheduleChartThemeTransition } from './chartThemeTransition';

describe('scheduleChartThemeTransition', () => {
  it('refreshes immediately, on the next paint frame, and after layout settles', () => {
    const frames = new Map<number, FrameRequestCallback>();
    const timers = new Map<number, () => void>();
    let nextId = 1;
    const refreshSurface = vi.fn();
    const scheduler = {
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
        const id = nextId++;
        frames.set(id, callback);
        return id;
      }),
      cancelAnimationFrame: vi.fn((id: number) => frames.delete(id)),
      setTimeout: vi.fn((callback: () => void) => {
        const id = nextId++;
        timers.set(id, callback);
        return id;
      }),
      clearTimeout: vi.fn((id: number) => timers.delete(id)),
    };

    const cleanup = scheduleChartThemeTransition({ refreshSurface }, scheduler);
    expect(refreshSurface).toHaveBeenCalledTimes(1);

    frames.get(1)?.(0);
    expect(refreshSurface).toHaveBeenCalledTimes(2);
    timers.get(2)?.();
    expect(refreshSurface).toHaveBeenCalledTimes(3);

    cleanup();
    expect(scheduler.cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(scheduler.clearTimeout).toHaveBeenCalledWith(2);
  });
});
