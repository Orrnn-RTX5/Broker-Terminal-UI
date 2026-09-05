import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CANDLE_STREAM_BASE_RECONNECT_DELAY_MS,
  CANDLE_STREAM_HEARTBEAT_INTERVAL_MS,
  CANDLE_STREAM_MAX_SUBSCRIPTION_RETRIES,
  CANDLE_STREAM_OPEN_TIMEOUT_MS,
  CANDLE_STREAM_PONG_TIMEOUT_MS,
  CANDLE_STREAM_SUBSCRIPTION_ACK_TIMEOUT_MS,
  CandleAuthBrokerMismatchError,
  ChartDataService,
} from './chartDataService';
import {
  buildBrokerApiV2,
  buildBrokerWsV2Uri,
} from './brokerSession';
import { API_V2_BASE_URL } from '../config/api';
import { TradeWebSocketClient } from '../api/tradeSocket';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  emit(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close(code?: number, reason?: string) {
    this.readyState = FakeWebSocket.CLOSED;
    this.closedWith = { code, reason };
    this.onclose?.({ code: code ?? 1000, reason: reason ?? '' });
  }

  emitClose(code = 1006, reason = '') {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

const parseSent = (ws: FakeWebSocket) => ws.sent.map((payload) => JSON.parse(payload));

const makeJwt = (payload: Record<string, unknown>): string => {
  const encodedPayload = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${encodedPayload}.signature`;
};

type RuntimeWindow = Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };

const setDesktopRuntime = () => {
  (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = { backendTarget: 'desktop' };
};

const expectedCandleUrl = () =>
  `${(buildBrokerApiV2() || API_V2_BASE_URL).replace(/\/$/, '')}/candles/EUR%2FUSD?timeframe=M15&limit=50`;

const expectedPublicCandleUrl = (symbol = 'EUR/USD', tf = '15m', limit = 50) =>
  `${(buildBrokerApiV2() || API_V2_BASE_URL).replace(/\/api\/v2\/?$/, '')}/api/v1/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}&limit=${limit}`;

const utcSeconds = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  Date.UTC(year, month - 1, day, hour, minute) / 1000;

const withWindowProtocol = (protocol: 'http:' | 'https:', run: () => void) => {
  const originalLocation = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...originalLocation,
      protocol,
    },
  });

  try {
    run();
  } finally {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  }
};

const withWindowLocation = (
  location: { protocol: 'http:' | 'https:'; hostname: string },
  run: () => void | Promise<void>,
) => {
  const originalLocation = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...originalLocation,
      protocol: location.protocol,
      hostname: location.hostname,
    },
  });

  const restore = () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  };

  try {
    const result = run();
    if (result && typeof (result as Promise<void>).then === 'function') {
      return (result as Promise<void>).finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
};

describe('trade candle normalization and websocket cleanup', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket as any);
    localStorage.clear();
    sessionStorage.clear();
    setDesktopRuntime();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('normalizes candle arrays from contract response wrappers, de-dupes by bucket, and sorts', () => {
    const service = new ChartDataService();

    expect(service.normalizeCandles({
      data: {
        candles: [
        { time: 1760000520000, open: '1.2', high: '1.25', low: '1.19', close: '1.22', tick_count: '8' },
        { time: 1760000405, open: 1.3, high: 1.35, low: 1.29, close: 1.31, volume: 3 },
        { time: 1760000410, open: 1.21, high: 1.26, low: 1.2, close: 1.24, volume: 10 },
        { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 },
        ],
      },
    }, 'M1')).toEqual([
      { time: 1760000400, open: 1.21, high: 1.26, low: 1.2, close: 1.24, volume: 10 },
      { time: 1760000520, open: 1.2, high: 1.25, low: 1.19, close: 1.22, volume: 8, tickVolume: 8 },
    ]);
  });

  it('normalizes common broker candle aliases and array rows', () => {
    const service = new ChartDataService();

    expect(service.normalizeCandles({
      result: {
        bars: [
          ['2025-10-09T10:20:15.000Z', '1.20', '1.25', '1.18', '1.22', '12'],
          { t: 1760005265, o: 1.22, h: 1.3, l: 1.21, c: 1.28, tick_volume: 9 },
        ],
      },
    }, 'M1')).toEqual([
      { time: 1760005200, open: 1.2, high: 1.25, low: 1.18, close: 1.22, volume: 12, tickVolume: 12 },
      { time: 1760005260, open: 1.22, high: 1.3, low: 1.21, close: 1.28, volume: 9, tickVolume: 9 },
    ]);
  });

  it('preserves backend forming and finalized candle metadata', () => {
    const service = new ChartDataService();

    expect(service.normalizeCandles({
      candles: [
        { time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5, closed: false },
        { time: 1760000460, open: 1.5, high: 2.1, low: 1.4, close: 2, volume: 6, is_complete: true },
      ],
    }, 'M1')).toEqual([
      { time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5, closed: false },
      { time: 1760000460, open: 1.5, high: 2.1, low: 1.4, close: 2, volume: 6, closed: true },
    ]);
  });

  it('rejects malformed backend OHLC instead of repairing or inventing its wick values', () => {
    const service = new ChartDataService();

    expect(service.normalizeCandles({
      candles: [
        { time: 1760000400, open: 4379, high: 4382, low: 4378, close: 4381, volume: 10 },
        { time: 1760000460, open: 0, high: 0, low: 0, close: 0, volume: 1 },
        { time: 1760000520, open: 4381, high: 280000, low: 4380, close: 4382, volume: 1 },
        { time: 1760000580, open: 4382, high: 4381, low: 4380, close: 4381, volume: 1 },
      ],
    }, 'M1')).toEqual([
      { time: 1760000400, open: 4379, high: 4382, low: 4378, close: 4381, volume: 10 },
    ]);
  });

  it('keeps positive legacy volume when tick volume is reported as zero', () => {
    const service = new ChartDataService();

    expect(service.normalizeCandles({
      candles: [
        {
          time: 1760005265,
          open: 1.22,
          high: 1.3,
          low: 1.21,
          close: 1.28,
          tick_volume: 0,
          volume: 25,
        },
      ],
    }, 'M1')).toEqual([
      { time: 1760005260, open: 1.22, high: 1.3, low: 1.21, close: 1.28, volume: 25, tickVolume: 0 },
    ]);
  });

  it('normalizes weekly and monthly candles without falling back to minute buckets', () => {
    const service = new ChartDataService();

    expect(service.normalizeCandles({
      candles: [
        { time: '2025-10-06T00:00:00.000Z', open: 0.9, high: 1.8, low: 0.8, close: 1, volume: 8 },
        { time: '2025-10-09T00:00:00.000Z', open: 1, high: 2, low: 0.9, close: 1.5, volume: 10 },
        { time: '2025-10-10T00:00:00.000Z', open: 1.5, high: 2.5, low: 1.1, close: 2, volume: 12 },
      ],
    }, 'W1')).toEqual([
      { time: 1759708800, open: 1.5, high: 2.5, low: 1.1, close: 2, volume: 12 },
    ]);

    expect(service.normalizeCandles({
      candles: [
        { time: '2025-10-05T00:00:00.000Z', open: 1, high: 2, low: 0.9, close: 1.5, volume: 10 },
        { time: '2025-10-20T00:00:00.000Z', open: 1.5, high: 2.5, low: 1.1, close: 2, volume: 12 },
        { time: '2025-11-02T00:00:00.000Z', open: 2, high: 3, low: 1.8, close: 2.2, volume: 7 },
      ],
    }, 'MN')).toEqual([
      { time: 1759276800, open: 1.5, high: 2.5, low: 1.1, close: 2, volume: 12 },
      { time: 1761955200, open: 2, high: 3, low: 1.8, close: 2.2, volume: 7 },
    ]);
  });

  it('normalizes and de-dupes MN candles to calendar month starts', () => {
    const service = new ChartDataService();

    expect(service.normalizeCandles({
      candles: [
        { time: '2026-07-01T00:00:00.000Z', open: 60000, high: 60500, low: 59800, close: 60200, volume: 10 },
        { time: '2026-07-02T12:30:00.000Z', open: 60200, high: 61200, low: 60100, close: 61000, volume: 20 },
        { time: '2026-08-31T23:59:00.000Z', open: 61000, high: 63000, low: 60000, close: 62500, volume: 30 },
      ],
    }, 'MN')).toEqual([
      { time: utcSeconds(2026, 7, 1), open: 60200, high: 61200, low: 60100, close: 61000, volume: 20 },
      { time: utcSeconds(2026, 8, 1), open: 61000, high: 63000, low: 60000, close: 62500, volume: 30 },
    ]);
  });

  it('merges authoritative candle corrections by time, including older bars', () => {
    const service = new ChartDataService();
    const candles = [
      { time: 100, open: 1, high: 2, low: 0.9, close: 1.5, volume: 10 },
      { time: 160, open: 1.5, high: 1.8, low: 1.4, close: 1.7, volume: 8 },
    ];

    expect(service.shouldRepaintForCandle(candles, { time: 100, open: 1.1, high: 2.1, low: 1, close: 2, volume: 12 })).toBe(true);
    expect(service.mergeCandle(candles, { time: 100, open: 1.1, high: 2.1, low: 1, close: 2, volume: 12 })).toEqual([
      { time: 100, open: 1.1, high: 2.1, low: 0.9, close: 2, volume: 12 },
      { time: 160, open: 1.5, high: 1.8, low: 1.4, close: 1.7, volume: 8 },
    ]);
  });

  it('lets a finalized server correction replace an earlier bad wick exactly', () => {
    const service = new ChartDataService();
    const candles = [
      { time: 100, open: 1, high: 9, low: 0.1, close: 1.5, volume: 40 },
    ];

    expect(service.mergeCandle(candles, {
      time: 100,
      open: 1.1,
      high: 2,
      low: 1,
      close: 1.8,
      volume: 12,
      closed: true,
    })).toEqual([{
      time: 100,
      open: 1.1,
      high: 2,
      low: 1,
      close: 1.8,
      volume: 12,
      closed: true,
    }]);
  });

  it('loads REST candles from the configured v2 base, ignoring legacy API base overrides', async () => {
    localStorage.setItem('api_base_url', 'https://rtxbackend.tradecopier.org');
    localStorage.setItem('auth_token', 'jwt-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 })).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledWith(
      expectedCandleUrl(),
      expect.any(Object),
    );
  });

  it('omits the candle limit query param when no count is requested', async () => {
    localStorage.setItem('auth_token', 'jwt-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15' })).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledWith(
      expectedCandleUrl().replace(/&limit=50$/, ''),
      expect.any(Object),
    );
  });

  it('uses a sessionStorage token for authenticated candle history requests', async () => {
    sessionStorage.setItem('auth_token', 'session-jwt-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candles: [{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 })).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledWith(
      expectedCandleUrl(),
      expect.any(Object),
    );
  });

  it('rejects candle requests when the auth token broker differs from the active broker', async () => {
    localStorage.setItem('broker_id', 'myprop-trade');
    localStorage.setItem('auth_token', makeJwt({ broker_id: 'gta_broker', account_login: 200009 }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candles: [{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'GBPUSD', timeframe: 'M1', count: 5000 })).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/candles?symbol=GBPUSD&tf=1m');
  });

  it('treats TEST and fxtrust as the same broker for candle auth', async () => {
    localStorage.setItem('broker_id', 'TEST');
    localStorage.setItem('auth_token', makeJwt({ broker_id: 'fxtrust', account_login: 1001 }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'BTCUSD', timeframe: 'M5', count: 50 })).resolves.toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v2/candles/BTCUSD?timeframe=M5');
  });

  it('prefers authenticated TEST v2 OHLC and does not query the public bridge when v2 is valid', async () => {
    localStorage.setItem('broker_id', 'TEST');
    localStorage.setItem('auth_token', makeJwt({ broker_id: 'fxtrust', account_login: 1001 }));
    const authenticatedCandles = [
      { time: 1788508800, open: 4474.2, high: 4474.8, low: 4473.9, close: 4474.6, volume: 18 },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { candles: authenticatedCandles } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'XAUUSD', timeframe: 'M1', count: 5000 }))
      .resolves.toEqual(authenticatedCandles);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${(buildBrokerApiV2() || API_V2_BASE_URL).replace(/\/$/, '')}/candles/XAUUSD?timeframe=M1&limit=5000`,
      expect.objectContaining({
        headers: { Authorization: expect.stringMatching(/^Bearer /) },
      }),
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/v1/candles'))).toBe(false);
  });

  it('refreshes from the broker instead of reusing a stale in-memory snapshot', async () => {
    localStorage.setItem('broker_id', 'TEST');
    localStorage.setItem('auth_token', makeJwt({ broker_id: 'fxtrust', account_login: 1001 }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candles: [{ time: 1788508800, open: 4474.2, high: 4474.8, low: 4473.9, close: 4474.6, volume: 18 }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candles: [{ time: 1788508800, open: 4474.2, high: 4475.1, low: 4473.9, close: 4475, volume: 22 }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    const first = await service.fetchCandles({ symbol: 'XAUUSD', timeframe: 'M1', count: 5000 });
    first[0].time -= 3600;
    first[0].close = 1;

    const second = service.fetchCandles({ symbol: 'XAUUSD', timeframe: 'M1', count: 5000 });

    await expect(second)
      .resolves.toEqual([
        { time: 1788508800, open: 4474.2, high: 4475.1, low: 4473.9, close: 4475, volume: 22 },
      ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps same-key requests independent when an older request is aborted', async () => {
    localStorage.setItem('broker_id', 'TEST');
    localStorage.setItem('auth_token', makeJwt({ broker_id: 'fxtrust', account_login: 1001 }));
    const firstController = new AbortController();
    const secondController = new AbortController();
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(abortError), { once: true });
      }))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candles: [{ time: 1788508800, open: 4474.2, high: 4475.1, low: 4473.9, close: 4475, volume: 22 }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    const first = service.fetchCandles({
      symbol: 'XAUUSD',
      timeframe: 'M1',
      count: 5000,
      signal: firstController.signal,
    });
    const second = service.fetchCandles({
      symbol: 'XAUUSD',
      timeframe: 'M1',
      count: 5000,
      signal: secondController.signal,
    });
    firstController.abort();

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not reuse an in-memory candle snapshot across account sessions', async () => {
    localStorage.setItem('broker_id', 'TEST');
    localStorage.setItem('auth_token', makeJwt({ broker_id: 'fxtrust', account_login: 1001 }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candles: [{ time: 1788508800, open: 4474.2, high: 4474.8, low: 4473.9, close: 4474.6, volume: 18 }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candles: [{ time: 1788508800, open: 4480, high: 4481, low: 4479, close: 4480.5, volume: 22 }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await service.fetchCandles({ symbol: 'XAUUSD', timeframe: 'M1', count: 5000 });
    localStorage.setItem('auth_token', makeJwt({ broker_id: 'fxtrust', account_login: 1002 }));

    await expect(service.fetchCandles({ symbol: 'XAUUSD', timeframe: 'M1', count: 5000 }))
      .resolves.toEqual([
        { time: 1788508800, open: 4480, high: 4481, low: 4479, close: 4480.5, volume: 22 },
      ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('allows candle requests when the auth token broker matches the active broker', async () => {
    localStorage.setItem('broker_id', 'myprop-trade');
    localStorage.setItem('auth_token', makeJwt({ broker_id: 'myprop-trade', account_login: 200002 }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candles: [{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'GBPUSD', timeframe: 'M1', count: 5000 }))
      .resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('builds M1 May-range candle requests with Unix-second from/to parameters', async () => {
    localStorage.setItem('auth_token', 'jwt-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ symbol: 'BTCUSD', timeframe: 'M1', candles: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({
      symbol: 'BTCUSD',
      timeframe: 'M1',
      count: 5000,
      from: 1777593600,
      to: 1778713500,
    })).resolves.toEqual([]);

    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestedUrl.pathname).toBe('/api/v2/candles/BTCUSD');
    expect(requestedUrl.searchParams.get('timeframe')).toBe('M1');
    expect(requestedUrl.searchParams.get('limit')).toBe('5000');
    expect(requestedUrl.searchParams.get('from')).toBe('1777593600');
    expect(requestedUrl.searchParams.get('to')).toBe('1778713500');
  });

  it('normalizes outgoing candle aliases, millisecond cursors, and max limits', async () => {
    localStorage.setItem('auth_token', 'jwt-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ symbol: 'GBPUSD', timeframe: 'M5', candles: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({
      symbol: 'GBPUSD',
      timeframe: '5m',
      count: 10_000,
      from: 1777593600000,
      to: 1780271999000,
    })).resolves.toEqual([]);

    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestedUrl.pathname).toBe('/api/v2/candles/GBPUSD');
    expect(requestedUrl.searchParams.get('timeframe')).toBe('M5');
    expect(requestedUrl.searchParams.get('limit')).toBe('5000');
    expect(requestedUrl.searchParams.get('from')).toBe('1777593600');
    expect(requestedUrl.searchParams.get('to')).toBe('1780271999');
    expect(requestedUrl.search).not.toContain('5m');
  });

  it('parses wrapped candle responses and sorts newest-first M1 rows ascending', async () => {
    localStorage.setItem('auth_token', 'jwt-token');
    const newest = utcSeconds(2026, 5, 1, 0, 2);
    const middle = utcSeconds(2026, 5, 1, 0, 1);
    const oldest = utcSeconds(2026, 5, 1, 0, 0);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        symbol: 'GBPUSD',
        timeframe: 'M1',
        candles: [
          { time: newest, open: 1.302, high: 1.303, low: 1.301, close: 1.3025, volume: 12 },
          { time: middle, open: 1.301, high: 1.302, low: 1.3, close: 1.3015, volume: 11 },
          { time: oldest, open: 1.3, high: 1.301, low: 1.299, close: 1.3005, volume: 10 },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'GBPUSD', timeframe: 'M1', count: 5000 }))
      .resolves.toEqual([
        { time: oldest, open: 1.3, high: 1.301, low: 1.299, close: 1.3005, volume: 10 },
        { time: middle, open: 1.301, high: 1.302, low: 1.3, close: 1.3015, volume: 11 },
        { time: newest, open: 1.302, high: 1.303, low: 1.301, close: 1.3025, volume: 12 },
      ]);
  });

  it('routes broker-discovered REST candles through the selected desktop broker', async () => {
    await withWindowLocation({ protocol: 'http:', hostname: 'localhost' }, async () => {
      localStorage.setItem('server_url', 'https://broker.example.com');
      localStorage.setItem('auth_token', 'jwt-token');
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { candles: [{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }] } }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new ChartDataService();
      await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 })).resolves.toHaveLength(1);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://broker.example.com/api/v2/candles/EUR%2FUSD?timeframe=M15&limit=50',
        expect.any(Object),
      );
    });
  });

  it('keeps broker-discovered REST candles direct outside local Vite dev', async () => {
    await withWindowLocation({ protocol: 'https:', hostname: 'app.example.com' }, async () => {
      localStorage.setItem('server_url', 'https://broker.example.com');
      localStorage.setItem('auth_token', 'jwt-token');
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { candles: [{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }] } }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const service = new ChartDataService();
      await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 })).resolves.toHaveLength(1);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://broker.example.com/api/v2/candles/EUR%2FUSD?timeframe=M15&limit=50',
        expect.any(Object),
      );
    });
  });

  it('preserves HTTPS broker REST and WSS candle stream URLs on HTTPS frontends', () => {
    withWindowProtocol('https:', () => {
      localStorage.setItem('server_url', 'https://broker.example.com');

      expect(buildBrokerApiV2('/candles/EUR%2FUSD')).toBe('https://broker.example.com/api/v2/candles/EUR%2FUSD');
      expect(buildBrokerWsV2Uri('jwt-token')).toBe('wss://broker.example.com/ws/v2?token=jwt-token');
    });
  });

  it('forces WSS for candle /ws/v2 when HTTPS frontend has an HTTP broker server', () => {
    withWindowProtocol('https:', () => {
      localStorage.setItem('server_url', 'http://broker.example.com');
      localStorage.setItem('auth_token', 'jwt-token');
      const service = new ChartDataService();

      const subscription = service.subscribeCandles({
        symbol: 'eur/usd',
        timeframe: '15m',
        onCandle: vi.fn(),
      });

      expect(buildBrokerWsV2Uri('jwt-token')).toBe('wss://broker.example.com/ws/v2?token=jwt-token');
      expect(FakeWebSocket.instances[0].url).toBe('wss://broker.example.com/ws/v2?token=jwt-token');
      subscription.close();
    });
  });

  it('forces WSS for stored candle ws_url on HTTPS frontends', () => {
    withWindowProtocol('https:', () => {
      localStorage.setItem('ws_url', 'ws://broker.example.com/ws/v2');

      expect(buildBrokerWsV2Uri('jwt-token')).toBe('wss://broker.example.com/ws/v2?token=jwt-token');
    });
  });

  it('loads public feed candles without an auth token', async () => {
    localStorage.setItem('server_url', 'https://broker.example.com');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candles: [{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 })).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(expectedPublicCandleUrl());
  });

  it('skips the protected core candle endpoint when no auth token is available', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candles: [{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 })).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(expectedPublicCandleUrl());
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('/api/v2/candles');
  });

  it('returns empty when the authenticated v2 candle response normalizes to empty', async () => {
    localStorage.setItem('auth_token', 'jwt-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { candles: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ candles: [] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 })).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      expectedCandleUrl(),
      expectedPublicCandleUrl(),
    ]);
  });

  it('falls back to public feed candles when authenticated v2 candles fail', async () => {
    localStorage.setItem('auth_token', 'jwt-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candles: [{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 })).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      expectedCandleUrl(),
      expectedPublicCandleUrl(),
    ]);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('/history/candles');
  });

  it('rejects malformed 200 candle responses when no valid fallback is available', async () => {
    localStorage.setItem('auth_token', 'jwt-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('Malformed candle response');
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 }))
      .rejects.toThrow('Malformed candle response');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      expectedCandleUrl(),
      expectedPublicCandleUrl(),
    ]);
  });

  it('rejects parsed v2 candle responses with unknown object shapes', async () => {
    localStorage.setItem('auth_token', 'jwt-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ foo: 'bar' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 }))
      .rejects.toThrow('Malformed candle response');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects non-empty v2 candle arrays when every row is invalid', async () => {
    localStorage.setItem('auth_token', 'jwt-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          candles: [
            { time: 0, open: 1, high: 2, low: 0.5, close: 1.5 },
            { time: 1760000400, open: 'bad', high: 2, low: 0.5, close: 1.5 },
          ],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 }))
      .rejects.toThrow('Malformed candle response');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects token-present malformed core candles when public fallback is empty', async () => {
    localStorage.setItem('auth_token', 'jwt-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Malformed core candle response');
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ candles: [] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 }))
      .rejects.toThrow('Malformed core candle response');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      expectedCandleUrl(),
      expectedPublicCandleUrl(),
    ]);
  });

  it('accepts parsed core candle bars before trying public fallback', async () => {
    localStorage.setItem('auth_token', 'jwt-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            bars: [{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { candles: [] } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 }))
      .resolves.toEqual([{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns empty after an empty v2 candle alias response', async () => {
    localStorage.setItem('auth_token', 'jwt-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { bars: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ candles: [] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 }))
      .resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('loads public feed candles when no auth token is available', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candles: [{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 }))
      .resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(expectedPublicCandleUrl());
  });

  it('times out a socket stuck in CONNECTING and reconnects after backoff', () => {
    vi.useFakeTimers();
    localStorage.setItem('auth_token', 'jwt-token');
    const service = new ChartDataService();

    const subscription = service.subscribeCandles({
      symbol: 'EURUSD',
      timeframe: 'M15',
    });
    const stalledSocket = FakeWebSocket.instances[0];

    vi.advanceTimersByTime(CANDLE_STREAM_OPEN_TIMEOUT_MS);
    expect(stalledSocket.closedWith).toEqual({
      code: 4000,
      reason: 'Candle stream open timeout',
    });

    vi.advanceTimersByTime(CANDLE_STREAM_BASE_RECONNECT_DELAY_MS - 1);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    subscription.close();
  });

  it('reports stream readiness only after the exact subscription acknowledgement', () => {
    localStorage.setItem('auth_token', 'jwt-token');
    const service = new ChartDataService();
    const onConnected = vi.fn();
    const onCandle = vi.fn();
    const candle = { time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 };

    const subscription = service.subscribeCandles({
      symbol: 'EURUSD.r',
      timeframe: 'M15',
      onConnected,
      onCandle,
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();

    expect(onConnected).not.toHaveBeenCalled();
    socket.emit({ type: 'subscribed', channel: 'candles.EURUSD.M15' });
    expect(onConnected).not.toHaveBeenCalled();

    socket.emit({ type: 'subscribed', channel: 'candles.EURUSD.R.M15' });
    expect(onConnected).toHaveBeenCalledOnce();

    socket.emit({ channel: 'candles.EURUSD.R.M15', data: candle });
    expect(onConnected).toHaveBeenCalledOnce();
    expect(onCandle).toHaveBeenCalledWith(candle);

    subscription.close();
  });

  it('treats exact candle data as readiness when the acknowledgement is absent', () => {
    localStorage.setItem('auth_token', 'jwt-token');
    const service = new ChartDataService();
    const onConnected = vi.fn();
    const onCandle = vi.fn();
    const candle = { time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 };

    const subscription = service.subscribeCandles({
      symbol: 'EURUSD',
      timeframe: 'M15',
      onConnected,
      onCandle,
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();

    expect(onConnected).not.toHaveBeenCalled();
    socket.emit({ channel: 'candles.EURUSD.M15', data: candle });

    expect(onConnected).toHaveBeenCalledOnce();
    expect(onCandle).toHaveBeenCalledWith(candle);

    subscription.close();
  });

  it('retries a missing acknowledgement three times on the same socket before reconnecting', () => {
    vi.useFakeTimers();
    localStorage.setItem('auth_token', 'jwt-token');
    const service = new ChartDataService();

    const subscription = service.subscribeCandles({
      symbol: 'EURUSD',
      timeframe: 'M15',
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    const subscriptionFrames = () => parseSent(socket)
      .filter((message) => message.action === 'subscribe');

    expect(subscriptionFrames()).toHaveLength(1);
    for (let retry = 1; retry <= CANDLE_STREAM_MAX_SUBSCRIPTION_RETRIES; retry += 1) {
      vi.advanceTimersByTime(CANDLE_STREAM_SUBSCRIPTION_ACK_TIMEOUT_MS);
      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(subscriptionFrames()).toHaveLength(retry + 1);
    }

    vi.advanceTimersByTime(CANDLE_STREAM_SUBSCRIPTION_ACK_TIMEOUT_MS);
    expect(subscriptionFrames()).toHaveLength(CANDLE_STREAM_MAX_SUBSCRIPTION_RETRIES + 1);
    expect(socket.closedWith).toEqual({
      code: 4000,
      reason: 'Candle subscription acknowledgement timeout',
    });

    vi.advanceTimersByTime(CANDLE_STREAM_BASE_RECONNECT_DELAY_MS - 1);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    subscription.close();
  });

  it('reconnects an open candle stream after heartbeat activity times out', () => {
    vi.useFakeTimers();
    localStorage.setItem('auth_token', 'jwt-token');
    const service = new ChartDataService();

    const subscription = service.subscribeCandles({
      symbol: 'EURUSD',
      timeframe: 'M15',
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.emit({ type: 'subscribed', channel: 'candles.EURUSD.M15' });
    socket.sent.length = 0;

    vi.advanceTimersByTime(CANDLE_STREAM_HEARTBEAT_INTERVAL_MS);
    expect(parseSent(socket)).toEqual([
      { type: 'ping', timestamp: expect.any(Number) },
    ]);

    vi.advanceTimersByTime(CANDLE_STREAM_PONG_TIMEOUT_MS);
    expect(socket.closedWith).toEqual({
      code: 4000,
      reason: 'Candle stream heartbeat timeout',
    });

    vi.advanceTimersByTime(CANDLE_STREAM_BASE_RECONNECT_DELAY_MS - 1);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    subscription.close();
  });

  it('never reconnects after an intentional candle stream close', () => {
    vi.useFakeTimers();
    localStorage.setItem('auth_token', 'jwt-token');
    const service = new ChartDataService();

    const subscription = service.subscribeCandles({
      symbol: 'EURUSD',
      timeframe: 'M15',
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.emit({ type: 'subscribed', channel: 'candles.EURUSD.M15' });

    subscription.close();
    expect(socket.closedWith).toEqual({
      code: 1000,
      reason: 'Chart candle subscription closed',
    });

    vi.advanceTimersByTime(
      CANDLE_STREAM_OPEN_TIMEOUT_MS
      + CANDLE_STREAM_HEARTBEAT_INTERVAL_MS
      + CANDLE_STREAM_PONG_TIMEOUT_MS,
    );
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('unsubscribes and closes candle streams without leaking the channel', () => {
    localStorage.setItem('auth_token', 'jwt-token');
    localStorage.setItem('server_url', 'https://broker.example.com');
    localStorage.setItem('ws_url', 'ws://broker.example.com/ws/feed');
    const service = new ChartDataService();

    const subscription = service.subscribeCandles({
      symbol: 'eur/usd',
      timeframe: '15m',
      onCandle: vi.fn(),
    });

    const ws = FakeWebSocket.instances[0];
    expect(ws.url).toBe('ws://broker.example.com/ws/v2?token=jwt-token');
    ws.open();
    expect(parseSent(ws)).toEqual([
      { action: 'auth', token: 'jwt-token' },
      { action: 'subscribe', channel: 'candles.EUR/USD.M15', channels: ['candles.EUR/USD.M15'] },
    ]);

    subscription.close();

    expect(parseSent(ws).at(-1)).toEqual({ action: 'unsubscribe', channel: 'candles.EUR/USD.M15', channels: ['candles.EUR/USD.M15'] });
    expect(ws.closedWith).toEqual({ code: 1000, reason: 'Chart candle subscription closed' });
  });

  it('requires matching symbol and timeframe metadata for channel-less candle stream messages', () => {
    localStorage.setItem('auth_token', 'jwt-token');
    const service = new ChartDataService();
    const onSnapshot = vi.fn();
    const onCandle = vi.fn();

    const subscription = service.subscribeCandles({
      symbol: 'eur/usd',
      timeframe: '15m',
      onSnapshot,
      onCandle,
    });

    const ws = FakeWebSocket.instances[0];
    const candle = { time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 };

    ws.emit({ channel: 'candles.GBPUSD.M15', data: candle });
    ws.emit({ type: 'candle', symbol: 'GBPUSD', timeframe: 'M15', data: candle });
    ws.emit({ type: 'candle', symbol: 'EURUSD', timeframe: 'M5', data: candle });
    ws.emit({ type: 'candle', data: candle });
    ws.emit({ type: 'snapshot', symbol: 'GBPUSD', period: 'M15', data: { candles: [candle] } });

    expect(onSnapshot).not.toHaveBeenCalled();
    expect(onCandle).not.toHaveBeenCalled();

    ws.emit({ type: 'snapshot', symbol: 'EUR/USD', period: '15m', data: { candles: [candle] } });
    ws.emit({ type: 'candle', symbol: 'EUR/USD', timeframe: 'M15', data: candle });
    // Punctuation is part of broker identity: the stripped channel must not
    // leak into an exact EUR/USD subscription.
    ws.emit({ channel: 'candles.EURUSD.M15', data: { ...candle, close: 1.6 } });
    ws.emit({ channel: 'candles.EUR/USD.M15', data: { ...candle, close: 1.7 } });

    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledWith([candle]);
    expect(onCandle).toHaveBeenCalledTimes(2);
    expect(onCandle).toHaveBeenNthCalledWith(1, candle);
    expect(onCandle).toHaveBeenNthCalledWith(2, { ...candle, close: 1.7 });

    subscription.close();
  });

  it('preserves a dot-suffixed broker symbol in subscribe, routing, and unsubscribe channels', () => {
    localStorage.setItem('auth_token', 'jwt-token');
    const service = new ChartDataService();
    const onCandle = vi.fn();
    const candle = { time: 1760000400, open: 100, high: 101, low: 99, close: 100.5, volume: 5 };

    const subscription = service.subscribeCandles({
      symbol: 'eurusd.r',
      timeframe: 'M1',
      onCandle,
    });

    const ws = FakeWebSocket.instances[0];
    ws.open();
    expect(parseSent(ws).at(-1)).toEqual({
      action: 'subscribe',
      channel: 'candles.EURUSD.R.M1',
      channels: ['candles.EURUSD.R.M1'],
    });

    ws.emit({ channel: 'candles.EURUSD.M1', data: candle });
    expect(onCandle).not.toHaveBeenCalled();
    ws.emit({ channel: 'candles.EURUSD.R.M1', data: candle });
    expect(onCandle).toHaveBeenCalledOnce();
    expect(onCandle).toHaveBeenCalledWith(candle);

    subscription.close();
    expect(parseSent(ws).at(-1)).toEqual({
      action: 'unsubscribe',
      channel: 'candles.EURUSD.R.M1',
      channels: ['candles.EURUSD.R.M1'],
    });
  });

  it('subscribes once per trade socket channel and removes the websocket subscription after the last handler', () => {
    const client = new TradeWebSocketClient({
      url: 'wss://backend.orrnn.com/ws/v2',
      token: 'jwt-token',
      reconnect: false,
    });
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    client.subscribeCandles('EURUSD', 'M5', handlerA);
    const unsubscribeB = client.subscribeCandles('EURUSD', 'M5', handlerB);
    client.connect();

    const ws = FakeWebSocket.instances[0];
    ws.open();
    expect(parseSent(ws)).toEqual([
      { action: 'auth', token: 'jwt-token' },
      { action: 'subscribe', channel: 'candles.EURUSD.M5', channels: ['candles.EURUSD.M5'] },
    ]);

    ws.emit({
      channel: 'candles.EURUSD.M5',
      data: { time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 },
    });
    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);

    unsubscribeB();
    expect(parseSent(ws).filter((message) => message.action === 'unsubscribe')).toEqual([]);

    client.unsubscribe('candles.EURUSD.M5', handlerA);
    expect(parseSent(ws).at(-1)).toEqual({ action: 'unsubscribe', channel: 'candles.EURUSD.M5', channels: ['candles.EURUSD.M5'] });
  });

  it('supports depth websocket subscriptions and infers depth channels from order book messages', () => {
    const client = new TradeWebSocketClient({
      url: 'wss://backend.orrnn.com/ws/v2',
      token: 'jwt-token',
      reconnect: false,
    });
    const handler = vi.fn();

    client.subscribeDepth('EURUSD', handler);
    client.connect();

    const ws = FakeWebSocket.instances[0];
    ws.open();
    expect(parseSent(ws)).toEqual([
      { action: 'auth', token: 'jwt-token' },
      { action: 'subscribe', channel: 'depth.EURUSD', channels: ['depth.EURUSD'] },
    ]);

    ws.emit({
      type: 'order_book_update',
      data: {
        symbol: 'EURUSD',
        bids: [{ price: 1.1, volume: 100 }],
        asks: [{ price: 1.2, volume: 80 }],
        time: 1760000400,
      },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    client.unsubscribe('depth.EURUSD', handler);
    expect(parseSent(ws).at(-1)).toEqual({ action: 'unsubscribe', channel: 'depth.EURUSD', channels: ['depth.EURUSD'] });
  });
});
