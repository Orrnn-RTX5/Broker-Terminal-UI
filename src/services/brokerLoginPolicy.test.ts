import { afterEach, describe, expect, it, vi } from 'vitest';

const webConfig = (brokerId: string) => ({ CONFIG_SOURCE: 'deployment', BROKER_ID: brokerId, API_HOST: brokerId === 'TEST' ? 'https://test-broker.example' : `https://${brokerId}.example`, WS_HOST: brokerId === 'TEST' ? 'wss://test-broker.example' : `wss://${brokerId}.example`, DEFAULT_MT5_SERVER: `${brokerId}-Live` });

const runtimeWindow = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };

describe('broker login policy', () => {
  it('selects the exact registered ID despite a case-distinct row arriving first', async () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = webConfig('Orrnn');
    const { resolveBrokerLoginPolicy } = await import('./brokerLoginPolicy');
    expect(resolveBrokerLoginPolicy([
      { broker_id: 'orrnn', broker_name: 'Other tenant' },
      { broker_id: 'Orrnn', broker_name: 'Orrnn' },
    ], { hostname: 'localhost' })).toMatchObject({ status: 'ready', brokerId: 'Orrnn' });
  });

  it('supports registered brokers sharing a gateway without directory-order selection', async () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = webConfig('broker-a');
    const { resolveBrokerLoginPolicy } = await import('./brokerLoginPolicy');
    const rows = [
      { broker_id: 'broker-b', broker_name: 'Other broker', server_url: 'https://broker-a.example' },
      { broker_id: 'broker-a', broker_name: 'Configured broker', server_url: 'https://broker-a.example' },
    ];
    expect(resolveBrokerLoginPolicy(rows, { hostname: 'localhost' })).toMatchObject({ status: 'ready', brokerId: 'broker-a' });
    expect(resolveBrokerLoginPolicy([...rows].reverse(), { hostname: 'localhost' })).toMatchObject({ status: 'ready', brokerId: 'broker-a' });
  });

  it('rejects a conflicting terminal hostname even if another row matches the API first', async () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = webConfig('broker-a');
    const { resolveBrokerLoginPolicy } = await import('./brokerLoginPolicy');
    expect(resolveBrokerLoginPolicy([
      { broker_id: 'broker-a', server_url: 'https://broker-a.example' },
      { broker_id: 'broker-b', webterminal_domain: 'terminal.other.example' },
    ], { hostname: 'terminal.other.example' })).toMatchObject({ status: 'error', brokerId: '' });
  });

  it('does not enable account access for a disabled configured broker', async () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = webConfig('broker-a');
    const { resolveBrokerLoginPolicy } = await import('./brokerLoginPolicy');
    expect(resolveBrokerLoginPolicy([{ broker_id: 'broker-a', enabled: false }], { hostname: 'localhost' }))
      .toMatchObject({ status: 'error', brokerId: '' });
  });
  afterEach(() => {
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
    localStorage.clear();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('ignores the stale active session broker in a pinned web deployment', async () => {
    vi.stubEnv('VITE_LOCAL_DESKTOP_BUILD', 'false');
    vi.stubEnv('VITE_BACKEND_TARGET', 'web');
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = webConfig('TEST');
    localStorage.setItem('broker_id', 'Nexa');
    vi.resetModules();
    const { resolveBrokerLoginPolicy } = await import('./brokerLoginPolicy');

    expect(resolveBrokerLoginPolicy([
      { broker_id: 'TEST', broker_name: 'TEST', server_url: 'https://test-broker.example' },
      { broker_id: 'Nexa', broker_name: 'Nexa', server_url: 'https://nexa.example' },
    ], { hostname: 'localhost' })).toMatchObject({
      status: 'ready', brokerId: 'TEST', displayName: 'TEST', locked: true,
    });
  });

  it('ignores a stored session broker that discovery does not list', async () => {
    vi.stubEnv('VITE_LOCAL_DESKTOP_BUILD', 'false');
    vi.stubEnv('VITE_BACKEND_TARGET', 'web');
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = webConfig('TEST');
    localStorage.setItem('broker_id', 'ghost-broker');
    vi.resetModules();
    const { resolveBrokerLoginPolicy } = await import('./brokerLoginPolicy');

    expect(resolveBrokerLoginPolicy([
      { broker_id: 'TEST', broker_name: 'TEST' },
    ], { hostname: 'localhost' })).toMatchObject({ status: 'ready', brokerId: 'TEST' });
  });

  it('keeps the deployment broker when saved session metadata names another broker', async () => {
    vi.stubEnv('VITE_LOCAL_DESKTOP_BUILD', 'false');
    vi.stubEnv('VITE_BACKEND_TARGET', 'web');
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = webConfig('broker-a');
    localStorage.setItem('broker_id', 'broker-b');
    vi.resetModules();
    const { resolveBrokerLoginPolicy } = await import('./brokerLoginPolicy');

    expect(resolveBrokerLoginPolicy([
      { broker_id: 'broker-a', broker_name: 'Broker A', webterminal_domain: 'terminal.broker-a.test' },
      { broker_id: 'broker-b', broker_name: 'Broker B' },
    ], { hostname: 'terminal.broker-a.test' })).toMatchObject({ status: 'ready', brokerId: 'broker-a' });
  });

  it('locks a live terminal to the exact verified runtime/domain broker', async () => {
    vi.stubEnv('VITE_LOCAL_DESKTOP_BUILD', 'false');
    vi.stubEnv('VITE_BACKEND_TARGET', 'web');
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = webConfig('broker-a');
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
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = webConfig('broker-b');
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
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = webConfig('broker-a');
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
