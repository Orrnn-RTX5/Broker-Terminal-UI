import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChartInteractionOwnership } from './chartInteractionOwnership';

describe('chart interaction ownership', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps a sparse 31-step drag active until the held pointer is released', () => {
    const onActive = vi.fn();
    const onIdle = vi.fn();
    const ownership = createChartInteractionOwnership({ idleMs: 180, onActive, onIdle });

    expect(ownership.beginPointer({ pointerId: 7, button: 0, isPrimary: true })).toBe(true);
    for (let step = 0; step < 31; step += 1) {
      ownership.noteRangeActivity();
      vi.advanceTimersByTime(500);
      expect(ownership.isActive()).toBe(true);
    }

    expect(onActive).toHaveBeenCalledTimes(1);
    expect(onIdle).not.toHaveBeenCalled();
    ownership.releasePointer(7);
    vi.advanceTimersByTime(179);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(ownership.isActive()).toBe(false);
  });

  it('does not treat pointerleave or a different pointer release as gesture end', () => {
    const onIdle = vi.fn();
    const ownership = createChartInteractionOwnership({ idleMs: 180, onActive: vi.fn(), onIdle });

    ownership.beginPointer({ pointerId: 11, button: 0, isPrimary: true });
    ownership.notePointerLeave();
    expect(ownership.releasePointer(12)).toBe(false);
    vi.advanceTimersByTime(1_000);

    expect(ownership.isHeld()).toBe(true);
    expect(ownership.isActive()).toBe(true);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('flushes one deferred left-edge action after release and kinetic idle', () => {
    let pendingLeftEdge = false;
    const loadHistory = vi.fn();
    const flushRender = vi.fn();
    const flushOverlay = vi.fn();
    const ownership = createChartInteractionOwnership({
      idleMs: 180,
      onActive: vi.fn(),
      onIdle: () => {
        if (pendingLeftEdge) loadHistory();
        pendingLeftEdge = false;
        flushRender();
        flushOverlay();
      },
    });

    ownership.beginPointer({ pointerId: 3, button: 0, isPrimary: true });
    for (let step = 0; step < 31; step += 1) {
      pendingLeftEdge = true;
      ownership.noteRangeActivity();
      vi.advanceTimersByTime(500);
    }
    expect(loadHistory).not.toHaveBeenCalled();
    expect(flushRender).not.toHaveBeenCalled();
    expect(flushOverlay).not.toHaveBeenCalled();

    ownership.releasePointer(3);
    ownership.noteRangeActivity();
    vi.advanceTimersByTime(180);
    expect(loadHistory).toHaveBeenCalledTimes(1);
    expect(flushRender).toHaveBeenCalledTimes(1);
    expect(flushOverlay).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    expect(loadHistory).toHaveBeenCalledTimes(1);
  });

  it('waits for both pointer and touch fallback ownership before settling', () => {
    const onIdle = vi.fn();
    const ownership = createChartInteractionOwnership({ idleMs: 180, onActive: vi.fn(), onIdle });

    ownership.beginPointer({ pointerId: 21, button: 0, isPrimary: true });
    ownership.setTouchFallbackHeld(true);
    ownership.setTouchFallbackHeld(false);
    vi.advanceTimersByTime(500);
    expect(onIdle).not.toHaveBeenCalled();

    ownership.releasePointer(21);
    vi.advanceTimersByTime(180);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('keeps a multi-touch fallback held until the final touch ends', () => {
    const onIdle = vi.fn();
    const ownership = createChartInteractionOwnership({ idleMs: 180, onActive: vi.fn(), onIdle });

    ownership.setTouchFallbackHeld(true);
    ownership.setTouchFallbackHeld(true);
    vi.advanceTimersByTime(500);
    expect(onIdle).not.toHaveBeenCalled();

    ownership.setTouchFallbackHeld(false);
    vi.advanceTimersByTime(180);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('keeps wheel kinetic activity debounced without pointer ownership', () => {
    const onIdle = vi.fn();
    const ownership = createChartInteractionOwnership({ idleMs: 180, onActive: vi.fn(), onIdle });

    ownership.noteWheelActivity();
    vi.advanceTimersByTime(150);
    ownership.noteRangeActivity();
    vi.advanceTimersByTime(150);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('force-settles a missed release at most once while dispose stays silent', () => {
    const onIdle = vi.fn();
    const ownership = createChartInteractionOwnership({ idleMs: 180, onActive: vi.fn(), onIdle });

    ownership.beginPointer({ pointerId: 44, button: 0, isPrimary: true });
    expect(ownership.forceSettle()).toBe(true);
    expect(ownership.forceSettle()).toBe(false);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(ownership.isHeld()).toBe(false);

    ownership.beginPointer({ pointerId: 45, button: 0, isPrimary: true });
    ownership.dispose();
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});
