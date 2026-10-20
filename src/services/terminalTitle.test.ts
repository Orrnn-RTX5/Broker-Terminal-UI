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

  it('shows each label once: broker name used, server label never repeated', () => {
    // Case A: configured display name — used once, repetitions dropped.
    setRuntimeBroker('Acme Trading');
    const configured = formatTerminalTitle(
      { accountId: '100043', brokerName: 'Acme Trading', marginMode: 'Hedge' },
      'EURUSD',
      'm15',
    );
    expect(configured).toBe('Acme Trading - 100043 - Hedge - EURUSD,M15');
    expect(configured).not.toMatch(/RTX/);

    // Case B: no display name — neutral prefix, server label exactly once.
    delete (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__;
    const fallback = formatTerminalTitle(
      { accountId: '100043', brokerName: 'local-dev', marginMode: 'Hedge' },
      'EURUSD',
      'm15',
    );
    expect(fallback).toBe('Web Terminal - 100043 - local-dev - Hedge - EURUSD,M15');
    expect(fallback.match(/local-dev/g)).toHaveLength(1);
    expect(fallback).not.toMatch(/RTX/);
  });
});
