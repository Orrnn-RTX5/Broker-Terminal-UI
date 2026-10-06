// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitBrokerAccountSessionScope } from '../services/brokerSession';

import {
  getPositionCloseScope,
  isPositionMarkedClosed,
  markPositionsClosed,
  RECENT_OPEN_POSITION_RETENTION_MS,
  shouldReplaceOpenPositionSnapshot,
  type Position,
  unmarkPositionsClosed,
  useAppStore,
} from './useAppStore';

const position = (id: number, overrides: Partial<Position> = {}): Position => ({
  id,
  symbol: 'BTCUSD',
  side: 'BUY',
  volume: 0.01,
  openPrice: 80_000 + id,
  currentPrice: 80_001 + id,
  openTime: '2026-08-25T12:00:00.000Z',
  sl: 0,
  tp: 0,
  swap: 0,
  commission: 0,
  unrealizedPnL: 0,
  ...overrides,
});

describe('useAppStore setPositions burst merge', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.getState().reset();
  });

  it('removes a fresh fill immediately and never resurrects a confirmed close from lagged snapshots', () => {
    const fresh = position(91, { chartEntryTime: new Date().toISOString() });
    useAppStore.getState().setPositions([fresh]);
    useAppStore.getState().setPositions([], { removedTickets: [91] });
    expect(useAppStore.getState().positions).toEqual([]);
    // Failed commands can restore an optimistic removal.
    useAppStore.getState().setPositions([fresh]);
    expect(useAppStore.getState().positions).toHaveLength(1);
    useAppStore.getState().setPositions([], { closedTickets: [91] });
    useAppStore.getState().setPositions([fresh]);
    expect(useAppStore.getState().positions).toEqual([]);
    useAppStore.setState({ accountId: 'another-account' });
    useAppStore.getState().setPositions([fresh]);
    expect(useAppStore.getState().positions).toHaveLength(1);
  });

  it('does not let lagged structural snapshots undo cleared SLTP or newer quote profit', () => {
    useAppStore.getState().setPositions([position(92, { state_version: '9007199254740993', sl: 0, tp: 0, profit: 7, unrealizedPnL: 7, price_time_msc: 2000 })]);
    useAppStore.getState().setPositions([position(92, { state_version: '9007199254740992', sl: 10, tp: 20 })]);
    expect(useAppStore.getState().positions[0]).toMatchObject({ sl: 0, tp: 0, profit: 7 });
    useAppStore.getState().setPositions([position(92, { state_version: '9007199254740993', profit: 1, unrealizedPnL: 1 })]);
    expect(useAppStore.getState().positions[0]).toMatchObject({ profit: 7, price_time_msc: 2000 });
  });

  it('preserves unknown close identity through full, partial and missing snapshots until confirmed', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    useAppStore.getState().setPositions([position(93, { closeCommandState: 'awaiting-confirmation', closeClientOrderId: id })]);
    useAppStore.getState().setPositions([position(93, { currentPrice: 81000 })]);
    useAppStore.getState().setPositions([{ id: 93, currentPrice: 82000 } as Position]);
    useAppStore.getState().setPositions([]);
    expect(useAppStore.getState().positions[0]).toMatchObject({ id: 93, currentPrice: 82000, closeCommandState: 'awaiting-confirmation', closeClientOrderId: id });
    useAppStore.getState().setPositions([], { closedTickets: [93] });
    useAppStore.getState().setPositions([position(93)]);
    expect(useAppStore.getState().positions).toEqual([]);
  });

  it('clears unknown close identity on rejection or account scope change', () => {
    useAppStore.getState().setPositions([position(94, { closeCommandState: 'awaiting-confirmation', closeClientOrderId: 'original' })]);
    useAppStore.getState().setPositions([position(94, { closeCommandState: undefined, closeClientOrderId: undefined })]);
    expect(useAppStore.getState().positions[0].closeCommandState).toBeUndefined();
    useAppStore.getState().setPositions([position(94, { closeCommandState: 'awaiting-confirmation', closeClientOrderId: 'original' })]);
    useAppStore.setState({ accountId: 'different-account' });
    useAppStore.getState().setPositions([position(94)]);
    expect(useAppStore.getState().positions[0].closeCommandState).toBeUndefined();
    expect(useAppStore.getState().positions[0].closeClientOrderId).toBeUndefined();
  });

  it('retains close ownership and tombstones across same-account token refresh, but invalidates logout', () => {
    useAppStore.getState().setAuthenticated(true, '200001', 'first-token');
    useAppStore.getState().setPositions([position(95, { closeCommandState: 'awaiting-confirmation', closeClientOrderId: 'original' }), position(96)]);
    useAppStore.getState().setPositions(useAppStore.getState().positions, { closedTickets: [96] });
    const scope = getPositionCloseScope();
    useAppStore.getState().setAuthTokens('refreshed-token');
    expect(getPositionCloseScope()).toBe(scope);
    useAppStore.getState().setAuthToken('refreshed-again');
    expect(getPositionCloseScope()).toBe(scope);
    useAppStore.getState().setPositions([position(95), position(96)]);
    expect(useAppStore.getState().positions).toHaveLength(1);
    expect(useAppStore.getState().positions[0]).toMatchObject({ id: 95, closeCommandState: 'awaiting-confirmation', closeClientOrderId: 'original' });
    useAppStore.getState().clearAuth();
    expect(getPositionCloseScope()).not.toBe(scope);
    useAppStore.getState().setPositions([position(95)]);
    expect(useAppStore.getState().positions[0].closeCommandState).toBeUndefined();
  });

  it('preserves immediate chart metadata across full and partial server updates', () => {
    useAppStore.getState().setPositions([position(1, {
      chartEntryPrice: 80_001.25,
      chartEntryTime: '2026-08-25T12:00:01.000Z',
    })]);

    useAppStore.getState().setPositions([position(1, {
      openPrice: 80_002,
      currentPrice: 80_003,
    })]);
    expect(useAppStore.getState().positions[0]).toMatchObject({
      openPrice: 80_002,
      currentPrice: 80_003,
      chartEntryPrice: 80_001.25,
      chartEntryTime: '2026-08-25T12:00:01.000Z',
    });

    useAppStore.getState().setPositions([{
      id: 1,
      currentPrice: 80_004,
      unrealizedPnL: 2.5,
    } as Position]);
    expect(useAppStore.getState().positions[0]).toMatchObject({
      id: 1,
      symbol: 'BTCUSD',
      openPrice: 80_002,
      currentPrice: 80_004,
      unrealizedPnL: 2.5,
      chartEntryPrice: 80_001.25,
    });
  });

  it('rejects unknown sparse rows while preserving a known ticket update', () => {
    useAppStore.getState().setPositions([position(24_155, {
      symbol: 'BTCUSD',
      volume: 0.01,
      openPrice: 79_500,
    })]);

    useAppStore.getState().setPositions([
      {
        id: 24_155,
        currentPrice: 79_608.32,
        unrealizedPnL: -1.65,
      } as Position,
      {
        id: 1,
        symbol: '',
        side: 'BUY',
        volume: 0,
        currentPrice: 0,
      } as Position,
      {
        id: 24_185,
        symbol: '',
        side: 'BUY',
        volume: 0,
        currentPrice: 79_608.32,
        unrealizedPnL: -0.22,
      } as Position,
    ]);

    expect(useAppStore.getState().positions).toEqual([
      expect.objectContaining({
        id: 24_155,
        symbol: 'BTCUSD',
        volume: 0.01,
        openPrice: 79_500,
        currentPrice: 79_608.32,
        unrealizedPnL: -1.65,
      }),
    ]);
  });

  it('admits a complete new ticket even when opening price is not in the snapshot', () => {
    useAppStore.getState().setPositions([position(24_185, {
      symbol: 'BTCUSD',
      volume: 0.01,
      openPrice: 0,
      currentPrice: 79_608.32,
    })]);

    expect(useAppStore.getState().positions).toEqual([
      expect.objectContaining({ id: 24_185, symbol: 'BTCUSD', volume: 0.01 }),
    ]);
  });

  it('keeps a just-filled ticket when a lagged snapshot omits it', () => {
    useAppStore.getState().setPositions([
      position(101),
      position(102, {
        chartEntryPrice: 80_110,
        chartEntryTime: new Date().toISOString(),
      }),
    ]);

    useAppStore.getState().setPositions([position(101, { currentPrice: 80_050 })]);

    expect(useAppStore.getState().positions.map(({ id }) => id).sort((a, b) => a - b)).toEqual([101, 102]);
    expect(useAppStore.getState().positions.find(({ id }) => id === 102)).toMatchObject({
      id: 102,
      symbol: 'BTCUSD',
      volume: 0.01,
      chartEntryTime: expect.any(String),
    });
  });

  it('does not apply an empty snapshot over a just-filled ticket', () => {
    const recent = position(102, { chartEntryTime: new Date().toISOString() });
    expect(shouldReplaceOpenPositionSnapshot([], [recent])).toBe(false);
    expect(shouldReplaceOpenPositionSnapshot([], [position(101)])).toBe(true);
    expect(shouldReplaceOpenPositionSnapshot([position(101)], [recent])).toBe(true);
  });

  it('still drops an older ticket that a full snapshot no longer reports', () => {
    useAppStore.getState().setPositions([
      position(101, { chartEntryTime: '2026-08-25T12:00:01.000Z' }),
      position(102),
    ]);

    useAppStore.getState().setPositions([position(102)]);

    expect(useAppStore.getState().positions).toEqual([
      expect.objectContaining({ id: 102 }),
    ]);
  });

  it('merges a 500-position unordered burst by strict ticket id and removes absent rows', () => {
    const initial = Array.from({ length: 500 }, (_, index) => position(index + 1));
    useAppStore.getState().setPositions(initial);

    const incoming = initial
      .filter(({ id }) => id % 2 === 0)
      .reverse()
      .map((row) => ({ ...row, currentPrice: row.currentPrice + 10 }));
    useAppStore.getState().setPositions(incoming);

    const result = useAppStore.getState().positions;
    expect(result).toHaveLength(250);
    expect(result.map(({ id }) => id)).toEqual(incoming.map(({ id }) => id));
    expect(result.every((row) => row.id % 2 === 0 && row.currentPrice === 80_011 + row.id)).toBe(true);
  });
});

