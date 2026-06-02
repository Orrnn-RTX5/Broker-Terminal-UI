import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartDataService } from './chartDataService';
import {
  buildBrokerApiV2,
  buildBrokerWsV2Uri,
} from './brokerSession';
import { DEV_BROKER_API_PROXY_PREFIX } from '../config/api';
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
  onclose: (() => void) | null = null;
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
    this.onclose?.();
  }
}

const parseSent = (ws: FakeWebSocket) => ws.sent.map((payload) => JSON.parse(payload));

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
      { time: 1760000520, open: 1.2, high: 1.25, low: 1.19, close: 1.22, volume: 8 },
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
      { time: 1760005200, open: 1.2, high: 1.25, low: 1.18, close: 1.22, volume: 12 },
      { time: 1760005260, open: 1.22, high: 1.3, low: 1.21, close: 1.28, volume: 9 },
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

  it('merges authoritative candle corrections by time, including older bars', () => {
    const service = new ChartDataService();
    const candles = [
      { time: 100, open: 1, high: 2, low: 0.9, close: 1.5, volume: 10 },
      { time: 160, open: 1.5, high: 1.8, low: 1.4, close: 1.7, volume: 8 },
    ];

    expect(service.shouldRepaintForCandle(candles, { time: 100, open: 1.1, high: 2.1, low: 1, close: 2, volume: 12 })).toBe(true);
    expect(service.mergeCandle(candles, { time: 100, open: 1.1, high: 2.1, low: 1, close: 2, volume: 12 })).toEqual([
      { time: 100, open: 1.1, high: 2.1, low: 1, close: 2, volume: 12 },
      { time: 160, open: 1.5, high: 1.8, low: 1.4, close: 1.7, volume: 8 },
    ]);
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
      '/api/v2/candles/EUR%2FUSD?timeframe=M15&limit=50',
      expect.any(Object),
    );
  });

  it('routes broker-discovered REST candles through the local dev API proxy', async () => {
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
        `${DEV_BROKER_API_PROXY_PREFIX}/${encodeURIComponent('http://broker.example.com')}/api/v2/candles/EUR%2FUSD?timeframe=M15&limit=50`,
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

  it('routes no-token public history candles to the runtime broker server selected after import', async () => {
    localStorage.setItem('server_url', 'https://broker.example.com');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 })).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEV_BROKER_API_PROXY_PREFIX}/${encodeURIComponent('http://broker.example.com')}/history/candles/EUR%2FUSD?tf=M15&count=50`,
      expect.any(Object),
    );
  });

  it('skips the protected core candle endpoint when no auth token is available', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 })).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/history/candles/EUR%2FUSD?tf=M15&count=50',
      expect.any(Object),
    );
  });

  it('falls back to authenticated history when the core candle response normalizes to empty', async () => {
    localStorage.setItem('auth_token', 'jwt-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { candles: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { candles: [{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }] } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 })).resolves.toEqual([
      { time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v2/candles/EUR%2FUSD?timeframe=M15&limit=50',
      '/history/candles/EUR%2FUSD?tf=M15&count=50',
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => init?.headers)).toEqual([
      { Authorization: 'Bearer jwt-token' },
      { Authorization: 'Bearer jwt-token' },
    ]);
  });

  it('tries authenticated history before unauthenticated history when protected candle endpoints reject', async () => {
    localStorage.setItem('auth_token', 'jwt-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { candles: [{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }] } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 }))
      .resolves.toEqual([{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }]);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v2/candles/EUR%2FUSD?timeframe=M15&limit=50',
      '/history/candles/EUR%2FUSD?tf=M15&count=50',
      '/history/candles/EUR%2FUSD?tf=M15&count=50',
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => init?.headers)).toEqual([
      { Authorization: 'Bearer jwt-token' },
      { Authorization: 'Bearer jwt-token' },
      undefined,
    ]);
  });

  it('rejects malformed 200 candle responses when no valid fallback is available', async () => {
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/history/candles/EUR%2FUSD?tf=M15&count=50',
      expect.any(Object),
    );
  });

  it('rejects parsed public candle responses with unknown object shapes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ foo: 'bar' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 }))
      .rejects.toThrow('Malformed candle response');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects non-empty public candle arrays when every row is invalid', async () => {
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
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
        json: async () => ({ data: { candles: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { candles: [] } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 }))
      .rejects.toThrow('Malformed core candle response');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v2/candles/EUR%2FUSD?timeframe=M15&limit=50',
      '/history/candles/EUR%2FUSD?tf=M15&count=50',
      '/history/candles/EUR%2FUSD?tf=M15&count=50',
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

  it('allows a non-empty public fallback to win after an empty core candle alias response', async () => {
    localStorage.setItem('auth_token', 'jwt-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { bars: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { candles: [{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }] } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 }))
      .resolves.toEqual([{ time: 1760000400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns empty public history results when no auth token is available', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { candles: [] } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new ChartDataService();
    await expect(service.fetchCandles({ symbol: 'EUR/USD', timeframe: 'M15', count: 50 }))
      .resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/history/candles/EUR%2FUSD?tf=M15&count=50',
      expect.any(Object),
    );
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
      { action: 'subscribe', channel: 'candles.EURUSD.M15', channels: ['candles.EURUSD.M15'] },
    ]);

    subscription.close();

    expect(parseSent(ws).at(-1)).toEqual({ action: 'unsubscribe', channel: 'candles.EURUSD.M15', channels: ['candles.EURUSD.M15'] });
    expect(ws.closedWith).toEqual({ code: 1000, reason: 'Chart candle subscription closed' });
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
