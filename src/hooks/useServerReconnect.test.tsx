/**
 * Reconnect backoff against real hook behaviour: a retry clears its own error
 * while the request is in flight, then fails again. The backoff must keep
 * growing across such attempts and the UI must stay in one steady
 * "reconnecting" state; only a recovery that holds resets the backoff.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useServerReconnect } from './useServerReconnect';

const advance = async (ms: number) => {
  await act(async () => { vi.advanceTimersByTime(ms); });
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useServerReconnect', () => {
  it('keeps growing the backoff when each retry clears the error in flight and then fails again', async () => {
    let pending = deferred();
    const retry = vi.fn(() => pending.promise);
    const { result, rerender } = renderHook(({ unreachable }) => useServerReconnect(unreachable, retry), {
      initialProps: { unreachable: true },
    });
    expect(result.current).toBe(true);

    for (const [index, delay] of [1000, 2000, 4000, 8000].entries()) {
      await advance(delay - 1);
      expect(retry).toHaveBeenCalledTimes(index);
      await advance(1);
      expect(retry).toHaveBeenCalledTimes(index + 1);
      // The retried load clears its error while the request is in flight…
      rerender({ unreachable: false });
      expect(result.current).toBe(true);
      // …and fails again when it settles.
      rerender({ unreachable: true });
      const settled = pending;
      pending = deferred();
      await act(async () => { settled.resolve(); await settled.promise; });
      expect(result.current).toBe(true);
    }
  });

  it('resets the backoff only after a recovery that holds', async () => {
    let pending = deferred();
    const retry = vi.fn(() => pending.promise);
    const { result, rerender } = renderHook(({ unreachable }) => useServerReconnect(unreachable, retry), {
      initialProps: { unreachable: true },
    });
    await advance(1000);
    rerender({ unreachable: false });
    let settled = pending;
    pending = deferred();
    await act(async () => { settled.resolve(); await settled.promise; });
    expect(result.current).toBe(false);

    // A brief flap right after recovery continues the backoff (2 s)…
    rerender({ unreachable: true });
    await advance(1999);
    expect(retry).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(retry).toHaveBeenCalledTimes(2);
    rerender({ unreachable: false });
    settled = pending;
    pending = deferred();
    await act(async () => { settled.resolve(); await settled.promise; });

    // …while a recovery that holds starts the next outage from 1 s.
    await advance(5000);
    rerender({ unreachable: true });
    await advance(999);
    expect(retry).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(retry).toHaveBeenCalledTimes(3);
  });

  it('stops after unmount', async () => {
    const retry = vi.fn(() => Promise.resolve());
    const { unmount } = renderHook(() => useServerReconnect(true, retry));
    unmount();
    await advance(60_000);
    expect(retry).not.toHaveBeenCalled();
  });
});
