import { afterEach, describe, expect, it, vi } from 'vitest';
import { tradeGatewayApi } from '../../../api/tradeGateway';
import { loadBalanceHistory } from './balanceHistory';

describe('complete account balance history', () => {
  afterEach(() => vi.restoreAllMocks());

  it('paginates, deduplicates overlapping operations and normalizes signed withdrawals and timestamps', async () => {
    const first = Array.from({ length: 500 }, (_, id) => ({
      id, account_login: 123, type: 'deposit', amount: '10', time: 1_790_836_200,
    }));
    const api = vi.spyOn(tradeGatewayApi, 'getBalanceHistory')
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce([first[499], {
        id: 500, type: 'withdrawal', amount: 25, time: '2026-10-01T08:00:00Z',
      }]);
    const result = await loadBalanceHistory(123);
    expect(result).toHaveLength(501);
    expect(result[0]).toMatchObject({ amount: 10, time: 1_790_836_200_000 });
    expect(result[500]).toMatchObject({ type: 'withdrawal', amount: -25, time: Date.parse('2026-10-01T08:00:00Z') });
    expect(api).toHaveBeenNthCalledWith(2, 123, 500, 500);
  });

  it('keeps malformed or wrong-account cash data unavailable instead of manufacturing zeros', async () => {
    const api = vi.spyOn(tradeGatewayApi, 'getBalanceHistory');
    api.mockResolvedValueOnce({ data: [] } as unknown as Record<string, unknown>[]);
    await expect(loadBalanceHistory(123)).resolves.toEqual([]);
    api.mockResolvedValueOnce({ message: 'unsupported' } as unknown as Record<string, unknown>[]);
    await expect(loadBalanceHistory(123)).rejects.toThrow('unavailable');
    api.mockResolvedValueOnce([{ id: 1, type: 'deposit', amount: null }]);
    await expect(loadBalanceHistory(123)).rejects.toThrow('Incomplete');
    api.mockResolvedValueOnce([{ id: 1, account_login: 456, type: 'deposit', amount: 100 }]);
    await expect(loadBalanceHistory(123)).rejects.toThrow('another account');
  });

  it('rejects a repeated full page instead of reporting a truncated sum', async () => {
    const page = Array.from({ length: 500 }, (_, id) => ({ id, type: 'deposit', amount: 1 }));
    vi.spyOn(tradeGatewayApi, 'getBalanceHistory').mockResolvedValue(page);
    await expect(loadBalanceHistory(123)).rejects.toThrow('did not advance');
  });

  it('stops pagination when the session has changed', async () => {
    let current = true;
    const api = vi.spyOn(tradeGatewayApi, 'getBalanceHistory').mockImplementation(async () => {
      current = false;
      return Array.from({ length: 500 }, (_, id) => ({ id, type: 'deposit', amount: 1 }));
    });
    await expect(loadBalanceHistory(123, () => current)).rejects.toThrow('session changed');
    expect(api).toHaveBeenCalledTimes(1);
  });
});
