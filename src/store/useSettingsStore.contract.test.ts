// @vitest-environment jsdom
/**
 * SUI settings coverage (2/3): settings-store hook contract for the SUI-T8 agent.
 *
 * SUI-T8 ("Options settings are saved but never read: wire the trade defaults
 * and one-click") will consume this store. These tests pin the CURRENT hook
 * interface -- hook names, value types, defaults -- so they pass before AND
 * after the wiring: the wiring adds consumers, it must not change this shape.
 * Written against the current interface only; no production code touched.
 */
import { act } from 'react';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    useAutomationSettings,
    useChartsSettings,
    useKeyboardShortcutsSettings,
    useNotificationsSettings,
    useServerSettings,
    useSettingsStore,
    useTradeSettings,
} from './useSettingsStore';

beforeEach(() => {
    useSettingsStore.getState().resetToDefaults();
});

describe('settings hook interface contract', () => {
    it('exposes every section selector hook the order path will consume', () => {
        for (const hook of [
            useServerSettings,
            useChartsSettings,
            useTradeSettings,
            useAutomationSettings,
            useNotificationsSettings,
            useKeyboardShortcutsSettings,
        ]) {
            expect(typeof hook).toBe('function');
        }
    });

    it('useTradeSettings returns the full TradeSettings value shape with typed defaults', () => {
        const { result } = renderHook(() => useTradeSettings());
        expect(result.current.defaultSymbolMode).toBe('automatic');
        expect(result.current.defaultVolumeMode).toBe('last-used');
        expect(result.current.defaultVolume).toBe(0.01);
        expect(typeof result.current.defaultVolume).toBe('number');
        expect(result.current.defaultDeviationMode).toBe('last-used');
        expect(result.current.defaultDeviation).toBe(0);
        expect(typeof result.current.defaultDeviation).toBe('number');
        expect(result.current.oneClickTrading).toBe(false);
        expect(typeof result.current.oneClickTrading).toBe('boolean');
    });

    it('trade defaults update through updateTradeSettings and are visible via useTradeSettings', () => {
        expect(typeof useSettingsStore.getState().updateTradeSettings).toBe('function');
        const { result } = renderHook(() => useTradeSettings());
        act(() => {
            useSettingsStore.getState().updateTradeSettings({
                defaultVolumeMode: 'default',
                defaultVolume: 0.25,
                defaultDeviationMode: 'default',
                defaultDeviation: 10,
            });
        });
        expect(result.current.defaultVolumeMode).toBe('default');
        expect(result.current.defaultVolume).toBe(0.25);
        expect(result.current.defaultDeviationMode).toBe('default');
        expect(result.current.defaultDeviation).toBe(10);
        // Untouched one-click flag survives a trade-defaults write.
        expect(result.current.oneClickTrading).toBe(false);
    });

    it('one-click flag toggles both directions for the SUI-T9 confirmation gate', () => {
        const { result } = renderHook(() => useTradeSettings());
        act(() => {
            useSettingsStore.getState().updateTradeSettings({ oneClickTrading: true });
        });
        expect(result.current.oneClickTrading).toBe(true);
        act(() => {
            useSettingsStore.getState().updateTradeSettings({ oneClickTrading: false });
        });
        expect(result.current.oneClickTrading).toBe(false);
    });

    it('section selectors stay referentially stable when an unrelated slice changes', () => {
        const { result } = renderHook(() => useTradeSettings());
        const before = result.current;
        act(() => {
            useSettingsStore.getState().updateServerSettings({ enableNews: false });
        });
        expect(result.current).toBe(before);
    });

    it('every section selector reflects its slice of the same store', () => {
        const trade = renderHook(() => useTradeSettings());
        const server = renderHook(() => useServerSettings());
        const charts = renderHook(() => useChartsSettings());
        const automation = renderHook(() => useAutomationSettings());
        const notifications = renderHook(() => useNotificationsSettings());
        const shortcuts = renderHook(() => useKeyboardShortcutsSettings());
        const state = useSettingsStore.getState();
        expect(trade.result.current).toBe(state.trade);
        expect(server.result.current).toBe(state.server);
        expect(charts.result.current).toBe(state.charts);
        expect(automation.result.current).toBe(state.automation);
        expect(notifications.result.current).toBe(state.notifications);
        expect(shortcuts.result.current).toBe(state.keyboardShortcuts);
    });
});
