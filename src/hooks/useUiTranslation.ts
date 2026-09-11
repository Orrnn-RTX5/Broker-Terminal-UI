import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

/** Translate presentation copy only. Never pass action IDs or trading values here. */
export function translateUi<T>(source: T, values?: Record<string, unknown>): T {
    if (typeof source !== 'string' || !source.trim()) return source;
    const key = source.trim();
    const translated = i18n.t(key, {
        ns: 'ui', keySeparator: false, nsSeparator: false,
        defaultValue: key, ...values,
    });
    return (source.slice(0, source.indexOf(key)) + (typeof translated === 'string' ? translated : key) + source.slice(source.indexOf(key) + key.length)) as T;
}

export function useUiTranslation() {
    const { i18n: instance } = useTranslation(['translation', 'ui']);
    // A new translator also invalidates memoized presentation labels. It does
    // not remount components or change their persistent IDs/state.
    return useCallback(
        <T,>(source: T, values?: Record<string, unknown>): T => translateUi(source, values),
        [instance?.resolvedLanguage, instance?.language],
    );
}
