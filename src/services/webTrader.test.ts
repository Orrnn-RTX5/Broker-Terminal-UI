import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCurrentWebTraderBrokerId,
  normalizeWebTraderUrl,
  openWebTrader,
  resolveWebTraderTarget,
} from './webTrader';

const discoveryResponse = (brokers: unknown[], status = 200): Response =>
  new Response(JSON.stringify({ servers: brokers }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('webTrader', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete window.electron;
  });

  it('normalizes declared domains to HTTPS and accepts only HTTP(S)', () => {
    expect(normalizeWebTraderUrl('trade.example.com')).toBe('https://trade.example.com');
    expect(normalizeWebTraderUrl('//trade.example.com/client')).toBe('https://trade.example.com/client');
    expect(normalizeWebTraderUrl('http://localhost:8080')).toBe('http://localhost:8080');
    expect(normalizeWebTraderUrl('ftp://trade.example.com')).toBeNull();
    expect(normalizeWebTraderUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeWebTraderUrl('https://user:pass@trade.example.com')).toBeNull();
  });

  it('uses persisted broker identity before the deployment runtime broker', () => {
    localStorage.setItem('broker_id', 'saved-broker');

    expect(getCurrentWebTraderBrokerId({ runtimeBrokerId: 'runtime-broker' })).toBe('saved-broker');
  });

  it('resolves the current broker declared Web Trader field from live discovery config', async () => {
    localStorage.setItem('rtx_broker_id', 'TEST');
    const fetcher = vi.fn().mockResolvedValue(discoveryResponse([
      { broker_id: 'other', broker_name: 'Other', webterminal_domain: 'other.example.com' },
      { broker_id: 'test', broker_name: 'Test Broker', web_terminal_url: 'terminal.test.example/path' },
    ]));

    const result = await resolveWebTraderTarget({
      discoveryUrl: 'https://directory.example/',
      fetcher,
      runtimeBrokerId: 'ignored-runtime',
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://directory.example/api/v2/broker/servers',
      { headers: { Accept: 'application/json' } },
    );
    expect(result).toEqual({
      status: 'ready',
      brokerId: 'TEST',
      brokerName: 'Test Broker',
      url: 'https://terminal.test.example/path',
      sourceField: 'web_terminal_url',
    });
  });

  it('resolves a nested broker-directory Web Trader domain', async () => {
    const result = await resolveWebTraderTarget({
      brokerId: 'test',
      fetcher: vi.fn().mockResolvedValue(discoveryResponse([
        {
          broker_id: 'test',
          broker_name: 'Test Broker',
          domains: { webterminal: 'web.test.example' },
        },
      ])),
      runtimeBrokerId: 'test',
      currentAppUrl: 'http://127.0.0.1:5173/',
    });

    expect(result).toMatchObject({
      status: 'ready',
      url: 'https://web.test.example',
      sourceField: 'domains.webterminal',
    });
  });

  it('uses the current browser app for the matching runtime broker when discovery has no URL', async () => {
    const result = await resolveWebTraderTarget({
      brokerId: 'TEST',
      fetcher: vi.fn().mockResolvedValue(discoveryResponse([
        { broker_id: 'test', broker_name: 'Test Broker', webterminal_domain: '' },
      ])),
      runtimeBrokerId: 'test',
      currentAppUrl: 'http://127.0.0.1:5173/terminal?ticket=42#chart',
      isElectronRuntime: false,
    });

    expect(result).toEqual({
      status: 'ready',
      brokerId: 'TEST',
      brokerName: 'Test Broker',
      url: 'http://127.0.0.1:5173/terminal',
      sourceField: 'current_app',
    });
  });

  it('does not use the current app for another broker or an Electron runtime', async () => {
    const fetcher = vi.fn().mockImplementation(async () => discoveryResponse([
      { broker_id: 'selected', broker_name: 'Selected Broker', webterminal_domain: '' },
    ]));

    const brokerMismatch = await resolveWebTraderTarget({
      brokerId: 'selected',
      fetcher,
      runtimeBrokerId: 'runtime-broker',
      currentAppUrl: 'https://runtime.example/',
      isElectronRuntime: false,
    });
    expect(brokerMismatch.status).toBe('url_not_configured');

    const electronRuntime = await resolveWebTraderTarget({
      brokerId: 'selected',
      fetcher,
      runtimeBrokerId: 'selected',
      currentAppUrl: 'https://runtime.example/',
      isElectronRuntime: true,
    });
    expect(electronRuntime.status).toBe('url_not_configured');
  });

  it('never treats the broker API server URL as a Web Trader URL', async () => {
    const result = await resolveWebTraderTarget({
      brokerId: 'test',
      fetcher: vi.fn().mockResolvedValue(discoveryResponse([
        {
          broker_id: 'test',
          broker_name: 'Test Broker',
          server_url: 'https://api.test.example',
          webterminal_domain: '',
        },
      ])),
      runtimeBrokerId: 'another-broker',
      currentAppUrl: 'https://runtime.example/',
    });

    expect(result.status).toBe('url_not_configured');
  });

  it('returns explicit statuses when the broker or its URL is unavailable', async () => {
    const noBroker = await resolveWebTraderTarget({
      brokerId: '',
      fetcher: vi.fn(),
      runtimeBrokerId: '',
    });
    expect(noBroker.status).toBe('broker_not_selected');

    const brokerMissing = await resolveWebTraderTarget({
      brokerId: 'missing',
      fetcher: vi.fn().mockResolvedValue(discoveryResponse([])),
    });
    expect(brokerMissing.status).toBe('broker_not_found');

    const urlMissing = await resolveWebTraderTarget({
      brokerId: 'test',
      fetcher: vi.fn().mockResolvedValue(discoveryResponse([
        { broker_id: 'test', broker_name: 'Test Broker', webterminal_domain: '' },
      ])),
    });
    expect(urlMissing).toMatchObject({
      status: 'url_not_configured',
      brokerId: 'test',
      brokerName: 'Test Broker',
    });

    const invalidUrl = await resolveWebTraderTarget({
      brokerId: 'test',
      fetcher: vi.fn().mockResolvedValue(discoveryResponse([
        { broker_id: 'test', broker_name: 'Test Broker', webterminal_domain: 'javascript:alert(1)' },
      ])),
    });
    expect(invalidUrl.status).toBe('invalid_url');
  });

  it('reports discovery failures without inventing a fallback site', async () => {
    const result = await resolveWebTraderTarget({
      brokerId: 'test',
      fetcher: vi.fn().mockResolvedValue(discoveryResponse([], 503)),
    });

    expect(result).toEqual({
      status: 'discovery_failed',
      brokerId: 'test',
      message: 'Broker discovery failed (503)',
    });
  });

  it('opens the resolved URL through Electron when available', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { shell: { openExternal } },
    });
    const fetcher = vi.fn().mockResolvedValue(discoveryResponse([
      { broker_id: 'test', broker_name: 'Test Broker', webterminal_domain: 'terminal.example.com' },
    ]));

    const result = await openWebTrader({ brokerId: 'test', fetcher });

    expect(openExternal).toHaveBeenCalledWith('https://terminal.example.com');
    expect(result).toMatchObject({
      status: 'opened',
      openedWith: 'electron',
      url: 'https://terminal.example.com',
    });
  });

  it('opens a no-opener browser tab and reports a blocked popup', async () => {
    const replace = vi.fn();
    const popup = { opener: window, location: { replace } } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    const fetcher = vi.fn().mockImplementation(async () => discoveryResponse([
      { broker_id: 'test', broker_name: 'Test Broker', webterminal_url: 'https://terminal.example.com' },
    ]));

    const opened = await openWebTrader({ brokerId: 'test', fetcher });
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(popup.opener).toBeNull();
    expect(replace).toHaveBeenCalledWith('https://terminal.example.com');
    expect(opened).toMatchObject({ status: 'opened', openedWith: 'browser' });

    open.mockReturnValue(null);
    const blocked = await openWebTrader({ brokerId: 'test', fetcher });
    expect(blocked).toMatchObject({ status: 'open_failed' });
  });
});
