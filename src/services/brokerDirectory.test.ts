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
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => json(brokers)));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  it('unions extra Superadmin directories and published production brokers for desktop login', async () => {
    const extra = [{
      broker_id: 'achiever-financials',
      broker_name: 'Achiever Financials',
      server_url: 'https://service.achieverfinancials.com',
      enabled: true,
    }];
    vi.mocked(fetch).mockImplementation(url => String(url).startsWith('https://superbackend.orrnn.com')
      ? Promise.resolve(json(extra))
      : Promise.resolve(json(brokers)));
    const { loadAppBrokerDirectory, DESKTOP_PUBLISHED_BROKERS, mergeBrokerDirectories } = await import('./brokerDirectory');

    const merged = await loadAppBrokerDirectory({ desktop: true });
    expect(merged.map(row => row.broker_id)).toEqual([
      'broker-one',
      'achiever-financials',
      'gta_broker',
      'myprop-trade',
    ]);
    expect(fetch).toHaveBeenCalledWith('https://directory.test/api/v2/broker/servers', expect.anything());
    expect(fetch).toHaveBeenCalledWith('https://superbackend.orrnn.com/api/v2/broker/servers', expect.anything());
    expect(mergeBrokerDirectories([brokers, extra, DESKTOP_PUBLISHED_BROKERS]).map(row => row.broker_name))
      .toContain('Grow Trading Academy');
  });

  it('does not invent published brokers when the primary directory is empty', async () => {
    vi.mocked(fetch).mockResolvedValue(json([]));
    const { loadAppBrokerDirectory } = await import('./brokerDirectory');
    expect(await loadAppBrokerDirectory({ desktop: true })).toEqual([]);
  });

  it('keeps a successful primary directory when an extra Superadmin directory fails', async () => {
    vi.mocked(fetch).mockImplementation(url => String(url).startsWith('https://superbackend.orrnn.com')
      ? Promise.resolve(json({}, 503))
      : Promise.resolve(json(brokers)));
    const { loadAppBrokerDirectory } = await import('./brokerDirectory');
    const merged = await loadAppBrokerDirectory({ desktop: true });
    expect(merged.map(row => row.broker_id)).toEqual(['broker-one', 'achiever-financials', 'gta_broker', 'myprop-trade']);
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
