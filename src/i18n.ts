import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import resourcesToBackend from 'i18next-resources-to-backend';

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

i18n
    .use(resourcesToBackend((language: string, namespace: string) => loadLocale(language, namespace)))
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        fallbackLng: 'en',
        debug: true, // Set to false in production

        interpolation: {
            escapeValue: false, // not needed for react as it escapes by default
        },

        // React Suspense settings
        react: {
            useSuspense: true,
        }
    });

export default i18n;
