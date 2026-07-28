import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_BACKEND_FALLBACK,
  SHARED_DISCOVERY_FALLBACK,
  WEB_BACKEND_FALLBACK,
  getBackendTarget,
  getRuntimeConfiguredBrokerId,
  getRuntimeDiscoveryBaseUrl,
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
const backendTargetSourcePath = resolve(process.cwd(), 'src/config/backendTarget.js');

describe('backend target resolver', () => {
  beforeEach(() => {
    delete runtimeWindow.electronAPI;
    delete runtimeWindow.RUNTIME_CONFIG;
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the shared public broker backend for browser sessions', () => {
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

    expect(broker.server_url).toBe(WEB_BACKEND_FALLBACK);
    expect(broker.market_api_url).toBe(WEB_BACKEND_FALLBACK);
    expect(broker.ws_url).toBe('wss://backend.orrnn.com/ws/v2');
    expect(broker.feed_url).toBe('wss://backend.orrnn.com/ws/feed');
  });

  it('uses safe runtime broker API and derives web websocket paths from runtime WS origin', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      API_HOST: 'https://services.growtradingacademy.com/',
      WS_HOST: 'wss://services.growtradingacademy.com',
    };

    expect(getBackendTarget()).toBe('https://services.growtradingacademy.com');
    expect(resolveBrokerWsUrl({}, '/ws/v2')).toBe('wss://services.growtradingacademy.com/ws/v2');
    expect(resolveBrokerWsUrl({}, '/ws/feed')).toBe('wss://services.growtradingacademy.com/ws/feed');
  });

  it('keeps branded web broker discovery on the shared discovery backend by default', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      API_HOST: 'https://services.growtradingacademy.com/',
      WS_HOST: 'wss://services.growtradingacademy.com',
    };

    expect(getBackendTarget()).toBe('https://services.growtradingacademy.com');
    expect(getRuntimeDiscoveryBaseUrl()).toBe(SHARED_DISCOVERY_FALLBACK);
  });

  it('does not use the branded broker API host as the discovery backend', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      API_HOST: 'https://services.growtradingacademy.com',
      API_HOST_EXT: 'https://services.growtradingacademy.com',
      DISCOVERY_BASE_URL: 'https://services.growtradingacademy.com',
      WS_HOST: 'wss://services.growtradingacademy.com',
    };

    expect(getBackendTarget()).toBe('https://services.growtradingacademy.com');
    expect(getRuntimeDiscoveryBaseUrl()).toBe(SHARED_DISCOVERY_FALLBACK);
  });

  it('accepts ORRNN test broker public runtime hosts in web mode', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      API_HOST: 'https://testbrokerbackend.orrnn.com',
      WS_HOST: 'wss://testbrokerbackend.orrnn.com',
    };

    expect(getBackendTarget()).toBe('https://testbrokerbackend.orrnn.com');
    expect(resolveBrokerWsUrl({}, '/ws/v2')).toBe('wss://testbrokerbackend.orrnn.com/ws/v2');
    expect(resolveBrokerWsUrl({}, '/ws/feed')).toBe('wss://testbrokerbackend.orrnn.com/ws/feed');
  });

  it('accepts Achiever service runtime API and websocket hosts while keeping shared discovery', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      API_HOST: 'https://service.achieverfinancials.com',
      API_HOST_EXT: 'https://service.achieverfinancials.com',
      DISCOVERY_BASE_URL: 'https://superbackend.orrnn.com',
      WS_HOST: 'wss://service.achieverfinancials.com',
      FEED_BROKER_ID: 'achiever-financials',
      FEED_BROKER_TOKEN: 'feed-secret',
    };

    expect(getBackendTarget()).toBe('https://service.achieverfinancials.com');
    expect(resolveBrokerWsUrl({}, '/ws/v2')).toBe('wss://service.achieverfinancials.com/ws/v2');
    expect(resolveBrokerWsUrl({}, '/ws/feed')).toBe('wss://service.achieverfinancials.com/ws/feed');
    expect(getRuntimeDiscoveryBaseUrl()).toBe('https://superbackend.orrnn.com');
  });

  it('does not read or expose feed broker tokens through build-time backend target env', () => {
    vi.stubEnv('VITE_FEED_BROKER_TOKEN', 'feed-secret');
    vi.stubEnv('FEED_BROKER_TOKEN', 'feed-secret');

    expect(getBackendTarget()).toBe(WEB_BACKEND_FALLBACK);
    expect(getRuntimeDiscoveryBaseUrl()).toBe(SHARED_DISCOVERY_FALLBACK);
    expect(resolveBrokerWsUrl({}, '/ws/feed')).toBe('wss://backend.orrnn.com/ws/feed');

    const source = readFileSync(backendTargetSourcePath, 'utf8');
    expect(source).not.toMatch(/import\.meta\.env(?:\?\.)?\s*\[/);
    expect(source).not.toContain('VITE_FEED_BROKER_TOKEN');
    expect(source).not.toContain('FEED_BROKER_TOKEN');
  });

  it('resolves the configured broker id from runtime config, overriding build-time env', () => {
    vi.stubEnv('VITE_BROKER_ID', 'myprop-trade');
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      BROKER_ID: 'achiever-financials',
      VITE_BROKER_ID: 'achiever-financials',
    };

    expect(getRuntimeConfiguredBrokerId()).toBe('achiever-financials');
  });

  it('falls back to build-time broker id env when no runtime config is injected', () => {
    vi.stubEnv('VITE_BROKER_ID', 'myprop-trade');

    expect(getRuntimeConfiguredBrokerId()).toBe('myprop-trade');
  });

  it('returns an empty broker id when neither runtime config nor env provides one', () => {
    expect(getRuntimeConfiguredBrokerId()).toBe('');
  });

  it('rejects unsafe runtime API and WS hosts in web mode', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_MODE: 'browser',
      API_HOST: 'https://admin.growtradingacademy.com',
      WS_HOST: 'ws://69.197.178.27:8090',
    };

    expect(getBackendTarget()).toBe(WEB_BACKEND_FALLBACK);
    expect(resolveBrokerWsUrl({}, '/ws/v2')).toBe('wss://backend.orrnn.com/ws/v2');
  });

  it('honors uppercase runtime target and mode keys', () => {
    runtimeWindow.RUNTIME_CONFIG = { BACKEND_TARGET: 'desktop' };
    expect(isDesktopBackendTarget()).toBe(true);

    runtimeWindow.RUNTIME_CONFIG = { VITE_BACKEND_MODE: 'web' };
    expect(isDesktopBackendTarget()).toBe(false);
  });

  it('does not hardcode a public broker IP in the desktop fallback (N3-02)', () => {
    // The last-resort desktop default must not leak a public infra IP or send the
    // Bearer token in cleartext to a public host; loopback is the only safe default.
    expect(DESKTOP_BACKEND_FALLBACK).toBe('http://127.0.0.1:8091');
    expect(DESKTOP_BACKEND_FALLBACK).not.toContain('103.91.186.142');

    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { backendTarget: 'desktop' };
    expect(getBackendTarget()).toBe('http://127.0.0.1:8091');
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

  it('prefers broker discovery domain URLs over server_ip in desktop sessions', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { VITE_BACKEND_TARGET: 'desktop' };

    const broker = normalizeBrokerInfoForTarget({
      broker_id: 'gta_broker',
      server_ip: '103.91.186.142',
      server_port: 443,
      server_url: 'https://services.growtradingacademy.com',
      market_api_url: 'https://services.growtradingacademy.com',
      ws_url: 'wss://services.growtradingacademy.com/ws/feed',
      feed_ws_url: 'wss://services.growtradingacademy.com/ws/feed',
    });

    expect(broker.server_url).toBe('https://services.growtradingacademy.com');
    expect(broker.market_api_url).toBe('https://services.growtradingacademy.com');
    expect(broker.ws_url).toBe('wss://services.growtradingacademy.com/ws/v2');
    expect(broker.feed_url).toBe('wss://services.growtradingacademy.com/ws/feed');
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
