/**
 * Broker-published server name: per broker, display only.
 * Fixtures are neutral: no real broker, host or account literals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDesktopBackendTarget } from '../config/backendTarget.js';
import {
  clearKnownBrokerServerName,
  getKnownBrokerServerName,
  recordBrokerServerIdentity,
  resolveServerDisplayLabel,
} from './brokerServerIdentity';

type RuntimeWindow = Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };

const setRuntime = (extra: Record<string, unknown> = {}) => {
  (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = {
    CONFIG_SOURCE: 'build', BACKEND_TARGET: 'web', API_HOST: 'https://broker.example',
    API_HOST_EXT: 'https://broker.example', WS_HOST: 'wss://broker.example', BROKER_ID: 'broker-a',
    BROKER_NAME: '', DEFAULT_MT5_SERVER: 'build-fallback', DISCOVERY_BASE_URL: 'https://broker.example',
    ...extra,
  };
};

beforeEach(() => {
  localStorage.clear();
  clearKnownBrokerServerName();
  setRuntime();
});

afterEach(() => {
  clearKnownBrokerServerName();
  vi.unstubAllGlobals();
  delete (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__;
  localStorage.clear();
});

describe('broker server identity', () => {
  it('replaces only the build fallback, case-insensitively, once the broker name is known', () => {
    expect(resolveServerDisplayLabel('build-fallback')).toBe('build-fallback');
    recordBrokerServerIdentity({ server_name: 'Neutral Markets' });
    expect(resolveServerDisplayLabel('build-fallback')).toBe('Neutral Markets');
    expect(resolveServerDisplayLabel(' BUILD-FALLBACK ')).toBe('Neutral Markets');
    expect(resolveServerDisplayLabel('broker-a')).toBe('broker-a');
    expect(resolveServerDisplayLabel('')).toBe('');
  });

  it('selects the remembered /broker/servers entry of the current broker and ignores other brokers', () => {
    localStorage.setItem('rtx_broker_server', 'Neutral-Demo');
    const servers = [
      { broker_id: 'broker-b', server: 'Other-Live' },
      { broker_id: 'broker-a', server: 'Neutral-Live' },
      { broker_id: 'broker-a', server: 'Neutral-Demo' },
    ];
    expect(recordBrokerServerIdentity({}, servers)).toBe('Neutral-Demo');
    localStorage.setItem('rtx_broker_server', 'https://broker.example');
    expect(recordBrokerServerIdentity({}, servers)).toBe('Neutral-Live');
    clearKnownBrokerServerName();
    expect(recordBrokerServerIdentity({}, [{ broker_id: 'broker-b', server: 'Other-Live' }])).toBe('');
    expect(getKnownBrokerServerName()).toBe('');
  });

  it('ignores a config document published for another broker', () => {
    expect(recordBrokerServerIdentity({ broker_id: 'broker-b', server_name: 'Other Markets' })).toBe('');
    expect(getKnownBrokerServerName()).toBe('');
  });

  it('keeps names per selected broker on desktop, so one broker never labels another', () => {
    vi.stubGlobal('electronAPI', {});
    expect(isDesktopBackendTarget()).toBe(true);
    localStorage.setItem('broker_id', 'broker-b');
    recordBrokerServerIdentity({ server_name: 'Other Markets' });
    expect(getKnownBrokerServerName()).toBe('Other Markets');

    localStorage.setItem('broker_id', 'broker-a');
    expect(getKnownBrokerServerName()).toBe('');
    expect(resolveServerDisplayLabel('build-fallback')).toBe('build-fallback');
  });
});
