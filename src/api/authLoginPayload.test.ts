import { describe, expect, it } from 'vitest';
import { normalizeBrokerAuthLoginPayload } from './authLoginPayload';

describe('normalizeBrokerAuthLoginPayload', () => {
  it('serializes a numeric account ID with the backend login field', () => {
    expect(normalizeBrokerAuthLoginPayload({
      username: '200001',
      password: 'fixture-password',
      broker_id: 'TEST',
    })).toEqual({
      login: 200001,
      password: 'fixture-password',
      broker_id: 'TEST',
    });
  });

  it('preserves an explicit numeric login over other identity aliases', () => {
    expect(normalizeBrokerAuthLoginPayload({
      login: 200001,
      username: 'ignored-user',
      email: 'ignored@example.com',
      password: 'fixture-password',
    })).toEqual({
      login: 200001,
      password: 'fixture-password',
    });
  });

  it('keeps nonnumeric identities on the username contract', () => {
    expect(normalizeBrokerAuthLoginPayload({
      email: 'trader@example.com',
      password: 'fixture-password',
      broker_id: 'broker-a',
    })).toEqual({
      username: 'trader@example.com',
      password: 'fixture-password',
      broker_id: 'broker-a',
    });
  });
});
