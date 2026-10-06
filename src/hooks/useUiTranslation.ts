import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

type CachedLabel = { label: string; resources: Array<{ language: string; value: unknown }> };
const labelCache = new Map<string, CachedLabel>();
const maxCachedLabels = 512;
let resourceStore: typeof i18n.store | undefined;
let language: string | undefined;
let resolvedLanguage: string | undefined;

const clearLabelCache = () => { labelCache.clear(); };
const bindResourceStore = () => {
    if (resourceStore === i18n.store) return;
    resourceStore?.off('added', clearLabelCache);
    resourceStore?.off('removed', clearLabelCache);
    resourceStore = i18n.store;
    resourceStore?.on('added removed', clearLabelCache);
    clearLabelCache();
};
const invalidateLabels = () => {
    bindResourceStore();
    clearLabelCache();
};
const readLabelResource = (language: string, key: string): unknown =>
    i18n.getResource(language, 'ui', key, { keySeparator: false });
const isPlainLabel = (value: unknown): boolean => typeof value === 'string'
    && !value.includes(i18n.options.interpolation?.prefix || '{{')
    && !value.includes(i18n.options.interpolation?.nestingPrefix || '$t(');
i18n.on('initialized languageChanged loaded', invalidateLabels);
bindResourceStore();

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        for (const event of ['initialized', 'languageChanged', 'loaded']) i18n.off(event, invalidateLabels);
        resourceStore?.off('added', clearLabelCache);
        resourceStore?.off('removed', clearLabelCache);
        clearLabelCache();
    });
}

/** Translate presentation copy only. Never pass action IDs or trading values here. */
export function translateUi<T>(source: T, values?: Record<string, unknown>): T {
    if (typeof source !== 'string' || !source.trim()) return source;
    const key = source.trim();
    bindResourceStore();
    if (language !== i18n.language || resolvedLanguage !== i18n.resolvedLanguage) {
        language = i18n.language;
        resolvedLanguage = i18n.resolvedLanguage;
        clearLabelCache();
    }
    // Options can carry interpolation, namespace, language, or postprocessors.
    // Keep every such call on i18next's normal path; only static copy is reused.
    const cacheable = values === undefined && i18n.isInitialized && key.length <= 512
        && isPlainLabel(key) && i18n.language?.toLowerCase() !== 'cimode'
        && !i18n.options.postProcess && !i18n.options.fallbackNS;
    const cached = cacheable ? labelCache.get(key) : undefined;
    // ResourceStore's documented silent writes emit no events. Validate the
    // handful of literal UI values in the language/fallback chain on a hit.
    // Nested/interpolated resources never enter the cache.
    let label = cached && cached.resources.length === i18n.languages.length
        && cached.resources.every((resource, index) => resource.language === i18n.languages[index]
            && resource.value === readLabelResource(resource.language, key)) ? cached.label : undefined;
    if (label === undefined) {
        const translated = i18n.t(key, {
            ns: 'ui', keySeparator: false, nsSeparator: false,
            defaultValue: key, ...values,
        });
        label = typeof translated === 'string' ? translated : key;
        if (cacheable && label.length <= 4096) {
            const resources = i18n.languages.map(language => ({ language, value: readLabelResource(language, key) }));
            if (resources.every(resource => resource.value === undefined || isPlainLabel(resource.value))) {
                if (labelCache.size >= maxCachedLabels) labelCache.delete(labelCache.keys().next().value!);
                labelCache.set(key, { label, resources });
            }
        }
    }
    const start = source.indexOf(key);
    return (source.slice(0, start) + label + source.slice(start + key.length)) as T;
}

export function useUiTranslation() {
    const { i18n: instance, t } = useTranslation(['translation', 'ui'], {
        bindI18n: 'languageChanged initialized loaded',
        bindI18nStore: 'added removed',
    });
    // A new translator also invalidates memoized presentation labels. It does
    // not remount components or change their persistent IDs/state.
    return useCallback(
        <T,>(source: T, values?: Record<string, unknown>): T => translateUi(source, values),
        [instance?.resolvedLanguage, instance?.language, t],
    );
}
