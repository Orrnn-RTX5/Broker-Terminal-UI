import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApiV2WsUrl, normalizeWsUrl } from '../config/api';
import {
  buildBrokerApiV2,
  buildBrokerWsFeedUri,
  buildBrokerWsV2Uri,
  getBrokerWsHost,
  getServerUrl,
  persistBrokerSessionDiscovery,
} from './brokerSession';

type RuntimeWindow = Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };

describe('broker websocket URL builder', () => {
  beforeEach(() => {
    localStorage.clear();
    (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = { backendTarget: 'desktop' };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('preserves saved HTTPS broker server_url in desktop runtime', () => {
    localStorage.setItem('broker_id', 'selected-broker');
    localStorage.setItem('server_url', 'https://testbrokerbackend.orrnn.com:443');
    localStorage.setItem('auth_token', 'access-token');

    expect(getServerUrl()).toBe('https://testbrokerbackend.orrnn.com:443');
    expect(buildBrokerApiV2()).toBe('https://testbrokerbackend.orrnn.com:443/api/v2');
    expect(buildBrokerWsV2Uri()).toBe(
      'wss://testbrokerbackend.orrnn.com/ws/v2?token=access-token'
    );
  });

  it('preserves explicit HTTP broker URLs in desktop runtime', () => {
    localStorage.setItem('server_url', 'http://103.91.186.142:443');

    expect(getServerUrl()).toBe('http://103.91.186.142:443');
    expect(buildBrokerApiV2()).toBe('http://103.91.186.142:443/api/v2');
    expect(buildBrokerWsV2Uri('jwt-token')).toBe(
      'ws://103.91.186.142:443/ws/v2?token=jwt-token'
    );
  });

  it('uses ws while preserving host and port from HTTP broker server_url', () => {
    localStorage.setItem('server_url', 'http://69.197.178.27:8090');

    expect(buildBrokerWsV2Uri('jwt-token')).toBe(
      'ws://69.197.178.27:8090/ws/v2?token=jwt-token'
    );
    expect(buildApiV2WsUrl('jwt-token')).toBe(
      'ws://69.197.178.27:8090/ws/v2?token=jwt-token'
    );
  });

  it('uses public broker URLs in web mode even when stale direct broker storage exists', () => {
    (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = { VITE_BACKEND_TARGET: 'web', API_HOST: 'https://configured.example', WS_HOST: 'wss://configured.example', BROKER_ID: 'gta_broker', DEFAULT_MT5_SERVER: 'Configured-Live' };
    localStorage.setItem('backend_url', 'http://103.91.186.142:8091');
    localStorage.setItem('server_url', 'http://103.91.186.142:8091');
    localStorage.setItem('ws_url', 'ws://103.91.186.142:8091/ws/v2');
    localStorage.setItem('feed_url', 'ws://103.91.186.142:8091/ws/feed');

    expect(getServerUrl()).toBe('https://configured.example');
    expect(buildBrokerApiV2()).toBe('https://configured.example/api/v2');
    expect(buildBrokerWsFeedUri()).toBe('wss://configured.example/ws/feed?broker_id=gta_broker');
    expect(buildBrokerWsV2Uri('access-token')).toBe(
      'wss://configured.example/ws/v2?token=access-token'
    );
  });

  it('ignores stale direct IP websocket storage in web mode even when it is not :8091', () => {
    (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = { BACKEND_TARGET: 'web', API_HOST: 'https://configured.example', WS_HOST: 'wss://configured.example', BROKER_ID: 'gta_broker', DEFAULT_MT5_SERVER: 'Configured-Live' };
    localStorage.setItem('backend_url', 'http://69.197.178.27:8090');
    localStorage.setItem('server_url', 'http://69.197.178.27:8090');
    localStorage.setItem('ws_url', 'ws://69.197.178.27:8090/ws/v2');
    localStorage.setItem('feed_url', 'ws://69.197.178.27/ws/feed');

    expect(getServerUrl()).toBe('https://configured.example');
    expect(buildBrokerApiV2()).toBe('https://configured.example/api/v2');
    expect(buildBrokerWsFeedUri()).toBe('wss://configured.example/ws/feed?broker_id=gta_broker');
    expect(buildBrokerWsV2Uri('access-token')).toBe(
      'wss://configured.example/ws/v2?token=access-token'
    );
    expect([
      buildBrokerWsFeedUri(),
      buildBrokerWsV2Uri('access-token'),
    ].join('\n')).not.toContain('69.197.178.27');
  });

  it('persists public broker routing for web discovery that includes direct broker endpoints', () => {
    (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = { BACKEND_MODE: 'browser', API_HOST: 'https://configured.example', WS_HOST: 'wss://configured.example', BROKER_ID: 'gta_broker', DEFAULT_MT5_SERVER: 'Configured-Live' };

    persistBrokerSessionDiscovery({
      access_token: 'access-token',
      broker_id: 'gta_broker',
      backend_url: 'http://103.91.186.142:8091',
      market_api_url: 'http://103.91.186.142:8090',
      server_url: 'http://103.91.186.142:8091',
      ws_url: 'ws://103.91.186.142:8091/ws/v2',
      feed_url: 'ws://103.91.186.142:8091/ws/feed',
    });

    expect(localStorage.getItem('backend_url')).toBe('https://configured.example');
    expect(localStorage.getItem('server_url')).toBe('https://configured.example');
    expect(localStorage.getItem('ws_url')).toBe('wss://configured.example/ws/v2');
    expect(localStorage.getItem('feed_url')).toBe('wss://configured.example/ws/feed');
  });

  it('extracts only host and port when server_url contains a path', () => {
    expect(getBrokerWsHost('https://broker-domain.com:8443/api/v2')).toBe(
      'broker-domain.com:8443'
    );
  });

  it('preserves explicit websocket schemes and maps explicit HTTP schemes only', () => {
    expect(normalizeWsUrl('wss://secure.example/ws')).toBe('wss://secure.example/ws');
    expect(normalizeWsUrl('ws://plain.example/ws')).toBe('ws://plain.example/ws');
    expect(normalizeWsUrl('https://secure.example/ws')).toBe('wss://secure.example/ws');
    expect(normalizeWsUrl('http://plain.example/ws')).toBe('ws://plain.example/ws');
  });

  it('prefers broker-provided feed_url for quote feed sockets', () => {
    localStorage.setItem('server_url', 'http://fallback-broker.example');
    localStorage.setItem('feed_url', 'wss://feed-broker.example/custom/feed');

    expect(buildBrokerWsFeedUri()).toBe('wss://feed-broker.example/custom/feed');
  });

  it('labels the quote feed socket with the active broker id and never a credential', () => {
    localStorage.setItem('broker_id', 'gta_broker');
    localStorage.setItem('server_url', 'https://services.growtradingacademy.com');

    const feedUri = buildBrokerWsFeedUri();
    expect(feedUri).toBe(
      'wss://services.growtradingacademy.com/ws/feed?broker_id=gta_broker'
    );
    expect(feedUri).not.toContain('token=');
  });

  it('uses the runtime-config broker id for deployed web quote sockets', () => {
    (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      DEFAULT_MT5_SERVER: 'Configured-Live',
      API_HOST: 'https://services.growtradingacademy.com',
      WS_HOST: 'wss://services.growtradingacademy.com',
      BROKER_ID: 'gta_broker',
      VITE_BROKER_ID: 'grow-trading-academy',
    };

    expect(buildBrokerWsFeedUri()).toBe(
      'wss://services.growtradingacademy.com/ws/feed?broker_id=gta_broker'
    );
  });

  it('uses the build-time broker id for the matching packaged broker', () => {
    vi.stubEnv('VITE_FEED_BROKER_ID', 'TEST');
    vi.stubEnv('VITE_BROKER_ID', 'TEST');
    localStorage.setItem('broker_id', 'TEST');
    localStorage.setItem('server_url', 'https://fxtrustbrokerbackend.orrnn.com');

    expect(buildBrokerWsFeedUri()).toBe(
      'wss://fxtrustbrokerbackend.orrnn.com/ws/feed?broker_id=TEST'
    );
  });

  it('labels the feed with the selected broker, not the packaged build-time broker', () => {
    vi.stubEnv('VITE_FEED_BROKER_ID', 'TEST');
    vi.stubEnv('VITE_BROKER_ID', 'TEST');
    localStorage.setItem('broker_id', 'achiever-financials');
    localStorage.setItem('server_url', 'https://service.achieverfinancials.com');

    expect(buildBrokerWsFeedUri()).toBe(
      'wss://service.achieverfinancials.com/ws/feed?broker_id=achiever-financials'
    );
  });

  it('uses FX Trust public broker hosts in web mode', () => {
    (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      DEFAULT_MT5_SERVER: 'Configured-Live',
      API_HOST: 'https://fxtrustbrokerbackend.orrnn.com',
      WS_HOST: 'wss://fxtrustbrokerbackend.orrnn.com',
      BROKER_ID: 'TEST',
    };

    expect(getServerUrl()).toBe('https://fxtrustbrokerbackend.orrnn.com');
    expect(buildBrokerApiV2()).toBe('https://fxtrustbrokerbackend.orrnn.com/api/v2');
    expect(buildBrokerWsV2Uri('access-token')).toBe(
      'wss://fxtrustbrokerbackend.orrnn.com/ws/v2?token=access-token'
    );
    expect(buildBrokerWsFeedUri()).toBe(
      'wss://fxtrustbrokerbackend.orrnn.com/ws/feed?broker_id=TEST'
    );
  });

  it('derives local same-origin websocket paths from runtime WS_HOST', () => {
    (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'desktop',
      API_HOST: 'http://127.0.0.1:5175',
      WS_HOST: 'ws://127.0.0.1:5175',
      BROKER_ID: 'TEST',
      FEED_BROKER_ID: 'TEST',
    };

    expect(buildBrokerWsV2Uri('access-token')).toBe(
      'ws://127.0.0.1:5175/ws/v2?token=access-token'
    );
    expect(buildBrokerWsFeedUri()).toBe('ws://127.0.0.1:5175/ws/feed?broker_id=TEST');
  });

  it('does not carry a packaged feed identity into a separately selected desktop broker', () => {
    localStorage.setItem('broker_id', 'grow-trading-academy');
    localStorage.setItem('rtx_broker_id', 'grow-trading-academy');
    localStorage.setItem('server_url', 'https://services.growtradingacademy.com');
    (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'desktop',
      BROKER_ID: 'gta_broker',
      FEED_BROKER_ID: 'gta_broker',
      VITE_BROKER_ID: 'grow-trading-academy',
    };

    expect(buildBrokerWsFeedUri()).toBe(
      'wss://services.growtradingacademy.com/ws/feed?broker_id=grow-trading-academy'
    );
  });

  it('preserves backend broker ids without frontend alias rewriting', () => {
    localStorage.setItem('broker_id', 'grow-trading-academy');
    localStorage.setItem('server_url', 'https://services.growtradingacademy.com');
    (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'desktop',
      VITE_BROKER_ID: 'grow-trading-academy',
    };

    expect(buildBrokerWsFeedUri()).toBe(
      'wss://services.growtradingacademy.com/ws/feed?broker_id=grow-trading-academy'
    );
  });

  it('uses the feed broker id published by backend discovery without rewriting it', () => {
    persistBrokerSessionDiscovery({
      broker_id: 'deployment-id', feed_broker_id: 'Backend-Feed-ID',
      server_url: 'https://broker.example',
    });
    expect(buildBrokerWsFeedUri()).toBe('wss://broker.example/ws/feed?broker_id=Backend-Feed-ID');
  });

  it('never persists or replays a feed credential from discovery', () => {
    // Legacy discovery payloads may still carry these; they must be ignored.
    const legacyDiscoveryPayload = {
      broker_id: 'gta_broker',
      backend_url: 'https://services.growtradingacademy.com',
      feed_broker_token: 'feed-secret',
      feed_token: 'feed-secret',
    };
    persistBrokerSessionDiscovery(legacyDiscoveryPayload);

    expect(localStorage.getItem('feed_broker_token')).toBeNull();
    expect(localStorage.getItem('feed_token')).toBeNull();
    expect(buildBrokerWsFeedUri()).toBe(
      'wss://services.growtradingacademy.com/ws/feed?broker_id=gta_broker'
    );
  });

  it('relabels the feed for the new broker when login switches brokers', () => {
    localStorage.setItem('broker_id', 'TEST');
    localStorage.setItem('server_url', 'https://fxtrustbrokerbackend.orrnn.com');
    localStorage.setItem('feed_broker_id', 'TEST');

    persistBrokerSessionDiscovery({
      access_token: 'new-account-token',
      broker_id: 'achiever-financials',
      backend_url: 'https://service.achieverfinancials.com',
      server_url: 'https://service.achieverfinancials.com',
    });

    expect(localStorage.getItem('feed_broker_id')).toBeNull();
    expect(buildBrokerWsFeedUri()).toBe(
      'wss://service.achieverfinancials.com/ws/feed?broker_id=achiever-financials'
    );
  });

  it('uses broker-provided ws_url when feed_url is absent', () => {
    localStorage.setItem('server_url', 'http://fallback-broker.example');
    localStorage.setItem('ws_url', 'https://feed-broker.example/ws/feed');

    expect(buildBrokerWsFeedUri()).toBe('wss://feed-broker.example/ws/feed');
  });

  it('normalizes broker-provided ws_url /ws/v2 to /ws/feed when feed_url is absent', () => {
    localStorage.setItem('server_url', 'http://fallback-broker.example');
    localStorage.setItem('ws_url', 'https://feed-broker.example/ws/v2');

    expect(buildBrokerWsFeedUri()).toBe('wss://feed-broker.example/ws/feed');
  });

  it('normalizes broker-provided quote ws_url to /ws/v2 for candle sockets only', () => {
    localStorage.setItem('server_url', 'http://fallback-broker.example');
    localStorage.setItem('ws_url', 'ws://103.91.186.142/ws/feed');

    expect(buildBrokerWsV2Uri('jwt-token')).toBe('ws://103.91.186.142/ws/v2?token=jwt-token');
    expect(buildBrokerWsFeedUri()).toBe('ws://103.91.186.142/ws/feed');
  });

  it('strips feed query params before appending auth to candle /ws/v2 URL', () => {
    localStorage.setItem('server_url', 'http://fallback-broker.example');
    localStorage.setItem('ws_url', 'wss://broker.example.com/ws/feed?stream=quotes');

    expect(buildBrokerWsV2Uri('jwt-token')).toBe('wss://broker.example.com/ws/v2?token=jwt-token');
  });

  it('derives /ws/feed from backend_url before server_url', () => {
    localStorage.setItem('server_url', 'http://server-broker.example');
    localStorage.setItem('backend_url', 'http://backend-broker.example/api/v2');

    expect(buildBrokerWsFeedUri()).toBe('ws://backend-broker.example/ws/feed');
  });

  it('derives /ws/feed from server_url when no feed endpoint is provided', () => {
    localStorage.setItem('server_url', 'http://69.197.178.27:8090');

    expect(buildBrokerWsFeedUri()).toBe('ws://69.197.178.27:8090/ws/feed');
  });

  it('persists gta_broker discovery market_api_url and feed_ws_url', () => {
    persistBrokerSessionDiscovery({
      broker_id: 'gta_broker',
      server_url: 'http://103.91.186.142:8091',
      market_api_url: 'http://103.91.186.142:8090',
      feed_ws_url: 'ws://103.91.186.142:8090/ws/feed',
      feed_status_url: 'http://103.91.186.142:8090/feed/status',
    });

    expect(getServerUrl()).toBe('http://103.91.186.142:8090');
    expect(buildBrokerApiV2()).toBe('http://103.91.186.142:8090/api/v2');
    expect(buildBrokerWsFeedUri()).toBe('ws://103.91.186.142:8090/ws/feed?broker_id=gta_broker');
    expect(localStorage.getItem('feed_status_url')).toBe('http://103.91.186.142:8090/feed/status');
  });

  it('keeps a valid market origin when a later login response reports :8091 endpoints', () => {
    persistBrokerSessionDiscovery({
      broker_id: 'gta_broker',
      market_api_url: 'http://103.91.186.142:8090',
      feed_ws_url: 'ws://103.91.186.142:8090/ws/feed',
    });

    persistBrokerSessionDiscovery({
      access_token: 'access-token',
      broker_id: 'gta_broker',
      server_url: 'http://103.91.186.142:8091',
      ws_url: 'ws://103.91.186.142:8091/ws/v2',
      feed_url: 'ws://103.91.186.142:8091/ws/feed',
    });

    expect(getServerUrl()).toBe('http://103.91.186.142:8090');
    expect(localStorage.getItem('backend_url')).toBe('http://103.91.186.142:8090');
    expect(localStorage.getItem('server_url')).toBe('http://103.91.186.142:8090');
    expect(localStorage.getItem('ws_url')).toBe('ws://103.91.186.142:8090/ws/v2');
    expect(localStorage.getItem('feed_url')).toBe('ws://103.91.186.142:8090/ws/feed');

    expect(buildBrokerApiV2()).toBe('http://103.91.186.142:8090/api/v2');
    expect(buildBrokerWsFeedUri()).toBe('ws://103.91.186.142:8090/ws/feed?broker_id=gta_broker');
    expect(buildBrokerWsV2Uri('access-token')).toBe('ws://103.91.186.142:8090/ws/v2?token=access-token');
    expect([
      getServerUrl(),
      buildBrokerApiV2(),
      buildBrokerWsFeedUri(),
      buildBrokerWsV2Uri('access-token'),
    ].join('\n')).not.toContain(':8091');
  });

  it('recovers runtime builders from stale :8091 storage when a valid feed origin exists', () => {
    localStorage.setItem('server_url', 'http://103.91.186.142:8091');
    localStorage.setItem('ws_url', 'ws://103.91.186.142:8091/ws/v2');
    localStorage.setItem('feed_url', 'ws://103.91.186.142:8090/ws/feed');

    expect(getServerUrl()).toBe('http://103.91.186.142:8090');
    expect(buildBrokerApiV2()).toBe('http://103.91.186.142:8090/api/v2');
    expect(buildBrokerWsFeedUri()).toBe('ws://103.91.186.142:8090/ws/feed');
    expect(buildBrokerWsV2Uri('access-token')).toBe('ws://103.91.186.142:8090/ws/v2?token=access-token');
  });

  it('derives websocket builders from valid server_url when stored sockets still point at :8091', () => {
    localStorage.setItem('server_url', 'http://103.91.186.142');
    localStorage.setItem('ws_url', 'ws://103.91.186.142:8091/ws/v2');
    localStorage.setItem('feed_url', 'ws://103.91.186.142:8091/ws/feed');

    expect(getServerUrl()).toBe('http://103.91.186.142');
    expect(buildBrokerWsFeedUri()).toBe('ws://103.91.186.142/ws/feed');
    expect(buildBrokerWsV2Uri('access-token')).toBe('ws://103.91.186.142/ws/v2?token=access-token');
    expect([
      getServerUrl(),
      buildBrokerWsFeedUri(),
      buildBrokerWsV2Uri('access-token'),
    ].join('\n')).not.toContain(':8091');
  });

  it('derives websocket builders from valid backend_url when restored feed_url points at :8091', () => {
    localStorage.setItem('backend_url', 'http://103.91.186.142');
    localStorage.setItem('feed_url', 'ws://103.91.186.142:8091/ws/feed');

    expect(buildBrokerWsFeedUri()).toBe('ws://103.91.186.142/ws/feed');
    expect(buildBrokerWsV2Uri('access-token')).toBe('ws://103.91.186.142/ws/v2?token=access-token');
    expect([
      buildBrokerWsFeedUri(),
      buildBrokerWsV2Uri('access-token'),
    ].join('\n')).not.toContain(':8091');
  });

  it('ignores broker-name rtx_broker_server while recovering bad :8091 storage from feed_url', () => {
    localStorage.setItem('rtx_broker_server', 'gta_broker');
    localStorage.setItem('server_url', 'http://103.91.186.142:8091');
    localStorage.setItem('ws_url', 'ws://103.91.186.142:8091/ws/v2');
    localStorage.setItem('feed_url', 'ws://103.91.186.142:8090/ws/feed');

    expect(getServerUrl()).toBe('http://103.91.186.142:8090');
    expect(buildBrokerApiV2()).toBe('http://103.91.186.142:8090/api/v2');
    expect(buildBrokerWsFeedUri()).toBe('ws://103.91.186.142:8090/ws/feed');
    expect(buildBrokerWsV2Uri('access-token')).toBe('ws://103.91.186.142:8090/ws/v2?token=access-token');
    expect([
      getServerUrl(),
      buildBrokerApiV2(),
      buildBrokerWsFeedUri(),
      buildBrokerWsV2Uri('access-token'),
    ].join('\n')).not.toContain('http://gta_broker');
  });

  it('does not preserve a fake broker-name origin over a bad :8091 login response', () => {
    localStorage.setItem('broker_id', 'gta_broker');
    localStorage.setItem('rtx_broker_id', 'gta_broker');
    localStorage.setItem('rtx_broker_server', 'gta_broker');
    localStorage.setItem('server_url', 'http://103.91.186.142:8091');
    localStorage.setItem('ws_url', 'ws://103.91.186.142:8091/ws/v2');
    localStorage.setItem('feed_url', 'ws://103.91.186.142:8090/ws/feed');

    persistBrokerSessionDiscovery({
      access_token: 'access-token',
      broker_id: 'gta_broker',
      broker_server: 'gta_broker',
      server_url: 'http://103.91.186.142:8091',
      ws_url: 'ws://103.91.186.142:8091/ws/v2',
      feed_url: 'ws://103.91.186.142:8091/ws/feed',
    });

    expect(getServerUrl()).toBe('http://103.91.186.142:8090');
    expect(localStorage.getItem('server_url')).toBe('http://103.91.186.142:8090');
    expect(localStorage.getItem('rtx_broker_server')).toBe('http://103.91.186.142:8090');
    expect(buildBrokerApiV2()).toBe('http://103.91.186.142:8090/api/v2');
    expect(buildBrokerWsV2Uri('access-token')).toBe('ws://103.91.186.142:8090/ws/v2?token=access-token');
    expect([
      localStorage.getItem('server_url') || '',
      localStorage.getItem('rtx_broker_server') || '',
      buildBrokerApiV2(),
      buildBrokerWsV2Uri('access-token'),
    ].join('\n')).not.toContain('http://gta_broker');
  });

  it('recovers REST and sockets from broker-name server_url using a valid feed_url', () => {
    localStorage.setItem('server_url', 'gta_broker');
    localStorage.setItem('feed_url', 'ws://103.91.186.142/ws/feed');

    expect(getServerUrl()).toBe('http://103.91.186.142');
    expect(buildBrokerApiV2()).toBe('http://103.91.186.142/api/v2');
    expect(buildBrokerWsFeedUri()).toBe('ws://103.91.186.142/ws/feed');
    expect(buildBrokerWsV2Uri('access-token')).toBe('ws://103.91.186.142/ws/v2?token=access-token');
    expect([
      getServerUrl(),
      buildBrokerApiV2(),
      buildBrokerWsFeedUri(),
      buildBrokerWsV2Uri('access-token'),
    ].join('\n')).not.toContain('gta_broker');
  });

  it('prefers a valid backend_url when server_url is a broker name', () => {
    localStorage.setItem('server_url', 'gta_broker');
    localStorage.setItem('backend_url', 'http://103.91.186.142');
    localStorage.setItem('feed_url', 'ws://103.91.186.142:8091/ws/feed');

    expect(getServerUrl()).toBe('http://103.91.186.142');
    expect(buildBrokerApiV2()).toBe('http://103.91.186.142/api/v2');
    expect(buildBrokerWsFeedUri()).toBe('ws://103.91.186.142/ws/feed');
    expect(buildBrokerWsV2Uri('access-token')).toBe('ws://103.91.186.142/ws/v2?token=access-token');
    expect([
      getServerUrl(),
      buildBrokerApiV2(),
      buildBrokerWsFeedUri(),
      buildBrokerWsV2Uri('access-token'),
    ].join('\n')).not.toContain('gta_broker');
  });

  it('recovers from broker-name backend_url using a valid feed_url', () => {
    localStorage.setItem('backend_url', 'gta_broker');
    localStorage.setItem('feed_url', 'ws://103.91.186.142/ws/feed');

    expect(getServerUrl()).toBe('http://103.91.186.142');
    expect(buildBrokerApiV2()).toBe('http://103.91.186.142/api/v2');
    expect(buildBrokerWsFeedUri()).toBe('ws://103.91.186.142/ws/feed');
    expect(buildBrokerWsV2Uri('access-token')).toBe('ws://103.91.186.142/ws/v2?token=access-token');
    expect([
      getServerUrl(),
      buildBrokerApiV2(),
      buildBrokerWsFeedUri(),
      buildBrokerWsV2Uri('access-token'),
    ].join('\n')).not.toContain('gta_broker');
  });

  it('derives sockets from valid backend_url when stored feed_url is a broker name', () => {
    localStorage.setItem('backend_url', 'http://103.91.186.142');
    localStorage.setItem('feed_url', 'gta_broker');

    expect(buildBrokerWsFeedUri()).toBe('ws://103.91.186.142/ws/feed');
    expect(buildBrokerWsV2Uri('access-token')).toBe('ws://103.91.186.142/ws/v2?token=access-token');
    expect([
      buildBrokerWsFeedUri(),
      buildBrokerWsV2Uri('access-token'),
    ].join('\n')).not.toContain('gta_broker');
  });

  it('derives sockets from valid backend_url when stored ws_url is a broker name', () => {
    localStorage.setItem('backend_url', 'http://103.91.186.142');
    localStorage.setItem('ws_url', 'gta_broker');

    expect(buildBrokerWsFeedUri()).toBe('ws://103.91.186.142/ws/feed');
    expect(buildBrokerWsV2Uri('access-token')).toBe('ws://103.91.186.142/ws/v2?token=access-token');
    expect([
      buildBrokerWsFeedUri(),
      buildBrokerWsV2Uri('access-token'),
    ].join('\n')).not.toContain('gta_broker');
  });

  it('derives sockets from valid backend_url when stored feed_url and ws_url are broker names', () => {
    localStorage.setItem('backend_url', 'http://103.91.186.142');
    localStorage.setItem('feed_url', 'gta_broker');
    localStorage.setItem('ws_url', 'gta_broker');

    expect(buildBrokerWsFeedUri()).toBe('ws://103.91.186.142/ws/feed');
    expect(buildBrokerWsV2Uri('access-token')).toBe('ws://103.91.186.142/ws/v2?token=access-token');
    expect([
      buildBrokerWsFeedUri(),
      buildBrokerWsV2Uri('access-token'),
    ].join('\n')).not.toContain('gta_broker');
  });

  it('uses a valid ws_url when feed_url is a broker name', () => {
    localStorage.setItem('backend_url', 'http://103.91.186.142');
    localStorage.setItem('feed_url', 'gta_broker');
    localStorage.setItem('ws_url', 'ws://quote-broker.example/ws/feed');

    expect(buildBrokerWsFeedUri()).toBe('ws://quote-broker.example/ws/feed');
    expect(buildBrokerWsV2Uri('access-token')).toBe('ws://quote-broker.example/ws/v2?token=access-token');
  });

  it('uses a valid feed_url when ws_url is a broker name', () => {
    localStorage.setItem('backend_url', 'http://103.91.186.142');
    localStorage.setItem('feed_url', 'ws://feed-broker.example/ws/feed');
    localStorage.setItem('ws_url', 'gta_broker');

    expect(buildBrokerWsFeedUri()).toBe('ws://feed-broker.example/ws/feed');
    expect(buildBrokerWsV2Uri('access-token')).toBe('ws://feed-broker.example/ws/v2?token=access-token');
  });

  it('drops broker-name websocket endpoints from discovery and derives sockets from backend_url', () => {
    persistBrokerSessionDiscovery({
      access_token: 'access-token',
      broker_id: 'gta_broker',
      backend_url: 'http://103.91.186.142',
      feed_url: 'gta_broker',
      ws_url: 'gta_broker',
    });

    expect(localStorage.getItem('feed_url')).toBeNull();
    expect(localStorage.getItem('ws_url')).toBeNull();
    expect(buildBrokerWsFeedUri()).toBe('ws://103.91.186.142/ws/feed?broker_id=gta_broker');
    expect(buildBrokerWsV2Uri('access-token')).toBe('ws://103.91.186.142/ws/v2?token=access-token');
    // The broker name may only appear as the feed label, never as an origin.
    expect([
      buildBrokerWsFeedUri(),
      buildBrokerWsV2Uri('access-token'),
    ].join('\n')).not.toContain('//gta_broker');
  });

  it('persists valid backend_url when discovery also includes broker-name market fields', () => {
    persistBrokerSessionDiscovery({
      broker_id: 'gta_broker',
      market_api_url: 'gta_broker',
      backend_url: 'http://103.91.186.142',
      server_url: 'gta_broker',
      feed_url: 'ws://103.91.186.142/ws/feed',
    });

    expect(localStorage.getItem('backend_url')).toBe('http://103.91.186.142');
    expect(localStorage.getItem('server_url')).toBe('http://103.91.186.142');
    expect(getServerUrl()).toBe('http://103.91.186.142');
    expect(buildBrokerApiV2()).toBe('http://103.91.186.142/api/v2');
    expect(buildBrokerWsFeedUri()).toBe('ws://103.91.186.142/ws/feed?broker_id=gta_broker');
    expect(buildBrokerWsV2Uri('access-token')).toBe('ws://103.91.186.142/ws/v2?token=access-token');
  });

  it('clears stale auth_token when pre-login broker discovery switches servers', () => {
    localStorage.setItem('server_url', 'http://old-broker.example');
    localStorage.setItem('auth_token', 'old-token');

    persistBrokerSessionDiscovery({
      broker_id: 'broker-2',
      server_url: 'http://new-broker.example',
    });

    expect(localStorage.getItem('server_url')).toBe('http://new-broker.example');
    expect(localStorage.getItem('auth_token')).toBeNull();
  });
});
