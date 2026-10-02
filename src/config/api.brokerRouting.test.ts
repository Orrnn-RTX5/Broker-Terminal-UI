import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAdminUrl, buildApiUrl, buildApiV2Url, buildHistoryUrl, buildWsUrl, updateDynamicUrls } from './api';

const runtime = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
const configure = (origin = 'https://service.achiever.orrnn.com', brokerId = 'achiever') => {
  runtime.__RTX_RUNTIME_CONFIG__ = {
    CONFIG_SOURCE: 'deployment', BACKEND_TARGET: 'web', API_HOST: origin,
    WS_HOST: origin.replace(/^https:/, 'wss:'), BROKER_ID: brokerId,
    DEFAULT_MT5_SERVER: 'configured-trading-server',
  };
};

describe('current deployment URL builders before cached URL events', () => {
  beforeEach(() => {
    localStorage.clear();
    configure();
    updateDynamicUrls();
  });
  afterEach(() => {
    delete runtime.__RTX_RUNTIME_CONFIG__;
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('uses the current deployment even before updateDynamicUrls is called on a switch', () => {
    configure('https://api.unrelated.example', 'unrelated');
    expect(buildApiUrl('/api/login')).toBe('https://api.unrelated.example/api/login');
    expect(buildApiV2Url('/orders')).toBe('https://api.unrelated.example/api/v2/orders');
    expect(buildHistoryUrl('/deals')).toBe('https://api.unrelated.example/history/deals');
    expect(buildAdminUrl('/api/admin')).toBe('https://api.unrelated.example/api/admin');
    expect(buildWsUrl('/ws/v2')).toBe('wss://api.unrelated.example/ws/v2');
    expect(buildWsUrl('ws/feed')).toBe('wss://api.unrelated.example/ws/feed');
  });

  it.each([buildApiUrl, buildApiV2Url, buildHistoryUrl, buildAdminUrl])('rejects absolute stale/foreign destinations in HTTP builders', build => {
    expect(() => build('https://service.orrnn.com/api/v2/auth/login')).toThrow(/does not belong/);
    expect(() => build('https://foreign.example/api/v2/orders')).toThrow(/does not belong/);
    expect(() => build('https://user:secret@service.achiever.orrnn.com/api/v2/orders')).toThrow(/does not belong/);
  });

  it('constructs socket paths once and rejects foreign socket destinations', () => {
    expect(buildWsUrl('/ws/v2')).toBe('wss://service.achiever.orrnn.com/ws/v2');
    expect(buildWsUrl('/ws/feed')).toBe('wss://service.achiever.orrnn.com/ws/feed');
    expect(() => buildWsUrl('wss://service.orrnn.com/ws/v2')).toThrow(/does not belong/);
  });

  it.each([buildApiUrl, buildApiV2Url, buildHistoryUrl, buildAdminUrl, buildWsUrl])('fails closed when the current configuration becomes missing', build => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    vi.stubGlobal('WebSocket', request);
    runtime.__RTX_RUNTIME_CONFIG__ = { CONFIG_SOURCE: 'deployment' };
    expect(() => build('/orders')).toThrow(/required/);
    expect(request).not.toHaveBeenCalled();
  });
});
