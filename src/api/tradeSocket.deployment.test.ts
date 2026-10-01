// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TradeWebSocketClient } from './tradeSocket';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { FakeWebSocket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 3; this.onclose?.(); }
}

const runtime = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
const achiever = 'https://service.achiever.orrnn.com';
const configure = (origin = achiever, id = 'achiever', token = 'current-token') => {
  runtime.__RTX_RUNTIME_CONFIG__ = {
    BACKEND_TARGET: 'web', API_HOST: origin, API_HOST_EXT: origin,
    WS_HOST: origin.replace('https:', 'wss:'), BROKER_ID: id, DEFAULT_MT5_SERVER: 'broker-server-3',
  };
  localStorage.setItem('server_url', origin);
  localStorage.setItem('broker_id', id);
  localStorage.setItem('auth_token', token);
};
const clients: TradeWebSocketClient[] = [];
const client = (options: ConstructorParameters<typeof TradeWebSocketClient>[0] = {}) => {
  const value = new TradeWebSocketClient({ reconnect: false, ...options });
  clients.push(value);
  return value;
};

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  delete window.electron;
  configure(); FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => {
  clients.splice(0).forEach(value => value.disconnect());
  delete runtime.__RTX_RUNTIME_CONFIG__;
  localStorage.clear(); sessionStorage.clear();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
});

describe('deployment-bound order sockets', () => {
  it.each([achiever, 'https://api.independent-market.net', 'https://previously-unknown.example'])('builds /ws/v2 only for the configured origin %s', origin => {
    configure(origin);
    const value = client(); value.connect();
    const socket = FakeWebSocket.instances[0];
    const url = new URL(socket.url);
    expect(url.origin).toBe(origin.replace('https:', 'wss:'));
    expect(url.pathname).toBe('/ws/v2');
    expect(url.searchParams.get('token')).toBe('current-token');
    socket.open();
    expect(socket.sent.map(value => JSON.parse(value))).toEqual([{ action: 'auth', token: 'current-token' }]);
  });

  it.each([
    {},
    { API_HOST: achiever, WS_HOST: 'wss://another-broker.example', BROKER_ID: 'achiever', DEFAULT_MT5_SERVER: 'broker-server-3' },
    { API_HOST: 'https://name:secret@service.achiever.orrnn.com', WS_HOST: 'wss://service.achiever.orrnn.com', BROKER_ID: 'achiever' },
  ])('creates zero sockets for invalid runtime configuration %j', configuration => {
    runtime.__RTX_RUNTIME_CONFIG__ = configuration;
    client({ url: 'wss://service.orrnn.com/ws/v2?token=current-token' }).connect();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it.each([
    { url: 'wss://service.orrnn.com/ws/v2?token=current-token' },
    { url: 'wss://service.achiever.orrnn.com/ws/feed?token=current-token' },
    { url: 'wss://service.achiever.orrnn.com/ws/v2?token=previous-broker-token' },
    { url: 'wss://service.achiever.orrnn.com/ws/v2?token=current-token&token=previous-broker-token' },
    { token: 'previous-broker-token' },
  ])('rejects explicit foreign URLs or stale URL/frame credentials %j', options => {
    client(options).connect();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('accepts an explicitly approved separate WebSocket origin', () => {
    runtime.__RTX_RUNTIME_CONFIG__!.WS_HOST = 'wss://stream.independent-market.net';
    runtime.__RTX_RUNTIME_CONFIG__!.BROKER_ALLOWED_ORIGINS = 'https://stream.independent-market.net';
    client().connect();
    expect(new URL(FakeWebSocket.instances[0].url).origin).toBe('wss://stream.independent-market.net');
  });

  it('sends no credentials when a captured connection opens after a broker switch', () => {
    const value = client({ reconnect: true }); value.connect();
    const captured = FakeWebSocket.instances[0];
    configure('https://new-broker.example', 'NewBroker', 'new-broker-token');
    captured.open();
    expect(captured.sent).toEqual([]);
    expect(captured.readyState).toBe(3);
    expect(value.isReadyForOrders()).toBe(false);
  });

  it('does not reconnect a previous broker client on the same origin after a broker switch', () => {
    vi.useFakeTimers();
    const value = client({ reconnect: true, reconnectDelayMs: 10 }); value.connect();
    FakeWebSocket.instances[0].close();
    configure(achiever, 'NewBroker', 'new-broker-token');
    vi.advanceTimersByTime(10);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(value.connectionState).toBe('error');
  });

  it('reconnects the same deployment using its current rotated token', () => {
    vi.useFakeTimers();
    const value = client({ reconnect: true, reconnectDelayMs: 10 }); value.connect();
    FakeWebSocket.instances[0].close();
    localStorage.setItem('auth_token', 'rotated-token');
    vi.advanceTimersByTime(10);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(new URL(FakeWebSocket.instances[1].url).searchParams.get('token')).toBe('rotated-token');
    FakeWebSocket.instances[1].open();
    expect(FakeWebSocket.instances[1].sent.map(value => JSON.parse(value))).toEqual([{ action: 'auth', token: 'rotated-token' }]);
  });

  it('blocks sends and ignores stale account frames after the deployment changes', () => {
    const value = client(); const handler = vi.fn(); value.onMessage(handler);
    value.connect(); const captured = FakeWebSocket.instances[0]; captured.open();
    captured.sent = [];
    configure(achiever, 'NewBroker', 'new-broker-token');
    expect(value.send({ action: 'auth', token: 'never-send' })).toBe(false);
    captured.onmessage?.({ data: JSON.stringify({ type: 'position_update' }) });
    expect(captured.sent).toEqual([]); expect(handler).not.toHaveBeenCalled();
  });
});
