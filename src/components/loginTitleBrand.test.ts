import { afterEach, describe, expect, it } from 'vitest';
import { NEUTRAL_LOGIN_TITLE_BRAND, resolveLoginTitleBrandName } from './loginTitleBrand';

type RuntimeWindow = Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
const webConfig = (extra: Record<string, unknown> = {}) => {
  (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = {
    BACKEND_TARGET: 'web', BROKER_ID: 'fixture-broker', API_HOST: 'https://api.fixture.example',
    WS_HOST: 'wss://api.fixture.example', DEFAULT_MT5_SERVER: 'Fixture-Live', ...extra,
  };
};

afterEach(() => {
  delete (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__;
});

describe('login title brand text', () => {
  it('uses the selected broker display name', () => {
    expect(resolveLoginTitleBrandName('  Fixture Markets ')).toBe('Fixture Markets');
  });

  it('falls back to the configured deployment broker name', () => {
    webConfig({ BROKER_NAME: 'Fixture Markets' });
    expect(resolveLoginTitleBrandName('')).toBe('Fixture Markets');
    expect(resolveLoginTitleBrandName('https://api.fixture.example')).toBe('Fixture Markets');
  });

  it.each([undefined, '', 'Broker', 'https://api.fixture.example', 'fixture.example', 'RTX5 Terminal', 'RTX Terminal'])(
    'shows the neutral name for an unusable name %j without deployment config',
    (value) => {
      expect(resolveLoginTitleBrandName(value)).toBe(NEUTRAL_LOGIN_TITLE_BRAND);
      expect(NEUTRAL_LOGIN_TITLE_BRAND).toBe('Broker');
    },
  );
});
