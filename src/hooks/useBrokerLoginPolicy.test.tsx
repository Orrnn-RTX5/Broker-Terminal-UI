import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadBrokerDirectory } from '../services/brokerDirectory';
import type { BrokerDiscoveryItem } from '../services/brokerDiscovery';
import { useBrokerLoginPolicy } from './useBrokerLoginPolicy';

vi.mock('../services/brokerDirectory', () => ({ loadBrokerDirectory: vi.fn() }));

const runtimeWindow = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
const configuredBroker = (brokerId = 'Atlas') => ({
  CONFIG_SOURCE: 'deployment',
  BACKEND_TARGET: 'web',
  BROKER_ID: brokerId,
  API_HOST: `https://${brokerId.toLowerCase()}.example`,
  WS_HOST: `wss://${brokerId.toLowerCase()}.example`,
  DEFAULT_MT5_SERVER: `${brokerId}-Live`,
  DISCOVERY_BASE_URL: 'https://directory.example',
  BROKER_NAME: `${brokerId} Markets`,
});
const atlas: BrokerDiscoveryItem = {
  broker_id: 'Atlas', broker_name: 'Atlas Markets', server_url: 'https://atlas.example',
};
const deferredDirectory = () => {
  let resolve!: (rows: BrokerDiscoveryItem[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<BrokerDiscoveryItem[]>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('useBrokerLoginPolicy', () => {
  beforeEach(() => {
    localStorage.clear();
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = configuredBroker();
    vi.mocked(loadBrokerDirectory).mockReset().mockResolvedValue([atlas]);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('waits for configured discovery before allowing login', async () => {
    const directory = deferredDirectory();
    vi.mocked(loadBrokerDirectory).mockReturnValue(directory.promise);
    const { result } = renderHook(() => useBrokerLoginPolicy(true));

    expect(result.current).toBeNull();
    expect(loadBrokerDirectory).toHaveBeenCalledOnce();
    expect(loadBrokerDirectory).toHaveBeenCalledWith(expect.objectContaining({ forceRefresh: true }));

    await act(async () => directory.resolve([atlas]));

    expect(result.current).toMatchObject({
      status: 'ready', brokerId: 'Atlas', displayName: 'Atlas Markets', locked: true, local: false,
    });
  });

  it('does not request discovery while the dialog is closed', () => {
    renderHook(() => useBrokerLoginPolicy(false));
    expect(loadBrokerDirectory).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['missing API host', { API_HOST: '' }],
    ['missing broker identity', { BROKER_ID: '' }],
    ['missing MT5 server', { DEFAULT_MT5_SERVER: '' }],
    ['insecure discovery URL', { DISCOVERY_BASE_URL: 'http://directory.example' }],
    ['discovery URL with credentials', { DISCOVERY_BASE_URL: 'https://user:password@directory.example' }],
  ] satisfies Array<[string, Record<string, string>]>)('rejects %s before requesting discovery', (_description, invalidSettings) => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { ...configuredBroker(), ...invalidSettings };
    const { result } = renderHook(() => useBrokerLoginPolicy(true));

    expect(result.current).toMatchObject({ status: 'error', brokerId: '', locked: true });
    expect(result.current?.error).toBeTruthy();
    expect(loadBrokerDirectory).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses valid deployment configuration when no discovery catalog is configured', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { ...configuredBroker(), DISCOVERY_BASE_URL: '' };
    const { result } = renderHook(() => useBrokerLoginPolicy(true));

    expect(result.current).toMatchObject({ status: 'ready', brokerId: 'Atlas', locked: true });
    expect(loadBrokerDirectory).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty directory', []],
    ['a different broker', [{ broker_id: 'Beacon', broker_name: 'Beacon Markets', server_url: 'https://beacon.example' }]],
    ['a case-mismatched broker ID', [{ ...atlas, broker_id: 'atlas' }]],
  ] satisfies Array<[string, BrokerDiscoveryItem[]]>)('rejects %s when discovery is configured', async (_description, rows) => {
    vi.mocked(loadBrokerDirectory).mockResolvedValue(rows);
    const { result } = renderHook(() => useBrokerLoginPolicy(true));

    await waitFor(() => expect(result.current).toMatchObject({ status: 'error', brokerId: '' }));
    expect(result.current?.error).toBeTruthy();
  });

  it('keeps the pinned web broker when storage contains another broker session', async () => {
    localStorage.setItem('broker_id', 'Beacon');
    vi.mocked(loadBrokerDirectory).mockResolvedValue([
      { broker_id: 'Beacon', broker_name: 'Beacon Markets', server_url: 'https://beacon.example' },
      atlas,
    ]);
    const { result } = renderHook(() => useBrokerLoginPolicy(true));

    await waitFor(() => expect(result.current).toMatchObject({ status: 'ready', brokerId: 'Atlas' }));
  });

  it('reports a discovery failure without permitting login from runtime identity alone', async () => {
    vi.mocked(loadBrokerDirectory).mockRejectedValue(new Error('Directory unavailable'));
    const { result } = renderHook(() => useBrokerLoginPolicy(true));

    await waitFor(() => expect(result.current).toMatchObject({
      status: 'error', brokerId: '', error: 'Directory unavailable',
    }));
  });

  it('ignores discovery success after the dialog closes', async () => {
    const directory = deferredDirectory();
    vi.mocked(loadBrokerDirectory).mockReturnValue(directory.promise);
    const { result, rerender } = renderHook(({ active }) => useBrokerLoginPolicy(active), {
      initialProps: { active: true },
    });

    rerender({ active: false });
    await act(async () => directory.resolve([atlas]));

    expect(result.current?.status).not.toBe('ready');
  });

  it.each(['success', 'failure'] as const)('ignores a late %s from a previous opening', async (outcome) => {
    const previous = deferredDirectory();
    const current = deferredDirectory();
    vi.mocked(loadBrokerDirectory)
      .mockReturnValueOnce(previous.promise)
      .mockReturnValueOnce(current.promise);
    const { result, rerender } = renderHook(({ active }) => useBrokerLoginPolicy(active), {
      initialProps: { active: true },
    });

    rerender({ active: false });
    rerender({ active: true });
    expect(loadBrokerDirectory).toHaveBeenCalledTimes(2);
    await act(async () => current.resolve([{ ...atlas, broker_name: 'Current Atlas Markets' }]));
    expect(result.current).toMatchObject({ status: 'ready', displayName: 'Current Atlas Markets' });

    await act(async () => {
      if (outcome === 'success') previous.resolve([{ ...atlas, broker_name: 'Old Atlas Markets' }]);
      else previous.reject(new Error('Old request failed'));
    });

    expect(result.current).toMatchObject({ status: 'ready', displayName: 'Current Atlas Markets' });
  });

  it.each(['broker', 'API origin', 'discovery origin'] as const)(
    'clears the old ready policy and restarts discovery after the configured %s changes',
    async (changedField) => {
      const next = deferredDirectory();
      vi.mocked(loadBrokerDirectory).mockResolvedValueOnce([atlas]).mockReturnValueOnce(next.promise);
      const { result, rerender } = renderHook(() => useBrokerLoginPolicy(true));
      await waitFor(() => expect(result.current?.brokerId).toBe('Atlas'));

      const configuration = changedField === 'broker' ? configuredBroker('Beacon') : configuredBroker();
      if (changedField === 'API origin') {
        configuration.API_HOST = 'https://atlas-next.example';
        configuration.WS_HOST = 'wss://atlas-next.example';
      }
      if (changedField === 'discovery origin') configuration.DISCOVERY_BASE_URL = 'https://directory-next.example';
      runtimeWindow.__RTX_RUNTIME_CONFIG__ = configuration;
      rerender();

      expect(result.current).toBeNull();
      expect(loadBrokerDirectory).toHaveBeenCalledTimes(2);
      await act(async () => next.resolve([{
        broker_id: configuration.BROKER_ID,
        broker_name: 'Current deployment broker',
        server_url: configuration.API_HOST,
      }]));

      expect(result.current).toMatchObject({
        status: 'ready', brokerId: configuration.BROKER_ID, displayName: 'Current deployment broker',
      });
    },
  );

  it('rejects a late response when deployment configuration changes before another render', async () => {
    const previous = deferredDirectory();
    vi.mocked(loadBrokerDirectory).mockReturnValue(previous.promise);
    const { result } = renderHook(() => useBrokerLoginPolicy(true));

    runtimeWindow.__RTX_RUNTIME_CONFIG__ = configuredBroker('Beacon');
    await act(async () => previous.resolve([atlas]));

    expect(result.current).toBeNull();
  });
});
