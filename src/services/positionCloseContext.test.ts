import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { positionsApi } from './api';
import { useAppStore, type Position } from '../store/useAppStore';
import { closePositionsLocalFirst } from './localFirstCloseCoordinator';
import { retainPositionCloseQuotes } from './positionCloseQuoteDemand';
import {
  calibrateTerminalQuoteClock,
  ingestTerminalQuote,
  resetTerminalQuoteFreshness,
} from './terminalQuoteFreshness';

const demands = vi.hoisted(() => new Map<string, string[]>());
vi.mock('./quoteSocketManager', () => ({
  getQuoteSocketManager: () => ({
    setDemand: (source: string, symbols: string[]) => demands.set(source, symbols),
    removeDemand: (source: string) => demands.delete(source),
  }),
}));

const position = (id: number): Position => ({
  id, symbol: 'BTCUSD', side: 'BUY', volume: 0.01, openPrice: 83000,
  currentPrice: 83001, openTime: new Date().toISOString(), sl: 0, tp: 0,
  swap: 0, commission: 0, unrealizedPnL: 0,
});

function quote(ageMs = 0) {
  const wall = Date.now(), mono = performance.now();
  expect(calibrateTerminalQuoteClock(wall, mono, wall, mono, wall)).toBe(true);
  expect(ingestTerminalQuote('BTCUSD', {
    bid: 83001, ask: 83002, provider_timestamp: wall - ageMs,
    source: 'test', sequence: '1',
  })).toBe(true);
}

