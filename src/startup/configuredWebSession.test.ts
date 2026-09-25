import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIGURED_WEB_SESSION_KEY, ensureConfiguredWebSession } from './configuredWebSession';
import { onSessionChange } from '../services/brokerSession';

const runtimeWindow = window as Window & {
  __RTX_RUNTIME_CONFIG__?: Record<string, unknown>;
  RUNTIME_CONFIG?: Record<string, unknown>;
  electronAPI?: unknown;
};
const TEST_URL = 'https://fxtrustbrokerbackend.orrnn.com';
const ACHIEVER_URL = 'https://service.achieverfinancials.com';
const configure = (brokerId = 'achiever-financials', apiUrl = ACHIEVER_URL) => {
  runtimeWindow.__RTX_RUNTIME_CONFIG__ = { BACKEND_TARGET: 'web', BROKER_ID: brokerId, API_HOST: apiUrl };
};
const storeSession = (brokerId = 'TEST', backendUrl = TEST_URL) => {
  localStorage.setItem('broker_id', brokerId);
  localStorage.setItem('server_url', backendUrl);
  localStorage.setItem('auth_token', 'old-access');
  localStorage.setItem('refresh_token', 'old-refresh');
  localStorage.setItem('rtx_last_login', '200001');
  localStorage.setItem('rtx_saved_username', '200001');
  localStorage.setItem('rtx_last_authenticated_broker_id', brokerId);
  localStorage.setItem('feed_broker_id', brokerId);
  sessionStorage.setItem('auth_token', 'session-access');
  sessionStorage.setItem('feed_broker_id', brokerId);
};

