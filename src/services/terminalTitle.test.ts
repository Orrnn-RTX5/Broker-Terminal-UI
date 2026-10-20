import { afterEach, describe, expect, it } from 'vitest';
import {
  formatTerminalTitle,
  getWebTerminalTitle,
} from '../hooks/useTerminalTitle';

type RuntimeWindow = Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };

const setRuntimeBroker = (brokerName: string) => {
  (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = {
    BACKEND_TARGET: 'web',
    BROKER_ID: 'acme',
    BROKER_NAME: brokerName,
    API_HOST: 'https://acme.example.com',
  };
};

afterEach(() => {
  delete (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__;
});

describe('white-label terminal title (ds-16)', () => {
  it('resolves the broker title from broker config with a neutral fallback', () => {
    setRuntimeBroker('Acme Trading');
    expect(getWebTerminalTitle()).toBe('Acme Trading');

    delete (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__;
    expect(getWebTerminalTitle()).toBe('Web Terminal');
    expect(getWebTerminalTitle()).not.toMatch(/RTX/);
  });

  it('prefixes the status title with the broker title, never a vendor default', () => {
    setRuntimeBroker('Acme Trading');
    const title = formatTerminalTitle(
      { accountId: '100043', brokerName: 'Acme Trading', marginMode: 'Hedge' },
      'EURUSD',
      'm15',
    );
    expect(title.startsWith('Acme Trading - 100043 - Acme Trading - Hedge - EURUSD,M15')).toBe(true);
    expect(title).not.toMatch(/RTX/);

    delete (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__;
    const fallback = formatTerminalTitle(
      { accountId: '100043', brokerName: 'Acme Trading', marginMode: 'Hedge' },
      'EURUSD',
      'm15',
    );
    expect(fallback.startsWith('Web Terminal - ')).toBe(true);
    expect(fallback).not.toMatch(/RTX/);
  });
});