describe('position close context through optimistic removal', () => {
  beforeEach(() => {
    vi.stubGlobal('RUNTIME_CONFIG', { TERMINAL_QUOTE_FRESHNESS: true });
    resetTerminalQuoteFreshness();
    demands.clear();
    useAppStore.setState({ accountId: '200001', positions: [position(15730289)] });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetTerminalQuoteFreshness();
    useAppStore.setState({ positions: [] });
  });

  function acceptClose() {
    return vi.spyOn(apiClient, 'post').mockImplementation(async (endpoint, body) => ({
      ticket: Number(String(endpoint).match(/positions\/(\d+)/)![1]),
      status: 'closed', client_order_id: (body as { client_order_id: string }).client_order_id,
    }) as never);
  }

  it('sends exactly one close after the position was hidden, retaining its symbol', async () => {
    quote();
    const captured = useAppStore.getState().positions[0];
    useAppStore.setState({ positions: [] });
    const post = acceptClose();
    await positionsApi.closePosition(String(captured.id), {
      account_login: 200001,
      executionContext: { ticketId: captured.id, symbol: captured.symbol, isCurrent: () => true },
    });
    expect(post).toHaveBeenCalledTimes(1);
    const [endpoint, body, options] = post.mock.calls[0];
    expect(endpoint).toBe('/positions/15730289/close');
    expect(body).toEqual({ client_order_id: expect.any(String), volume: 0 });
    expect(options).not.toHaveProperty('executionContext');
  });

  it('still rejects a stale BTCUSD quote without sending a request', async () => {
    quote(4000);
    useAppStore.setState({ positions: [] });
    const post = acceptClose();
    await expect(positionsApi.closePosition('15730289', {
      account_login: 200001,
      executionContext: { ticketId: 15730289, symbol: 'BTCUSD', isCurrent: () => true },
    })).rejects.toMatchObject({ code: 'QUOTE_STALE', symbol: 'BTCUSD' });
    expect(post).not.toHaveBeenCalled();
  });

  it.each([true, false])('refuses an old session with quote checks enabled=%s', async enabled => {
    quote();
    vi.stubGlobal('RUNTIME_CONFIG', { TERMINAL_QUOTE_FRESHNESS: enabled });
    useAppStore.setState({ positions: [] });
    const post = acceptClose();
    await expect(positionsApi.closePosition('15730289', {
      executionContext: { ticketId: 15730289, symbol: 'BTCUSD', isCurrent: () => false },
    })).rejects.toThrow('Trading session changed');
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses context captured for a different ticket', async () => {
    quote();
    const post = acceptClose();
    await expect(positionsApi.closePosition('15730289', {
      executionContext: { ticketId: 15730290, symbol: 'BTCUSD', isCurrent: () => true },
    })).rejects.toThrow('Trading session changed');
    expect(post).not.toHaveBeenCalled();
  });

  it('closes queued and server-discovered positions after all local rows were hidden', async () => {
    quote();
    const local = Array.from({ length: 7 }, (_, index) => position(15730289 + index));
    const discovered = position(15730296);
    useAppStore.setState({ positions: local });
    const post = acceptClose();
    const result = await closePositionsLocalFirst({
      sessionKey: 'Nexa:200001', getCurrentSessionKey: () => 'Nexa:200001',
      localCandidates: local, loadAuthoritativeCandidates: async () => [...local, discovered],
      onCandidatesStarted: () => useAppStore.setState({ positions: [] }),
      closePosition: (ticketId, candidate) => positionsApi.closePosition(String(ticketId), {
        account_login: 200001,
        executionContext: { ticketId, symbol: candidate.symbol, isCurrent: () => true },
      }),
    });
    expect(post).toHaveBeenCalledTimes(8);
    expect(result.confirmedTicketIds).toEqual([...local, discovered].map(row => row.id));
    expect(result.failedTicketIds).toEqual([]);
    expect(useAppStore.getState().positions).toEqual([]);
  });

  it.each([false, true])('retains held-only quotes across a slow first wave (session changes=%s)', async switchSession => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] });
    quote();
    const local = Array.from({ length: 7 }, (_, index) => position(15730289 + index));
    useAppStore.setState({ positions: local });
    demands.set('open-positions', ['BTCUSD']);
    const lease = retainPositionCloseQuotes('bulk-close:test', ['BTCUSD']);
    const waiting: (() => void)[] = [];
    const post = vi.spyOn(apiClient, 'post').mockImplementation(async (endpoint, body) => {
      if (waiting.length < 3) await new Promise<void>(resolve => waiting.push(resolve));
      return {
        ticket: Number(String(endpoint).match(/positions\/(\d+)/)![1]),
        status: 'closed', client_order_id: (body as { client_order_id: string }).client_order_id,
      } as never;
    });
    let current = true;
    const running = closePositionsLocalFirst({
      sessionKey: 'Nexa:200001', getCurrentSessionKey: () => current ? 'Nexa:200001' : 'Nexa:200002',
      localCandidates: local, loadAuthoritativeCandidates: async () => [],
      onCandidatesStarted: () => {
        useAppStore.setState({ positions: [] });
        demands.delete('open-positions');
      },
      closePosition: (ticketId, candidate) => positionsApi.closePosition(String(ticketId), {
        account_login: 200001,
        executionContext: { ticketId, symbol: candidate.symbol, isCurrent: () => current },
      }),
    });
    try {
      expect(post).toHaveBeenCalledTimes(3);
      expect(waiting).toHaveLength(3);
      vi.advanceTimersByTime(4000);
      // Simulate ticks only for symbols retained by a real demand owner.
      if ([...demands.values()].some(symbols => symbols.includes('BTCUSD'))) {
        expect(ingestTerminalQuote('BTCUSD', {
          bid: 83001, ask: 83002, provider_timestamp: Date.now(), source: 'test', sequence: '2',
        })).toBe(true);
      }
      if (switchSession) current = false;
      waiting.forEach(resolve => resolve());
      const result = await running;
      expect(post).toHaveBeenCalledTimes(switchSession ? 3 : 7);
      expect(result.confirmedTicketIds).toHaveLength(switchSession ? 3 : 7);
      expect(result.failedTicketIds).toHaveLength(switchSession ? 4 : 0);
    } finally {
      lease.release();
    }
    expect(demands.size).toBe(0);
  });
});
