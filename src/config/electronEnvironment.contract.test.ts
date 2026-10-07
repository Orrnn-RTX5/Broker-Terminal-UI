import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRuntimeBrokerConfiguration, getRuntimeDiscoveryBaseUrl, isDesktopBackendTarget } from './backendTarget.js';

const desktopEnvironment = {
  VITE_BACKEND_TARGET: 'electron',
  VITE_BACKEND_MODE: 'electron',
  VITE_API_HOST: 'https://backend.configured.example',
  VITE_WS_HOST: 'wss://backend.configured.example',
  VITE_BROKER_ID: 'configured-broker',
  VITE_DEFAULT_MT5_SERVER: 'Configured Broker Trading',
  VITE_USE_MOCK_DISCOVERY: 'false',
  VITE_BROKER_DISCOVERY_URL: 'https://directory.configured.example',
  VITE_DISCOVERY_BASE_URL: 'https://directory.configured.example',
  VITE_EXTRA_BROKER_DISCOVERY_URLS: 'https://secondary-directory.configured.example',
};

beforeEach(() => {
  vi.stubGlobal('window', { location: { protocol: 'file:' }, electron: { window: {} } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Electron broker directory environment', () => {
  it('uses the explicitly supplied runtime directory in Electron', () => {
    vi.stubGlobal('window', {
      location: { protocol: 'file:' }, electron: { window: {} },
      __RTX_RUNTIME_CONFIG__: desktopEnvironment,
    });
    expect(isDesktopBackendTarget()).toBe(true);
    expect(getRuntimeDiscoveryBaseUrl()).toBe(desktopEnvironment.VITE_DISCOVERY_BASE_URL);
    expect(getRuntimeBrokerConfiguration()).toMatchObject({
      valid: true, pinned: false, errors: [],
      extraDiscoveryUrls: [desktopEnvironment.VITE_EXTRA_BROKER_DISCOVERY_URLS],
    });
  });

  it('uses explicit build environment discovery without requiring a local env file', () => {
    Object.entries(desktopEnvironment).forEach(([key, value]) => vi.stubEnv(key, value));
    expect(isDesktopBackendTarget()).toBe(true);
    expect(getRuntimeDiscoveryBaseUrl()).toBe(desktopEnvironment.VITE_DISCOVERY_BASE_URL);
    expect(getRuntimeBrokerConfiguration()).toMatchObject({ valid: true, pinned: false, errors: [] });
  });

  it('leaves discovery unavailable when its environment is absent', () => {
    for (const key of ['VITE_DISCOVERY_BASE_URL', 'VITE_BROKER_DISCOVERY_URL', 'VITE_SHARED_DISCOVERY_BASE_URL']) {
      vi.stubEnv(key, '');
    }
    expect(isDesktopBackendTarget()).toBe(true);
    expect(getRuntimeDiscoveryBaseUrl()).toBe('');
    expect(getRuntimeBrokerConfiguration().extraDiscoveryUrls).toEqual([]);
  });
});
