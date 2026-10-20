// @vitest-environment jsdom

/**
 * SUI-T19d contract: every shortcut hint rendered by MenuBar/FileMenu must
 * resolve through getTerminalShortcutHint OR through tr() with an existing
 * ui.json key (localized hints such as Ctrl+S/Ctrl+P/Ctrl+Shift+D/Shift+F5/
 * Ctrl+F5 are translated in de/fr/es/it/tr and must be kept). No RAW
 * hardcoded English hint strings are allowed.
 *
 * Each rendered `.rtx-menu-row__shortcut` must satisfy EITHER:
 * (a) it equals a TERMINAL_SHORTCUTS catalog value produced by an actual
 *     getTerminalShortcutHint(id) call observed during render, OR
 * (b) it equals a tr() key observed during render that exists in
 *     src/locales/en/ui.json (localized hint).
 */

import '@testing-library/jest-dom';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keyboardShortcutManager } from '../../services/keyboardShortcutManager';
import { TERMINAL_SHORTCUTS } from '../../services/shortcutCatalog';
import { useDrawingSidebarStore } from '../../store/useDrawingSidebarStore';
import { useTerminalBarsStore } from '../../store/useTerminalBarsStore';
import { useTerminalResolutionStore } from '../../store/useTerminalResolutionStore';
import {
    defaultChartProperties,
    useChartSettingsStore,
} from '../../store/useChartSettingsStore';

const hintCalls = vi.hoisted(() => ({ ids: [] as string[] }));
const trCalls = vi.hoisted(() => ({ keys: [] as string[] }));

vi.mock('../../services/shortcutCatalog', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../services/shortcutCatalog')>();
    return {
        ...actual,
        getTerminalShortcutHint: (id: string) => {
            hintCalls.ids.push(id);
            return actual.getTerminalShortcutHint(id);
        },
    };
});

vi.mock('../../hooks/useUiTranslation', () => {
    const record = (source: unknown): void => {
        if (typeof source === 'string') trCalls.keys.push(source);
    };
    const translate = (source: string, values?: Record<string, unknown>): string => {
        record(source);
        if (values) {
            return source.replace(/{{(\w+)}}/g, (_, key: string) => String(values[key] ?? ''));
        }
        return source;
    };
    return {
        useUiTranslation: () => translate,
        translateUi: translate,
    };
});

vi.mock('react-i18next', async (importOriginal) => ({
    ...await importOriginal<typeof import('react-i18next')>(),
    useTranslation: () => ({
        t: (key: string) => key,
        i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
}));

vi.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
}));

const appStoreState = vi.hoisted(() => ({
    selectedSymbol: 'XAUUSD',
    timeframe: 'M15',
    isAuthenticated: true,
    positions: [] as unknown[],
    orders: [] as unknown[],
    logout: vi.fn(),
}));

vi.mock('../../store/useAppStore', () => {
    const useAppStore = (selector: (value: typeof appStoreState) => unknown) => selector(appStoreState);
    (useAppStore as unknown as { getState: () => unknown }).getState = () => appStoreState;
    return { useAppStore };
});

const catalogApiMock = vi.hoisted(() => ({
    getSymbols: vi.fn(async (): Promise<Array<Record<string, string>>> => []),
}));

vi.mock('../../services/api', () => ({
    default: {
        market: {
            getSymbols: catalogApiMock.getSymbols,
        },
    },
}));

vi.mock('../../hooks/useDesktopRelease', () => ({
    useDesktopRelease: () => ({ release: null, status: 'idle', error: null, available: false }),
}));

vi.mock('../../services/chartPrinter', () => ({
    chartPrinter: {
        getPreferences: vi.fn(() => ({})),
        printChart: vi.fn(),
        setPreferences: vi.fn(),
        captureActiveChartData: vi.fn(async () => ({
            symbol: 'XAUUSD',
            timeframe: 'M15',
            chartCanvas: document.createElement('canvas'),
            indicators: [],
            drawings: [],
        })),
    },
}));

vi.mock('../../services/localWorkspaceProfiles', () => ({
    BUILTIN_WORKSPACE_PROFILE_NAMES: ['Default', 'Euro', 'Market Overview'],
    listWorkspaceProfiles: vi.fn(() => []),
    restoreWorkspaceProfile: vi.fn(() => ({ status: 'missing', profile: null })),
    saveCurrentWorkspaceProfile: vi.fn(),
    deleteWorkspaceProfile: vi.fn(() => false),
    restoreBuiltinWorkspaceProfile: vi.fn(() => ({ status: 'missing', profile: null })),
}));

