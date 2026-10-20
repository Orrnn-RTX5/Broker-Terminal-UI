// @vitest-environment jsdom

/**
 * SUI-T19d contract: File Exit receives real dirty-state.
 *
 * MenuBar must not hardcode hasUnsavedChanges={false}, and FileMenu must not
 * hardcode zero trade counts into ExitConfirmDialog: open positions / pending
 * orders from live terminal state must surface in the exit confirmation, and
 * a clean terminal must exit directly without a confirm dialog.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDrawingSidebarStore } from '../../store/useDrawingSidebarStore';
import { useTerminalBarsStore } from '../../store/useTerminalBarsStore';
import { useTerminalResolutionStore } from '../../store/useTerminalResolutionStore';
import {
    defaultChartProperties,
    useChartSettingsStore,
} from '../../store/useChartSettingsStore';

vi.mock('react-i18next', async (importOriginal) => {
    const mockTranslations: Record<string, string> = {
        'menu.file.newChart': 'New Chart',
        'menu.file.openDeleted': 'Open Deleted',
        'menu.file.profiles': 'Profiles',
        'menu.file.close': 'Close',
        'menu.file.save': 'Save',
        'menu.file.saveAsPicture': 'Save As Picture',
        'menu.file.openDataFolder': 'Open Data Folder',
        'menu.file.print': 'Print',
        'menu.file.printPreview': 'Print Preview',
        'menu.file.printSetup': 'Print Setup',
        'menu.file.openAccount': 'Open an Account',
        'menu.file.loginTrade': 'Login to Trade Account',
        'menu.file.loginWeb': 'Login to Web Trader',
        'menu.file.loginMql5': 'Login to RTX5.community',
        'menu.file.exit': 'Exit',
    };
    return {
        ...await importOriginal<typeof import('react-i18next')>(),
        useTranslation: () => ({
            t: (key: string) => mockTranslations[key] || key,
        }),
    };
});

vi.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
}));

const appStoreState = vi.hoisted(() => ({
    selectedSymbol: 'XAUUSD',
    timeframe: 'M15' as const,
    isAuthenticated: true,
    positions: [] as Array<Record<string, unknown>>,
    orders: [] as Array<Record<string, unknown>>,
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
    useDesktopRelease: () => ({ release: null, status: 'idle', error: null }),
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

const exitDialogSeen = vi.hoisted(() => ({ current: null as null | { isOpen: boolean; changes: Record<string, unknown> } }));

vi.mock('../dialogs/ExitConfirmDialog', () => ({
    ExitConfirmDialog: ({ isOpen, changes, onConfirm, onCancel }: {
        isOpen: boolean;
        changes: { openTradesCount: number; draftOrdersCount: number };
        onConfirm: (save: boolean) => void;
        onCancel: () => void;
    }) => {
        exitDialogSeen.current = { isOpen, changes: changes as unknown as Record<string, unknown> };
        if (!isOpen) return null;
        return (
            <div data-testid="exit-confirm-dialog">
                <span>{`${changes.openTradesCount} open positions`}</span>
                <span>{`${changes.draftOrdersCount} pending orders`}</span>
                <button type="button" onClick={() => onConfirm(true)}>Confirm Exit</button>
                <button type="button" onClick={onCancel}>Cancel Exit</button>
            </div>
        );
    },
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
        version: 'exit-dirty-state-contract',
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

const installElectronBridge = () => {
    Object.defineProperty(window, 'electron', {
        configurable: true,
        writable: true,
        value: { window: { minimize: vi.fn(), maximize: vi.fn(), close: vi.fn() } },
    });
};

const seedPositions = (count: number) => {
    appStoreState.positions = Array.from({ length: count }, (_, index) => ({
        id: `position-${index + 1}`,
        ticket: 1000 + index,
        symbol: 'XAUUSD',
        side: 'BUY',
        volume: 0.01,
    }));
};

const seedOrders = (statuses: string[]) => {
    appStoreState.orders = statuses.map((status, index) => ({
        id: `order-${index + 1}`,
        ticket: 2000 + index,
        symbol: 'XAUUSD',
        status,
    }));
};

beforeEach(() => {
    localStorage.clear();
    appStoreState.isAuthenticated = true;
    appStoreState.positions = [];
    appStoreState.orders = [];
    exitDialogSeen.current = null;
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

describe('File Exit dirty-state contract (SUI-T19d)', () => {
    it('surfaces live open positions in the Exit confirm instead of hardcoded zeros', () => {
        seedPositions(2);
        const onExit = vi.fn();
        render(<FileMenu onSave={vi.fn()} onExit={onExit} />);

        fireEvent.click(screen.getByText('Exit').closest('button')!);

        expect(screen.getByTestId('exit-confirm-dialog')).toBeInTheDocument();
        expect(screen.getByText('2 open positions')).toBeInTheDocument();
        expect(exitDialogSeen.current?.changes).toMatchObject({
            hasOpenTrades: true,
            openTradesCount: 2,
        });
        expect(onExit).not.toHaveBeenCalled();
    });

    it('surfaces live pending orders in the Exit confirm instead of hardcoded zeros', () => {
        seedOrders(['PENDING', 'FILLED']);
        const onExit = vi.fn();
        render(<FileMenu onSave={vi.fn()} onExit={onExit} />);

        fireEvent.click(screen.getByText('Exit').closest('button')!);

        expect(screen.getByTestId('exit-confirm-dialog')).toBeInTheDocument();
        expect(screen.getByText('1 pending orders')).toBeInTheDocument();
        expect(exitDialogSeen.current?.changes).toMatchObject({
            hasDraftOrders: true,
            draftOrdersCount: 1,
        });
        expect(onExit).not.toHaveBeenCalled();
    });

    it('exits directly without a confirm when the terminal is clean', () => {
        const onExit = vi.fn();
        render(<FileMenu onSave={vi.fn()} onExit={onExit} />);

        fireEvent.click(screen.getByText('Exit').closest('button')!);

        expect(onExit).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('exit-confirm-dialog')).not.toBeInTheDocument();
    });

    it('wires MenuBar File Exit to live trade state instead of a hardcoded clean flag', () => {
        installElectronBridge();

        seedPositions(1);
        render(<MenuBar />);
        fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
        fireEvent.click(screen.getByText('Exit').closest('button')!);
        expect(screen.getByTestId('exit-confirm-dialog')).toBeInTheDocument();
        expect(screen.getByText('1 open positions')).toBeInTheDocument();
        cleanup();

        appStoreState.positions = [];
        appStoreState.orders = [];
        exitDialogSeen.current = null;
        render(<MenuBar />);
        fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
        fireEvent.click(screen.getByText('Exit').closest('button')!);
        expect(screen.queryByTestId('exit-confirm-dialog')).not.toBeInTheDocument();
        expect(screen.queryByRole('menu', { name: 'File menu' })).not.toBeInTheDocument();
    });
});
