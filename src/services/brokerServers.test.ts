import { describe, expect, it } from 'vitest';

import { resolveLoginBrokerTarget } from './brokerServers';

describe('resolveLoginBrokerTarget', () => {
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
});
