import { describe, expect, it } from 'vitest';
import { extractBrokerDiscoveryList } from './brokerDiscovery';

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
