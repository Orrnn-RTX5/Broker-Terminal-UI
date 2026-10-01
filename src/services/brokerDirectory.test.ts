import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/api', () => ({ BROKER_DISCOVERY_URL: 'https://directory.test' }));

const brokers = [{
  broker_id: 'broker-one',
  broker_name: 'Broker One',
  server_url: 'https://one.example',
  enabled: true,
}];
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' },
});
const pending = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

describe('shared broker directory loading', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_BACKEND_TARGET', 'desktop');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json(brokers)));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('shares one in-flight request between preloading, opening, and forced login discovery', async () => {
    const response = pending<Response>();
    vi.mocked(fetch).mockReturnValue(response.promise);
    const { loadBrokerDirectory, getCachedBrokerDirectory } = await import('./brokerDirectory');

    const preload = loadBrokerDirectory();
    const openDialog = loadBrokerDirectory();
    const login = loadBrokerDirectory({ forceRefresh: true });
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('https://directory.test/api/v2/broker/servers', expect.objectContaining({
      signal: expect.any(AbortSignal),
      cache: 'no-store',
    }));
    expect(getCachedBrokerDirectory()).toBeNull();

    response.resolve(json({ data: { servers: brokers } }));
    expect(await Promise.all([preload, openDialog, login])).toEqual([brokers, brokers, brokers]);
    expect(getCachedBrokerDirectory()).toEqual(brokers);
    expect(await loadBrokerDirectory()).toEqual(brokers);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('expires results after five minutes and replaces changed routes with a fresh directory', async () => {
    vi.useFakeTimers();
    const { loadBrokerDirectory, getCachedBrokerDirectory, BROKER_DIRECTORY_CACHE_TTL_MS } = await import('./brokerDirectory');
    expect(BROKER_DIRECTORY_CACHE_TTL_MS).toBe(300_000);
    await loadBrokerDirectory();
    await vi.advanceTimersByTimeAsync(BROKER_DIRECTORY_CACHE_TTL_MS - 1);
    expect(getCachedBrokerDirectory()).toEqual(brokers);
    await vi.advanceTimersByTimeAsync(1);
    expect(getCachedBrokerDirectory()).toBeNull();

    const changed = [{ ...brokers[0], server_url: 'https://new-one.example' }];
    vi.mocked(fetch).mockResolvedValue(json(changed));
    expect(await loadBrokerDirectory()).toEqual(changed);
    expect(getCachedBrokerDirectory()).toEqual(changed);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('invalidates cached brokers during a forced refresh and preserves an authoritative empty result', async () => {
    const { loadBrokerDirectory, getCachedBrokerDirectory } = await import('./brokerDirectory');
    await loadBrokerDirectory();
    const refreshedResponse = pending<Response>();
    vi.mocked(fetch).mockReturnValue(refreshedResponse.promise);

    const refresh = loadBrokerDirectory({ forceRefresh: true });
    expect(getCachedBrokerDirectory()).toBeNull();
    const openDialog = loadBrokerDirectory();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);
    refreshedResponse.resolve(json([]));
    expect(await refresh).toEqual([]);
    expect(await openDialog).toEqual([]);
    expect(getCachedBrokerDirectory()).toEqual([]);
    expect(await loadBrokerDirectory()).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('isolates cached results and pending requests by discovery endpoint', async () => {
    const other = [{ ...brokers[0], broker_id: 'other', broker_name: 'Other Broker' }];
    const firstResponse = pending<Response>();
    const otherResponse = pending<Response>();
    vi.mocked(fetch).mockImplementation(url => String(url).startsWith('https://other-directory.test')
      ? otherResponse.promise
      : firstResponse.promise);
    const { loadBrokerDirectory, getCachedBrokerDirectory } = await import('./brokerDirectory');

    const first = loadBrokerDirectory();
    const second = loadBrokerDirectory({ discoveryUrl: 'https://other-directory.test/' });
    const sameSecond = loadBrokerDirectory({ discoveryUrl: 'https://other-directory.test' });
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);
    firstResponse.resolve(json(brokers));
    otherResponse.resolve(json(other));
    expect(await first).toEqual(brokers);
    expect(await second).toEqual(other);
    expect(await sameSecond).toEqual(other);
    expect(getCachedBrokerDirectory()).toEqual(brokers);
    expect(getCachedBrokerDirectory('https://other-directory.test')).toEqual(other);
  });

  it.each(['http', 'network', 'invalid-json'] as const)('does not retain old actionable brokers after a %s refresh failure and allows retry', async failure => {
    const { loadBrokerDirectory, getCachedBrokerDirectory } = await import('./brokerDirectory');
    await loadBrokerDirectory();
    if (failure === 'network') vi.mocked(fetch).mockRejectedValueOnce(new Error('Offline'));
    else if (failure === 'invalid-json') vi.mocked(fetch).mockResolvedValueOnce(new Response('{'));
    else vi.mocked(fetch).mockResolvedValueOnce(json({}, 503));

    await expect(loadBrokerDirectory({ forceRefresh: true })).rejects.toBeInstanceOf(Error);
    expect(getCachedBrokerDirectory()).toBeNull();
    expect(await loadBrokerDirectory()).toEqual(brokers);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('unions only backend rows from explicitly configured desktop directories', async () => {
    vi.stubEnv('VITE_EXTRA_BROKER_DISCOVERY_URLS', 'https://extra-directory.test');
    vi.stubEnv('VITE_BACKEND_TARGET', 'desktop');
    const extra = [{
      broker_id: 'achiever-financials',
      broker_name: 'Achiever Financials',
      server_url: 'https://service.achieverfinancials.com',
      enabled: true,
    }];
    vi.mocked(fetch).mockImplementation(url => String(url).startsWith('https://extra-directory.test')
      ? Promise.resolve(json(extra))
      : Promise.resolve(json(brokers)));
    const { loadAppBrokerDirectory, mergeBrokerDirectories } = await import('./brokerDirectory');

    const merged = await loadAppBrokerDirectory({ desktop: true });
    expect(merged.map(row => row.broker_id)).toEqual([
      'broker-one',
      'achiever-financials',
    ]);
    expect(fetch).toHaveBeenCalledWith('https://directory.test/api/v2/broker/servers', expect.anything());
    expect(fetch).toHaveBeenCalledWith('https://extra-directory.test/api/v2/broker/servers', expect.anything());
    expect(mergeBrokerDirectories([brokers, extra, extra]).map(row => row.broker_name))
      .toEqual(['Broker One', 'Achiever Financials']);
  });

  it.each([
    ['shared gateway', { broker_id: 'registered-two', broker_name: 'Broker Two', server_url: brokers[0].server_url }],
    ['shared name', { broker_id: 'registered-two', broker_name: brokers[0].broker_name, server_url: 'https://two.example' }],
    ['case-distinct ID', { broker_id: 'Broker-One', broker_name: 'Broker Two', server_url: 'https://two.example' }],
    ['name equal to another ID', { broker_id: 'registered-two', broker_name: brokers[0].broker_id, server_url: 'https://two.example' }],
  ])('keeps distinct registered backend IDs with a %s', async (_, other) => {
    const { mergeBrokerDirectories } = await import('./brokerDirectory');
    expect(mergeBrokerDirectories([brokers, [other]]).map(row => row.broker_id))
      .toEqual(['broker-one', other.broker_id]);
  });

  it('keeps the primary directory authority for repeated exact IDs without hiding separate brokers', async () => {
    const { mergeBrokerDirectories } = await import('./brokerDirectory');
    const primary = { ...brokers[0], enabled: false };
    const repeated = { ...brokers[0], server_url: 'https://replaced.example', enabled: true };
    const distinct = { ...brokers[0], broker_id: 'newly-registered' };
    expect(mergeBrokerDirectories([[primary], [repeated, distinct], [repeated]]))
      .toEqual([primary, distinct]);
  });

  it('does not merge ID-less legacy rows into registered identities or collapse distinct full tuples', async () => {
    const { mergeBrokerDirectories } = await import('./brokerDirectory');
    const legacy = { broker_name: brokers[0].broker_name, server_url: brokers[0].server_url };
    const otherLegacy = { ...legacy, broker_name: 'Another Name' };
    expect(mergeBrokerDirectories([[legacy], brokers, [otherLegacy, { ...legacy }, {}]]))
      .toEqual([legacy, brokers[0], otherLegacy]);
  });

  it('shows a newly backend-registered broker after refresh even when it shares a gateway and display name', async () => {
    vi.stubEnv('VITE_EXTRA_BROKER_DISCOVERY_URLS', 'https://extra-directory.test');
    let published = brokers;
    vi.mocked(fetch).mockImplementation(url => String(url).startsWith('https://extra-directory.test')
      ? Promise.resolve(json(brokers))
      : Promise.resolve(json({ data: { servers: published } })));
    const { loadAppBrokerDirectory } = await import('./brokerDirectory');
    expect((await loadAppBrokerDirectory({ desktop: true })).map(row => row.broker_id))
      .toEqual(['broker-one']);

    published = [...brokers, { ...brokers[0], broker_id: 'backend-registered-next' }];
    const refreshed = await loadAppBrokerDirectory({ desktop: true, forceRefresh: true });
    expect(refreshed.map(row => row.broker_id)).toEqual(['broker-one', 'backend-registered-next']);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('rejects stale discovery overrides and invalid deployment settings before any fetch', async () => {
    const runtime = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
    runtime.__RTX_RUNTIME_CONFIG__ = {
      CONFIG_SOURCE: 'deployment', BROKER_ID: 'Achiever',
      API_HOST: 'https://service.achiever.orrnn.com', WS_HOST: 'wss://service.achiever.orrnn.com',
      DEFAULT_MT5_SERVER: 'Achiever-Live', DISCOVERY_BASE_URL: 'https://catalog.achiever.example',
    };
    try {
      const { loadBrokerDirectory } = await import('./brokerDirectory');
      await expect(loadBrokerDirectory({ discoveryUrl: 'https://directory.test' })).rejects.toThrow(/does not match/);
      expect(fetch).not.toHaveBeenCalled();
      runtime.__RTX_RUNTIME_CONFIG__ = { CONFIG_SOURCE: 'deployment' };
      await expect(loadBrokerDirectory({ discoveryUrl: 'https://catalog.achiever.example' })).rejects.toThrow(/required/);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      delete runtime.__RTX_RUNTIME_CONFIG__;
    }
  });

  it('keeps valid local Vite discovery on the configured reverse proxy', async () => {
    const runtime = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
    runtime.__RTX_RUNTIME_CONFIG__ = {
      CONFIG_SOURCE: 'deployment', BROKER_ID: 'Achiever',
      API_HOST: 'https://service.achiever.orrnn.com', WS_HOST: 'wss://service.achiever.orrnn.com',
      DEFAULT_MT5_SERVER: 'Achiever-Live', DISCOVERY_BASE_URL: 'https://catalog.achiever.example',
    };
    vi.stubEnv('DEV', true);
    vi.stubEnv('MODE', 'web');
    try {
      const { loadBrokerDirectory, getCurrentBrokerDiscoveryUrl } = await import('./brokerDirectory');
      const proxyBase = '/__broker_discovery/https%3A%2F%2Fcatalog.achiever.example';
      expect(getCurrentBrokerDiscoveryUrl()).toBe(proxyBase);
      await loadBrokerDirectory();
      expect(fetch).toHaveBeenCalledWith(`${proxyBase}/api/v2/broker/servers`, expect.objectContaining({
        credentials: 'omit', redirect: 'error',
      }));
    } finally {
      delete runtime.__RTX_RUNTIME_CONFIG__;
    }
  });

  it('does not invent published brokers when the primary directory is empty', async () => {
    vi.mocked(fetch).mockResolvedValue(json([]));
    const { loadAppBrokerDirectory } = await import('./brokerDirectory');
    expect(await loadAppBrokerDirectory({ desktop: true })).toEqual([]);
  });

  it('does not request an implicit directory or append frontend brokers', async () => {
    const { loadAppBrokerDirectory } = await import('./brokerDirectory');
    expect(await loadAppBrokerDirectory({ desktop: true })).toEqual(brokers);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports missing discovery configuration without fetching a relative endpoint', async () => {
    const { loadBrokerDirectory, getCachedBrokerDirectory } = await import('./brokerDirectory');
    await expect(loadBrokerDirectory({ discoveryUrl: '' })).rejects.toThrow('not configured');
    expect(getCachedBrokerDirectory('')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps a successful primary directory when an extra Superadmin directory fails', async () => {
    vi.stubEnv('VITE_EXTRA_BROKER_DISCOVERY_URLS', 'https://extra-directory.test');
    vi.stubEnv('VITE_BACKEND_TARGET', 'desktop');
    vi.mocked(fetch).mockImplementation(url => String(url).startsWith('https://extra-directory.test')
      ? Promise.resolve(json({}, 503))
      : Promise.resolve(json(brokers)));
    const { loadAppBrokerDirectory } = await import('./brokerDirectory');
    const merged = await loadAppBrokerDirectory({ desktop: true });
    expect(merged.map(row => row.broker_id)).toEqual(['broker-one']);
  });

  it('times out an unresponsive fetch after ten seconds and ignores its late response after a successful retry', async () => {
    vi.useFakeTimers();
    const lateResponse = pending<Response>();
    vi.mocked(fetch).mockReturnValueOnce(lateResponse.promise);
    const { loadBrokerDirectory, getCachedBrokerDirectory, BROKER_DIRECTORY_TIMEOUT_MS } = await import('./brokerDirectory');
    expect(BROKER_DIRECTORY_TIMEOUT_MS).toBe(10_000);
    const first = loadBrokerDirectory();
    const rejected = expect(first).rejects.toBeInstanceOf(Error);
    await Promise.resolve();
    const requestSignal = vi.mocked(fetch).mock.calls[0][1]?.signal;

    await vi.advanceTimersByTimeAsync(BROKER_DIRECTORY_TIMEOUT_MS);
    await rejected;
    expect(requestSignal?.aborted).toBe(true);
    expect(getCachedBrokerDirectory()).toBeNull();

    const changed = [{ ...brokers[0], server_url: 'https://retry-one.example' }];
    vi.mocked(fetch).mockResolvedValue(json(changed));
    expect(await loadBrokerDirectory()).toEqual(changed);
    lateResponse.resolve(json(brokers));
    await vi.advanceTimersByTimeAsync(0);
    expect(getCachedBrokerDirectory()).toEqual(changed);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
