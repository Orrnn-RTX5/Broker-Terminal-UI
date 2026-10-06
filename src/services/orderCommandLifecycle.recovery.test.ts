import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollOrderCommandUntilTerminal } from './orderCommandLifecycle';
const id = '123e4567-e89b-42d3-a456-426614174000';
describe('bounded original-command reconciliation', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it('retains late terminal events after the local wait even when all GETs fail', async () => {
    let listener!: (message: unknown) => void;
    const statuses: string[] = [], unsubscribe = vi.fn();
    const result = pollOrderCommandUntilTerminal({ clientOrderId: id, initialResponse: { status: 'processing', client_order_id: id },
      readStatus: vi.fn().mockRejectedValue(new Error('GET unavailable')), pollImmediately: true,
      backgroundReconciliationMs: 60_000, onStatus: command => statuses.push(command.status),
      subscribeTerminal: callback => { listener = callback; return unsubscribe; },
    });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(statuses).toContain('outcome-unknown'); expect(statuses).not.toContain('expired');
    expect(unsubscribe).not.toHaveBeenCalled();
    listener({ status: 'filled', client_order_id: id, data: { ticket: 701 } });
    await expect(result).resolves.toMatchObject({ status: 'filled', clientOrderId: id });
    expect(unsubscribe).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('remains unknown rather than expired after the bounded background budget is exhausted', async () => {
    const result = pollOrderCommandUntilTerminal({ clientOrderId: id, initialResponse: { status: 'processing' },
      readStatus: async () => ({ status: 'processing' }), backgroundReconciliationMs: 10_000 });
    await vi.advanceTimersByTimeAsync(40_000);
    await expect(result).resolves.toMatchObject({ status: 'outcome-unknown', terminal: false, error: { code: 'ORDER_OUTCOME_UNKNOWN' } });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([-86_400_000, 86_400_000])('does not let a PC wall-clock jump of %ims expire server evidence', async jump => {
    const epoch = 1_800_000_000_000, statuses: string[] = [];
    vi.setSystemTime(epoch);
    const result = pollOrderCommandUntilTerminal({ clientOrderId: id,
      initialResponse: { status: 'accepted', execute_before: epoch + 30_000, server_time_ms: epoch },
      startedAtMonoMs: performance.now(), readStatus: async () => ({ status: 'processing' }),
      onStatus: command => statuses.push(command.status),
    });
    vi.setSystemTime(epoch + jump); await vi.advanceTimersByTimeAsync(29_999);
    expect(statuses).not.toContain('outcome-unknown');
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ status: 'outcome-unknown', terminal: false });
  });
  it('aborts a hung status read and still accepts the same command late fill', async () => {
    let listener!: (message: unknown) => void, signal: AbortSignal | undefined;
    const result = pollOrderCommandUntilTerminal({ clientOrderId: id, initialResponse: { status: 'processing' },
      pollImmediately: true, backgroundReconciliationMs: 60_000,
      readStatus: (_id, nextSignal) => { signal = nextSignal; return new Promise(() => {}); },
      subscribeTerminal: callback => { listener = callback; return () => {}; },
    });
    await vi.advanceTimersByTimeAsync(8000); expect(signal?.aborted).toBe(true);
    listener({ status: 'filled', client_order_id: id });
    await expect(result).resolves.toMatchObject({ status: 'filled' }); expect(vi.getTimerCount()).toBe(0);
  });
});
