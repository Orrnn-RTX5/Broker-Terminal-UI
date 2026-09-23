import { waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n, { changeInterfaceLanguage, i18nReady } from '../i18n';

const dockStore = vi.hoisted(() => ({ resetWindows: vi.fn() }));

vi.mock('../store/useDockLayoutStore', () => ({
  useDockLayoutStore: { getState: () => dockStore },
}));

import { resetWorkspaceLayout } from './resetLayout';

const collectOrderFeedback = () => {
  const events: CustomEvent<{ message: string; type: string }>[] = [];
  const listener = (event: Event) => { events.push(event as CustomEvent<{ message: string; type: string }>); };
  window.addEventListener('rtx:order-feedback', listener);
  return { events, dispose: () => window.removeEventListener('rtx:order-feedback', listener) };
};

beforeAll(async () => { await i18nReady; });

beforeEach(async () => {
  dockStore.resetWindows.mockClear();
  await changeInterfaceLanguage('fr');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await changeInterfaceLanguage('en');
});

afterAll(() => { localStorage.removeItem('i18nextLng'); });

describe('reset layout', () => {
  it('restores the default windows and switches the interface language back to English', async () => {
    resetWorkspaceLayout();

    expect(dockStore.resetWindows).toHaveBeenCalledOnce();
    await waitFor(() => expect(i18n.language).toBe('en'));
    expect(localStorage.getItem('i18nextLng')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('leaves an already English interface alone', async () => {
    await changeInterfaceLanguage('en');
    const changeLanguage = vi.spyOn(i18n, 'changeLanguage');

    resetWorkspaceLayout();

    expect(dockStore.resetWindows).toHaveBeenCalledOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changeLanguage).not.toHaveBeenCalled();
    expect(localStorage.getItem('i18nextLng')).toBe('en');
  });

  it('keeps the current language and reports the failure when English cannot be loaded', async () => {
    const feedback = collectOrderFeedback();
    vi.spyOn(i18n, 'loadLanguages').mockImplementation((_language, callback) => {
      callback?.(new Error('Chunk unavailable'), i18n.t);
      return Promise.resolve();
    });

    try {
      resetWorkspaceLayout();

      expect(dockStore.resetWindows).toHaveBeenCalledOnce();
      await waitFor(() => expect(feedback.events).toHaveLength(1));
      expect(feedback.events[0].detail.type).toBe('error');
      expect(feedback.events[0].detail.message).toBe('Impossible de changer de langue. Veuillez réessayer.');
      expect(i18n.language).toBe('fr');
    } finally {
      feedback.dispose();
    }
  });
});
