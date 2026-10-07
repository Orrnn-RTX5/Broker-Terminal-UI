import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedBrokerDirectory, loadBrokerDirectory } from '../services/brokerDirectory';
import type { BrokerDiscoveryItem } from '../services/brokerDiscovery';
import { useBrokerLoginPolicy } from './useBrokerLoginPolicy';

vi.mock('../services/brokerDirectory', () => ({
  getCachedBrokerDirectory: vi.fn(), loadBrokerDirectory: vi.fn(),
}));

const runtimeWindow = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
const configuredBroker = (brokerId = 'Atlas') => ({
  CONFIG_SOURCE: 'deployment', BACKEND_TARGET: 'web', BROKER_ID: brokerId,
  API_HOST: `https://${brokerId.toLowerCase()}.example`,
  WS_HOST: `wss://${brokerId.toLowerCase()}.example`,
  DEFAULT_MT5_SERVER: `${brokerId}-Live`, DISCOVERY_BASE_URL: 'https://directory.example',
  BROKER_NAME: `${brokerId} Markets`,
});
const desktopBroker = () => ({ ...configuredBroker(), CONFIG_SOURCE: 'runtime', BACKEND_TARGET: 'desktop' });
const atlas: BrokerDiscoveryItem = {
  broker_id: 'Atlas', broker_name: 'Atlas Markets', server_url: 'https://atlas.example',
};
const beacon: BrokerDiscoveryItem = {
  broker_id: 'Beacon', broker_name: 'Beacon Markets', server_url: 'https://beacon.example',
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
    vi.mocked(getCachedBrokerDirectory).mockReset().mockReturnValue(null);
    vi.mocked(loadBrokerDirectory).mockReset().mockResolvedValue([atlas]);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('allows the exact validated web broker immediately while discovery is stalled', () => {
    vi.mocked(loadBrokerDirectory).mockReturnValue(deferredDirectory().promise);
    const { result } = renderHook(() => useBrokerLoginPolicy(true));
    expect(result.current).toMatchObject({
      status: 'ready', brokerId: 'Atlas', displayName: 'Atlas Markets', locked: true, local: false,
    });
    expect(loadBrokerDirectory).toHaveBeenCalledOnce();
    expect(loadBrokerDirectory).toHaveBeenCalledWith({
      discoveryUrl: 'https://directory.example', forceRefresh: false,
    });
  });

  it('uses fresh directory metadata synchronously without forcing another request', () => {
    vi.mocked(getCachedBrokerDirectory).mockReturnValue([{ ...atlas, broker_name: 'Verified Atlas' }]);
    vi.mocked(loadBrokerDirectory).mockReturnValue(deferredDirectory().promise);
    const { result } = renderHook(() => useBrokerLoginPolicy(true));
    expect(result.current).toMatchObject({ status: 'ready', brokerId: 'Atlas', displayName: 'Verified Atlas' });
    expect(getCachedBrokerDirectory).toHaveBeenCalledWith('https://directory.example');
    expect(loadBrokerDirectory).toHaveBeenCalledWith(expect.objectContaining({ forceRefresh: false }));
  });

  it('revokes older verified readiness when another dialog refreshes the shared cache', async () => {
    const { result, rerender } = renderHook(() => useBrokerLoginPolicy(true));
    await waitFor(() => expect(result.current?.status).toBe('ready'));
    vi.mocked(getCachedBrokerDirectory).mockReturnValue([{ ...atlas, enabled: false }]);
    rerender();
    expect(result.current).toMatchObject({ status: 'error', brokerId: '' });
    expect(result.current?.error).toMatch(/unavailable/i);
  });

  it.each([
    ['a suspended configured broker', [{ ...atlas, enabled: false }]],
    ['a directory without the configured identity', [beacon]],
    ['an authoritative empty directory', []],
  ] satisfies Array<[string, BrokerDiscoveryItem[]]>)('rejects cached %s immediately', (_description, rows) => {
    vi.mocked(getCachedBrokerDirectory).mockReturnValue(rows);
    vi.mocked(loadBrokerDirectory).mockReturnValue(deferredDirectory().promise);
    const { result } = renderHook(() => useBrokerLoginPolicy(true));
    expect(result.current).toMatchObject({ status: 'error', brokerId: '' });
    expect(result.current?.error).toBeTruthy();
  });

  it('does not request discovery or expose a policy while the dialog is closed', () => {
    const { result } = renderHook(() => useBrokerLoginPolicy(false));
    expect(result.current).toBeNull();
    expect(loadBrokerDirectory).not.toHaveBeenCalled();
    expect(getCachedBrokerDirectory).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['missing API host', { API_HOST: '' }],
    ['missing broker identity', { BROKER_ID: '' }],
    ['missing MT5 server', { DEFAULT_MT5_SERVER: '' }],
    ['insecure discovery URL', { DISCOVERY_BASE_URL: 'http://directory.example' }],
    ['discovery URL with credentials', { DISCOVERY_BASE_URL: 'https://user:password@directory.example' }],
    ['API URL with query text', { API_HOST: 'https://atlas.example?broker=other' }],
    ['unapproved secondary API origin', { API_HOST_EXT: 'https://other.example' }],
    ['unapproved websocket origin', { WS_HOST: 'wss://other.example' }],
  ] satisfies Array<[string, Record<string, string>]>)('rejects %s synchronously without requesting discovery', (_description, invalidSettings) => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { ...configuredBroker(), ...invalidSettings };
    const { result } = renderHook(() => useBrokerLoginPolicy(true));
    expect(result.current).toMatchObject({ status: 'error', brokerId: '', locked: true });
    expect(result.current?.error).toBeTruthy();
    expect(loadBrokerDirectory).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses valid web configuration without an optional discovery catalog', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { ...configuredBroker(), DISCOVERY_BASE_URL: '' };
    const { result } = renderHook(() => useBrokerLoginPolicy(true));
    expect(result.current).toMatchObject({ status: 'ready', brokerId: 'Atlas', locked: true });
    expect(loadBrokerDirectory).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty directory', []],
    ['a different broker', [beacon]],
    ['a case-mismatched broker ID', [{ ...atlas, broker_id: 'atlas' }]],
    ['a suspended configured broker', [{ ...atlas, enabled: false }]],
    ['a conflicting API owner', [{ ...atlas, server_url: 'https://atlas-other.example' }, { ...beacon, server_url: 'https://atlas.example' }]],
  ] satisfies Array<[string, BrokerDiscoveryItem[]]>)('revokes provisional readiness when discovery reports %s', async (_description, rows) => {
    const directory = deferredDirectory();
    vi.mocked(loadBrokerDirectory).mockReturnValue(directory.promise);
    const { result } = renderHook(() => useBrokerLoginPolicy(true));
    expect(result.current?.status).toBe('ready');
    await act(async () => directory.resolve(rows));
    expect(result.current).toMatchObject({ status: 'error', brokerId: '' });
    expect(result.current?.error).toBeTruthy();
  });

  it('keeps the exact pinned web broker despite another stored broker and a case-distinct row', async () => {
    localStorage.setItem('broker_id', 'Beacon');
    vi.mocked(loadBrokerDirectory).mockResolvedValue([{ ...atlas, broker_id: 'atlas' }, beacon, atlas]);
    const { result } = renderHook(() => useBrokerLoginPolicy(true));
    expect(result.current?.brokerId).toBe('Atlas');
    await waitFor(() => expect(result.current).toMatchObject({ status: 'ready', brokerId: 'Atlas' }));
  });

  it('reports background discovery failure instead of silently keeping provisional access', async () => {
    const directory = deferredDirectory();
    vi.mocked(loadBrokerDirectory).mockReturnValue(directory.promise);
    const { result } = renderHook(() => useBrokerLoginPolicy(true));
    expect(result.current?.status).toBe('ready');
    await act(async () => directory.reject(new Error('Directory unavailable')));
    expect(result.current).toMatchObject({ status: 'error', brokerId: '', error: 'Directory unavailable' });
  });

  it('stays ready immediately across closing and reopening while requests are pending', () => {
    vi.mocked(loadBrokerDirectory).mockReturnValue(deferredDirectory().promise);
    const { result, rerender } = renderHook(({ active }) => useBrokerLoginPolicy(active), {
      initialProps: { active: true },
    });
    expect(result.current?.brokerId).toBe('Atlas');
    rerender({ active: false });
    expect(result.current).toBeNull();
    rerender({ active: true });
    expect(result.current).toMatchObject({ status: 'ready', brokerId: 'Atlas' });
    expect(loadBrokerDirectory).toHaveBeenCalledTimes(2);
    expect(vi.mocked(loadBrokerDirectory).mock.calls.every(([options]) => options?.forceRefresh === false)).toBe(true);
  });

  it('keeps the verified web policy on reopening while the same deployment refreshes', async () => {
    vi.mocked(loadBrokerDirectory).mockResolvedValueOnce([{ ...atlas, broker_name: 'Verified Atlas' }])
      .mockReturnValueOnce(deferredDirectory().promise);
    const { result, rerender } = renderHook(({ active }) => useBrokerLoginPolicy(active), { initialProps: { active: true } });
    await waitFor(() => expect(result.current?.displayName).toBe('Verified Atlas'));
    rerender({ active: false });
    rerender({ active: true });
    expect(result.current).toMatchObject({ status: 'ready', brokerId: 'Atlas', displayName: 'Verified Atlas' });
  });

  it('ignores discovery success after the dialog closes', async () => {
    const directory = deferredDirectory();
    vi.mocked(loadBrokerDirectory).mockReturnValue(directory.promise);
    const { result, rerender } = renderHook(({ active }) => useBrokerLoginPolicy(active), {
      initialProps: { active: true },
    });
    rerender({ active: false });
    await act(async () => directory.resolve([atlas]));
    expect(result.current).toBeNull();
  });

  it.each(['success', 'failure'] as const)('ignores a late %s from a previous opening', async (outcome) => {
    const previous = deferredDirectory();
    const current = deferredDirectory();
    vi.mocked(loadBrokerDirectory).mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
    const { result, rerender } = renderHook(({ active }) => useBrokerLoginPolicy(active), {
      initialProps: { active: true },
    });
    rerender({ active: false });
    rerender({ active: true });
    expect(result.current?.status).toBe('ready');
    await act(async () => current.resolve([{ ...atlas, broker_name: 'Current Atlas' }]));
    await act(async () => {
      if (outcome === 'success') previous.resolve([{ ...atlas, broker_name: 'Old Atlas' }]);
      else previous.reject(new Error('Old request failed'));
    });
    expect(result.current).toMatchObject({ status: 'ready', brokerId: 'Atlas', displayName: 'Current Atlas' });
  });

  it.each(['broker', 'API origin', 'discovery origin'] as const)(
    'uses only the new validated policy while configured %s verification is pending',
    async (changedField) => {
      const next = deferredDirectory();
      vi.mocked(loadBrokerDirectory).mockResolvedValueOnce([{ ...atlas, broker_name: 'Old metadata' }]).mockReturnValueOnce(next.promise);
      const { result, rerender } = renderHook(() => useBrokerLoginPolicy(true));
      await waitFor(() => expect(result.current?.displayName).toBe('Old metadata'));
      const configuration = changedField === 'broker' ? configuredBroker('Beacon') : configuredBroker();
      if (changedField === 'API origin') {
        configuration.API_HOST = 'https://atlas-next.example';
        configuration.WS_HOST = 'wss://atlas-next.example';
      }
      if (changedField === 'discovery origin') configuration.DISCOVERY_BASE_URL = 'https://directory-next.example';
      runtimeWindow.__RTX_RUNTIME_CONFIG__ = configuration;
      rerender();
      expect(result.current).toMatchObject({ status: 'ready', brokerId: configuration.BROKER_ID, displayName: configuration.BROKER_NAME });
      expect(loadBrokerDirectory).toHaveBeenCalledTimes(2);
      await act(async () => next.resolve([{
        broker_id: configuration.BROKER_ID, broker_name: 'New metadata', server_url: configuration.API_HOST,
      }]));
      expect(result.current?.displayName).toBe('New metadata');
    },
  );

  it('rejects a late response after configuration changes before another render', async () => {
    const previous = deferredDirectory();
    const current = deferredDirectory();
    vi.mocked(loadBrokerDirectory).mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
    const { result, rerender } = renderHook(() => useBrokerLoginPolicy(true));
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = configuredBroker('Beacon');
    await act(async () => previous.resolve([{ ...atlas, broker_name: 'Stale result' }]));
    rerender();
    expect(result.current).toMatchObject({ status: 'ready', brokerId: 'Beacon', displayName: 'Beacon Markets' });
  });

  it('keeps desktop pending until actual directory verification completes', async () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = desktopBroker();
    const directory = deferredDirectory();
    vi.mocked(loadBrokerDirectory).mockReturnValue(directory.promise);
    const { result } = renderHook(() => useBrokerLoginPolicy(true));
    expect(result.current).toBeNull();
    await act(async () => directory.resolve([atlas]));
    expect(result.current).toMatchObject({ status: 'ready', brokerId: 'Atlas' });
  });

  it('never permits runtime-only desktop access when discovery fails', async () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = desktopBroker();
    const directory = deferredDirectory();
    vi.mocked(loadBrokerDirectory).mockReturnValue(directory.promise);
    const { result } = renderHook(() => useBrokerLoginPolicy(true));
    expect(result.current).toBeNull();
    await act(async () => directory.reject(new Error('Directory unavailable')));
    expect(result.current).toMatchObject({ status: 'error', brokerId: '', error: 'Directory unavailable' });
  });

  it('can immediately reuse a fresh verified desktop directory', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = desktopBroker();
    vi.mocked(getCachedBrokerDirectory).mockReturnValue([atlas]);
    vi.mocked(loadBrokerDirectory).mockReturnValue(deferredDirectory().promise);
    const { result } = renderHook(() => useBrokerLoginPolicy(true));
    expect(result.current).toMatchObject({ status: 'ready', brokerId: 'Atlas' });
  });

  it('clears desktop readiness on close so reopening cannot use expired verification', async () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = desktopBroker();
    vi.mocked(loadBrokerDirectory).mockResolvedValueOnce([atlas]).mockReturnValueOnce(deferredDirectory().promise);
    const { result, rerender } = renderHook(({ active }) => useBrokerLoginPolicy(active), { initialProps: { active: true } });
    await waitFor(() => expect(result.current?.status).toBe('ready'));
    rerender({ active: false });
    rerender({ active: true });
    expect(result.current).toBeNull();
  });

  it('does not fall back to runtime-only desktop access without a discovery catalog', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { ...desktopBroker(), DISCOVERY_BASE_URL: '' };
    const { result } = renderHook(() => useBrokerLoginPolicy(true));
    expect(result.current).toMatchObject({ status: 'error', brokerId: '' });
    expect(loadBrokerDirectory).not.toHaveBeenCalled();
  });

  it('invalidates verified desktop policy when its selected session broker changes', async () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = desktopBroker();
    const next = deferredDirectory();
    vi.mocked(loadBrokerDirectory).mockResolvedValueOnce([atlas, beacon]).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(() => useBrokerLoginPolicy(true));
    await waitFor(() => expect(result.current?.brokerId).toBe('Atlas'));
    localStorage.setItem('broker_id', 'Beacon');
    rerender();
    expect(result.current).toBeNull();
    await act(async () => next.resolve([atlas, beacon]));
    expect(result.current).toMatchObject({ status: 'ready', brokerId: 'Beacon' });
  });
});
