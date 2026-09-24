import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SessionChangeReason =
  | 'token_rotation'
  | 'login'
  | 'logout'
  | 'broker_url_change'
  | 'account_change';

const brokerSessionMock = vi.hoisted(() => ({
  accessToken: 'access-token' as string | null,
  login: 200001 as number | null,
  ready: true,
  sessionListener: null as null | ((reason: SessionChangeReason) => void),
}));

const appStoreMock = vi.hoisted(() => ({
  account: {
    balance: 10_000,
    equity: 10_000,
    margin: 0,
    freeMargin: 10_000,
    unrealizedPL: 0,
    marginLevel: 0,
    currency: 'USD',
    leverage: 100,
  } as any,
  positions: [] as any[],
  setAccount: vi.fn(),
  setPositions: vi.fn(),
}));

vi.mock('./brokerSession', () => ({
  buildBrokerWsV2Uri: vi.fn((token?: string | null) => (
    `wss://broker.example/ws/v2${token ? `?token=${token}` : ''}`
  )),
  getAccessToken: vi.fn(() => brokerSessionMock.accessToken),
  getAccountLogin: vi.fn(() => brokerSessionMock.login),
  isSessionReady: vi.fn(() => brokerSessionMock.ready),
  getCommittedBrokerAccountSessionScope: vi.fn(() => ({ accountId: String(brokerSessionMock.login) })),
  getCommittedBrokerAccountSessionScopeKey: vi.fn(() => `test-session:${brokerSessionMock.login}`),
  onSessionChange: vi.fn((listener: (reason: SessionChangeReason) => void) => {
    brokerSessionMock.sessionListener = listener;
    return vi.fn();
  }),
}));

vi.mock('../store/useAppStore', () => ({
  markPositionsClosed: vi.fn(),
  useAppStore: {
    getState: () => appStoreMock,
  },
}));

import { AccountSocketManager } from './accountSocketManager';

const originalVisibilityStateDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
const originalOnLineDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine');

const setVisibilityState = (state: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
};

