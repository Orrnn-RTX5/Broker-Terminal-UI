import { afterEach, describe, expect, it, vi } from 'vitest';
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import viteConfig, { createBrokerProxyAccess, getBrokerProxyTargets, learnBrokerOrigins, parseDynamicProxyTarget, validateProxyTarget } from '../../vite.config';
import { resolveProxyAddresses } from '../../viteBrokerProxyAddress';

vi.mock('../../viteBrokerProxyAddress', async importOriginal => ({
  ...await importOriginal<typeof import('../../viteBrokerProxyAddress')>(),
  resolveProxyAddresses: vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]),
}));
const base = {
  API_HOST: 'https://service.achiever.orrnn.com', API_HOST_EXT: 'https://service.achiever.orrnn.com',
  WS_HOST: 'wss://service.achiever.orrnn.com', BROKER_ID: 'Achiever', DEFAULT_MT5_SERVER: 'Achiever Trading',
  DISCOVERY_BASE_URL: 'https://catalog.independent.example',
};
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe('canonical broker development proxy policy', () => {
  it.each(['https://service.achiever.orrnn.com', 'https://api.unrelated-financial.network', 'https://unknown-new-broker.example'])('accepts any configured broker %s without trusting compiled aliases', origin => {
    const env = { ...base, API_HOST: origin, API_HOST_EXT: origin, WS_HOST: origin.replace('https:', 'wss:'),
      VITE_RTX5_API_URL: 'https://service.orrnn.com', VITE_API_HOST: 'https://service.orrnn.com', VITE_WS_HOST: 'wss://service.orrnn.com' };
    expect(getBrokerProxyTargets(env).brokerApiTarget).toBe(origin);
    const access = createBrokerProxyAccess(env);
    expect(access.valid).toBe(true);
    expect(access.brokerOrigins.has(origin)).toBe(true);
    expect(access.trustedOrigins.has('https://service.orrnn.com')).toBe(false);
    expect(access.trustedOrigins.has(origin.replace('https:', 'http:'))).toBe(false);
  });
  it('accepts configured separate API and WS origins and every supported unprefixed family', () => {
    const env = { API_V2_URL: 'https://api.example', API_URL_EXT: 'https://accounts.example', RTX5_WS_URL: 'wss://quotes.example',
      BROKER_ID: 'new-broker', DEFAULT_MT5_SERVER: 'New Trading', BROKER_DISCOVERY_URL: 'https://catalog.example',
      BROKER_ALLOWED_ORIGINS: 'https://accounts.example,https://quotes.example' };
    expect(getBrokerProxyTargets(env)).toMatchObject({ valid: true, backendTarget: 'https://api.example', brokerApiTarget: 'https://accounts.example', wsTarget: 'wss://quotes.example', discoveryTarget: 'https://catalog.example' });
    expect([...createBrokerProxyAccess(env).brokerOrigins]).toEqual(['https://api.example', 'https://accounts.example', 'https://quotes.example']);
  });
  it.each([
    { API_HOST: '' }, { BROKER_ID: '' }, { DEFAULT_MT5_SERVER: '' },
    { API_HOST: 'https://user:password@service.achiever.orrnn.com' },
    { WS_HOST: 'ws://service.achiever.orrnn.com' }, { WS_HOST: 'wss://service.orrnn.com' },
  ])('blocks invalid pinned settings %j, including explicit dev exceptions', async invalid => {
    const env = { ...base, ...invalid, VITE_DEV_PROXY_ALLOWED_ORIGINS: 'https://service.orrnn.com' };
    const access = createBrokerProxyAccess(env);
    expect(access.valid).toBe(false);
    expect(access.trustedOrigins.size).toBe(0);
    expect(access.envAllowedOrigins.size).toBe(0);
    expect(getBrokerProxyTargets(env).brokerApiTarget).toBe('');
    expect(await validateProxyTarget(new URL('https://service.orrnn.com/api/v2/accounts'), access)).toMatchObject({ allowed: false });
    expect(resolveProxyAddresses).not.toHaveBeenCalled();
  });
  it('keeps catalog authority separate from broker credentials and preserves DNS validation', async () => {
    const access = createBrokerProxyAccess(base);
    expect(await validateProxyTarget(new URL(`${base.DISCOVERY_BASE_URL}/api/v2/broker/servers`), access)).toMatchObject({ allowed: false });
    expect(resolveProxyAddresses).not.toHaveBeenCalled();
    expect(await validateProxyTarget(new URL(`${base.DISCOVERY_BASE_URL}/api/v2/broker/servers`), access, 'discovery')).toMatchObject({ allowed: true });
    expect(resolveProxyAddresses).toHaveBeenCalledWith('catalog.independent.example', true);
  });
  it('requires an explicit dev allowlist before permitting private origins', async () => {
    const access = createBrokerProxyAccess({ ...base, DEV_PROXY_ALLOWED_ORIGINS: 'http://127.0.0.1:8100' });
    expect(await validateProxyTarget(new URL('http://127.0.0.1:8100/api/v2/instruments'), access)).toMatchObject({ allowed: true });
    expect(resolveProxyAddresses).toHaveBeenCalledWith('127.0.0.1', false);
    vi.clearAllMocks();
    expect(await validateProxyTarget(new URL('http://127.0.0.1:8200'), access)).toMatchObject({ allowed: false });
    expect(resolveProxyAddresses).not.toHaveBeenCalled();
  });
  it.each(['https://user:password@api.example', 'https://api.example/api', 'https://api.example?token=x', 'https://api.example#hash'])('rejects unsafe encoded proxy origin %s before forwarding credentials', origin => {
    expect(parseDynamicProxyTarget(`/__broker_api/${encodeURIComponent(origin)}/api/v2/accounts`, '/__broker_api')).toBeNull();
  });
  it('keeps query parameters in the request path while validating an origin-only destination', () => {
    const target = parseDynamicProxyTarget(`/__broker_api/${encodeURIComponent(base.API_HOST)}/api/v2/quotes?symbol=XAUUSD`, '/__broker_api');
    expect(target?.href).toBe(`${base.API_HOST}/api/v2/quotes?symbol=XAUUSD`);
  });
  it('learns only exact configured broker rows and never learns HTTP downgrades or suspended rows', () => {
    const access = createBrokerProxyAccess(base);
    learnBrokerOrigins(Buffer.from(JSON.stringify({ data: [
      { id: 'Orrnn', server_url: 'https://service.orrnn.com' },
      { broker_id: 'achiever', server_url: 'https://wrong-case.example' },
      { id: 'Achiever', server_url: 'https://matched-broker.example', ws_url: 'wss://matched-feed.example/ws/feed', backend_url: 'http://insecure.example' },
      { id: 'Achiever', server_url: 'https://suspended.example', active: false },
      { id: 'Achiever', server_url: 'https://private:secret@unsafe.example' },
    ] })), access);
    expect([...access.discoveredBrokerOrigins]).toEqual(['https://matched-broker.example', 'https://matched-feed.example']);
    learnBrokerOrigins(Buffer.from('not valid metadata'), access);
    expect(access.discoveredBrokerOrigins.size).toBe(0);
  });
  it('preserves the explicit desktop picker with validated public directory selections', () => {
    const access = createBrokerProxyAccess({ BACKEND_TARGET: 'desktop', DISCOVERY_BASE_URL: 'https://directory.example' });
    expect(access.valid).toBe(true);
    learnBrokerOrigins(Buffer.from(JSON.stringify([
      { id: 'broker-a', server_url: 'https://desktop-broker.example' },
      { id: 'broker-b', server_url: 'http://desktop-http.example' },
      { id: 'disabled', server_url: 'https://disabled.example', enabled: false },
      { id: 'invalid', server_url: 'https://credential:secret@unsafe.example' },
    ])), access);
    expect([...access.discoveredBrokerOrigins]).toEqual(['https://desktop-broker.example', 'http://desktop-http.example']);
  });
  it('keeps every static proxy on canonical targets with TLS verification enabled', async () => {
    for (const [name, value] of Object.entries({ ...base, VITE_RTX5_API_URL: 'https://service.orrnn.com' })) vi.stubEnv(name, value);
    if (typeof viteConfig !== 'function') throw new Error('Expected a Vite config factory');
    const config = await viteConfig({ mode: 'test', command: 'serve' });
    const proxies = config.server!.proxy!;
    expect((proxies['/__broker_api'] as { target: string }).target).toBe(base.API_HOST);
    for (const proxy of Object.values(proxies)) expect((proxy as { secure: boolean }).secure).toBe(true);
    const source = readFileSync(resolve('vite.config.ts'), 'utf8');
    expect(source).not.toMatch(/rejectUnauthorized:\s*false|secure:\s*false/);
  });
});
