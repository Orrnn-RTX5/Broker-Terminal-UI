import { describe, it, expect, vi, afterEach } from 'vitest';
import { createStateInvalidator } from './stateInvalidation';

afterEach(() => vi.useRealTimers());
describe('committed state invalidations', () => {
  it('bounds bursts without starving refresh under continuous mutations', () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const client = createStateInvalidator(refresh);
    client.invalidate(101);
    vi.advanceTimersByTime(40);
    client.invalidate(101);
    vi.advanceTimersByTime(10);
    expect(refresh).toHaveBeenCalledExactlyOnceWith(101);
    client.invalidate(101);
    vi.advanceTimersByTime(50);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it('cancels work on logout and never refreshes invalid accounts', () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const client = createStateInvalidator(refresh);
    client.invalidate(0);
    client.invalidate(Number.NaN);
    vi.advanceTimersByTime(100);
    expect(refresh).not.toHaveBeenCalled();
    client.invalidate(101);
    client.dispose();
    vi.runAllTimers();
    expect(refresh).not.toHaveBeenCalled();
  });
});