const setOnline = (online: boolean): void => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
};

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  emitClose(code = 1006, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

const frames = (socket: FakeWebSocket): unknown[] => (
  socket.sent.map(payload => JSON.parse(payload))
);

describe('AccountSocketManager session and transport contract', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    brokerSessionMock.accessToken = 'access-token';
    brokerSessionMock.login = 200001;
    brokerSessionMock.ready = true;
    brokerSessionMock.sessionListener = null;
    setVisibilityState('visible');
    setOnline(true);
    appStoreMock.setAccount.mockReset();
    appStoreMock.setPositions.mockReset();
    appStoreMock.account = {
      balance: 10_000,
      equity: 10_000,
      margin: 0,
      freeMargin: 10_000,
      unrealizedPL: 0,
      marginLevel: 0,
      currency: 'USD',
      leverage: 100,
    };
    appStoreMock.positions = [];
    appStoreMock.setAccount.mockImplementation((account) => {
      appStoreMock.account = account;
    });
    appStoreMock.setPositions.mockImplementation((positions) => {
      appStoreMock.positions = positions;
    });
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalVisibilityStateDescriptor) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityStateDescriptor);
    }
    if (originalOnLineDescriptor) {
      Object.defineProperty(navigator, 'onLine', originalOnLineDescriptor);
    }
  });

  it('retains demand before the session is ready and connects on the login session event', () => {
    brokerSessionMock.ready = false;
    const manager = new AccountSocketManager();

    manager.connect(200001);

    expect(manager.getLogin()).toBe(200001);
    expect(FakeWebSocket.instances).toHaveLength(0);

    brokerSessionMock.ready = true;
    brokerSessionMock.sessionListener?.('login');

    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe('wss://broker.example/ws/v2?token=access-token');

    socket.open();
    expect(frames(socket)).toEqual([
      { action: 'subscribe', channel: 'positions.200001' },
      { action: 'subscribe', channel: 'metrics.200001' },
      { action: 'subscribe', channel: 'account.200001' },
    ]);

    manager.destroy();
  });

  it('ignores callbacks from the old socket after an account switch', () => {
    vi.useFakeTimers();
    const manager = new AccountSocketManager();
    manager.connect(200001);
    const oldSocket = FakeWebSocket.instances[0];

    brokerSessionMock.login = 200002;
    brokerSessionMock.sessionListener?.('account_change');

    expect(FakeWebSocket.instances).toHaveLength(2);
    const currentSocket = FakeWebSocket.instances[1];
    expect(oldSocket.readyState).toBe(FakeWebSocket.CLOSED);

    oldSocket.open();
    oldSocket.emit({
      channel: 'metrics.200001',
      data: { login: 200001, balance: 1 },
    });
    oldSocket.emitClose(1006, 'late old-socket close');
    vi.advanceTimersByTime(1000);

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(oldSocket.sent).toEqual([]);
    expect(appStoreMock.setAccount).not.toHaveBeenCalled();

    currentSocket.open();
    expect(frames(currentSocket)).toEqual([
      { action: 'subscribe', channel: 'positions.200002' },
      { action: 'subscribe', channel: 'metrics.200002' },
      { action: 'subscribe', channel: 'account.200002' },
    ]);
    currentSocket.emit({
      channel: 'metrics.200002',
      data: { login: 200002, balance: 20_002 },
    });
    expect(appStoreMock.setAccount).toHaveBeenCalledTimes(1);
    expect(appStoreMock.setAccount).toHaveBeenCalledWith(expect.objectContaining({ balance: 20_002 }));

    manager.destroy();
  });

  it('ignores irrelevant dotted channel noise without treating a symbol suffix as a login', () => {
    const manager = new AccountSocketManager();
    manager.connect(200001);
    const socket = FakeWebSocket.instances[0];
    socket.open();

    socket.emit({
      channel: 'ticks.EURUSD.r',
      data: { balance: 1, positions: [{ ticket: 10 }] },
    });
    socket.emit({
      channel: 'noise.metrics.200001',
      data: { balance: 2, positions: [{ ticket: 11 }] },
    });

    expect(appStoreMock.setAccount).not.toHaveBeenCalled();
    expect(appStoreMock.setPositions).not.toHaveBeenCalled();

    manager.destroy();
  });

  it('rejects a mismatched channel login even when the payload claims the active login', () => {
    const manager = new AccountSocketManager();
    manager.connect(200001);
    const socket = FakeWebSocket.instances[0];
    socket.open();

    socket.emit({
      channel: 'metrics.200002',
      data: { login: 200001, balance: 20_002 },
    });
    socket.emit({
      channel: 'positions.200002',
      data: { positions: [{ ticket: 99, symbol: 'XAUUSD', price_open: 4400 }] },
    });

    expect(appStoreMock.setAccount).not.toHaveBeenCalled();
    expect(appStoreMock.setPositions).not.toHaveBeenCalled();

    socket.emit({
      channel: 'metrics.200001',
      data: { balance: 20_001 },
    });
    expect(appStoreMock.setAccount).toHaveBeenCalledTimes(1);

    manager.destroy();
  });

  it('merges equity and margin deltas that legitimately omit balance', () => {
    const manager = new AccountSocketManager();
    manager.connect(200001);
    const socket = FakeWebSocket.instances[0];
    socket.open();

    socket.emit({
      channel: 'metrics.200001',
      data: {
        login: 200001,
        equity: 10_025.5,
        used_margin: 125.25,
        margin_free: 9_900.25,
        margin_level: 8_004.39,
        floating_pnl: 25.5,
      },
    });

    expect(appStoreMock.setAccount).toHaveBeenCalledWith(expect.objectContaining({
      balance: 10_000,
      equity: 10_025.5,
      margin: 125.25,
      freeMargin: 9_900.25,
      marginLevel: 8_004.39,
      unrealizedPL: 25.5,
      currency: 'USD',
      leverage: 100,
      hasBackendEquity: true,
      hasBackendFreeMargin: true,
      hasBackendMarginLevel: true,
    }));

    socket.emit({
      channel: 'account.200001',
      data: { free_margin_amount: { amount: '9,875.00' } },
    });
    expect(appStoreMock.account).toMatchObject({
      balance: 10_000,
      equity: 10_025.5,
      margin: 125.25,
      freeMargin: 9_875,
      marginLevel: 8_004.39,
    });

    manager.destroy();
  });

  it('replaces authoritative position snapshots and removes absent or closed tickets', () => {
    appStoreMock.positions = [
      {
        id: 10,
        symbol: 'EURUSD',
        side: 'BUY',
        volume: 0.1,
        openPrice: 1.1,
        currentPrice: 1.101,
        openTime: '2026-09-04T08:00:00.000Z',
        sl: 1.09,
        tp: 1.12,
        swap: 0,
        commission: 0,
        unrealizedPnL: 1,
      },
      {
        id: 11,
        symbol: 'XAUUSD.raw',
        side: 'SELL',
        volume: 0.02,
        openPrice: 4_475,
        currentPrice: 4_474,
        openTime: '2026-09-04T08:01:00.000Z',
        sl: 0,
        tp: 0,
        swap: 0,
        commission: 0,
        unrealizedPnL: 2,
      },
      {
        id: 12,
        symbol: 'BTCUSD',
        side: 'BUY',
        volume: 0.01,
        openPrice: 110_000,
        currentPrice: 110_100,
        openTime: '2026-09-04T08:02:00.000Z',
        sl: 0,
        tp: 0,
        swap: 0,
        commission: 0,
        unrealizedPnL: 1,
      },
    ];

    const manager = new AccountSocketManager();
    manager.connect(200001);
    const socket = FakeWebSocket.instances[0];
    socket.open();

    socket.emit({
      channel: 'positions.200001',
      data: {
        type: 'positions_snapshot',
        positions: [
          { ticket: '11', price_current: 4_473.5, profit: 3.5 },
          { ticket: '12', volume: 0, status: 'closed' },
        ],
      },
    });

    expect(appStoreMock.setPositions).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: 11,
        symbol: 'XAUUSD.raw',
        side: 'SELL',
        volume: 0.02,
        openPrice: 4_475,
        currentPrice: 4_473.5,
        unrealizedPnL: 3.5,
      }),
    ]);
    expect(appStoreMock.positions.map(position => position.id)).toEqual([11]);

    const reconciliationEvents: Event[] = [];
    const recordReconciliation = (event: Event) => reconciliationEvents.push(event);
    window.addEventListener('rtx:toolbox-trade-refresh', recordReconciliation);
    try {
      socket.emit({
        channel: 'positions.200001',
        data: { positions: [] },
      });
      // An empty transport snapshot is not enough evidence that the account
      // is flat. The REST-backed Trade reader must confirm it first.
      expect(appStoreMock.setPositions).toHaveBeenLastCalledWith([
        expect.objectContaining({ id: 11 }),
      ]);
      expect(appStoreMock.positions.map(position => position.id)).toEqual([11]);
      expect(reconciliationEvents).toHaveLength(1);
    } finally {
      window.removeEventListener('rtx:toolbox-trade-refresh', recordReconciliation);
    }

    manager.destroy();
  });

  it('keeps all symbols through alternating gateway and manager updates, then removes only closed trades', () => {
    const manager = new AccountSocketManager();
    manager.connect(200001);
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.emit({ channel: 'positions.200001', data: { type: 'positions_snapshot', positions: [
      { ticket: 1, symbol: 'XAUUSD', side: 'buy', volume: 0.01, price_open: 4291 },
      { ticket: 2, symbol: 'BTCUSD', side: 'sell', volume: 0.02, price_open: 110000 },
    ] } });
    for (let index = 0; index < 10; index++) {
      socket.emit({ channel: 'positions.200001', data: { type: 'position_update', data: [
        { ticket: 1, symbol: 'XAUUSD', side: 'buy', volume: 0.01, price_open: 4291, price_current: 4330, profit: index },
      ] } });
      socket.emit({ type: 'channel_message', channel: 'positions.200001', data: { type: 'pnl_update', symbol: 'BTCUSD', positions: [
        { ticket: 2, price_current: 109900, profit: index + 1 },
      ] } });
      expect(appStoreMock.positions.map(position => position.symbol)).toEqual(['XAUUSD', 'BTCUSD']);
      expect(appStoreMock.positions[1]).toMatchObject({ side: 'SELL', volume: 0.02, openPrice: 110000, currentPrice: 109900 });
    }
    socket.emit({ channel: 'positions.200001', data: { type: 'position_closed', data: { ticket: 1 } } });
    expect(appStoreMock.positions.map(position => position.id)).toEqual([2]);
    socket.emit({ type: 'channel_message', channel: 'positions.200001', data: { type: 'position_closed', data: { ticket: 2 } } });
    expect(appStoreMock.positions).toEqual([]);
    manager.destroy();
  });

  it('normalizes position open times from microseconds, nanoseconds, and ISO text', () => {
    const manager = new AccountSocketManager();
    manager.connect(200001);
    const socket = FakeWebSocket.instances[0];
    socket.open();

    socket.emit({
      channel: 'positions.200001',
      data: {
        positions: [
          { ticket: 1, symbol: 'EURUSD', volume: 0.1, time_create: 1_788_176_700_123_456 },
          { ticket: 2, symbol: 'XAUUSD', volume: 0.1, time_open: 1_788_176_701_456_000_000 },
          { ticket: 3, symbol: 'BTCUSD', volume: 0.1, opened_at: '2026-09-04T08:11:40.123Z' },
        ],
      },
    });

    expect(appStoreMock.positions.map(position => position.openTime)).toEqual([
      '2026-08-31T11:45:00.123Z',
      '2026-08-31T11:45:01.456Z',
      '2026-09-04T08:11:40.123Z',
    ]);
    manager.destroy();
  });

  it('suspends heartbeat deadlines while hidden and reconnects once visible', () => {
    vi.useFakeTimers();
    const manager = new AccountSocketManager();
    manager.connect(200001);
    const socket = FakeWebSocket.instances[0];
    socket.open();

    vi.advanceTimersByTime(25_000);
    setVisibilityState('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(60_000);
    expect(socket.readyState).toBe(FakeWebSocket.OPEN);

    setVisibilityState('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1].open();
    expect(frames(FakeWebSocket.instances[1])).toEqual([
      { action: 'subscribe', channel: 'positions.200001' },
      { action: 'subscribe', channel: 'metrics.200001' },
      { action: 'subscribe', channel: 'account.200001' },
    ]);
    manager.destroy();
  });

  it('suspends heartbeat deadlines offline and reconnects once online', () => {
    vi.useFakeTimers();
    const manager = new AccountSocketManager();
    manager.connect(200001);
    const socket = FakeWebSocket.instances[0];
    socket.open();

    vi.advanceTimersByTime(25_000);
    setOnline(false);
    window.dispatchEvent(new Event('offline'));
    vi.advanceTimersByTime(60_000);
    expect(socket.readyState).toBe(FakeWebSocket.OPEN);

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    expect(FakeWebSocket.instances).toHaveLength(2);
    manager.destroy();
  });

  it('reconnects an OPEN socket that does not answer the heartbeat', () => {
    vi.useFakeTimers();
    const manager = new AccountSocketManager();
    manager.connect(200001);
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.sent.length = 0;

    vi.advanceTimersByTime(25_000);
    expect(frames(socket)).toEqual([
      { type: 'ping', timestamp: expect.any(Number) },
    ]);

    vi.advanceTimersByTime(10_000);
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);

    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    manager.destroy();
  });

  it.each([1008, 4001, 4003, 4401, 4403])(
    'treats authentication close code %s as terminal and does not reconnect',
    (closeCode) => {
      vi.useFakeTimers();
      const manager = new AccountSocketManager();
      manager.connect(200001);
      const socket = FakeWebSocket.instances[0];
      socket.open();

      socket.emitClose(closeCode, 'authentication rejected');
      vi.advanceTimersByTime(60_000);

      expect(manager.isConnected()).toBe(false);
      expect(FakeWebSocket.instances).toHaveLength(1);

      manager.destroy();
    },
  );
});
