import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchEarlyPublicStartup } from './earlyPublicStartup';

const symbolsUrl = 'https://service.example/api/v1/market/symbols';

afterEach(() => {
  delete (window as Window & { __RTX_EARLY_PUBLIC_STARTUP__?: unknown }).__RTX_EARLY_PUBLIC_STARTUP__;
  vi.unstubAllGlobals();
});

describe('early public startup fetch', () => {
  it('uses the page request once when the URL matches and does not start another', async () => {
    const fetchMock = vi.fn(async () => new Response('{"symbols":[]}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const early = Promise.resolve(new Response(JSON.stringify({ symbols: [] }), { status: 200 }));
    (window as Window & { __RTX_EARLY_PUBLIC_STARTUP__?: unknown }).__RTX_EARLY_PUBLIC_STARTUP__ = {
      symbolsUrl,
      symbols: early,
    };

    const first = fetchEarlyPublicStartup('symbols', symbolsUrl, new AbortController().signal);
    const second = fetchEarlyPublicStartup('symbols', symbolsUrl, new AbortController().signal);

    await expect(first.then((response) => response.json())).resolves.toEqual({ symbols: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(symbolsUrl, {
      signal: expect.any(AbortSignal),
      credentials: 'omit',
      cache: 'no-store',
    });
    second.catch(() => undefined);
  });

  it('ignores an early request for a different address', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    (window as Window & { __RTX_EARLY_PUBLIC_STARTUP__?: unknown }).__RTX_EARLY_PUBLIC_STARTUP__ = {
      symbolsUrl: 'https://other.example/api/v1/market/symbols',
      symbols: Promise.resolve(new Response('{"symbols":[]}', { status: 200 })),
    };

    await fetchEarlyPublicStartup('symbols', symbolsUrl, new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an aborted caller without reading the early response', async () => {
    const controller = new AbortController();
    controller.abort();
    (window as Window & { __RTX_EARLY_PUBLIC_STARTUP__?: unknown }).__RTX_EARLY_PUBLIC_STARTUP__ = {
      symbolsUrl,
      symbols: Promise.resolve(new Response('{}', { status: 200 })),
    };

    await expect(fetchEarlyPublicStartup('symbols', symbolsUrl, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
