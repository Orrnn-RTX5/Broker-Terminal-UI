// @vitest-environment jsdom
/**
 * SUI settings coverage (3/3): broker-config fallback tests.
 *
 * White-label plumbing must degrade to neutral defaults when the broker
 * payload is missing keys -- never `undefined` behaviour, never a throw, and
 * never a tenant-specific literal. Covers the presentation/unbranded fallbacks
 * the broker-config work consumes: normalize/resolve/build/merge/chrome plus
 * the display-name neutral fallback. Generic fixtures only.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
    applyBrokerChrome,
    buildBrokerPresentationUrl,
    getBrokerChrome,
    mergeBrokerPresentation,
    normalizeBrokerPresentationConfig,
    resolveBrokerPresentationAssetUrl,
    type BrokerPresentationSource,
} from './brokerPresentation';
import { normalizeBrokerThemeColor } from './brokerThemeColor';
import { brokerDisplayName, isBrokerName } from './brokerDisplayName';

const SERVER = 'https://broker.example.test';
const BROKER_ID = 'fixture-broker';

beforeEach(() => {
    window.localStorage.clear();
    applyBrokerChrome({});
    document.title = '';
});

describe('normalizeBrokerPresentationConfig missing-key fallbacks', () => {
    it.each([undefined, null, [], 'broker', 0])('returns null (never undefined) for %s', (payload) => {
        expect(normalizeBrokerPresentationConfig(payload)).toBeNull();
    });

    it('returns null when every key is missing or placeholder-only', () => {
        expect(normalizeBrokerPresentationConfig({})).toBeNull();
        expect(normalizeBrokerPresentationConfig({ broker_name: 'Broker' })).toBeNull();
        expect(normalizeBrokerPresentationConfig({ logo_url: '/assets/logo.png' })).toBeNull();
        expect(normalizeBrokerPresentationConfig({ theme_color: 'red' })).toBeNull();
        expect(
            normalizeBrokerPresentationConfig({
                broker_name: 'Broker',
                logo_url: '/assets/logo.png',
                theme_color: '',
            }),
        ).toBeNull();
    });

    it('keeps only the valid keys and drops the missing/invalid ones', () => {
        expect(normalizeBrokerPresentationConfig({ broker_name: 'Test Broker' })).toEqual({
            broker_name: 'Test Broker',
        });
        expect(normalizeBrokerPresentationConfig({ theme_color: '#1a73e8' })).toEqual({
            theme_color: '#1a73e8',
        });
        expect(
            normalizeBrokerPresentationConfig(
                { broker_name: 'Test Broker', logo_url: '/assets/logo.png', theme_color: 'nope' },
                SERVER,
            ),
        ).toEqual({ broker_name: 'Test Broker' });
    });

    it('resolves a relative logo against the broker origin and keeps absolute URLs untouched', () => {
        expect(
            normalizeBrokerPresentationConfig(
                { broker_name: 'Test Broker', logo_url: '/branding/logo.png', theme_color: '#1a73e8' },
                SERVER,
            ),
        ).toEqual({
            broker_name: 'Test Broker',
            logo_url: `${SERVER}/branding/logo.png`,
            theme_color: '#1a73e8',
        });
        expect(
            normalizeBrokerPresentationConfig({ logo_url: 'https://assets.example.test/logo.svg' }),
        ).toEqual({ logo_url: 'https://assets.example.test/logo.svg' });
    });
});

describe('broker presentation URL + asset fallbacks', () => {
    it('buildBrokerPresentationUrl returns empty string when server or id is missing', () => {
        expect(buildBrokerPresentationUrl('', '')).toBe('');
        expect(buildBrokerPresentationUrl(undefined, undefined)).toBe('');
        expect(buildBrokerPresentationUrl(SERVER, '')).toBe('');
        expect(buildBrokerPresentationUrl('', BROKER_ID)).toBe('');
        expect(buildBrokerPresentationUrl('not a URL', BROKER_ID)).toBe('');
    });

    it('buildBrokerPresentationUrl keeps the broker origin and pins the id query', () => {
        expect(buildBrokerPresentationUrl(`${SERVER}/`, BROKER_ID)).toBe(
            `${SERVER}/api/v2/broker/config?broker_id=${BROKER_ID}`,
        );
    });

    it('resolveBrokerPresentationAssetUrl returns empty string for missing/placeholder inputs', () => {
        expect(resolveBrokerPresentationAssetUrl('', '')).toBe('');
        expect(resolveBrokerPresentationAssetUrl(undefined, undefined)).toBe('');
        expect(resolveBrokerPresentationAssetUrl('/assets/logo.png', SERVER)).toBe('');
        expect(resolveBrokerPresentationAssetUrl('/branding/logo.png', '')).toBe('');
        expect(resolveBrokerPresentationAssetUrl('/branding/logo.png', undefined)).toBe('');
    });

    it('resolveBrokerPresentationAssetUrl never returns undefined for present inputs', () => {
        expect(resolveBrokerPresentationAssetUrl('/branding/logo.png', SERVER)).toBe(
            `${SERVER}/branding/logo.png`,
        );
        expect(
            resolveBrokerPresentationAssetUrl('https://assets.example.test/logo.svg', SERVER),
        ).toBe('https://assets.example.test/logo.svg');
        const protocolRelative = resolveBrokerPresentationAssetUrl('//assets.example.test/l.png', '');
        expect(typeof protocolRelative).toBe('string');
        expect(protocolRelative).not.toBe('');
    });

    it('normalizeBrokerThemeColor falls back to empty string for anything unsafe', () => {
        expect(normalizeBrokerThemeColor(undefined)).toBe('');
        expect(normalizeBrokerThemeColor(null)).toBe('');
        expect(normalizeBrokerThemeColor('')).toBe('');
        expect(normalizeBrokerThemeColor('red')).toBe('');
        expect(normalizeBrokerThemeColor('rgb(1, 2, 3)')).toBe('');
        expect(normalizeBrokerThemeColor('#1a73e8')).toBe('#1a73e8');
    });
});

describe('broker chrome + merge neutral defaults', () => {
    it('applyBrokerChrome({}) resets to empty-string neutrals, never undefined', () => {
        const chrome = applyBrokerChrome({});
        expect(chrome).toEqual({ brokerId: '', brokerName: '', logoUrl: '', themeColor: '' });
        for (const value of Object.values(chrome)) {
            expect(typeof value).toBe('string');
        }
        expect(getBrokerChrome()).toEqual(chrome);
    });

    it('applyBrokerChrome coerces missing keys to empty strings', () => {
        const chrome = applyBrokerChrome({ brokerName: 'Test Broker' });
        expect(chrome.brokerId).toBe('');
        expect(chrome.brokerName).toBe('Test Broker');
        expect(chrome.logoUrl).toBe('');
        expect(chrome.themeColor).toBe('');
    });

    it('mergeBrokerPresentation returns the broker untouched when presentation is null', () => {
        const broker = { broker_id: BROKER_ID, broker_name: 'Test Broker' };
        expect(mergeBrokerPresentation(broker, null)).toBe(broker);
    });

    it('mergeBrokerPresentation fills only the provided keys, keeping broker values otherwise', () => {
        const broker: BrokerPresentationSource = { broker_id: BROKER_ID, broker_name: 'Test Broker', logo_url: `${SERVER}/old.png` };
        const merged = mergeBrokerPresentation(broker, { theme_color: '#1a73e8' });
        expect(merged.broker_name).toBe('Test Broker');
        expect(merged.logo_url).toBe(`${SERVER}/old.png`);
        expect(merged.theme_color).toBe('#1a73e8');
        expect(merged.broker_name).not.toBeUndefined();
        expect(merged.logo_url).not.toBeUndefined();
    });
});

describe('broker display-name neutral fallback', () => {
    it('rejects placeholders, URLs and window titles as broker names', () => {
        expect(isBrokerName('')).toBe(false);
        expect(isBrokerName('Broker')).toBe(false);
        expect(isBrokerName('RTX Terminal')).toBe(false);
        expect(isBrokerName('RTX 5 Web Terminal')).toBe(false);
        expect(isBrokerName('https://broker.example.test')).toBe(false);
        expect(isBrokerName('Test Broker')).toBe(true);
    });

    it('falls back to the neutral "Broker" label instead of undefined/empty', () => {
        expect(brokerDisplayName('', 'Broker')).toBe('Broker');
        expect(brokerDisplayName('https://broker.example.test', 'Broker')).toBe('Broker');
        for (const label of [
            brokerDisplayName(''),
            brokerDisplayName('', 'Broker'),
            brokerDisplayName('https://broker.example.test', 'Broker'),
        ]) {
            expect(typeof label).toBe('string');
            expect(label).not.toBe('');
        }
    });

    it('prefers an explicitly supplied valid name without changing routing', () => {
        expect(brokerDisplayName('', 'Test Broker')).toBe('Test Broker');
    });
});
