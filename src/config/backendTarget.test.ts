import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getBackendTarget,
  getRuntimeConfiguredBrokerId,
  getRuntimeDiscoveryBaseUrl,
  isDesktopBackendTarget,
  normalizeBrokerInfoForTarget,
  resolveBrokerBackendUrl,
  resolveBrokerExtApiUrl,
  resolveBrokerWsUrl,
} from './backendTarget.js';

type RuntimeWindow = Omit<Window, 'electron' | 'electronAPI'> & {
  electron?: { window?: unknown };
  electronAPI?: unknown;
  RUNTIME_CONFIG?: Record<string, unknown>;
  __RTX_RUNTIME_CONFIG__?: Record<string, unknown>;
};

const runtimeWindow = window as RuntimeWindow;
const backendTargetSourcePath = resolve(process.cwd(), 'src/config/backendTarget.js');

// Routing fixtures are complete deployments; malformed cases below bypass this helper.
const completeWebFixture = (config: Record<string, unknown>) => {
  const api = String(config.API_HOST || '')
  return {
    ...(api ? { BROKER_ID: 'fixture-broker', DEFAULT_MT5_SERVER: 'Fixture Server', WS_HOST: api.replace(/^http/, 'ws').replace(/\/+$/, '') } : {}),
    ...config,
  }
}


