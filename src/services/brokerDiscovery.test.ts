import { describe, expect, it } from 'vitest';
import {
  extractBrokerDiscoveryList,
  filterBrokerDirectory,
  firstSelectableBroker,
  isBrokerSuspended,
  getDirectoryBrokerServerUrl,
  isDirectoryBrokerSelectable,
  type BrokerDiscoveryItem,
} from './brokerDiscovery';

describe('extractBrokerDiscoveryList', () => {
  it('accepts a raw broker array', () => {
    expect(extractBrokerDiscoveryList([
      { broker_id: 'gta_broker', broker_name: 'Grow Trading Academy' },
    ])).toEqual([
      { broker_id: 'gta_broker', broker_name: 'Grow Trading Academy' },
    ]);
  });

  it('accepts object-wrapped broker arrays', () => {
    expect(extractBrokerDiscoveryList({
      brokers: [
        {
          broker_id: 'grow-trading-academy',
          name: 'Grow Trading Academy',
          backend_url: 'https://services.growtradingacademy.com',
        },
      ],
    })).toEqual([
      {
        broker_id: 'grow-trading-academy',
        name: 'Grow Trading Academy',
        broker_name: 'Grow Trading Academy',
        backend_url: 'https://services.growtradingacademy.com',
      },
    ]);
  });

  it('accepts nested data/server wrappers from discovery APIs', () => {
    expect(extractBrokerDiscoveryList({
      data: {
        servers: [
          { id: 42, name: 'Nested Broker', server_url: 'https://broker.example' },
        ],
      },
    })).toEqual([
      {
        id: 42,
        name: 'Nested Broker',
        broker_id: '42',
        broker_name: 'Nested Broker',
        server_url: 'https://broker.example',
      },
    ]);
  });

  it('preserves v2 sanitized rows with opaque server handles and no direct host or port', () => {
    expect(extractBrokerDiscoveryList({
      servers: [
        {
          broker_id: 'gta_broker',
          broker_name: 'Grow Trading Academy',
          server: 'gta-live',
          logo_url: '/logos/gta.png',
        },
      ],
    })).toEqual([
      {
        broker_id: 'gta_broker',
        broker_name: 'Grow Trading Academy',
        server: 'gta-live',
        logo_url: '/logos/gta.png',
      },
    ]);
  });

  it('filters invalid payload rows instead of returning non-broker values', () => {
    expect(extractBrokerDiscoveryList({
      data: [
        null,
        'bad-row',
        { broker_id: '', broker_name: 'Missing Id' },
        { broker_id: 'valid', broker_name: 'Valid Broker' },
      ],
    })).toEqual([
      { broker_id: 'valid', broker_name: 'Valid Broker' },
    ]);
  });
});

describe('filterBrokerDirectory', () => {
  const broker = (overrides: Partial<BrokerDiscoveryItem>): BrokerDiscoveryItem => ({
    broker_id: 'other-broker',
    broker_name: 'Other Broker',
    logo_url: '',
    ...overrides,
  });
  const directory = [
    broker({ broker_id: 'achiever-financials', broker_name: 'Achiever Financials' }),
    broker({ broker_id: 'gta_broker', broker_name: 'Grow Trading Academy' }),
    broker({ broker_id: 'myprop-trade', broker_name: 'MyProp', region: 'eu' }),
  ];
  const selected = directory[0];

  it('lists the whole directory when the query is the selected broker name', () => {
    const result = filterBrokerDirectory(directory, 'Achiever Financials', selected);
    expect(result.map(item => item.broker_id)).toEqual([
      'achiever-financials',
      'gta_broker',
      'myprop-trade',
    ]);
  });

  it('lists the whole directory for an empty query', () => {
    expect(filterBrokerDirectory(directory, '   ', null)).toHaveLength(3);
  });

  it('filters by name, id, and region while typing', () => {
    expect(filterBrokerDirectory(directory, 'grow', selected).map(item => item.broker_id))
      .toEqual(['gta_broker']);
    expect(filterBrokerDirectory(directory, 'myprop-trade', null).map(item => item.broker_id))
      .toEqual(['myprop-trade']);
    expect(filterBrokerDirectory(directory, 'eu', null).map(item => item.broker_id))
      .toEqual(['myprop-trade']);
  });

  it('returns nothing when no broker matches the typed query', () => {
    expect(filterBrokerDirectory(directory, 'zzz', selected)).toEqual([]);
  });

  it('does not insert a selected broker that was removed from the live directory', () => {
    expect(filterBrokerDirectory(directory.slice(1), selected.broker_name!, selected)).toEqual(directory.slice(1));
  });
});

describe('directory broker login address', () => {
  it('uses the exact published server URL and ignores IP routing metadata', () => {
    expect(getDirectoryBrokerServerUrl({ server_url: 'https://broker.example:8443/trader/', server_ip: '192.0.2.1', server_port: 8091 })).toBe('https://broker.example:8443/trader');
  });

  it.each(['', 'Broker Name', '//broker.example', 'javascript:alert(1)', 'https://user:pass@broker.example', 'https://broker.example?server=other', 'https://broker.example/#other'])('rejects unusable server URL %s', server_url => {
    expect(isDirectoryBrokerSelectable({ broker_id: 'broker', server_url, backend_url: 'https://fallback.example' })).toBe(false);
  });
});

describe('isBrokerSuspended', () => {
  const broker = (overrides: Partial<BrokerDiscoveryItem>): BrokerDiscoveryItem => ({
    broker_id: 'some-broker',
    broker_name: 'Some Broker',
    logo_url: '',
    ...overrides,
  });

  it('flags brokers disabled or inactive in superadmin', () => {
    expect(isBrokerSuspended(broker({ enabled: false }))).toBe(true);
    expect(isBrokerSuspended(broker({ active: false }))).toBe(true);
    expect(isBrokerSuspended(broker({ status: 'suspended' }))).toBe(true);
  });

  it('keeps enabled brokers selectable', () => {
    expect(isBrokerSuspended(broker({ active: true, enabled: true }))).toBe(false);
    expect(isBrokerSuspended(broker())).toBe(false);
    expect(isBrokerSuspended(null)).toBe(false);
  });

  it('firstSelectableBroker skips suspended rows in directory order', () => {
    expect(firstSelectableBroker([
      broker({ broker_id: 'suspended', enabled: false }),
      broker({ broker_id: 'live', active: true }),
    ])?.broker_id).toBe('live');
    expect(firstSelectableBroker([broker({ broker_id: 'suspended', enabled: false })])).toBeUndefined();
  });
});
