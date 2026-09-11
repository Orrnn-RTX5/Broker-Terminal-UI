import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import resourcesToBackend from 'i18next-resources-to-backend';
import { supportedLanguages } from './config/supportedLanguages';

const localeLoaders = import.meta.glob<{ default: Record<string, unknown> }>('./locales/*/*.json');

const loadLocale = async (language: string, namespace: string) => {
    const normalizedLanguage = (language || 'en').trim();
    const baseLanguage = normalizedLanguage.split('-')[0];

    const candidates = [
        `./locales/${normalizedLanguage}/${namespace}.json`,
        `./locales/${baseLanguage}/${namespace}.json`,
        `./locales/en/${namespace}.json`,
    ];

    for (const candidate of candidates) {
        const loader = localeLoaders[candidate];
        if (loader) {
            const module = await loader();
            return module.default ?? {};
        }
    }

    return {};
};

export const i18nReady = i18n
    .use(resourcesToBackend((language: string, namespace: string) => loadLocale(language, namespace)))
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        fallbackLng: 'en',
        supportedLngs: supportedLanguages.map(({ code }) => code),
        ns: ['translation', 'ui'],
        defaultNS: 'translation',
        detection: {
            order: ['localStorage', 'navigator'],
            lookupLocalStorage: 'i18nextLng',
            caches: ['localStorage'],
        },
        debug: false, // Set to false in production

        interpolation: {
            escapeValue: false, // not needed for react as it escapes by default
        },

        // The static HTML splash remains visible until initialization finishes.
        // Avoid replacing the whole terminal with a second Suspense loader.
        react: {
            useSuspense: false,
        }
    });

const applyDocumentLanguage = (language: string) => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = language;
    document.documentElement.dir = i18n.dir(language);
};
i18n.on('languageChanged', applyDocumentLanguage);
void i18nReady.then(() => applyDocumentLanguage(i18n.resolvedLanguage || i18n.language || 'en'));

let languageRequest = 0;
export async function changeInterfaceLanguage(language: string) {
    if (!supportedLanguages.some(({ code }) => code === language)) {
        throw new Error('Unsupported interface language');
    }
    const request = ++languageRequest;
    await i18nReady;
    // Load both namespaces before changing the visible UI. A failed download
    // leaves the current language intact instead of silently showing English.
    await new Promise<void>((resolve, reject) => {
        void i18n.loadLanguages(language, (error: unknown) => error ? reject(error) : resolve());
    });
    if (request !== languageRequest) return;
    if (!i18n.hasResourceBundle(language, 'ui') || !i18n.hasResourceBundle(language, 'translation')) {
        throw new Error('Interface translation could not be loaded');
    }
    await i18n.changeLanguage(language);
}

export default i18n;
