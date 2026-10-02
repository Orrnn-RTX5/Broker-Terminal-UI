import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildBrokerApiV2, buildBrokerWsFeedUri, buildBrokerWsV2Uri,
  credentialsAreBoundToDeployment, getAccessToken, getRefreshToken,
  createCommittedBrokerAccountSessionScope, getCommittedBrokerAccountSessionScopeKey,
  persistBrokerSessionDiscovery,
} from './brokerSession';
import { ensureConfiguredWebSession } from '../startup/configuredWebSession';
import { EnhancedWebSocketService } from './websocket-enhanced';

const runtime = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
const configure = (brokerId = 'Achiever', origin = 'https://service.achiever.orrnn.com') => {
  runtime.__RTX_RUNTIME_CONFIG__ = {
    CONFIG_SOURCE: 'deployment', BACKEND_TARGET: 'web', API_HOST: origin,
    WS_HOST: origin.replace(/^https:/, 'wss:'), BROKER_ID: brokerId,
    DEFAULT_MT5_SERVER: `${brokerId}-Live`,
  };
};
const saveCredentials = (brokerId = 'Achiever', origin = 'https://service.achiever.orrnn.com', token = 'scoped-access') => {
  localStorage.setItem('broker_id', brokerId);
  localStorage.setItem('server_url', origin);
  localStorage.setItem('auth_token', token);
  localStorage.setItem('refresh_token', 'scoped-refresh');
};

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly url: string) { FakeSocket.instances.push(this); }
  close() { this.readyState = FakeSocket.CLOSED; }
  send() { /* A synthetic socket never sends network requests. */ }
}

