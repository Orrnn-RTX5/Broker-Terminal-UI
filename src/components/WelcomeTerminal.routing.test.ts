import { beforeEach, describe, expect, it } from 'vitest';
import {
  findBrokerForRuntimeDomain,
  findBrokerForWebRuntime,
  buildConfiguredRuntimeBroker,
  LAST_AUTHENTICATED_BROKER_ID_KEY,
  pickDiscoveryBroker,
  type BrokerServerItem,
} from './WelcomeTerminal';

type RuntimeWindow = Window & {
  RUNTIME_CONFIG?: Record<string, unknown>;
  __RTX_RUNTIME_CONFIG__?: Record<string, unknown>;
};

const runtimeWindow = window as RuntimeWindow;

const broker = (overrides: Partial<BrokerServerItem>): BrokerServerItem => ({
  broker_id: 'other-broker',
  broker_name: 'Other Broker',
  logo_url: '',
  server_url: 'https://broker.example',
  ...overrides,
});

describe('WelcomeTerminal broker runtime selection', () => {
  beforeEach(() => {
    delete runtimeWindow.RUNTIME_CONFIG;
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
    localStorage.clear();
  });

  it('matches Achiever from custom webterminal domain identity fields', () => {
    const brokers = [
      broker({ broker_id: 'myprop-trade', broker_name: 'MyProp', domain: 'myprop.trade' }),
      broker({
        broker_id: 'achiever-financials',
        broker_name: 'Achiever Financials',
        webterminal_domain: 'webterminal.achieverfinancials.com',
        admin_domain: 'admin.achieverfinancials.com',
        manager_domain: 'manager.achieverfinancials.com',
      }),
    ];

    expect(findBrokerForRuntimeDomain(brokers, 'webterminal.achieverfinancials.com')?.broker_id)
      .toBe('achiever-financials');
  });

  it('prefers runtime API target matching over custom-domain identity matching', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web', BROKER_ID: 'achiever-financials',
      DEFAULT_MT5_SERVER: 'Configured-Live',
      API_HOST: 'https://service.achieverfinancials.com',
      API_HOST_EXT: 'https://service.achieverfinancials.com',
      WS_HOST: 'wss://service.achieverfinancials.com',
    };
    const brokers = [
      broker({
        broker_id: 'domain-only-achiever',
        broker_name: 'Achiever Domain Row',
        webterminal_domain: 'webterminal.achieverfinancials.com',
      }),
      broker({
        broker_id: 'achiever-financials',
        broker_name: 'Achiever Financials',
        API_HOST: 'https://service.achieverfinancials.com',
        API_HOST_EXT: 'https://service.achieverfinancials.com',
        webterminal_domain: 'webterminal.achieverfinancials.com',
      }),
    ];

    expect(findBrokerForWebRuntime(brokers, 'webterminal.achieverfinancials.com')?.broker_id)
      .toBe('achiever-financials');
  });

  it('pins TEST from runtime config when discovery only has unrelated local demo brokers', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      DEFAULT_MT5_SERVER: 'Configured-Live',
      API_HOST: 'https://fxtrustbrokerbackend.orrnn.com',
      API_HOST_EXT: 'https://fxtrustbrokerbackend.orrnn.com',
      WS_HOST: 'wss://fxtrustbrokerbackend.orrnn.com',
      BROKER_ID: 'TEST',
      VITE_BROKER_ID: 'TEST',
    };

    const brokers = [
      broker({
        broker_id: 'local_demo_01',
        broker_name: 'Local Demo Broker 01',
        server: 'demo01.local.test:443',
        server_url: 'https://demo01.local.test',
      }),
      broker({
        broker_id: 'local_demo_02',
        broker_name: 'Local Demo Broker 02',
        server: 'demo02.local.test:443',
        server_url: 'https://demo02.local.test',
      }),
    ];

    const selected = pickDiscoveryBroker(brokers);
    expect(selected?.broker_id).toBe('TEST');
    expect(selected?.server_url).toBe('https://fxtrustbrokerbackend.orrnn.com');
    expect(selected?.broker_id).not.toBe('local_demo_01');
  });

  it('still uses the discovery row when TEST is present in the super-admin list', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      DEFAULT_MT5_SERVER: 'Configured-Live',
      API_HOST: 'https://fxtrustbrokerbackend.orrnn.com', WS_HOST: 'wss://fxtrustbrokerbackend.orrnn.com',
      BROKER_ID: 'TEST',
    };

    const brokers = [
      broker({
        broker_id: 'local_demo_01',
        broker_name: 'Local Demo Broker 01',
        server_url: 'https://demo01.local.test',
      }),
      broker({
        broker_id: 'TEST',
        broker_name: 'FX Trust TEST',
        server_url: 'https://fxtrustbrokerbackend.orrnn.com',
        API_HOST: 'https://fxtrustbrokerbackend.orrnn.com',
      }),
    ];

    expect(pickDiscoveryBroker(brokers)?.broker_id).toBe('TEST');
    expect(pickDiscoveryBroker(brokers)?.broker_name).toBe('FX Trust TEST');
  });

  it('gives the configured TEST broker its canonical broker-directory logo', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      DEFAULT_MT5_SERVER: 'Configured-Live',
      API_HOST: 'https://fxtrustbrokerbackend.orrnn.com', WS_HOST: 'wss://fxtrustbrokerbackend.orrnn.com',
      DISCOVERY_BASE_URL: 'https://fxtrustsuperbackned.orrnn.com',
      BROKER_ID: 'TEST',
    };

    expect(buildConfiguredRuntimeBroker()?.logo_url).toBe(
      'https://fxtrustsuperbackned.orrnn.com/api/v1/brokers/TEST/logo',
    );
  });

  it('selects the TEST row whose server URL matches the local FXTrust runtime', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      DEFAULT_MT5_SERVER: 'Configured-Live',
      API_HOST: 'https://fxtrustbrokerbackend.orrnn.com',
      WS_HOST: 'wss://fxtrustbrokerbackend.orrnn.com',
      BROKER_ID: 'TEST',
    };

    const brokers = [
      broker({
        broker_id: 'local_demo_01',
        broker_name: 'Local Demo Broker 01',
        server_url: 'https://other-broker.example',
      }),
      broker({
        broker_id: 'TEST',
        broker_name: 'TEST',
        server_url: 'https://fxtrustbrokerbackend.orrnn.com',
      }),
    ];

    expect(findBrokerForWebRuntime(brokers, '127.0.0.1')?.broker_id).toBe('TEST');
  });

  it('does not let localhost discovery replace the explicitly configured TEST broker', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      DEFAULT_MT5_SERVER: 'Configured-Live',
      API_HOST: 'https://fxtrustbrokerbackend.orrnn.com', WS_HOST: 'wss://fxtrustbrokerbackend.orrnn.com',
      BROKER_ID: 'TEST',
    };

    const brokers = [
      broker({
        broker_id: 'localdemo',
        broker_name: 'Local Demo Broker',
        webterminal_domain: '127.0.0.1',
        server_url: 'https://127.0.0.1:8090',
      }),
    ];

    expect(findBrokerForWebRuntime(brokers, '127.0.0.1')).toBeUndefined();
    expect(pickDiscoveryBroker(brokers)?.broker_id).toBe('TEST');
  });

  it('ignores a stale saved broker that was never authenticated successfully', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      DEFAULT_MT5_SERVER: 'Configured-Live',
      API_HOST: 'https://fxtrustbrokerbackend.orrnn.com', WS_HOST: 'wss://fxtrustbrokerbackend.orrnn.com',
      BROKER_ID: 'TEST',
    };

    const brokers = [
      broker({ broker_id: 'localdemo', broker_name: 'Local Demo Broker' }),
      broker({ broker_id: 'TEST', broker_name: 'FX Trust TEST' }),
    ];

    expect(pickDiscoveryBroker(brokers, { savedBrokerId: 'localdemo' })?.broker_id).toBe('TEST');
  });

  it('keeps the configured web broker even after another broker logged in successfully', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      DEFAULT_MT5_SERVER: 'Configured-Live',
      API_HOST: 'https://fxtrustbrokerbackend.orrnn.com', WS_HOST: 'wss://fxtrustbrokerbackend.orrnn.com',
      BROKER_ID: 'TEST',
    };

    const brokers = [
      broker({ broker_id: 'localdemo', broker_name: 'Local Demo Broker' }),
      broker({ broker_id: 'TEST', broker_name: 'FX Trust TEST' }),
    ];
    localStorage.setItem(LAST_AUTHENTICATED_BROKER_ID_KEY, 'localdemo');

    expect(pickDiscoveryBroker(brokers, {
      savedBrokerId: 'localdemo',
      lastAuthenticatedBrokerId: localStorage.getItem(LAST_AUTHENTICATED_BROKER_ID_KEY),
    })?.broker_id).toBe('TEST');
  });

  it('switches a same-origin TEST login to the configured Achiever broker', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      DEFAULT_MT5_SERVER: 'Configured-Live',
      API_HOST: 'https://service.achieverfinancials.com', WS_HOST: 'wss://service.achieverfinancials.com',
      BROKER_ID: 'achiever-financials',
    };
    const selected = pickDiscoveryBroker([
      broker({ broker_id: 'TEST', broker_name: 'FX Trust TEST' }),
      broker({ broker_id: 'achiever-financials', broker_name: 'Achiever Financials' }),
    ], { savedBrokerId: 'TEST', lastAuthenticatedBrokerId: 'TEST' });
    expect(selected?.broker_id).toBe('achiever-financials');
  });

  it('keeps the configured web broker when the saved broker is the only directory row', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      DEFAULT_MT5_SERVER: 'Configured-Live',
      API_HOST: 'https://service.achieverfinancials.com', WS_HOST: 'wss://service.achieverfinancials.com',
      BROKER_ID: 'achiever-financials',
    };
    const selected = pickDiscoveryBroker([
      broker({ broker_id: 'TEST', broker_name: 'FX Trust TEST' }),
    ], { savedBrokerId: 'TEST', lastAuthenticatedBrokerId: 'TEST' });
    expect(selected?.broker_id).toBe('achiever-financials');
    expect(selected?.server_url).toBe('https://service.achieverfinancials.com');
  });

  it('retains the authenticated broker selection in desktop mode', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      DEFAULT_MT5_SERVER: 'Configured-Live',
      API_HOST: 'https://service.achieverfinancials.com', WS_HOST: 'wss://service.achieverfinancials.com',
      BROKER_ID: 'achiever-financials',
    };
    const selected = pickDiscoveryBroker([
      broker({ broker_id: 'TEST', broker_name: 'FX Trust TEST' }),
      broker({ broker_id: 'achiever-financials', broker_name: 'Achiever Financials' }),
    ], { isDesktopBrokerSelection: true, savedBrokerId: 'TEST', lastAuthenticatedBrokerId: 'TEST' });
    expect(selected?.broker_id).toBe('TEST');
  });

  it('restores the exact case-sensitive backend ID among brokers sharing a gateway and name', () => {
    const brokers = [
      broker({ broker_id: 'Registered', broker_name: 'Shared Trading', server_url: 'https://shared.example' }),
      broker({ broker_id: 'registered', broker_name: 'Shared Trading', server_url: 'https://shared.example' }),
    ];
    expect(pickDiscoveryBroker(brokers, {
      isDesktopBrokerSelection: true, savedBrokerId: 'registered', lastAuthenticatedBrokerId: 'registered',
    })?.broker_id).toBe('registered');
  });

  it('does not restore another registered ID through case-insensitive saved identity matching', () => {
    const brokers = [
      broker({ broker_id: 'default-broker' }),
      broker({ broker_id: 'registered', server_url: 'https://registered.example' }),
    ];
    expect(pickDiscoveryBroker(brokers, {
      isDesktopBrokerSelection: true, savedBrokerId: 'REGISTERED', lastAuthenticatedBrokerId: 'REGISTERED',
    })?.broker_id).toBe('default-broker');
  });

  it('requires the last authenticated identity to resolve to the same exact registered broker', () => {
    const brokers = [
      broker({ broker_id: 'default-broker' }),
      broker({ broker_id: 'Registered', server_url: 'https://registered.example' }),
      broker({ broker_id: 'registered', server_url: 'https://registered.example' }),
    ];
    expect(pickDiscoveryBroker(brokers, {
      isDesktopBrokerSelection: true, savedBrokerId: 'registered', lastAuthenticatedBrokerId: 'Registered',
    })?.broker_id).toBe('default-broker');
  });

  it.each(['https://shared.example', 'Shared-Live'])('does not restore a saved login from ambiguous legacy lookup %s', legacyLookup => {
    const brokers = [
      broker({ broker_id: 'default-broker' }),
      broker({ broker_id: 'registered-one', server: 'Shared-Live', server_url: 'https://shared.example' }),
      broker({ broker_id: 'registered-two', server: 'Shared-Live', server_url: 'https://shared.example' }),
    ];
    expect(pickDiscoveryBroker(brokers, {
      isDesktopBrokerSelection: true, savedBrokerId: legacyLookup, lastAuthenticatedBrokerId: legacyLookup,
    })?.broker_id).toBe('default-broker');
  });

  it.each(['https://UNIQUE.example/', 'unique-live'])('preserves a unique legacy saved server lookup %s', legacyLookup => {
    const brokers = [
      broker({ broker_id: 'default-broker' }),
      broker({ broker_id: 'registered-new', server: 'Unique-Live', server_url: 'https://unique.example' }),
    ];
    expect(pickDiscoveryBroker(brokers, {
      isDesktopBrokerSelection: true, savedBrokerId: legacyLookup, lastAuthenticatedBrokerId: legacyLookup,
    })?.broker_id).toBe('registered-new');
  });

  it('prefers an exact registered ID over another broker using that value as a legacy server handle', () => {
    const brokers = [
      broker({ broker_id: 'other-registered', server: 'registered-new' }),
      broker({ broker_id: 'registered-new', server_url: 'https://new.example' }),
    ];
    expect(pickDiscoveryBroker(brokers, {
      isDesktopBrokerSelection: true, savedBrokerId: 'registered-new', lastAuthenticatedBrokerId: 'registered-new',
    })?.broker_id).toBe('registered-new');
  });

  it('does not override a pinned browser broker with a case-distinct directory ID or a shared endpoint', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web', BROKER_ID: 'registered', DEFAULT_MT5_SERVER: 'Configured-Live',
      API_HOST: 'https://shared.example', WS_HOST: 'wss://shared.example',
    };
    const brokers = [
      broker({ broker_id: 'Registered', server_url: 'https://shared.example' }),
      broker({ broker_id: 'registered', server_url: 'https://shared.example' }),
    ];
    expect(pickDiscoveryBroker(brokers, { savedBrokerId: 'Registered', lastAuthenticatedBrokerId: 'Registered' })?.broker_id)
      .toBe('registered');
  });

  it('prefers a public broker over loopback development rows on a fresh desktop launch', () => {
    const selected = pickDiscoveryBroker([
      broker({
        broker_id: 'localdemo',
        broker_name: 'Local Demo Broker',
        server_url: 'https://127.0.0.1:8090',
      }),
      broker({
        broker_id: 'local-demo-01',
        broker_name: 'Local Demo Broker 01',
        server_url: 'https://demo01.local.test',
      }),
      broker({
        broker_id: 'Nexa',
        broker_name: 'Nexa',
        server_url: 'https://nexa.orrnn.com',
      }),
    ], { isDesktopBrokerSelection: true });

    expect(selected?.broker_id).toBe('Nexa');
  });

  it('skips suspended brokers when falling back to directory order', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      DEFAULT_MT5_SERVER: 'Configured-Live',
      API_HOST: 'https://service.achieverfinancials.com', WS_HOST: 'wss://service.achieverfinancials.com',
      BROKER_ID: 'missing-broker',
    };
    const selected = pickDiscoveryBroker([
      broker({ broker_id: 'suspended-broker', broker_name: 'Suspended Broker', enabled: false }),
      broker({ broker_id: 'achiever-financials', broker_name: 'Achiever Financials' }),
    ], { isDesktopBrokerSelection: true });
    expect(selected?.broker_id).toBe('achiever-financials');
  });

  it('uses a discovered desktop broker instead of an unavailable configured fallback', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web',
      DEFAULT_MT5_SERVER: 'Configured-Live',
      API_HOST: 'https://services.growtradingacademy.com', WS_HOST: 'wss://services.growtradingacademy.com',
      BROKER_ID: 'gta_broker',
    };
    const selected = pickDiscoveryBroker([
      broker({ broker_id: 'achiever-financials', broker_name: 'Achiever Financials', server_url: 'https://service.achieverfinancials.com' }),
    ], { isDesktopBrokerSelection: true, savedBrokerId: 'gta_broker' });
    expect(selected?.broker_id).toBe('achiever-financials');
    expect(selected?.server_url).toBe('https://service.achieverfinancials.com');
  });
});
