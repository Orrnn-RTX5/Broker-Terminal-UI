// @vitest-environment jsdom
/**
 * SUI settings coverage (1/3): useSettingsStore defaults + persistence shape.
 *
 * Pins the shipped defaults for the Options -> Trade section (trade defaults +
 * one-click flag) and the zustand persist contract (key `rtx5-settings`, six
 * slices, actions excluded). Locale is intentionally NOT part of this store:
 * interface language is owned by i18n (localStorage `i18nextLng`, fallback
 * `en`); these tests pin that separation so SUI-T8 wiring cannot silently
 * move locale into persisted settings.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from './useSettingsStore';
import { supportedLanguages } from '../config/supportedLanguages';

const PERSIST_KEY = 'rtx5-settings';

beforeEach(() => {
    window.localStorage.removeItem(PERSIST_KEY);
    useSettingsStore.getState().resetToDefaults();
});

describe('useSettingsStore trade defaults', () => {
    it('ships MT-style order defaults: automatic symbol, last-used volume/deviation', () => {
        const { trade } = useSettingsStore.getState();
        expect(trade.defaultSymbolMode).toBe('automatic');
        expect(trade.defaultVolumeMode).toBe('last-used');
        expect(trade.defaultVolume).toBe(0.01);
        expect(trade.defaultDeviationMode).toBe('last-used');
        expect(trade.defaultDeviation).toBe(0);
    });

    it('ships with one-click trading OFF so orders require confirmation until enabled', () => {
        expect(useSettingsStore.getState().trade.oneClickTrading).toBe(false);
        expect(typeof useSettingsStore.getState().trade.oneClickTrading).toBe('boolean');
    });

    it('updateTradeSettings merges without dropping sibling trade defaults', () => {
        useSettingsStore.getState().updateTradeSettings({ oneClickTrading: true, defaultVolume: 0.5 });
        const { trade } = useSettingsStore.getState();
        expect(trade.oneClickTrading).toBe(true);
        expect(trade.defaultVolume).toBe(0.5);
        expect(trade.defaultSymbolMode).toBe('automatic');
        expect(trade.defaultVolumeMode).toBe('last-used');
        expect(trade.defaultDeviation).toBe(0);
    });

    it('resetToDefaults restores the shipped trade defaults', () => {
        useSettingsStore.getState().updateTradeSettings({ oneClickTrading: true, defaultVolume: 2 });
        useSettingsStore.getState().resetToDefaults();
        expect(useSettingsStore.getState().trade).toEqual({
            defaultSymbolMode: 'automatic',
            defaultVolumeMode: 'last-used',
            defaultVolume: 0.01,
            defaultDeviationMode: 'last-used',
            defaultDeviation: 0,
            oneClickTrading: false,
        });
    });
});

describe('useSettingsStore persistence shape', () => {
    it('persists under the rtx5-settings key', () => {
        expect(useSettingsStore.persist.getOptions().name).toBe(PERSIST_KEY);
    });

    it('snapshot and persisted state carry exactly the six settings slices', () => {
        const snapshot = useSettingsStore.getState().getSnapshot();
        expect(Object.keys(snapshot).sort()).toEqual(
            ['automation', 'charts', 'keyboardShortcuts', 'notifications', 'server', 'trade'].sort(),
        );

        useSettingsStore.getState().updateTradeSettings({ oneClickTrading: true });
        const raw = window.localStorage.getItem(PERSIST_KEY);
        expect(raw).not.toBeNull();
        const persisted = JSON.parse(raw as string) as { state: Record<string, unknown> };
        expect(Object.keys(persisted.state).sort()).toEqual(
            ['automation', 'charts', 'keyboardShortcuts', 'notifications', 'server', 'trade'].sort(),
        );
        expect((persisted.state.trade as { oneClickTrading: unknown }).oneClickTrading).toBe(true);
    });

    it('never persists store actions alongside the settings slices', () => {
        useSettingsStore.getState().updateServerSettings({ enableNews: false });
        const persisted = JSON.parse(window.localStorage.getItem(PERSIST_KEY) as string) as {
            state: Record<string, unknown>;
        };
        for (const action of [
            'updateServerSettings',
            'updateChartsSettings',
            'updateTradeSettings',
            'updateAutomationSettings',
            'updateNotificationsSettings',
            'updateKeyboardShortcutsSettings',
            'updateShortcut',
            'addAllowedURL',
            'removeAllowedURL',
            'resetToDefaults',
            'getSnapshot',
            'restoreSnapshot',
        ]) {
            expect(persisted.state).not.toHaveProperty(action);
        }
    });

    it('restoreSnapshot round-trips the full settings state', () => {
        const snapshot = useSettingsStore.getState().getSnapshot();
        useSettingsStore.getState().updateTradeSettings({ oneClickTrading: true });
        useSettingsStore.getState().updateServerSettings({ enableNews: false });
        useSettingsStore.getState().restoreSnapshot(snapshot);
        expect(useSettingsStore.getState().trade.oneClickTrading).toBe(false);
        expect(useSettingsStore.getState().server.enableNews).toBe(true);
    });
});

describe('settings store locale separation', () => {
    it('owns no locale/language key: interface language lives in i18n, not in persisted settings', () => {
        const state = useSettingsStore.getState();
        expect(state).not.toHaveProperty('locale');
        expect(state).not.toHaveProperty('language');
        expect(useSettingsStore.getState().getSnapshot()).not.toHaveProperty('locale');
    });

    it('i18n offers English so the neutral locale fallback exists outside this store', () => {
        expect(supportedLanguages.map(({ code }) => code)).toContain('en');
    });
});
