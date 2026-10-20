// @vitest-environment jsdom
/**
 * brokerConfigWarmup — App broker-config effect coverage (ds-7 REVIEW-B W).
 *
 * - fetch resolves live → the shared normalization sees the live document.
 * - fetch rejects → the normalization sees null (neutral fallbacks) and no
 *   rejection escapes the effect.
 * - unmount before settle → no post-teardown work and no React state warning.
 *
 * No live network: api.config.getConfig is mocked. No broker literals: the
 * live payload is a shape fixture, asserted by identity, never by value.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../services/api';
import { normalizeBrokerOperationalConfig } from '../services/brokerOperationalConfig';
import { useBrokerConfigWarmup } from './brokerConfigWarmup';

vi.mock('../services/api', () => ({
  api: { config: { getConfig: vi.fn() } },
}));

vi.mock('../services/brokerOperationalConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/brokerOperationalConfig')>();
  return { ...actual, normalizeBrokerOperationalConfig: vi.fn(actual.normalizeBrokerOperationalConfig) };
});

type ConfigResult = Awaited<ReturnType<typeof api.config.getConfig>>;
const getConfig = () => vi.mocked(api.config.getConfig);
const normalize = () => vi.mocked(normalizeBrokerOperationalConfig);

beforeEach(() => {
  getConfig().mockReset();
  normalize().mockClear();
});

afterEach(() => {
  cleanup();
});

describe('useBrokerConfigWarmup', () => {
  it('fetches once on mount and normalizes the live document', async () => {
    const live = { brokerName: 'Fixture Broker' } as ConfigResult;
    getConfig().mockResolvedValue(live);
    renderHook(() => useBrokerConfigWarmup());
    expect(getConfig()).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(normalize()).toHaveBeenCalledTimes(1);
    expect(normalize()).toHaveBeenCalledWith(live);
  });

  it('resolves a failed fetch to neutral without surfacing the rejection', async () => {
    getConfig().mockRejectedValue(new Error('offline'));
    renderHook(() => useBrokerConfigWarmup());
    await act(async () => {});
    expect(getConfig()).toHaveBeenCalledTimes(1);
    expect(normalize()).toHaveBeenCalledTimes(1);
    expect(normalize()).toHaveBeenCalledWith(null);
  });

  it('does no work after unmount before a successful fetch settles', async () => {
    let resolveFetch!: (value: ConfigResult) => void;
    getConfig().mockImplementation(() => new Promise<ConfigResult>((resolve) => { resolveFetch = resolve; }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { unmount } = renderHook(() => useBrokerConfigWarmup());
      unmount();
      resolveFetch({ brokerName: 'Late Broker' } as ConfigResult);
      await act(async () => {});
      expect(normalize()).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does no work after unmount before a failed fetch settles', async () => {
    let rejectFetch!: (reason: Error) => void;
    getConfig().mockImplementation(() => new Promise<ConfigResult>((_, reject) => { rejectFetch = reject; }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { unmount } = renderHook(() => useBrokerConfigWarmup());
      unmount();
      rejectFetch(new Error('offline'));
      await act(async () => {});
      expect(normalize()).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
