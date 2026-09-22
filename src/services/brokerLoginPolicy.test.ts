import { afterEach, describe, expect, it, vi } from 'vitest';

const runtimeWindow = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };

describe('broker login policy', () => {
  afterEach(() => {
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('locks a live terminal to the exact verified runtime/domain broker', async () => {
    vi.stubEnv('VITE_LOCAL_DESKTOP_BUILD', 'false');
    vi.stubEnv('VITE_BACKEND_TARGET', 'web');
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { BROKER_ID: 'broker-a' };
    vi.resetModules();
    const { resolveBrokerLoginPolicy } = await import('./brokerLoginPolicy');

    expect(resolveBrokerLoginPolicy([
      { broker_id: 'broker-a', broker_name: 'Broker A', webterminal_domain: 'terminal.broker-a.test' },
      { broker_id: 'broker-b', broker_name: 'Broker B', webterminal_domain: 'terminal.broker-b.test' },
    ], { hostname: 'terminal.broker-a.test' })).toMatchObject({
      status: 'ready', brokerId: 'broker-a', displayName: 'Broker A', local: false, locked: true,
    });
  });

  it('fails closed when the deployment URL and runtime broker disagree', async () => {
    vi.stubEnv('VITE_LOCAL_DESKTOP_BUILD', 'false');
    vi.stubEnv('VITE_BACKEND_TARGET', 'web');
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { BROKER_ID: 'broker-b' };
    vi.resetModules();
    const { resolveBrokerLoginPolicy } = await import('./brokerLoginPolicy');

    expect(resolveBrokerLoginPolicy([
      { broker_id: 'broker-a', broker_name: 'Broker A', webterminal_domain: 'terminal.broker-a.test' },
      { broker_id: 'broker-b', broker_name: 'Broker B' },
    ], { hostname: 'terminal.broker-a.test' })).toMatchObject({ status: 'error', brokerId: '' });
  });

  it('ignores path and query text because only the exact hostname is evaluated', async () => {
    vi.stubEnv('VITE_LOCAL_DESKTOP_BUILD', 'false');
    vi.stubEnv('VITE_BACKEND_TARGET', 'web');
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { BROKER_ID: 'broker-a' };
    vi.resetModules();
    const { resolveBrokerLoginPolicy } = await import('./brokerLoginPolicy');

    const policy = resolveBrokerLoginPolicy([
      { broker_id: 'broker-a', broker_name: 'Broker A', webterminal_domain: 'terminal.broker-a.test' },
      { broker_id: 'evil', broker_name: 'Evil', webterminal_domain: 'evil.test' },
    ], { hostname: 'terminal.broker-a.test' });
    expect(policy.brokerId).toBe('broker-a');
  });

  it.each(['localhost', '127.0.0.1', '[::1]', 'terminal.localhost'])('verifies Nexa by its API when a different broker lists the local page host %s', async (hostname) => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'desktop', BROKER_ID: 'Nexa', API_HOST: 'https://nexa.orrnn.com',
    };
    const { resolveBrokerLoginPolicy } = await import('./brokerLoginPolicy');
    expect(resolveBrokerLoginPolicy([
      { broker_id: 'localdemo', webterminal_domain: hostname, server_url: 'http://127.0.0.1:8090' },
      { broker_id: 'Nexa', broker_name: 'Nexa', webterminal_domain: 'nexa-terminal.orrnn.com', server_url: 'https://nexa.orrnn.com' },
    ], { hostname })).toMatchObject({ status: 'ready', brokerId: 'Nexa', locked: true });
  });

  it('still rejects a local terminal whose API belongs to another broker', async () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'desktop', BROKER_ID: 'Nexa', API_HOST: 'https://another-broker.test',
    };
    const { resolveBrokerLoginPolicy } = await import('./brokerLoginPolicy');
    expect(resolveBrokerLoginPolicy([
      { broker_id: 'another-broker', server_url: 'https://another-broker.test' },
      { broker_id: 'Nexa', server_url: 'https://nexa.orrnn.com' },
    ], { hostname: '127.0.0.1' })).toMatchObject({ status: 'error', brokerId: '' });
  });
});