describe('position history cache work', () => {
  const cacheKey = 'rtx5_trade_history_levels_v1';
  const readPositionCache = () => JSON.parse(localStorage.getItem(cacheKey) || '{}')['200001:position:301'];

  beforeEach(() => {
    localStorage.clear();
    useAppStore.getState().reset();
    useAppStore.setState({ accountId: '200001' });
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: 'broker-a', serverUrl: 'https://broker-a.test' });
    useAppStore.getState().setPositions([position(301, { sl: 79000, tp: 83000 })]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAppStore.getState().reset();
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
    localStorage.clear();
  });

  it('skips cache reads and parsing for full or sparse P&L-only updates', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    useAppStore.getState().setPositions([{ ...useAppStore.getState().positions[0], currentPrice: 81000, unrealizedPnL: 7 }]);
    useAppStore.getState().setPositions([{ id: 301, currentPrice: 81001, unrealizedPnL: 8 } as Position]);

    expect(getItem.mock.calls.filter(([key]) => key === cacheKey)).toHaveLength(0);
    expect(useAppStore.getState().positions[0]).toMatchObject({ currentPrice: 81001, unrealizedPnL: 8 });
    expect(readPositionCache()).toMatchObject({ sl: 79000, tp: 83000 });
  });

  it.each([
    [{ sl: 0, tp: 0 }, { sl: 0, tp: 0 }],
    [{ sl: 79500, tp: 84000 }, { sl: 79500, tp: 84000 }],
    [{ volume: 0.02 }, { volume: 0.02 }],
    [{ openPrice: 80500 }, { openPrice: 80500 }],
    [{ openTime: '2026-09-25T12:00:00.000Z' }, { openTime: '2026-09-25T12:00:00.000Z' }],
    [{ price_sl: 0, price_tp: 85000 }, { sl: 0, tp: 85000 }],
  ])('persists changed level inputs %j', (changes, expected) => {
    useAppStore.getState().setPositions([{ ...useAppStore.getState().positions[0], ...changes }]);
    expect(readPositionCache()).toMatchObject(expected);
  });

  it('seeds a new account even when its first row has the same ticket and values', () => {
    useAppStore.setState({ accountId: '200002' });
    useAppStore.getState().setPositions([...useAppStore.getState().positions]);
    expect(JSON.parse(localStorage.getItem(cacheKey) || '{}')['200002:position:301']).toMatchObject({ sl: 79000, tp: 83000 });
  });

  it('rechecks unchanged rows after a broker ownership change', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: 'broker-b', serverUrl: 'https://broker-b.test' });
    useAppStore.getState().setPositions([...useAppStore.getState().positions]);
    expect(getItem.mock.calls.filter(([key]) => key === cacheKey)).toHaveLength(1);
  });

  it('seeds restored positions that did not pass through the previous cache write', () => {
    localStorage.removeItem(cacheKey);
    useAppStore.setState({ positions: [position(301, { sl: 78000, tp: 84000 })] });
    useAppStore.getState().setPositions([...useAppStore.getState().positions]);
    expect(readPositionCache()).toMatchObject({ sl: 78000, tp: 84000 });
  });
});

