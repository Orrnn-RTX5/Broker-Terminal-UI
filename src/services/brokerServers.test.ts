import { beforeEach, describe, expect, it } from 'vitest';

import {
  BROKER_SERVER_STORAGE_KEY,
  DEFAULT_BROKER_SERVER,
  getStoredBrokerServer,
  isDefaultBrokerServerValue,
  normalizeBrokerServers,
  persistBrokerServer,
  resolveLoginBrokerTarget,
} from './brokerServers';

type RuntimeWindow = Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };

describe('resolveLoginBrokerTarget', () => {
  beforeEach(() => {
    (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = { backendTarget: 'desktop' };
  });

  it('treats URL-like broker targets with hostnames as server values without requiring ports', () => {
    expect(resolveLoginBrokerTarget('https://example.com')).toEqual({
      displayValue: 'https://example.com',
      server: 'https://example.com',
    });

    expect(resolveLoginBrokerTarget('tcp://example.com')).toEqual({
      displayValue: 'tcp://example.com',
      server: 'tcp://example.com',
    });
  });

  it('keeps non-address broker ids as broker_id values', () => {
    expect(resolveLoginBrokerTarget('broker_3')).toEqual({
      displayValue: 'broker_3',
      broker_id: 'broker_3',
    });

    expect(resolveLoginBrokerTarget('broker_3/non-address')).toEqual({
      displayValue: 'broker_3/non-address',
      broker_id: 'broker_3/non-address',
    });
  });

  it('keeps bare host:port broker targets as server values', () => {
    expect(resolveLoginBrokerTarget('example.com:443')).toEqual({
      displayValue: 'example.com:443',
      server: 'example.com:443',
    });
  });

  it('resolves registered broker ids and names to broker_id plus direct server_url', () => {
    normalizeBrokerServers([{
      id: 1,
      broker_id: 'testorrnn',
      broker_name: 'Test Broker',
      server: 'TestBroker-Live',
      server_url: 'https://testbroker.example',
    }]);

    expect(resolveLoginBrokerTarget('testorrnn')).toEqual({
      displayValue: 'testorrnn',
      broker_id: 'testorrnn',
      server: 'https://testbroker.example',
    });

    expect(resolveLoginBrokerTarget('Test Broker')).toEqual({
      displayValue: 'Test Broker',
      broker_id: 'testorrnn',
      server: 'https://testbroker.example',
    });
  });
});

describe('white-label fallback server (T-ADD)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses a neutral, brand-free fallback (no tenant literals)', () => {
    expect(DEFAULT_BROKER_SERVER).toBe('Broker');
    expect(DEFAULT_BROKER_SERVER.toLowerCase()).not.toContain('rtx');
    expect(DEFAULT_BROKER_SERVER.toLowerCase()).not.toContain('terminal');
  });

  it('resolves empty input to the neutral fallback with no routing hints', () => {
    expect(resolveLoginBrokerTarget('')).toEqual({ displayValue: 'Broker' });
    expect(resolveLoginBrokerTarget('   ')).toEqual({ displayValue: 'Broker' });
  });

  it('passes unknown labels through with no routing hints (no brand list)', () => {
    expect(resolveLoginBrokerTarget('Retired Default Server')).toEqual({
      displayValue: 'Retired Default Server',
      broker_id: 'Retired Default Server',
    });
    expect(isDefaultBrokerServerValue('Retired Default Server')).toBe(false);
  });

  it('still recognizes the neutral fallback and rejects real server names', () => {
    expect(isDefaultBrokerServerValue('Broker')).toBe(true);
    expect(isDefaultBrokerServerValue('broker_3')).toBe(false);
    expect(isDefaultBrokerServerValue('MetaQuotes-Demo')).toBe(false);
    expect(isDefaultBrokerServerValue('example.com:443')).toBe(false);
    expect(isDefaultBrokerServerValue('')).toBe(false);
  });

  it('reads an empty store as neutral and keeps runtime-listed servers intact', () => {
    expect(getStoredBrokerServer()).toBe('Broker');
    (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      BROKER_ID: 'acme',
      DEFAULT_MT5_SERVER: 'Acme-Live',
      API_HOST: 'https://acme.example.com',
    };
    try {
      localStorage.setItem(BROKER_SERVER_STORAGE_KEY, 'Acme-Live');
      expect(getStoredBrokerServer()).toBe('Acme-Live');
    } finally {
      delete (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__;
      localStorage.clear();
    }
  });

  it('discards stored servers outside the runtime list, using first configured (ds-16)', () => {
    localStorage.setItem(BROKER_SERVER_STORAGE_KEY, 'Some Stale Server');
    expect(getStoredBrokerServer()).toBe('Broker');
    (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      BROKER_ID: 'acme',
      DEFAULT_MT5_SERVER: 'Acme-Live',
      API_HOST: 'https://acme.example.com',
    };
    try {
      localStorage.setItem(BROKER_SERVER_STORAGE_KEY, 'Some Stale Server');
      expect(getStoredBrokerServer()).toBe('Acme-Live');
    } finally {
      delete (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__;
      localStorage.clear();
    }
  });

  it('persists empty input as the neutral fallback', () => {
    expect(persistBrokerServer('')).toBe('Broker');
    expect(localStorage.getItem(BROKER_SERVER_STORAGE_KEY)).toBe('Broker');
  });
});
