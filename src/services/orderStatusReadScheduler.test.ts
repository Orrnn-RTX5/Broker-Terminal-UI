import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('shared burst status read budget', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.resetModules(); });
  afterEach(() => { vi.useRealTimers(); });
  it.each([10, 25, 50])('bounds and staggers %i independent UUID lookups without losing one', async count => {
    const { scheduleOrderStatusRead, ORDER_STATUS_MAX_CONCURRENT_READS } = await import('./orderStatusReadScheduler');
    let active = 0, maximum = 0;
    const starts: number[] = [];
    const calls = Array.from({ length: count }, (_, id) => scheduleOrderStatusRead(async () => {
      starts.push(performance.now()); maximum = Math.max(maximum, ++active);
      await new Promise(resolve => setTimeout(resolve, 500)); active--; return id;
    }));
    await vi.runAllTimersAsync();
    expect(await Promise.all(calls)).toEqual(Array.from({ length: count }, (_, id) => id));
    expect(maximum).toBeLessThanOrEqual(ORDER_STATUS_MAX_CONCURRENT_READS);
    expect(starts.slice(1).every((at, i) => at - starts[i] >= 100)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('never dispatches an aborted queued read', async () => {
    const { scheduleOrderStatusRead } = await import('./orderStatusReadScheduler');
    const first = scheduleOrderStatusRead(async () => 1);
    const controller = new AbortController(), read = vi.fn(async () => 2);
    const second = scheduleOrderStatusRead(read, controller.signal).catch(error => error);
    controller.abort(); await vi.runAllTimersAsync();
    expect(await first).toBe(1); expect(await second).toMatchObject({ name: 'AbortError' });
    expect(read).not.toHaveBeenCalled();
  });
});