vi.mock('../dialogs/SaveWorkspaceDialog', () => ({
    SaveWorkspaceDialog: () => null,
}));

vi.mock('../dialogs/PrintSetupDialog', () => ({
    PrintSetupDialog: () => null,
}));

vi.mock('../dialogs/PrintPreviewDialog', () => ({
    PrintPreviewDialog: () => null,
}));

vi.mock('../dialogs/ExitConfirmDialog', () => ({
    ExitConfirmDialog: () => null,
}));

vi.mock('../dialogs/SavePictureDialog', () => ({
    SavePictureDialog: () => null,
}));

vi.mock('../dialogs/OpenAccountDialog', () => ({
    OpenAccountDialog: () => null,
}));

vi.mock('../settings/OptionsDialog', () => ({
    OptionsDialog: () => null,
}));

vi.mock('../SymbolsDialog', () => ({
    SymbolsDialog: () => null,
}));

vi.mock('../LoginDialog', () => ({
    LoginDialog: () => null,
}));

const openWebTraderMock = vi.hoisted(() => vi.fn());
const dockStoreFixture = vi.hoisted(() => ({
    layout: {
        version: 'shortcut-contract',
        root: {
            id: 'root', type: 'split', ratio: 1, children: [
                { id: 'chart-a', title: 'XAUUSD,M1', component: 'Chart', props: { symbol: 'XAUUSD', timeframe: 'M1' } },
            ],
        },
        floatingPanels: [],
    },
    recentlyClosedCharts: [] as unknown[],
    arrangeIcons: vi.fn(() => 1),
    resetWindows: vi.fn(),
    resetToDefaultLayout: vi.fn(),
    closeActiveChart: vi.fn(() => true),
    restoreClosedChart: vi.fn(() => true),
    arrangeCharts: vi.fn(),
    tileWindows: vi.fn(),
}));

vi.mock('../../services/webTrader', () => ({
    openWebTrader: openWebTraderMock,
}));

vi.mock('../../store/useDockLayoutStore', () => {
    const getState = () => ({ ...dockStoreFixture });
    const useDockLayoutStore = (selector: (state: ReturnType<typeof getState>) => unknown) => selector(getState());
    (useDockLayoutStore as unknown as { getState: () => unknown }).getState = getState;
    return { useDockLayoutStore };
});

import { FileMenu } from './FileMenu';
import { MenuBar } from './MenuBar';
import enUi from '../../locales/en/ui.json';

const catalogHintFor = (id: string): string => {
    const entry = TERMINAL_SHORTCUTS.find(shortcut => shortcut.id === id);
    if (!entry) return '';
    return keyboardShortcutManager.formatShortcut(entry as never);
};

const catalogHintValues = (): Set<string> => new Set(
    TERMINAL_SHORTCUTS.map(shortcut => catalogHintFor(shortcut.id)).filter(hint => hint !== ''),
);

const collectRenderedHints = (): string[] => Array.from(
    document.querySelectorAll('.rtx-menu-row__shortcut'),
)
    .map(node => (node.textContent || '').trim())
    .filter(text => text.length > 0);

/** Localized hints kept via tr(): each key must exist in src/locales/en/ui.json
 * (and is translated in de/fr/es/it/tr — routing them through the
 * English-only catalog would erase localization). */
const LOCALIZED_HINT_KEYS = ['Shift+F5', 'Ctrl+F5', 'Ctrl+S', 'Ctrl+Shift+D', 'Ctrl+P'];

const uiKeys = (): Set<string> => new Set(Object.keys(enUi as Record<string, unknown>));

/**
 * Every rendered hint must EITHER be a catalog value produced via
 * getTerminalShortcutHint(id) OR a tr() key with an existing ui.json entry.
 * RAW hardcoded English hint strings satisfy neither branch and fail.
 */
const expectHintsResolveThroughCatalogOrLocalizedTr = (hints: string[]) => {
    const expected = catalogHintValues();
    const localized = uiKeys();
    expect(hints.length).toBeGreaterThan(0);
    for (const hint of hints) {
        const viaCatalog = expected.has(hint)
            && hintCalls.ids.some(id => catalogHintFor(id) === hint);
        if (viaCatalog) continue;
        const viaLocalizedTr = trCalls.keys.includes(hint) && localized.has(hint);
        expect(
            viaLocalizedTr,
            `hint "${hint}" must resolve via getTerminalShortcutHint(id) or tr() with a ui.json key`,
        ).toBe(true);
    }
};

