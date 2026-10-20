import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The chart default is tenant configuration: deployment runtime config first,
// then build env, otherwise empty (the first authorized symbol is used).
type RuntimeWindow = Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };

const load = async () => {
  vi.resetModules();
  return import('./chartDefaults');
};

beforeEach(() => {
  vi.stubEnv('VITE_DEFAULT_CHART_SYMBOL', '');
  vi.stubEnv('VITE_DEFAULT_CHART_TIMEFRAME', '');
  vi.stubEnv('VITE_FIRST_PAINT_HISTORY_COUNT', '');
  delete (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__;
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__;
});

describe('tenant chart defaults', () => {
  it('ships no compiled-in market when nothing is configured', async () => {
    const defaults = await load();
    expect(defaults.DEFAULT_CHART_SYMBOL).toBe('');
    expect(defaults.DEFAULT_CHART_TIMEFRAME).toBe('M1');
    expect(defaults.FIRST_PAINT_HISTORY_COUNT).toBe(500);
  });

  it('reads the build env and normalizes the symbol', async () => {
    vi.stubEnv('VITE_DEFAULT_CHART_SYMBOL', 'eurusd');
    vi.stubEnv('VITE_DEFAULT_CHART_TIMEFRAME', 'h1');
    vi.stubEnv('VITE_FIRST_PAINT_HISTORY_COUNT', '250');
    const defaults = await load();
    expect(defaults.DEFAULT_CHART_SYMBOL).toBe('EURUSD');
    expect(defaults.DEFAULT_CHART_TIMEFRAME).toBe('H1');
    expect(defaults.FIRST_PAINT_HISTORY_COUNT).toBe(250);
  });

  it('prefers the deployment runtime config over the build env', async () => {
    vi.stubEnv('VITE_DEFAULT_CHART_SYMBOL', 'EURUSD');
    (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = {
      DEFAULT_CHART_SYMBOL: 'xauusd', DEFAULT_CHART_TIMEFRAME: 'M15', FIRST_PAINT_HISTORY_COUNT: '300',
    };
    const defaults = await load();
    expect(defaults.DEFAULT_CHART_SYMBOL).toBe('XAUUSD');
    expect(defaults.DEFAULT_CHART_TIMEFRAME).toBe('M15');
    expect(defaults.FIRST_PAINT_HISTORY_COUNT).toBe(300);
  });

  it.each(['https://evil.example/x', 'EUR USD', 'A'.repeat(21), '../BTC'])(
    'rejects a non-symbol value %j instead of opening it',
    async (value) => {
      (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = { DEFAULT_CHART_SYMBOL: value };
      const defaults = await load();
      expect(defaults.DEFAULT_CHART_SYMBOL).toBe('');
    },
  );

  it('falls back to generic technical defaults for invalid timeframe and count', async () => {
    (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = { DEFAULT_CHART_TIMEFRAME: 'M2', FIRST_PAINT_HISTORY_COUNT: '-5' };
    const defaults = await load();
    expect(defaults.DEFAULT_CHART_TIMEFRAME).toBe('M1');
    expect(defaults.FIRST_PAINT_HISTORY_COUNT).toBe(500);
  });
});