describe('configured web broker session ownership', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete runtimeWindow.RUNTIME_CONFIG;
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
    delete runtimeWindow.electronAPI;
    vi.stubEnv('VITE_BROKER_ID', '');
    configure();
  });
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete runtimeWindow.RUNTIME_CONFIG;
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
    delete runtimeWindow.electronAPI;
    vi.unstubAllEnvs();
  });

  it('clears TEST credentials before opening Achiever on the same browser origin', () => {
    storeSession();
    localStorage.setItem('feed_url', 'wss://fxtrustbrokerbackend.orrnn.com/ws/feed');
    expect(ensureConfiguredWebSession()).toBe(false);
    for (const key of ['auth_token', 'refresh_token', 'rtx_saved_username', 'rtx_last_login', 'feed_broker_id', 'rtx_last_authenticated_broker_id']) {
      expect(localStorage.getItem(key)).toBeNull();
    }
    expect(sessionStorage.getItem('auth_token')).toBeNull();
    expect(sessionStorage.getItem('feed_broker_id')).toBeNull();
    expect(localStorage.getItem('broker_id')).toBe('achiever-financials');
    expect(localStorage.getItem('server_url')).toBe(ACHIEVER_URL);
    expect(localStorage.getItem('feed_url')).toBe('wss://service.achieverfinancials.com/ws/feed');
  });

  it('preserves matching legacy sessions and subsequent same-broker reloads', () => {
    storeSession('achiever-financials', `${ACHIEVER_URL}/`);
    expect(ensureConfiguredWebSession()).toBe(true);
    expect(ensureConfiguredWebSession()).toBe(true);
    expect(localStorage.getItem('auth_token')).toBe('old-access');
    expect(localStorage.getItem('refresh_token')).toBe('old-refresh');
    expect(localStorage.getItem('rtx_last_login')).toBe('200001');
  });

  it('retains GTA login credentials when deployment and authenticated broker ids use known aliases', () => {
    const gtaUrl = 'https://services.growtradingacademy.com';
    configure('grow-trading-academy', gtaUrl);
    storeSession('gta_broker', gtaUrl);
    expect(ensureConfiguredWebSession()).toBe(true);
    expect(ensureConfiguredWebSession()).toBe(true);
    expect(localStorage.getItem('auth_token')).toBe('old-access');
    expect(localStorage.getItem('broker_id')).toBe('gta_broker');
  });

  it('accepts a GTA login response after the deployment scope was initialized anonymously', () => {
    const gtaUrl = 'https://services.growtradingacademy.com';
    configure('grow-trading-academy', gtaUrl);
    expect(ensureConfiguredWebSession()).toBe(true);
    storeSession('gta_broker', gtaUrl);
    expect(ensureConfiguredWebSession()).toBe(true);
    expect(localStorage.getItem('auth_token')).toBe('old-access');
  });

  it('still rejects GTA aliases when the stored API host belongs to another broker', () => {
    configure('grow-trading-academy', 'https://services.growtradingacademy.com');
    storeSession('gta_broker', TEST_URL);
    expect(ensureConfiguredWebSession()).toBe(false);
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('rejects a changed API host even when the broker id stays the same', () => {
    configure('TEST', TEST_URL);
    storeSession();
    expect(ensureConfiguredWebSession()).toBe(true);
    configure('TEST', ACHIEVER_URL);
    expect(ensureConfiguredWebSession()).toBe(false);
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('rejects a changed broker id even when the API host stays the same', () => {
    configure('TEST', TEST_URL);
    storeSession();
    expect(ensureConfiguredWebSession()).toBe(true);
    configure('another-broker', TEST_URL);
    expect(ensureConfiguredWebSession()).toBe(false);
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('rejects another tab overwriting the broker session after deployment was selected', () => {
    expect(ensureConfiguredWebSession()).toBe(true);
    storeSession('TEST', ACHIEVER_URL);
    expect(ensureConfiguredWebSession()).toBe(false);
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('clears old credentials before broker transition listeners can observe the new routing', () => {
    storeSession();
    const tokensAtTransition: Array<string | null> = [];
    const unsubscribe = onSessionChange(() => tokensAtTransition.push(localStorage.getItem('auth_token')));
    try {
      expect(ensureConfiguredWebSession()).toBe(false);
      expect(tokensAtTransition.length).toBeGreaterThan(0);
      expect(tokensAtTransition.every((token) => token === null)).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it('retains preferences and saved accounts while removing the active persisted account', () => {
    storeSession();
    const savedAccounts = [{ login: 200001, server: 'FX Trust' }];
    localStorage.setItem('trading-app-storage', JSON.stringify({ version: 1, state: {
      accountId: '200001', isAuthenticated: true, authToken: 'legacy-token', savedAccounts,
      timeframe: 'M5', selectedSymbol: 'XAUUSD',
    } }));
    localStorage.setItem('i18nextLng', 'hi');
    localStorage.setItem('rtx5_chart_type', 'candles');
    expect(ensureConfiguredWebSession()).toBe(false);
    expect(JSON.parse(localStorage.getItem('trading-app-storage')!)).toEqual({ version: 1, state: {
      savedAccounts, timeframe: 'M5', selectedSymbol: 'XAUUSD',
    } });
    expect(localStorage.getItem('i18nextLng')).toBe('hi');
    expect(localStorage.getItem('rtx5_chart_type')).toBe('candles');
  });

  it('requires a fresh login for credentials without known broker ownership', () => {
    localStorage.setItem('auth_token', 'unscoped-access');
    expect(ensureConfiguredWebSession()).toBe(false);
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('does not bind or clear sessions without an explicit configured broker', () => {
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
    storeSession();
    expect(ensureConfiguredWebSession()).toBe(true);
    expect(localStorage.getItem('auth_token')).toBe('old-access');
    expect(localStorage.getItem(CONFIGURED_WEB_SESSION_KEY)).toBeNull();
  });

  it('preserves Electron broker selection even when web runtime configuration exists', () => {
    runtimeWindow.electronAPI = {};
    storeSession();
    expect(ensureConfiguredWebSession()).toBe(true);
    expect(localStorage.getItem('auth_token')).toBe('old-access');
    expect(localStorage.getItem('broker_id')).toBe('TEST');
    expect(localStorage.getItem(CONFIGURED_WEB_SESSION_KEY)).toBeNull();
  });
});
