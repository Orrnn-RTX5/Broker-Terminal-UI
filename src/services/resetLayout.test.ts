import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n, { changeInterfaceLanguage, i18nReady } from '../i18n';
import { supportedLanguages } from '../config/supportedLanguages';

const dockStore = vi.hoisted(() => ({ resetWindows: vi.fn() }));

vi.mock('../store/useDockLayoutStore', () => ({
  useDockLayoutStore: { getState: () => dockStore },
}));

import { resetWorkspaceLayout } from './resetLayout';

// Every locale below is resolved from the existing i18n store and the shared
// supported-languages config. This file names no language of its own.
const listInterfaceCodes = (): string[] => supportedLanguages.map(({ code }) => code);

const readConfiguredFallback = (): string => {
  const fallback = i18n.options.fallbackLng;
  if (typeof fallback === 'string' && fallback.length > 0) return fallback;
  if (Array.isArray(fallback)) {
    const first = fallback.find((code): code is string => typeof code === 'string' && code.length > 0);
    if (first) return first;
  }
  const [firstConfigured] = listInterfaceCodes();
  if (!firstConfigured) throw new Error('No interface locales configured');
  return firstConfigured;
};

const flushPendingWork = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(async () => { await i18nReady; });

beforeEach(() => { dockStore.resetWindows.mockClear(); });

describe('reset layout preserves the interface locale', () => {
  it('resets panels while leaving a non-default locale exactly as set', async () => {
    const fallback = readConfiguredFallback();
    const alternate = listInterfaceCodes().find((code) => code !== fallback);
    expect(alternate).toBeDefined();
    await changeInterfaceLanguage(alternate as string);
    const languageBefore = i18n.language;
    const resolvedBefore = i18n.resolvedLanguage;
    const documentLanguageBefore = document.documentElement.lang;
    const changeLanguage = vi.spyOn(i18n, 'changeLanguage');

    try {
      resetWorkspaceLayout();

      expect(dockStore.resetWindows).toHaveBeenCalledOnce();
      await flushPendingWork();
      expect(changeLanguage).not.toHaveBeenCalled();
      expect(i18n.language).toBe(languageBefore);
      expect(i18n.resolvedLanguage).toBe(resolvedBefore);
      expect(document.documentElement.lang).toBe(documentLanguageBefore);
    } finally {
      vi.restoreAllMocks();
      await changeInterfaceLanguage(fallback);
    }
  });

  it('resets panels while leaving the default locale exactly as set', async () => {
    const fallback = readConfiguredFallback();
    await changeInterfaceLanguage(fallback);
    const languageBefore = i18n.language;
    const resolvedBefore = i18n.resolvedLanguage;
    const documentLanguageBefore = document.documentElement.lang;
    const changeLanguage = vi.spyOn(i18n, 'changeLanguage');

    try {
      resetWorkspaceLayout();

      expect(dockStore.resetWindows).toHaveBeenCalledOnce();
      await flushPendingWork();
      expect(changeLanguage).not.toHaveBeenCalled();
      expect(i18n.language).toBe(languageBefore);
      expect(i18n.resolvedLanguage).toBe(resolvedBefore);
      expect(document.documentElement.lang).toBe(documentLanguageBefore);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
