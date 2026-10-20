// @vitest-environment jsdom
/**
 * brokerOperationalConfig — white-label broker operating values.
 *
 * - Values a broker configured (camelCase or snake_case) flow through
 *   untouched, so existing brokers keep their behavior.
 * - Anything missing or malformed resolves to neutral defaults ('', 0):
 *   a new broker never inherits another broker's literals from code.
 */
import { describe, expect, it } from 'vitest';
import {
    NEUTRAL_BROKER_OPERATIONAL_CONFIG,
    normalizeBrokerOperationalConfig,
} from './brokerOperationalConfig';

describe('normalizeBrokerOperationalConfig', () => {
    it('returns neutral defaults for missing or malformed payloads', () => {
        for (const payload of [undefined, null, [], 'broker', 0, {}]) {
            expect(normalizeBrokerOperationalConfig(payload)).toEqual({
                brokerName: '',
                priceFeedLP: '',
                executionMode: '',
                defaultLeverage: 0,
                defaultBalance: 0,
                marginMode: '',
                maxTicksPerSymbol: 0,
            });
        }
        expect(NEUTRAL_BROKER_OPERATIONAL_CONFIG).toEqual(
            normalizeBrokerOperationalConfig(null),
        );
    });

    it('passes an existing broker camelCase config through untouched', () => {
        // Legacy input fixture (what an existing broker's config document
        // carries today) — asserts preservation, not a code default.
        expect(normalizeBrokerOperationalConfig({
            brokerName: 'RTX',
            priceFeedLP: 'YOFX',
            executionMode: 'ABOOK',
            defaultLeverage: 1000,
            defaultBalance: 0,
            marginMode: 'HEDGING',
            maxTicksPerSymbol: 1000,
        })).toEqual({
            brokerName: 'RTX',
            priceFeedLP: 'YOFX',
            executionMode: 'ABOOK',
            defaultLeverage: 1000,
            defaultBalance: 0,
            marginMode: 'HEDGING',
            maxTicksPerSymbol: 1000,
        });
    });

    it('resolves the snake_case broker-row keys to the same values', () => {
        expect(normalizeBrokerOperationalConfig({
            broker_name: 'Fixture Markets',
            price_feed_lp: 'Fixture LP',
            execution_mode: 'BBOOK',
            default_leverage: 500,
            default_balance: 25,
            margin_mode: 'NETTING',
            max_ticks_per_symbol: 250,
        })).toEqual({
            brokerName: 'Fixture Markets',
            priceFeedLP: 'Fixture LP',
            executionMode: 'BBOOK',
            defaultLeverage: 500,
            defaultBalance: 25,
            marginMode: 'NETTING',
            maxTicksPerSymbol: 250,
        });
    });

    it('prefers camelCase when both key forms are present', () => {
        expect(normalizeBrokerOperationalConfig({
            brokerName: 'Camel Broker',
            broker_name: 'Snake Broker',
            marginMode: 'HEDGING',
            margin_mode: 'NETTING',
            defaultLeverage: 100,
            default_leverage: 200,
        })).toEqual(expect.objectContaining({
            brokerName: 'Camel Broker',
            marginMode: 'HEDGING',
            defaultLeverage: 100,
        }));
    });

    it('trims strings and coerces numeric strings, dropping non-finite counts', () => {
        expect(normalizeBrokerOperationalConfig({
            brokerName: '  Fixture Markets  ',
            priceFeedLP: '   ',
            executionMode: 7,
            defaultLeverage: '1,000',
            defaultBalance: 'nope',
            marginMode: null,
            maxTicksPerSymbol: Number.NaN,
        })).toEqual({
            brokerName: 'Fixture Markets',
            priceFeedLP: '',
            executionMode: '',
            defaultLeverage: 1000,
            defaultBalance: 0,
            marginMode: '',
            maxTicksPerSymbol: 0,
        });
    });
});