describe('pinned deployment session and reconnect isolation', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    configure();
    vi.stubEnv('VITE_API_HOST', 'https://service.orrnn.com');
    vi.stubEnv('VITE_WS_HOST', 'wss://service.orrnn.com');
    vi.stubEnv('VITE_BROKER_ID', 'Orrnn');
    vi.stubEnv('VITE_DEFAULT_MT5_SERVER', 'Orrnn-Live');
  });
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete runtime.__RTX_RUNTIME_CONFIG__;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['Achiever', 'https://service.achiever.orrnn.com'],
    ['Unrelated', 'https://terminal-api.unrelated.example'],
    ['Unknown', 'https://newly-configured.example.net'],
  ])('keeps compiled Orrnn and stale sockets out of %s routing', (brokerId, origin) => {
    configure(brokerId, origin);
    saveCredentials(brokerId, origin);
    localStorage.setItem('ws_url', 'wss://service.orrnn.com/ws/v2');
    localStorage.setItem('feed_url', 'wss://other-broker.example/ws/feed?broker_id=Other');
    localStorage.setItem('feed_broker_id', 'Orrnn');
    expect(buildBrokerApiV2('/positions')).toBe(`${origin}/api/v2/positions`);
    expect(buildBrokerWsV2Uri()).toBe(`${origin.replace(/^https:/, 'wss:')}/ws/v2?token=scoped-access`);
    expect(buildBrokerWsFeedUri()).toBe(`${origin.replace(/^https:/, 'wss:')}/ws/feed?broker_id=${brokerId}`);
    expect(getAccessToken()).toBe('scoped-access');
  });

  it('withholds stale credentials even before startup reconciliation runs', () => {
    saveCredentials('Orrnn', 'https://service.orrnn.com', 'orrnn-private-token');
    sessionStorage.setItem('auth_token', 'orrnn-session-token');
    expect(credentialsAreBoundToDeployment()).toBe(false);
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(buildBrokerWsV2Uri()).toBe('wss://service.achiever.orrnn.com/ws/v2');
    expect(ensureConfiguredWebSession()).toBe(false);
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(sessionStorage.getItem('auth_token')).toBeNull();
  });

  it.each(['', 'wss://selected.example/ws/v2', 'https://user:secret@selected.example'])('withholds desktop credentials without a safe selected server: %s', (server) => {
    runtime.__RTX_RUNTIME_CONFIG__ = { BACKEND_TARGET: 'desktop' };
    saveCredentials('selected-broker', server, 'previous-broker-private-token');
    expect(credentialsAreBoundToDeployment()).toBe(false);
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(buildBrokerWsV2Uri()).not.toContain('previous-broker-private-token');
  });

  it.each(['http://127.0.0.1:8090', 'http://10.12.0.4:8090', 'https://selected.example'])('keeps explicitly selected desktop credentials bound to %s', (server) => {
    runtime.__RTX_RUNTIME_CONFIG__ = { BACKEND_TARGET: 'desktop' };
    saveCredentials('selected-broker', server);
    expect(credentialsAreBoundToDeployment()).toBe(true);
    expect(getAccessToken()).toBe('scoped-access');
    expect(getRefreshToken()).toBe('scoped-refresh');
  });

  it('withholds desktop credentials whose selected broker identity was lost', () => {
    runtime.__RTX_RUNTIME_CONFIG__ = { BACKEND_TARGET: 'desktop' };
    saveCredentials('', 'https://selected.example', 'previous-broker-private-token');
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(buildBrokerWsV2Uri()).toBe('wss://selected.example/ws/v2');
  });

  it('rejects a stale JWT broker claim even if saved broker labels were overwritten', () => {
    const payload = btoa(JSON.stringify({ broker_id: 'Orrnn' })).replace(/=+$/, '');
    saveCredentials('Achiever', 'https://service.achiever.orrnn.com', `header.${payload}.signature`);
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(ensureConfiguredWebSession()).toBe(false);
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('does not accept cross-broker discovery or broker ID case changes', () => {
    expect(() => persistBrokerSessionDiscovery({ broker_id: 'Orrnn', access_token: 'foreign-token' })).toThrow(/does not match/);
    expect(() => persistBrokerSessionDiscovery({ broker_id: 'achiever', access_token: 'foreign-token' })).toThrow(/does not match/);
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('keeps case-distinct backend identities and server paths in separate cache scopes', () => {
    const scope = (brokerId: string, path = 'Trading') => createCommittedBrokerAccountSessionScope({
      authenticated: true, brokerId, accountId: '12345', serverUrl: `https://BROKER.example/${path}`,
    });
    expect(scope('Achiever').serverUrl).toBe('https://broker.example/Trading');
    expect(getCommittedBrokerAccountSessionScopeKey(scope('Achiever'))).not.toBe(getCommittedBrokerAccountSessionScopeKey(scope('achiever')));
    expect(getCommittedBrokerAccountSessionScopeKey(scope('Achiever'))).not.toBe(getCommittedBrokerAccountSessionScopeKey(scope('Achiever', 'trading')));
  });

  it('uses explicitly authorized separate market and socket origins without changing credential ownership', () => {
    runtime.__RTX_RUNTIME_CONFIG__ = {
      ...runtime.__RTX_RUNTIME_CONFIG__,
      API_HOST_EXT: 'https://market.achiever.example', WS_HOST: 'wss://stream.achiever.example',
      BROKER_ALLOWED_ORIGINS: 'https://market.achiever.example,https://stream.achiever.example',
    };
    saveCredentials();
    expect(ensureConfiguredWebSession()).toBe(true);
    expect(buildBrokerWsV2Uri()).toBe('wss://stream.achiever.example/ws/v2?token=scoped-access');
    expect(buildBrokerWsFeedUri()).toBe('wss://stream.achiever.example/ws/feed?broker_id=Achiever');
    expect(localStorage.getItem('market_api_url')).toBe('https://market.achiever.example');
    expect(localStorage.getItem('server_url')).toBe('https://service.achiever.orrnn.com');
    expect(ensureConfiguredWebSession()).toBe(true);
    expect(getAccessToken()).toBe('scoped-access');
  });

  it.each([
    undefined,
    {},
    { API_HOST: 'not a URL', WS_HOST: 'wss://service.achiever.orrnn.com', BROKER_ID: 'Achiever', DEFAULT_MT5_SERVER: 'Achiever-Live' },
    { API_HOST: 'https://service.achiever.orrnn.com', WS_HOST: 'wss://other.example', BROKER_ID: 'Achiever', DEFAULT_MT5_SERVER: 'Achiever-Live' },
    { API_HOST: 'https://service.achiever.orrnn.com', WS_HOST: 'wss://service.achiever.orrnn.com', BROKER_ID: '', DEFAULT_MT5_SERVER: 'Achiever-Live' },
  ])('invalid configuration cannot produce endpoints or credentials: %j', (config) => {
    // Explicit missing runtime is represented by an empty production object;
    // deleting the object is covered separately by the runtime resolver tests.
    runtime.__RTX_RUNTIME_CONFIG__ = config || { CONFIG_SOURCE: 'deployment' };
    saveCredentials();
    expect(buildBrokerApiV2('/orders')).toBe('');
    expect(buildBrokerWsFeedUri()).toBe('');
    expect(buildBrokerWsV2Uri('private-token')).toBe('');
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('publishes token updates only after the token broker routing is committed', () => {
    saveCredentials('Orrnn', 'https://service.orrnn.com', 'old-token');
    const observed: Array<[string | null, string | null]> = [];
    const listener = () => observed.push([localStorage.getItem('auth_token'), localStorage.getItem('server_url')]);
    window.addEventListener('auth:token-updated', listener);
    try {
      persistBrokerSessionDiscovery({ broker_id: 'Achiever', access_token: 'new-token' });
      expect(observed).toEqual([['new-token', 'https://service.achiever.orrnn.com']]);
      expect(localStorage.getItem('refresh_token')).toBeNull();
    } finally {
      window.removeEventListener('auth:token-updated', listener);
    }
  });

  it('reconnects at the configured socket and never sends an old token after broker switching', () => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    saveCredentials();
    const service = new EnhancedWebSocketService('wss://service.orrnn.com/ws/v2');
    try {
      service.connect();
      expect(FakeSocket.instances[0].url).toBe('wss://service.achiever.orrnn.com/ws/v2?token=scoped-access');
      configure('Other', 'https://api.unrelated.example');
      service.forceReconnect();
      expect(FakeSocket.instances).toHaveLength(1);
      expect(FakeSocket.instances[0].readyState).toBe(FakeSocket.CLOSED);
      persistBrokerSessionDiscovery({ broker_id: 'Other', access_token: 'other-access' });
      expect(FakeSocket.instances).toHaveLength(2);
      expect(FakeSocket.instances[1].url).toBe('wss://api.unrelated.example/ws/v2?token=other-access');
      expect(FakeSocket.instances.map(socket => socket.url).join('\n')).not.toContain('service.orrnn.com');
    } finally {
      service.destroy();
    }
  });
});
