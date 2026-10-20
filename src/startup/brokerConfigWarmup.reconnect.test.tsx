// @vitest-environment jsdom
/**
 * Broker config while the API is unreachable: the warmup retries transport
 * failures with a capped exponential backoff and records the broker's server
 * name once the API answers, so the build fallback is replaced without a
 * page reload. Other failures keep the single-attempt neutral behaviour.
 *
 * Fixtures are neutral: no real broker, host or account literals.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../services/api';
import { ApiError } from '../api/client';
import { brokerDisplayName } from '../services/brokerDisplayName';
import { getWebTerminalTitle } from '../hooks/useTerminalTitle';
import { useBrokerConfigWarmup } from './brokerConfigWarmup';

vi.mock('../services/api', () => ({
  api: { config: { getConfig: vi.fn() } },
}));

type RuntimeWindow = Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
type ConfigResult = Awaited<ReturnType<typeof api.config.getConfig>>;
const getConfig = () => vi.mocked(api.config.getConfig);
const FALLBACK = 'local-dev';

const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const advance = async (ms: number) => {
  await act(async () => { vi.advanceTimersByTime(ms); await Promise.resolve(); });
  await flush();
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  getConfig().mockReset();
  (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = {
    CONFIG_SOURCE: 'build', BACKEND_TARGET: 'web', API_HOST: 'https://broker.example',
    API_HOST_EXT: 'https://broker.example', WS_HOST: 'wss://broker.example', BROKER_ID: 'example-broker',
    BROKER_NAME: '', DEFAULT_MT5_SERVER: FALLBACK, DISCOVERY_BASE_URL: 'https://broker.example',
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__;
  localStorage.clear();
});

describe('useBrokerConfigWarmup reconnect', () => {
  it('retries an unreachable API with backoff and shows the broker server name after recovery', async () => {
    getConfig()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new ApiError(0, 'Failed to fetch'))
      .mockResolvedValueOnce({ server_name: 'Example Markets' } as unknown as ConfigResult);

    renderHook(() => useBrokerConfigWarmup());
    await flush();
    expect(getConfig()).toHaveBeenCalledTimes(1);
    expect(brokerDisplayName(FALLBACK)).toBe(FALLBACK);

    await advance(999);
    expect(getConfig()).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(getConfig()).toHaveBeenCalledTimes(2);
    await advance(2000);
    expect(getConfig()).toHaveBeenCalledTimes(3);

    expect(brokerDisplayName(FALLBACK)).toBe('Example Markets');
    expect(getWebTerminalTitle()).toBe('Example Markets');
    await advance(120_000);
    expect(getConfig()).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-transport failure', async () => {
    getConfig().mockRejectedValue(new Error('offline'));
    renderHook(() => useBrokerConfigWarmup());
    await flush();
    await advance(120_000);
    expect(getConfig()).toHaveBeenCalledTimes(1);
    expect(brokerDisplayName(FALLBACK)).toBe(FALLBACK);
  });

  it('stops retrying after unmount', async () => {
    getConfig().mockRejectedValue(new TypeError('Failed to fetch'));
    const { unmount } = renderHook(() => useBrokerConfigWarmup());
    await flush();
    unmount();
    await advance(120_000);
    expect(getConfig()).toHaveBeenCalledTimes(1);
  });
});
