import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesktopStartupReady } from './useDesktopStartupReady';

const startupReady = vi.fn();
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let originalElectron: Window['electron'];

function paintFrame() {
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach(callback => callback(performance.now())));
}

beforeEach(() => {
  originalElectron = window.electron;
  window.electron = { startupReady } as unknown as Window['electron'];
  startupReady.mockClear();
  frames = new Map();
  nextFrame = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
});

afterEach(() => {
  cleanup();
  window.electron = originalElectron;
  vi.restoreAllMocks();
});

describe('useDesktopStartupReady', () => {
  it('does nothing in the browser or with an older desktop bridge', () => {
    delete window.electron;
    const view = renderHook(() => useDesktopStartupReady());
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    view.unmount();

    window.electron = {} as Window['electron'];
    renderHook(() => useDesktopStartupReady());
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(startupReady).not.toHaveBeenCalled();
  });

  it('waits for readiness and a paint opportunity, then reports only once', () => {
    const view = renderHook(({ ready }) => useDesktopStartupReady(ready), {
      initialProps: { ready: false },
    });
    expect(frames.size).toBe(0);

    view.rerender({ ready: true });
    expect(startupReady).not.toHaveBeenCalled();
    paintFrame();
    expect(startupReady).not.toHaveBeenCalled();
    paintFrame();
    expect(startupReady).toHaveBeenCalledTimes(1);

    view.rerender({ ready: false });
    view.rerender({ ready: true });
    expect(frames.size).toBe(0);
    expect(startupReady).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('cancels frames on unmount (first frame ran: %s)', firstFrameRan => {
    const view = renderHook(() => useDesktopStartupReady());
    if (firstFrameRan) paintFrame();
    view.unmount();
    expect(frames.size).toBe(0);
    paintFrame();
    expect(startupReady).not.toHaveBeenCalled();
  });

  it('cancels a pending report if readiness is withdrawn', () => {
    const view = renderHook(({ ready }) => useDesktopStartupReady(ready), {
      initialProps: { ready: true },
    });
    paintFrame();
    view.rerender({ ready: false });
    paintFrame();
    expect(startupReady).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('survives StrictMode effect replay without reporting early or twice', () => {
    renderHook(() => useDesktopStartupReady(), {
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    });
    expect(frames.size).toBe(1);
    paintFrame();
    expect(startupReady).not.toHaveBeenCalled();
    paintFrame();
    expect(startupReady).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });
});
