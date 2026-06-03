import { beforeEach, describe, expect, it } from 'vitest';
import {
  DESKTOP_BACKEND_FALLBACK,
  WEB_BACKEND_FALLBACK,
  getBackendTarget,
  isDesktopBackendTarget,
  normalizeBrokerInfoForTarget,
  resolveBrokerBackendUrl,
  resolveBrokerExtApiUrl,
  resolveBrokerWsUrl,
} from './backendTarget.js';

type RuntimeWindow = Window & {
  electronAPI?: unknown;
  RUNTIME_CONFIG?: Record<string, unknown>;
  __RTX_RUNTIME_CONFIG__?: Record<string, unknown>;
};

const runtimeWindow = window as RuntimeWindow;

describe('backend target resolver', () => {
  beforeEach(() => {
    delete runtimeWindow.electronAPI;
    delete runtimeWindow.RUNTIME_CONFIG;
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
  });

  it('uses the shared public services backend for browser sessions', () => {
    expect(isDesktopBackendTarget()).toBe(false);
    expect(getBackendTarget()).toBe(WEB_BACKEND_FALLBACK);
    expect(resolveBrokerBackendUrl({
      broker_id: 'gta_broker',
      server_ip: '103.91.186.142',
      server_port: 8091,
      backend_url: 'http://103.91.186.142:8091',
    })).toBe(WEB_BACKEND_FALLBACK);
  });

  it('ignores public broker fields and legacy direct fields in web mode', () => {
    const broker = normalizeBrokerInfoForTarget({
      broker_id: 'gta_broker',
      public_backend_url: 'https://webterminal.growtradingacademy.com/',
      public_ext_api_url: 'https://manager.growtradingacademy.com/ext',
      public_ws_url: 'wss://admin.growtradingacademy.com/ws/v2',
      backend_url: 'http://103.91.186.142:8091',
      ws_url: 'ws://103.91.186.142:8091/ws/v2',
    });

    expect(broker.server_url).toBe('https://services.growtradingacademy.com');
    expect(broker.market_api_url).toBe('https://services.growtradingacademy.com');
    expect(broker.ws_url).toBe('wss://services.growtradingacademy.com/ws/v2');
    expect(broker.feed_url).toBe('wss://services.growtradingacademy.com/ws/feed');
  });

  it('uses safe runtime services API and derives web websocket paths from runtime WS origin', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      API_HOST: 'https://services.growtradingacademy.com/',
      WS_HOST: 'wss://services.growtradingacademy.com',
    };

    expect(getBackendTarget()).toBe('https://services.growtradingacademy.com');
    expect(resolveBrokerWsUrl({}, '/ws/v2')).toBe('wss://services.growtradingacademy.com/ws/v2');
    expect(resolveBrokerWsUrl({}, '/ws/feed')).toBe('wss://services.growtradingacademy.com/ws/feed');
  });

  it('rejects unsafe runtime API and WS hosts in web mode', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_MODE: 'browser',
      API_HOST: 'https://admin.growtradingacademy.com',
      WS_HOST: 'ws://69.197.178.27:8090',
    };

    expect(getBackendTarget()).toBe(WEB_BACKEND_FALLBACK);
    expect(resolveBrokerWsUrl({}, '/ws/v2')).toBe('wss://services.growtradingacademy.com/ws/v2');
  });

  it('honors uppercase runtime target and mode keys', () => {
    runtimeWindow.RUNTIME_CONFIG = { BACKEND_TARGET: 'desktop' };
    expect(isDesktopBackendTarget()).toBe(true);

    runtimeWindow.RUNTIME_CONFIG = { VITE_BACKEND_MODE: 'web' };
    expect(isDesktopBackendTarget()).toBe(false);
  });

  it('uses selected broker direct IP and port for desktop sessions', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { backendTarget: 'desktop' };

    const broker = {
      broker_id: 'gta_broker',
      server_ip: '103.91.186.142',
      server_port: 8091,
      backend_url: 'http://103.91.186.142:8091',
      ws_url: 'ws://103.91.186.142:8091/ws/v2',
    };

    expect(isDesktopBackendTarget()).toBe(true);
    expect(getBackendTarget()).toBe(DESKTOP_BACKEND_FALLBACK);
    expect(resolveBrokerBackendUrl(broker)).toBe('http://103.91.186.142:8091');
    expect(resolveBrokerExtApiUrl(broker)).toBe('http://103.91.186.142:8091');
    expect(resolveBrokerWsUrl(broker)).toBe('ws://103.91.186.142:8091/ws/v2');
  });

  it('prefers selected broker server_ip/server_port over stale desktop URL fields', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { VITE_BACKEND_TARGET: 'desktop' };

    const broker = normalizeBrokerInfoForTarget({
      broker_id: 'selected_broker',
      server_ip: '69.197.178.27',
      server_port: 8090,
      backend_url: 'http://103.91.186.142:8091',
      market_api_url: 'http://103.91.186.142:8091',
      server_url: 'http://103.91.186.142:8091',
    });

    expect(broker.server_url).toBe('http://69.197.178.27:8090');
    expect(broker.market_api_url).toBe('http://69.197.178.27:8090');
    expect(broker.ws_url).toBe('ws://69.197.178.27:8090/ws/v2');
    expect(broker.feed_url).toBe('ws://69.197.178.27:8090/ws/feed');
  });

  it('prefers selected broker server_ip/server_port over stale desktop websocket URL fields', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { VITE_BACKEND_TARGET: 'desktop' };

    const broker = normalizeBrokerInfoForTarget({
      broker_id: 'selected_broker',
      server_ip: '69.197.178.27',
      server_port: 8090,
      ws_url: 'ws://103.91.186.142:8091/ws/v2',
      feed_url: 'ws://103.91.186.142:8091/ws/feed',
    });

    expect(broker.server_url).toBe('http://69.197.178.27:8090');
    expect(broker.ws_url).toBe('ws://69.197.178.27:8090/ws/v2');
    expect(broker.feed_url).toBe('ws://69.197.178.27:8090/ws/feed');
  });

  it('uses default desktop direct port 8091 when broker server_port is missing', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { BACKEND_MODE: 'direct' };

    expect(resolveBrokerBackendUrl({
      broker_id: 'selected_broker',
      server_ip: '69.197.178.27',
      backend_url: 'http://103.91.186.142:8090',
    })).toBe('http://69.197.178.27:8091');
  });
});