const installElectronBridge = () => {
    Object.defineProperty(window, 'electron', {
        configurable: true,
        writable: true,
        value: { window: { minimize: vi.fn(), maximize: vi.fn(), close: vi.fn() } },
    });
};

beforeEach(() => {
    hintCalls.ids = [];
    trCalls.keys = [];
});

afterEach(() => {
    cleanup();
    delete (window as { electron?: unknown }).electron;
    useDrawingSidebarStore.setState({ visible: true });
    useTerminalBarsStore.setState({ statusBarVisible: true, chartsBarVisible: true, timeframesVisible: true });
    useTerminalResolutionStore.getState().setResolution('1920x1080');
    useChartSettingsStore.setState({
        globalProperties: { ...defaultChartProperties, colors: { ...defaultChartProperties.colors } },
        symbolProperties: {},
    });
    vi.restoreAllMocks();
});

describe('MenuBar/FileMenu shortcut-hint contract (SUI-T19d)', () => {
    it('routes every FileMenu shortcut hint through getTerminalShortcutHint or localized tr()', () => {
        installElectronBridge();
        render(
            <FileMenu
                onSave={vi.fn()}
                onSaveAsPicture={vi.fn()}
                onOpenDataFolder={vi.fn()}
                onPrint={vi.fn()}
                onPrintPreview={vi.fn()}
                onPrintSetup={vi.fn()}
                onExit={vi.fn()}
            />,
        );

        expectHintsResolveThroughCatalogOrLocalizedTr(collectRenderedHints());
    });

    it('renders no RAW hardcoded hint strings in FileMenu (tr()-localized hints allowed)', () => {
        installElectronBridge();
        render(
            <FileMenu
                onSave={vi.fn()}
                onOpenDataFolder={vi.fn()}
                onExit={vi.fn()}
            />,
        );

        const hints = collectRenderedHints();
        expect(hints.length).toBeGreaterThan(0);
        // Every rendered hint satisfies the either/or contract (no RAW strings).
        expectHintsResolveThroughCatalogOrLocalizedTr(hints);
        // The five localized hints are tr()-sourced with existing ui.json keys (kept).
        const localized = uiKeys();
        for (const key of LOCALIZED_HINT_KEYS) {
            expect(localized.has(key), `localized hint key "${key}" must exist in en/ui.json`).toBe(true);
            if (hints.includes(key)) {
                expect(trCalls.keys, `localized hint "${key}" must render via tr()`).toContain(key);
            }
        }
        // Ctrl+F4 has a ui.json key but no catalog id and no tr() call site: it must never render.
        expect(hints, 'unresolvable hint "Ctrl+F4" must not render').not.toContain('Ctrl+F4');
    });

    it('routes every desktop menu shortcut hint through getTerminalShortcutHint or localized tr()', () => {
        installElectronBridge();
        render(<MenuBar />);

        const seen = new Set<string>();
        const collect = () => {
            for (const hint of collectRenderedHints()) seen.add(hint);
        };

        for (const top of ['File', 'View', 'Insert', 'Charts', 'Tools', 'Window', 'Help'] as const) {
            fireEvent.click(screen.getByRole('menuitem', { name: top }));
            collect();
            if (top === 'Insert') {
                fireEvent.click(screen.getByRole('menuitem', { name: 'menu.insert.objects' }));
                collect();
                fireEvent.click(screen.getByRole('menuitem', { name: 'Lines' }));
                collect();
            }
            if (top === 'Charts') {
                fireEvent.click(screen.getByRole('menuitem', { name: 'menu.charts.objects' }));
                collect();
            }
        }

        expectHintsResolveThroughCatalogOrLocalizedTr(Array.from(seen));
    });

    it('routes web launcher chart-control hints through getTerminalShortcutHint or localized tr()', () => {
        render(<MenuBar />);

        fireEvent.click(screen.getByRole('button', { name: 'Open application menu' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Chart settings' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Chart controls' }));

        expectHintsResolveThroughCatalogOrLocalizedTr(collectRenderedHints());
    });
});