describe('closed positions and recent-open retention', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    useAppStore.getState().reset();
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
  });

  const ids = () => useAppStore.getState().positions.map(({ id }) => id).sort((a, b) => a - b);

  it.each([
    ['account', () => useAppStore.setState({ accountId: '200002' })],
    ['token', () => useAppStore.setState({ authToken: 'session-b' })],
    ['logout', () => useAppStore.setState({ isAuthenticated: false })],
    ['broker', () => commitBrokerAccountSessionScope({ authenticated: true, accountId: '200001', brokerId: 'broker-b', serverUrl: 'https://broker-b.test' })],
    ['reset', () => useAppStore.getState().reset()],
  ] as const)('isolates reused tickets and late rollback after %s changes', (_name, changeSession) => {
    useAppStore.setState({ accountId: '200001', authToken: 'session-a', isAuthenticated: true });
    commitBrokerAccountSessionScope({ authenticated: true, accountId: '200001', brokerId: 'broker-a', serverUrl: 'https://broker-a.test' });
    const oldScope = getPositionCloseScope();
    markPositionsClosed([24155]);
    expect(isPositionMarkedClosed(24155)).toBe(true);

    changeSession();
    expect(getPositionCloseScope()).not.toBe(oldScope);
    expect(isPositionMarkedClosed(24155)).toBe(false);

    const currentScope = getPositionCloseScope();
    markPositionsClosed([24155]);
    unmarkPositionsClosed([24155], oldScope);
    expect(isPositionMarkedClosed(24155)).toBe(true);
    unmarkPositionsClosed([24155], currentScope);
    expect(isPositionMarkedClosed(24155)).toBe(false);
  });

  it('does not restore stale suppression when returning to a previous account', () => {
    useAppStore.setState({ accountId: '200001' });
    const oldScope = getPositionCloseScope();
    markPositionsClosed([24155]);
    useAppStore.setState({ accountId: '200002' });
    useAppStore.setState({ accountId: '200001' });
    expect(getPositionCloseScope()).not.toBe(oldScope);
    expect(isPositionMarkedClosed(24155)).toBe(false);
  });

  it('removes just-opened tickets from the chart when they are closed', () => {
    const recent = { chartEntryTime: new Date().toISOString() };
    useAppStore.getState().setPositions([position(201, recent), position(202, recent), position(203)]);

    // Close all: the close path marks the tickets, then removes them.
    markPositionsClosed([201, 202, 203]);
    useAppStore.getState().setPositions([]);

    expect(ids()).toEqual([]);
    expect(shouldReplaceOpenPositionSnapshot([], [position(201, recent)])).toBe(true);
  });

  it('retains a just-opened ticket again when its close fails', () => {
    const recent = { chartEntryTime: new Date().toISOString() };
    useAppStore.getState().setPositions([position(211, recent)]);
    markPositionsClosed([211]);
    unmarkPositionsClosed([211]);

    useAppStore.getState().setPositions([]);

    expect(ids()).toEqual([211]);
  });

  it('drops a retained ticket when retention ends even if no further update arrives', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T12:00:00.000Z'));
    useAppStore.getState().setPositions([
      position(221, { chartEntryTime: new Date().toISOString() }),
      position(222),
    ]);

    useAppStore.getState().setPositions([position(222)]);
    expect(ids()).toEqual([221, 222]);

    vi.advanceTimersByTime(RECENT_OPEN_POSITION_RETENTION_MS + 1);
    expect(ids()).toEqual([222]);
  });
});
