// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';

it('loads saved Arabic at startup while keeping the terminal layout LTR', async () => {
    const savedLanguage = localStorage.getItem('i18nextLng');
    const previousLang = document.documentElement.getAttribute('lang');
    const previousDir = document.documentElement.getAttribute('dir');
    vi.resetModules();
    try {
        localStorage.setItem('i18nextLng', 'ar');
        document.documentElement.lang = 'en';
        document.documentElement.dir = 'rtl';

        // A fresh import exercises the production detector and real locale
        // loading without an explicit call to changeInterfaceLanguage.
        const { default: i18n, i18nReady } = await import('./i18n');
        await i18nReady;

        expect(i18n.resolvedLanguage).toBe('ar');
        expect(document.documentElement.lang).toBe('ar');
        expect(document.documentElement.dir).toBe('ltr');
        expect(localStorage.getItem('i18nextLng')).toBe('ar');
        expect(i18n.t('menu.view.languages')).toMatch(/[\u0600-\u06ff]/);
        expect(i18n.t('New Order', { ns: 'ui', keySeparator: false })).toMatch(/[\u0600-\u06ff]/);
    } finally {
        if (savedLanguage === null) localStorage.removeItem('i18nextLng');
        else localStorage.setItem('i18nextLng', savedLanguage);
        if (previousLang === null) document.documentElement.removeAttribute('lang');
        else document.documentElement.setAttribute('lang', previousLang);
        if (previousDir === null) document.documentElement.removeAttribute('dir');
        else document.documentElement.setAttribute('dir', previousDir);
        vi.resetModules();
    }
});