describe('backend target resolver', () => {
  it('uses the dedicated Nexa HTTPS origin without falling back to the shared broker', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = completeWebFixture({
      BACKEND_TARGET: 'web', BROKER_ID: 'Nexa',
      API_HOST: 'https://nexa.orrnn.com',
      WS_HOST: 'wss://nexa.orrnn.com',
    });
    expect(getBackendTarget()).toBe('https://nexa.orrnn.com');
    expect(getRuntimeConfiguredBrokerId()).toBe('Nexa');
    expect(resolveBrokerWsUrl({}, '/ws/feed')).toBe('wss://nexa.orrnn.com/ws/feed');
  });
  beforeEach(() => {
    delete runtimeWindow.electron;
    delete runtimeWindow.electronAPI;
    delete runtimeWindow.RUNTIME_CONFIG;
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('leaves browser routing unavailable without configuration or usable backend metadata', () => {
    expect(isDesktopBackendTarget()).toBe(false);
    expect(getBackendTarget()).toBe('');
    expect(resolveBrokerBackendUrl({
      broker_id: 'gta_broker',
      server_ip: '103.91.186.142',
      server_port: 8091,
      backend_url: 'http://103.91.186.142:8091',
    })).toBe('');
  });

  it('keeps configured web routing authoritative over stale broker metadata', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = completeWebFixture({ API_HOST: 'https://configured.example' });
    const broker = normalizeBrokerInfoForTarget({
      broker_id: 'gta_broker',
      public_backend_url: 'https://webterminal.growtradingacademy.com/',
      public_ext_api_url: 'https://manager.growtradingacademy.com/ext',
      public_ws_url: 'wss://admin.growtradingacademy.com/ws/v2',
      backend_url: 'http://103.91.186.142:8091',
      ws_url: 'ws://103.91.186.142:8091/ws/v2',
    });

    expect(broker.server_url).toBe('https://configured.example');
    expect(broker.market_api_url).toBe('https://configured.example');
    expect(broker.ws_url).toBe('wss://configured.example/ws/v2');
    expect(broker.feed_url).toBe('wss://configured.example/ws/feed');
  });

  it('uses safe runtime broker API and derives web websocket paths from runtime WS origin', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = completeWebFixture({
      BACKEND_TARGET: 'web',
      API_HOST: 'https://services.growtradingacademy.com/',
      WS_HOST: 'wss://services.growtradingacademy.com',
    });

    expect(getBackendTarget()).toBe('https://services.growtradingacademy.com');
    expect(resolveBrokerWsUrl({}, '/ws/v2')).toBe('wss://services.growtradingacademy.com/ws/v2');
    expect(resolveBrokerWsUrl({}, '/ws/feed')).toBe('wss://services.growtradingacademy.com/ws/feed');
  });

  it('routes Trivanta public APIs and quote sockets to its configured backend', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = completeWebFixture({
      BACKEND_TARGET: 'web',
      BROKER_ID: 'trivanta-markets',
      API_HOST: 'https://trivanta.orrnn.com',
      WS_HOST: 'wss://trivanta.orrnn.com',
      DISCOVERY_BASE_URL: 'https://superadmin-prod.orrnn.com',
    });

    expect(getBackendTarget()).toBe('https://trivanta.orrnn.com');
    expect(resolveBrokerWsUrl({}, '/ws/v2')).toBe('wss://trivanta.orrnn.com/ws/v2');
    expect(resolveBrokerWsUrl({}, '/ws/feed')).toBe('wss://trivanta.orrnn.com/ws/feed');
    expect(getRuntimeDiscoveryBaseUrl()).toBe('https://superadmin-prod.orrnn.com');
  });

  it('keeps the selected broker authoritative in Electron even when the web runtime script is present', () => {
    runtimeWindow.electron = { window: {} };
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = completeWebFixture({
      BACKEND_TARGET: 'web',
      API_HOST: 'https://services.growtradingacademy.com',
      WS_HOST: 'wss://services.growtradingacademy.com',
    });

    expect(isDesktopBackendTarget()).toBe(true);
    expect(resolveBrokerBackendUrl({
      broker_id: 'achiever-financials',
      server_url: 'https://service.achieverfinancials.com',
      feed_url: 'wss://service.achieverfinancials.com/ws/feed',
    })).toBe('https://service.achieverfinancials.com');
  });

  it('routes Nexa web API and websockets to Nexa while keeping superadmin discovery separate', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = completeWebFixture({
      BACKEND_TARGET: 'web',
      BROKER_ID: 'Nexa',
      API_HOST: 'https://nexa.orrnn.com',
      API_HOST_EXT: 'https://nexa.orrnn.com',
      WS_HOST: 'wss://nexa.orrnn.com',
      DISCOVERY_BASE_URL: 'https://fxtrustsuperbackned.orrnn.com',
      BROKER_DISCOVERY_URL: 'https://fxtrustsuperbackned.orrnn.com',
    });
    expect(getBackendTarget()).toBe('https://nexa.orrnn.com');
    expect(resolveBrokerBackendUrl({})).toBe('https://nexa.orrnn.com');
    expect(resolveBrokerExtApiUrl({})).toBe('https://nexa.orrnn.com');
    expect(resolveBrokerWsUrl({}, '/ws/v2')).toBe('wss://nexa.orrnn.com/ws/v2');
    expect(resolveBrokerWsUrl({}, '/ws/feed')).toBe('wss://nexa.orrnn.com/ws/feed');
    expect(getRuntimeDiscoveryBaseUrl()).toBe('https://fxtrustsuperbackned.orrnn.com');
  });

  it('uses the Electron mode API host when no selected broker has been persisted yet', () => {
    runtimeWindow.electron = { window: {} };
    vi.stubEnv('VITE_API_URL', 'https://fxtrustbrokerbackend.orrnn.com');
    vi.stubEnv('VITE_BACKEND_URL', 'https://fxtrustbrokerbackend.orrnn.com');

    expect(getBackendTarget()).toBe('https://fxtrustbrokerbackend.orrnn.com');
  });

  it('requires explicit discovery configuration for branded web brokers', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = completeWebFixture({
      BACKEND_TARGET: 'web',
      API_HOST: 'https://services.growtradingacademy.com/',
      WS_HOST: 'wss://services.growtradingacademy.com',
    });

    expect(getBackendTarget()).toBe('https://services.growtradingacademy.com');
    expect(getRuntimeDiscoveryBaseUrl()).toBe('');
  });

  it('accepts an explicitly configured catalog on the broker origin', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = completeWebFixture({
      BACKEND_TARGET: 'web',
      API_HOST: 'https://services.growtradingacademy.com',
      API_HOST_EXT: 'https://services.growtradingacademy.com',
      DISCOVERY_BASE_URL: 'https://services.growtradingacademy.com',
      WS_HOST: 'wss://services.growtradingacademy.com',
    });

    expect(getBackendTarget()).toBe('https://services.growtradingacademy.com');
    expect(getRuntimeDiscoveryBaseUrl()).toBe('https://services.growtradingacademy.com');
  });

  it('accepts ORRNN test broker public runtime hosts in web mode', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = completeWebFixture({
      BACKEND_TARGET: 'web',
      API_HOST: 'https://testbrokerbackend.orrnn.com',
      WS_HOST: 'wss://testbrokerbackend.orrnn.com',
    });

    expect(getBackendTarget()).toBe('https://testbrokerbackend.orrnn.com');
    expect(resolveBrokerWsUrl({}, '/ws/v2')).toBe('wss://testbrokerbackend.orrnn.com/ws/v2');
    expect(resolveBrokerWsUrl({}, '/ws/feed')).toBe('wss://testbrokerbackend.orrnn.com/ws/feed');
  });

  it('accepts FX Trust broker public runtime hosts and FX Trust super-admin discovery', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = completeWebFixture({
      BACKEND_TARGET: 'web',
      API_HOST: 'https://fxtrustbrokerbackend.orrnn.com',
      WS_HOST: 'wss://fxtrustbrokerbackend.orrnn.com',
      DISCOVERY_BASE_URL: 'https://fxtrustsuperbackned.orrnn.com',
    });

    expect(getBackendTarget()).toBe('https://fxtrustbrokerbackend.orrnn.com');
    expect(resolveBrokerBackendUrl({})).toBe('https://fxtrustbrokerbackend.orrnn.com');
    expect(resolveBrokerWsUrl({}, '/ws/v2')).toBe('wss://fxtrustbrokerbackend.orrnn.com/ws/v2');
    expect(resolveBrokerWsUrl({}, '/ws/feed')).toBe('wss://fxtrustbrokerbackend.orrnn.com/ws/feed');
    expect(getRuntimeDiscoveryBaseUrl()).toBe('https://fxtrustsuperbackned.orrnn.com');
  });

  it('accepts Achiever service runtime API and websocket hosts while keeping shared discovery', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = completeWebFixture({
      BACKEND_TARGET: 'web',
      API_HOST: 'https://service.achieverfinancials.com',
      API_HOST_EXT: 'https://service.achieverfinancials.com',
      DISCOVERY_BASE_URL: 'https://superbackend.orrnn.com',
      WS_HOST: 'wss://service.achieverfinancials.com',
      FEED_BROKER_ID: 'achiever-financials',
    });

    expect(getBackendTarget()).toBe('https://service.achieverfinancials.com');
    expect(resolveBrokerWsUrl({}, '/ws/v2')).toBe('wss://service.achieverfinancials.com/ws/v2');
    expect(resolveBrokerWsUrl({}, '/ws/feed')).toBe('wss://service.achieverfinancials.com/ws/feed');
    expect(getRuntimeDiscoveryBaseUrl()).toBe('https://superbackend.orrnn.com');
  });

  it('does not read or expose feed broker tokens through build-time backend target env', () => {
    vi.stubEnv('VITE_FEED_BROKER_TOKEN', 'feed-secret');
    vi.stubEnv('FEED_BROKER_TOKEN', 'feed-secret');

    expect(getBackendTarget()).toBe('');
    expect(getRuntimeDiscoveryBaseUrl()).toBe('');
    expect(resolveBrokerWsUrl({}, '/ws/feed')).toBe('');

    const source = readFileSync(backendTargetSourcePath, 'utf8');
    expect(source).not.toMatch(/import\.meta\.env(?:\?\.)?\s*\[/);
    expect(source).not.toContain('VITE_FEED_BROKER_TOKEN');
    expect(source).not.toContain('FEED_BROKER_TOKEN');
  });

  it('resolves the configured broker id from runtime config, overriding build-time env', () => {
    vi.stubEnv('VITE_BROKER_ID', 'myprop-trade');
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = completeWebFixture({
      BACKEND_TARGET: 'web',
      BROKER_ID: 'achiever-financials',
      VITE_BROKER_ID: 'achiever-financials',
    });

    expect(getRuntimeConfiguredBrokerId()).toBe('achiever-financials');
  });

  it('falls back to build-time broker id env when no runtime config is injected', () => {
    vi.stubEnv('VITE_BROKER_ID', 'myprop-trade');

    expect(getRuntimeConfiguredBrokerId()).toBe('myprop-trade');
  });

  it('returns an empty broker id when neither runtime config nor env provides one', () => {
    expect(getRuntimeConfiguredBrokerId()).toBe('');
  });

  it('supports a new backend-provided broker without adding its domain to frontend code', () => {
    runtimeWindow.electron = { window: {} };
    const broker = normalizeBrokerInfoForTarget({
      broker_id: 'new-broker', broker_name: 'New Broker',
      server_url: 'https://new-broker.example',
      feed_ws_url: 'wss://quotes.new-broker.example/ws/feed',
    });
    expect(broker.server_url).toBe('https://new-broker.example');
    expect(broker.ws_url).toBe('wss://new-broker.example/ws/v2');
    expect(broker.feed_url).toBe('wss://quotes.new-broker.example/ws/feed');
    expect(broker.broker_server).toBe('New Broker');
  });

  it('accepts arbitrary secure runtime broker domains', () => {
    runtimeWindow.RUNTIME_CONFIG = completeWebFixture({
      API_HOST: 'https://new-broker.example', WS_HOST: 'wss://quotes.new-broker.example',
      BROKER_ALLOWED_ORIGINS: 'https://quotes.new-broker.example',
      DISCOVERY_BASE_URL: 'https://directory.example',
    });
    expect(getBackendTarget()).toBe('https://new-broker.example');
    expect(resolveBrokerWsUrl({}, '/ws/feed')).toBe('wss://quotes.new-broker.example/ws/feed');
    expect(getRuntimeDiscoveryBaseUrl()).toBe('https://directory.example');
  });

  it.each(['http://broker.example', 'https://127.0.0.1', 'https://user:pass@broker.example', 'wss://broker.example'])(
  'leaves unsafe or incorrect API target %s unavailable', (API_HOST) => {
    runtimeWindow.RUNTIME_CONFIG = { API_HOST };
    expect(getBackendTarget()).toBe('');
    expect(resolveBrokerWsUrl({})).toBe('');
  });

  it('rejects unsafe runtime API and WS hosts in web mode', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = completeWebFixture({
      BACKEND_MODE: 'browser',
      API_HOST: 'http://insecure.example',
      WS_HOST: 'ws://69.197.178.27:8090',
    });

    expect(getBackendTarget()).toBe('');
    expect(resolveBrokerWsUrl({}, '/ws/v2')).toBe('');
  });

  it('honors uppercase runtime target and mode keys', () => {
    runtimeWindow.RUNTIME_CONFIG = { BACKEND_TARGET: 'desktop' };
    expect(isDesktopBackendTarget()).toBe(true);

    runtimeWindow.RUNTIME_CONFIG = { VITE_BACKEND_MODE: 'web' };
    expect(isDesktopBackendTarget()).toBe(false);
  });

  it('leaves desktop routing unavailable until configured or selected', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = completeWebFixture({ backendTarget: 'desktop' });
    expect(getBackendTarget()).toBe('');
    expect(resolveBrokerWsUrl({})).toBe('');
  });

  it('uses selected broker direct IP and port for desktop sessions', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = completeWebFixture({ backendTarget: 'desktop' });

    const broker = {
      broker_id: 'gta_broker',
      server_ip: '103.91.186.142',
      server_port: 8091,
      backend_url: 'http://103.91.186.142:8091',
      ws_url: 'ws://103.91.186.142:8091/ws/v2',
    };

    expect(isDesktopBackendTarget()).toBe(true);
    expect(getBackendTarget()).toBe('');
    expect(resolveBrokerBackendUrl(broker)).toBe('http://103.91.186.142:8091');
    expect(resolveBrokerExtApiUrl(broker)).toBe('http://103.91.186.142:8091');
    expect(resolveBrokerWsUrl(broker)).toBe('ws://103.91.186.142:8091/ws/v2');
  });

  it('prefers selected broker server_ip/server_port over stale desktop URL fields', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = completeWebFixture({ VITE_BACKEND_TARGET: 'desktop' });

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
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = completeWebFixture({ VITE_BACKEND_TARGET: 'desktop' });

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
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = completeWebFixture({ VITE_BACKEND_TARGET: 'desktop' });

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

  it('does not invent a desktop broker port when server_port is missing', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = completeWebFixture({ BACKEND_MODE: 'direct' });

    expect(resolveBrokerBackendUrl({
      broker_id: 'selected_broker',
      server_ip: '69.197.178.27',
      backend_url: 'http://103.91.186.142:8090',
    })).toBe('http://69.197.178.27');
  });
});
