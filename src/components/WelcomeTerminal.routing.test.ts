import { beforeEach, describe, expect, it } from 'vitest';
import {
  findBrokerForRuntimeDomain,
  findBrokerForWebRuntime,
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
});
