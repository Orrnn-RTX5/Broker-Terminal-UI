import { useMemo } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { translateUi, useUiTranslation } from './useUiTranslation';

const backend = vi.hoisted(() => ({ labels: {} as Record<string, string> }));
vi.mock('../i18n', async () => {
    const { createInstance } = await import('i18next');
    const { initReactI18next } = await import('react-i18next');
    const instance = createInstance().use(initReactI18next).use({
        type: 'backend' as const,
        read: (_language: string, namespace: string, callback: (error: null, data: Record<string, string>) => void) => {
            callback(null, namespace === 'ui' ? backend.labels : {});
        },
    });
    return { default: instance };
});

beforeEach(async () => {
    backend.labels = {};
    await i18n.init({
        lng: 'en', fallbackLng: 'en', ns: ['translation', 'ui'], defaultNS: 'translation',
        resources: {
            en: { ui: { Label: 'English label', Greeting: 'Hello {{name}}', Nested: '$t(Other)', Other: 'First' }, translation: { Label: 'Other namespace' } },
            fr: { ui: { Label: 'French label' }, translation: {} },
        },
        interpolation: { escapeValue: false },
        react: { useSuspense: false },
    });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('bounded UI label translation cache', () => {
    it('reuses static labels across whitespace variants without changing nonstrings or blanks', () => {
        const translate = vi.spyOn(i18n, 't');
        for (let n = 0; n < 1000; n++) expect(translateUi('Label')).toBe('English label');
        expect(translateUi('\t Label \n')).toBe('\t English label \n');
        expect(translate).toHaveBeenCalledTimes(1);
        const object = { symbol: 'BTCUSD', price: 123.45 };
        expect(translateUi(object)).toBe(object);
        expect(translateUi(123.45)).toBe(123.45);
        expect(translateUi(null)).toBeNull();
        expect(translateUi(undefined)).toBeUndefined();
        expect(translateUi(' \t')).toBe(' \t');
        expect(translate).toHaveBeenCalledTimes(1);
    });

    it('never caches values/options, including empty options and namespace overrides', () => {
        const translate = vi.spyOn(i18n, 't');
        expect(translateUi('Greeting', { name: 'BTCUSD<&>' })).toBe('Hello BTCUSD<&>');
        expect(translateUi('Greeting', { name: 'EURUSD' })).toBe('Hello EURUSD');
        expect(translateUi('Label', {})).toBe('English label');
        expect(translateUi('Label', {})).toBe('English label');
        expect(translateUi('Label', { ns: 'translation' })).toBe('Other namespace');
        expect(translateUi('Label', { lng: 'fr' })).toBe('French label');
        expect(translate).toHaveBeenCalledTimes(6);
    });

    it('invalidates language changes, fallback changes, cimode, and resource-store replacement', async () => {
        expect(translateUi('Label')).toBe('English label');
        await i18n.changeLanguage('fr');
        expect(translateUi('Label')).toBe('French label');
        expect(translateUi('Other')).toBe('First');
        await i18n.changeLanguage('cimode');
        expect(translateUi('Label')).toBe('Label');
        await i18n.changeLanguage('en');
        expect(translateUi('Label')).toBe('English label');
        await i18n.init({ lng: 'en', resources: { en: { ui: { Label: 'Reinitialized' } } } });
        expect(translateUi('Label')).toBe('Reinitialized');
    });

    it('observes added, replaced, removed and fallback resource bundles', async () => {
        expect(translateUi('Label')).toBe('English label');
        i18n.addResource('en', 'ui', 'Label', 'Added');
        expect(translateUi('Label')).toBe('Added');
        i18n.addResources('en', 'ui', { Label: 'Multiple' });
        expect(translateUi('Label')).toBe('Multiple');
        i18n.addResourceBundle('en', 'ui', { Label: 'Bundle' }, true, true);
        expect(translateUi('Label')).toBe('Bundle');
        await i18n.changeLanguage('fr');
        expect(translateUi('Label')).toBe('French label');
        i18n.removeResourceBundle('fr', 'ui');
        expect(translateUi('Label')).toBe('Bundle');
        i18n.removeResourceBundle('en', 'ui');
        expect(translateUi('Label')).toBe('Label');
        i18n.addResourceBundle('en', 'ui', { Label: 'Restored' });
        expect(translateUi('Label')).toBe('Restored');
    });

    it('detects silent writes to existing and newly preferred fallback-chain resources', async () => {
        expect(translateUi('Label')).toBe('English label');
        i18n.addResource('en', 'ui', 'Label', 'Silent', { silent: true });
        expect(translateUi('Label')).toBe('Silent');
        await i18n.changeLanguage('fr');
        expect(translateUi('Other')).toBe('First');
        i18n.addResource('fr', 'ui', 'Other', 'Preferred silent', { silent: true });
        expect(translateUi('Other')).toBe('Preferred silent');
        // The installed runtime forwards this sixth option to ResourceStore;
        // its public declaration exposes only the first five parameters.
        const addBundleWithOptions = i18n.addResourceBundle.bind(i18n) as (
            language: string, namespace: string, resources: Record<string, string>,
            deep: boolean, overwrite: boolean, options: { silent: boolean },
        ) => typeof i18n;
        addBundleWithOptions('fr', 'ui', { Other: 'Silent bundle' }, true, true, { silent: true });
        expect(translateUi('Other')).toBe('Silent bundle');
    });

    it('keeps nested and interpolated resources uncached even without explicit values', () => {
        expect(translateUi('Nested')).toBe('First');
        i18n.addResource('en', 'ui', 'Other', 'Second', { silent: true });
        expect(translateUi('Nested')).toBe('Second');
        const translate = vi.spyOn(i18n, 't');
        translateUi('Greeting'); translateUi('Greeting');
        expect(translate).toHaveBeenCalledTimes(2);
    });

    it('reloads backend resources and refreshes memoized hook labels without language changes', async () => {
        function Label() {
            const translate = useUiTranslation();
            return <div data-testid="label">{useMemo(() => translate('Label'), [translate])}</div>;
        }
        render(<Label />);
        expect(screen.getByTestId('label').textContent).toBe('English label');
        act(() => { i18n.addResource('en', 'ui', 'Label', 'Runtime resource'); });
        expect(screen.getByTestId('label').textContent).toBe('Runtime resource');
        backend.labels = { Label: 'Reloaded' };
        await act(async () => { await i18n.reloadResources(['en'], ['ui']); });
        expect(screen.getByTestId('label').textContent).toBe('Reloaded');
        act(() => { i18n.removeResourceBundle('en', 'ui'); });
        expect(screen.getByTestId('label').textContent).toBe('Label');
    });

    it('bounds retained labels and does not retain oversized or dynamic-value strings', () => {
        const translate = vi.spyOn(i18n, 't');
        for (let n = 0; n < 513; n++) translateUi(`Static label ${n}`);
        expect(translate).toHaveBeenCalledTimes(513);
        translateUi('Static label 512');
        expect(translate).toHaveBeenCalledTimes(513);
        translateUi('Static label 0');
        expect(translate).toHaveBeenCalledTimes(514);
        const longLabel = 'x'.repeat(513);
        translateUi(longLabel); translateUi(longLabel);
        expect(translate).toHaveBeenCalledTimes(516);
    });
});
