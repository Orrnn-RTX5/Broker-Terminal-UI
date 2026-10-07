import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTestBrokerRuntime } from '../test/brokerRuntime';
import { removeToken } from './client';
import { tradingV2Api } from './trade';

// The shared scheduler has its own concurrency/spacing suite. Isolate lifecycle
// timing here so other tests' global read-launch times cannot affect fake time.
vi.mock('../services/orderStatusReadScheduler', () => ({ scheduleOrderStatusRead: (read: () => Promise<unknown>) => read() }));
const id = '550e8400-e29b-41d4-a716-446655440000';
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const filled = () => response({ status: 'filled', client_order_id: id, data: { ticket: 998877, status: 'closed', client_order_id: id } });

describe('close command late confirmation', () => {
  let restore: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear(); sessionStorage.clear(); removeToken();
    restore = installTestBrokerRuntime();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => { restore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('keeps the original close pending, then accepts a late fill without another POST', async () => {
    const notify = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce(response({ status: 'accepted' }, 202))
      .mockResolvedValueOnce(response({ status: 'processing' }))
      .mockResolvedValueOnce(filled());
    let settled = false;
    const result = tradingV2Api.closePosition(998877, { client_order_id: id, closeRecoveryAttempts: 1,
      onCloseCommandStatus: notify }).then(value => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(1);
    expect(notify).toHaveBeenCalledWith({ status: 'awaiting-confirmation', clientOrderId: id, ticket: '998877' });
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toMatchObject({ ticket: 998877 });
    expect(notify).toHaveBeenLastCalledWith({ status: 'filled', clientOrderId: id, ticket: '998877' });
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/order-commands/')).every(([url]) => String(url).includes(id))).toBe(true);
  });

  it('preserves the accepted server deadline across status omissions and a PC clock jump', async () => {
    const notify = vi.fn();
    const epoch = 1_800_000_000_000;
    vi.mocked(fetch).mockResolvedValueOnce(response({ status: 'accepted', accepted_at: epoch,
      execute_before: epoch + 1000 }, 202)).mockImplementation(async () => response({ status: 'processing' }));
    const result = tradingV2Api.closePosition(998877, { client_order_id: id, closeRecoveryAttempts: 20,
      closeRecoveryIntervalMs: 500, closeBackgroundReconciliationMs: 0, onCloseCommandStatus: notify }).catch(error => error);
    await vi.advanceTimersByTimeAsync(500);
    vi.setSystemTime(Date.now() + 86400_000);
    expect(notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    const error = await result;
    expect(error.data).toMatchObject({ code: 'ORDER_OUTCOME_UNKNOWN', execute_before_ms: epoch + 1000 });
    expect(notify).toHaveBeenCalledWith({ status: 'awaiting-confirmation', clientOrderId: id, ticket: '998877' });
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });

  it('does not treat a transient status 404 as expiry or resend a close', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ status: 'accepted' }, 202))
      .mockResolvedValueOnce(response({ message: 'not visible yet' }, 404)).mockResolvedValueOnce(filled());
    const result = tradingV2Api.closePosition(998877, { client_order_id: id, closeRecoveryIntervalMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toMatchObject({ ticket: 998877 });
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });

  it.each([500, 502, 504])('reconciles an uncertain POST %s with the original UUID and no replay', async status => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ message: 'Proxy response lost' }, status)).mockResolvedValueOnce(filled());
    expect(await tradingV2Api.closePosition(998877, { client_order_id: id })).toMatchObject({ ticket: 998877 });
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain(id);
  });

  it('stops reconciliation when the close execution context changes', async () => {
    let current = true;
    vi.mocked(fetch).mockResolvedValueOnce(response({ status: 'accepted' }, 202))
      .mockImplementation(async () => { current = false; return response({ status: 'processing' }); });
    // Quote guards are disabled by this test runtime; this context still fences recovery.
    const result = tradingV2Api.closePosition(998877, { client_order_id: id,
      executionContext: { ticketId: 998877, symbol: 'BTCUSD', isCurrent: () => current } }).catch(error => error);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).data.code).toBe('ORDER_OUTCOME_UNKNOWN');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])('retains uncertainty if status permission is lost (%s)', async status => {
    const notify = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce(response({ status: 'accepted' }, 202))
      .mockResolvedValueOnce(response({ message: 'Permission lost' }, status));
    const error = await tradingV2Api.closePosition(998877, { client_order_id: id,
      onCloseCommandStatus: notify }).catch(error => error);
    expect(error.data.code).toBe('ORDER_OUTCOME_UNKNOWN');
    expect(notify).toHaveBeenLastCalledWith({ status: 'awaiting-confirmation', clientOrderId: id, ticket: '998877' });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('retains uncertainty when the caller cancels after submission', async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockResolvedValueOnce(response({ status: 'accepted' }, 202))
      .mockResolvedValueOnce(response({ status: 'processing' }));
    const result = tradingV2Api.closePosition(998877, { client_order_id: id,
      signal: controller.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    expect((await result).data.code).toBe('ORDER_OUTCOME_UNKNOWN');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });
});
