import { beforeEach, describe, expect, it } from 'vitest';
import {
  findBrokerForRuntimeDomain,
  findBrokerForWebRuntime,
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
  ...overrides,
});

describe('WelcomeTerminal broker runtime selection', () => {
  beforeEach(() => {
    delete runtimeWindow.RUNTIME_CONFIG;
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
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
      BACKEND_TARGET: 'web',
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
      API_HOST: 'https://fxtrustbrokerbackend.orrnn.com',
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
});
