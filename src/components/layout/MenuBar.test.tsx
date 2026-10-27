// @vitest-environment jsdom

import '@testing-library/jest-dom';
import { useDrawingSidebarStore } from '../../store/useDrawingSidebarStore';
import { useTerminalBarsStore } from '../../store/useTerminalBarsStore';
import { useTerminalResolutionStore } from '../../store/useTerminalResolutionStore';
import { TerminalViewport } from './TerminalViewport';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DockLayout } from '../../services/dockManager';
import { activateActiveChartSource, registerActiveChartSource } from '../../services/activeChartSource';

// Repeated jsdom accessibility queries run more slowly on Windows.
const menuInteractionTimeoutMs = process.platform === 'win32' ? 30000 : 10000;

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

vi.mock('../../store/useAppStore', () => {
    const state = {
        isAuthenticated: false,
        selectedSymbol: 'XAUUSD',
        savedAccounts: [{ login: 200002, name: 'Arijit Nayak', server: 'MetaQuotes-Demo', isLive: false }],
    };
    const useAppStore = (selector: (value: typeof state) => unknown) => selector(state);
    useAppStore.getState = () => state;
    return { useAppStore };
});

const openWebTraderMock = vi.hoisted(() => vi.fn().mockResolvedValue({
    status: 'opened',
    brokerId: 'test',
    brokerName: 'Test Broker',
    url: 'https://terminal.example.com',
    openedWith: 'browser',
}));
const closeActiveChartMock = vi.hoisted(() => vi.fn(() => true));
const arrangeChartsMock = vi.hoisted(() => vi.fn());
const tileWindowsMock = vi.hoisted(() => vi.fn());
const dockStoreFixture = vi.hoisted(() => ({
    layout: {
        version: 'menu-test',
        root: { id: 'root', type: 'split', ratio: 1, children: [
            { id: 'chart-a', title: 'XAUUSD,M1', component: 'Chart', props: { symbol: 'XAUUSD', timeframe: 'M1' } },
        ] },
        floatingPanels: [],
    } as DockLayout,
    arrangeIcons: vi.fn(() => 1),
    resetWindows: vi.fn(),
    resetToDefaultLayout: vi.fn(),
}));

vi.mock('../../services/webTrader', () => ({
    openWebTrader: openWebTraderMock,
}));

vi.mock('../../store/useDockLayoutStore', () => {
    const getState = () => ({ ...dockStoreFixture, closeActiveChart: closeActiveChartMock, arrangeCharts: arrangeChartsMock, tileWindows: tileWindowsMock });
    const useDockLayoutStore = (selector: (state: ReturnType<typeof getState>) => unknown) => selector(getState());
    useDockLayoutStore.getState = getState;
    return { useDockLayoutStore };
});

vi.mock('./FileMenu', () => ({
    FileMenu: ({
        onSave,
        onCloseActiveChart,
        onChartRestored,
        onProfileRestored,
        onLoginTrade,
        onLoginWebTrader,
        onOpenDataFolder,
        onExit,
        accountId,
        onLogout,
        shortcutsOnly,
    }: {
        onSave: (workspaceName?: string) => void;
        onCloseActiveChart?: () => void;
        onChartRestored?: () => void;
        onProfileRestored?: (profileName: string) => void;
        onLoginTrade?: () => void;
        onLoginWebTrader?: () => void;
        onOpenDataFolder?: () => void;
        onExit?: () => void;
        accountId?: string;
        onLogout?: () => void;
        shortcutsOnly?: boolean;
    }) => shortcutsOnly ? null : (
        <div data-testid="file-menu">
            <button type="button" onClick={() => onSave('Default')}>Save workspace</button>
            {onCloseActiveChart && <button type="button" onClick={onCloseActiveChart}>Close current chart</button>}
            {onChartRestored && <button type="button" onClick={onChartRestored}>Restore chart</button>}
            {onProfileRestored && <button type="button" onClick={() => onProfileRestored('Market')}>Restore profile</button>}
            {onLoginTrade && <button type="button" onClick={onLoginTrade}>Login trade account</button>}
            {onLoginWebTrader && <button type="button" onClick={onLoginWebTrader}>Open web trader</button>}
            {onOpenDataFolder && <button type="button" onClick={onOpenDataFolder}>Open data folder</button>}
            {onExit && <button type="button" onClick={onExit}>Exit terminal</button>}
            {accountId && <span>Current account {accountId}</span>}
            {onLogout && <button type="button" onClick={onLogout}>Log Out</button>}
        </div>
    ),
}));

vi.mock('../settings/OptionsDialog', () => ({
    OptionsDialog: ({ isOpen }: { isOpen: boolean }) => (
        isOpen ? <div role="dialog" aria-label="Options" /> : null
    ),
}));

vi.mock('../SymbolsDialog', () => ({
    SymbolsDialog: ({ isOpen }: { isOpen: boolean }) => (
        isOpen ? <div role="dialog" aria-label="Symbols dialog" /> : null
    ),
}));

vi.mock('../LoginDialog', () => ({
    LoginDialog: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
        isOpen ? (
            <div role="dialog" aria-label="Trade account login">
                <button type="button" onClick={onClose}>Close login</button>
            </div>
        ) : null
    ),
}));

import { MenuBar } from './MenuBar';
import { commandBus } from '../../services/commandBus';
import { chartPropertiesFeature, chartObjectsFeature, depthOfMarketFeature } from '../../startup/terminalFeatures';
import { drawingManager } from '../../services/drawingManager';
import {
    defaultChartProperties,
    getPresetSchemeColors,
    useChartSettingsStore,
} from '../../store/useChartSettingsStore';

type ElectronWindowApi = NonNullable<Window['electron']>['window'];

const installElectronBridge = () => {
    const windowApi: ElectronWindowApi = {
        minimize: vi.fn(),
        maximize: vi.fn(),
        close: vi.fn(),
        isMaximized: vi.fn().mockResolvedValue(false),
        setTitle: vi.fn(),
        onMaximizeChange: vi.fn(() => vi.fn()),
    };

    Object.defineProperty(window, 'electron', {
        configurable: true,
        writable: true,
        value: { window: windowApi },
    });
};

afterEach(() => {
    cleanup();
    closeActiveChartMock.mockClear();
    dockStoreFixture.layout.floatingPanels = [];
    dockStoreFixture.arrangeIcons.mockClear();
    dockStoreFixture.resetWindows.mockClear();
    dockStoreFixture.resetToDefaultLayout.mockClear();
    useDrawingSidebarStore.setState({ visible: true });
    useTerminalBarsStore.setState({ statusBarVisible: true, chartsBarVisible: true, timeframesVisible: true });
    useTerminalResolutionStore.getState().setResolution('1920x1080');
    delete window.electron;
    delete (window as Window & { __RTX_APP_ACTIVE__?: boolean }).__RTX_APP_ACTIVE__;
    useChartSettingsStore.setState({
        globalProperties: {
            ...defaultChartProperties,
            colors: { ...defaultChartProperties.colors },
        },
        symbolProperties: {},
    });
    vi.restoreAllMocks();
});

describe('chart controls intent preload', () => {
    it.each(['web', 'desktop'])('warms chart dialogs when the %s chart menu opens', surface => {
        if (surface === 'desktop') installElectronBridge();
        const spies = [chartPropertiesFeature, chartObjectsFeature, depthOfMarketFeature]
            .map(feature => vi.spyOn(feature, 'preload').mockResolvedValue(undefined as never));
        render(<MenuBar />);
        spies.forEach(spy => expect(spy).not.toHaveBeenCalled());
        if (surface === 'desktop') {
            fireEvent.click(screen.getByRole('menuitem', { name: 'Charts' }));
        } else {
            fireEvent.click(screen.getByRole('button', { name: 'Open application menu' }));
            spies.forEach(spy => expect(spy).not.toHaveBeenCalled());
            fireEvent.click(screen.getByRole('menuitem', { name: 'Chart settings' }));
        }
        spies.forEach(spy => expect(spy).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});

describe('unavailable terminal services', () => {
    it.each(['web', 'desktop'])('locks unsupported Tools entries in the %s menu and keeps working actions available', async (surface) => {
        if (surface === 'desktop') installElectronBridge();
        render(<MenuBar />);
        const openTools = () => {
            if (surface === 'desktop') {
                fireEvent.click(screen.getByRole('menuitem', { name: 'Tools' }));
            } else {
                fireEvent.click(screen.getByRole('button', { name: 'Open application menu' }));
                fireEvent.click(screen.getByRole('menuitem', { name: 'Algo Trading' }));
            }
        };
        openTools();
        const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
        for (const key of ['strategyTester', 'scriptEditor', 'agentsManager', 'taskManager', 'globalVariables', 'marketplace', 'signalsHub', 'cloudHosting']) {
            const item = screen.getByRole('menuitem', { name: `menu.tools.${key}` });
            expect(item).toBeDisabled();
            expect(item).toHaveAttribute('aria-disabled', 'true');
            expect(item.getAttribute('aria-description')).toContain('currently unavailable');
            expect(item).toHaveAttribute('title', item.getAttribute('aria-description'));
            expect(item.querySelector('.rtx-menu-row__lock')).toBeInTheDocument();
            expect(item.querySelector('.rtx-menu-row__shortcut')).not.toBeInTheDocument();
            fireEvent.click(item);
            fireEvent.keyDown(item, { key: 'Enter' });
            fireEvent.keyDown(item, { key: ' ' });
        }
        expect(dispatchSpy).not.toHaveBeenCalled();
        const newOrder = screen.getByRole('menuitem', { name: 'menu.tools.newOrder' });
        expect(newOrder).toBeEnabled();
        fireEvent.click(newOrder);
        expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'openNewOrder' }));
        openTools();
        const options = screen.getByRole('menuitem', { name: 'menu.tools.options' });
        expect(options).toBeEnabled();
        fireEvent.click(options);
        expect(await screen.findByRole('dialog', { name: 'Options' })).toBeInTheDocument();
    }, menuInteractionTimeoutMs);

    it('also locks duplicate service entries under desktop View and Help', () => {
        installElectronBridge();
        render(<MenuBar />);
        fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
        expect(screen.getByRole('menuitem', { name: 'menu.view.strategyTester' })).toBeDisabled();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }));
        for (const key of ['marketplace', 'signals', 'cloudHosting']) {
            expect(screen.getByRole('menuitem', { name: `menu.help.${key}` })).toBeDisabled();
        }
    });
});

describe('MenuBar toolbar visibility', () => {
    const openToolbars = (surface: string) => {
        if (surface === 'desktop') {
            fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
        } else {
            fireEvent.click(screen.getByRole('button', { name: 'Open application menu' }));
            fireEvent.click(screen.getByRole('menuitem', { name: 'Terminal' }));
            fireEvent.click(screen.getByRole('menuitem', { name: 'View & interface' }));
        }
        fireEvent.click(screen.getByRole('menuitem', { name: 'menu.view.toolbars' }));
    };

    it.each(['web', 'desktop'])('hides and restores Line Studies through the %s Toolbars submenu', (surface) => {
        if (surface === 'desktop') installElectronBridge();
        render(<MenuBar />);

        openToolbars(surface);
        const lineStudies = screen.getByRole('menuitemcheckbox', { name: 'Line Studies' });
        expect(lineStudies).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(lineStudies);
        expect(useDrawingSidebarStore.getState().visible).toBe(false);
        expect(useTerminalBarsStore.getState().timeframesVisible).toBe(true);
        expect(screen.queryByRole('menuitemcheckbox', { name: 'Line Studies' })).not.toBeInTheDocument();

        openToolbars(surface);
        expect(screen.getByRole('menuitemcheckbox', { name: 'Line Studies' })).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Line Studies' }));
        expect(useDrawingSidebarStore.getState().visible).toBe(true);
    });

    it.each(['web', 'desktop'])('persists the Timeframes checkbox and restores it from the %s Toolbars submenu', async (surface) => {
        if (surface === 'desktop') installElectronBridge();
        render(<MenuBar />);

        openToolbars(surface);
        const timeframes = screen.getByRole('menuitemcheckbox', { name: 'Timeframes' });
        expect(timeframes).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(timeframes);
        expect(useTerminalBarsStore.getState().timeframesVisible).toBe(false);
        expect(useTerminalBarsStore.getState().statusBarVisible).toBe(true);
        expect(useTerminalBarsStore.getState().chartsBarVisible).toBe(true);
        expect(useDrawingSidebarStore.getState().visible).toBe(true);
        expect(screen.queryByRole('menuitemcheckbox', { name: 'Timeframes' })).not.toBeInTheDocument();

        const savedBars = localStorage.getItem('rtx-terminal-bars');
        expect(savedBars).not.toBeNull();
        expect(JSON.parse(savedBars!).state.timeframesVisible).toBe(false);
        act(() => useTerminalBarsStore.setState({ timeframesVisible: true }));
        localStorage.setItem('rtx-terminal-bars', savedBars!);
        await act(async () => { await useTerminalBarsStore.persist.rehydrate(); });
        expect(useTerminalBarsStore.getState().timeframesVisible).toBe(false);

        openToolbars(surface);
        expect(screen.getByRole('menuitemcheckbox', { name: 'Timeframes' })).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Timeframes' }));
        expect(useTerminalBarsStore.getState().timeframesVisible).toBe(true);
        expect(JSON.parse(localStorage.getItem('rtx-terminal-bars')!).state.timeframesVisible).toBe(true);
    });

    it('keeps Line Studies synchronized with the existing Show and Hide drawing tools action', () => {
        render(<MenuBar />);
        const launcher = screen.getByRole('button', { name: 'Open application menu' });

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Hide drawing tools' }));
        openToolbars('web');
        expect(screen.getByRole('menuitemcheckbox', { name: 'Line Studies' })).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Line Studies' }));

        fireEvent.click(launcher);
        expect(screen.getByRole('menuitem', { name: 'Hide drawing tools' })).toBeInTheDocument();
        fireEvent.click(launcher);
        openToolbars('web');
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Line Studies' }));
        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Show drawing tools' }));

        openToolbars('web');
        expect(screen.getByRole('menuitemcheckbox', { name: 'Line Studies' })).toHaveAttribute('aria-checked', 'true');
    }, menuInteractionTimeoutMs);
});

describe('MenuBar hamburger launcher', () => {
    it.each(['statusBar', 'chartsBar'] as const)('toggles %s, updates its checkmark, and remembers the setting', async (bar) => {
        render(<MenuBar />);
        const launcher = screen.getByRole('button', { name: 'Open application menu' });
        const openView = () => {
            fireEvent.click(launcher);
            fireEvent.click(screen.getByRole('menuitem', { name: 'Terminal' }));
            fireEvent.click(screen.getByRole('menuitem', { name: 'View & interface' }));
        };
        const stateKey = bar === 'statusBar' ? 'statusBarVisible' : 'chartsBarVisible';
        const otherKey = bar === 'statusBar' ? 'chartsBarVisible' : 'statusBarVisible';
        openView();
        const item = screen.getByRole('menuitemcheckbox', { name: `menu.view.${bar}` });
        expect(item).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(item);
        expect(useTerminalBarsStore.getState()[stateKey]).toBe(false);
        expect(useTerminalBarsStore.getState()[otherKey]).toBe(true);
        expect(launcher).toHaveAttribute('aria-expanded', 'false');
        await act(async () => { await useTerminalBarsStore.persist.rehydrate(); });
        openView();
        expect(screen.getByRole('menuitemcheckbox', { name: `menu.view.${bar}` })).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: `menu.view.${bar}` }));
        expect(useTerminalBarsStore.getState()[stateKey]).toBe(true);
    });

    it('hides and restores the drawing sidebar from the application menu', () => {
        render(<MenuBar />);
        const launcher = screen.getByRole('button', { name: 'Open application menu' });
        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Hide drawing tools' }));
        expect(useDrawingSidebarStore.getState().visible).toBe(false);
        expect(launcher).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Show drawing tools' }));
        expect(useDrawingSidebarStore.getState().visible).toBe(true);
    });

    it('places Area immediately after Line and dispatches the two chart types independently', () => {
        const dispatchSpy = vi.spyOn(commandBus, 'dispatch');

        render(<MenuBar />);
        const launcher = screen.getByRole('button', { name: 'Open application menu' });

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Chart settings' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Chart controls' }));

        const chartsMenu = screen.getByRole('menu', { name: 'Chart controls menu' });
        const chartItems = Array.from(chartsMenu.querySelectorAll<HTMLElement>(
            '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]',
        ));
        const chartItemNames = chartItems.map(item => item.getAttribute('aria-label'));
        const lineIndex = chartItemNames.indexOf('menu.charts.lineChart');
        const areaIndex = chartItemNames.indexOf('menu.charts.areaChart');

        expect(lineIndex).toBeGreaterThanOrEqual(0);
        expect(areaIndex).toBe(lineIndex + 1);

        fireEvent.click(within(chartsMenu).getByRole('menuitemradio', { name: 'menu.charts.lineChart' }));
        expect(dispatchSpy).toHaveBeenLastCalledWith({
            type: 'SET_CHART_TYPE',
            payload: { chartType: 'line' },
        });

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Chart settings' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Chart controls' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'menu.charts.areaChart' }));
        expect(dispatchSpy).toHaveBeenLastCalledWith({
            type: 'SET_CHART_TYPE',
            payload: { chartType: 'area' },
        });
    });

    it('shows the reference-style action launcher and opens submenus only after a click', () => {
        render(<MenuBar />);

        const launcher = screen.getByRole('button', { name: 'Open application menu' });
        expect(launcher).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('menu', { name: 'Application menu' })).not.toBeInTheDocument();

        fireEvent.click(launcher);

        expect(launcher).toHaveAttribute('aria-expanded', 'true');
        const brandHeader = screen.getByTestId('application-menu-brand');
        expect(brandHeader).toBeInTheDocument();
        expect(brandHeader.querySelector('img.rtx-application-menu__brand-logo')).not.toBeNull();
        expect(brandHeader.querySelector('.rtx-application-menu__brand-title')).not.toBeNull();
        for (const label of [
            'Trading accounts',
            'Chart settings',
            'One Click Trading',
            'Light Theme',
            'Color Templates',
            'Algo Trading',
            'Terminal',
            'Economic Calendar',
            'Language',
            'Shortcuts',
            'Contact us',
            'About program',
        ]) {
            expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
        }
        const calendarItem = screen.getByRole('menuitem', { name: 'Economic Calendar' });
        expect(calendarItem).toBeDisabled();
        expect(calendarItem.querySelector('.rtx-menu-row__lock')).toBeInTheDocument();
        fireEvent.click(calendarItem);
        expect(screen.getByRole('menu', { name: 'Application menu' })).toBeInTheDocument();
        const tradingAccountsItem = screen.getByRole('menuitem', { name: 'Trading accounts' });
        const chartSettingsItem = screen.getByRole('menuitem', { name: 'Chart settings' });
        expect(screen.queryByTestId('connected-account-card')).not.toBeInTheDocument();
        expect(screen.queryByText('Connected account')).not.toBeInTheDocument();
        expect(tradingAccountsItem.compareDocumentPosition(chartSettingsItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByRole('menu', { name: 'Chart settings menu' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('menuitem', { name: 'Chart settings' }));
        const chartSettingsMenu = screen.getByRole('menu', { name: 'Chart settings menu' });
        expect(chartSettingsMenu).toBeInTheDocument();
        expect(chartSettingsMenu.style.top).toBe('-38px');

        fireEvent.click(screen.getByRole('menuitem', { name: 'Chart controls' }));
        expect(screen.getByRole('menu', { name: 'Chart controls menu' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('menuitem', { name: 'Color Templates' }));
        expect(screen.queryByRole('menu', { name: 'Chart settings menu' })).not.toBeInTheDocument();
        expect(screen.getByRole('menu', { name: 'Color Templates menu' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('menuitem', { name: 'Language' }));
        expect(screen.queryByRole('menu', { name: 'Color Templates menu' })).not.toBeInTheDocument();
        expect(screen.getByRole('menu', { name: 'Language menu' })).toBeInTheDocument();
    });

    it('keeps the specialized File menu and closes after a leaf action', () => {
        render(<MenuBar />);
        fireEvent.click(screen.getByRole('button', { name: 'Open application menu' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Trading accounts' }));

        expect(screen.getByTestId('file-menu')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save workspace' }));
        expect(screen.queryByRole('menu', { name: 'Application menu' })).not.toBeInTheDocument();
    });

    it('passes the exact active pane when closing one of several charts with the same symbol', () => {
        const sourceElement = document.createElement('div');
        document.body.appendChild(sourceElement);
        const unregister = registerActiveChartSource({
            id: 'trading-chart:chart-b', getContainer: () => sourceElement,
            getSymbol: () => 'XAUUSD', getTimeframe: () => 'H4',
        });
        activateActiveChartSource('trading-chart:chart-b');
        try {
            render(<MenuBar chartSymbol="XAUUSD" />);
            fireEvent.click(screen.getByRole('button', { name: 'Open application menu' }));
            fireEvent.click(screen.getByRole('menuitem', { name: 'Trading accounts' }));
            fireEvent.click(screen.getByRole('button', { name: 'Close current chart' }));
            expect(closeActiveChartMock).toHaveBeenCalledWith('XAUUSD', 'chart-b');
        } finally {
            unregister();
            sourceElement.remove();
        }
    });

    it('wires chart close, restore, profile restore, and trade login to live application owners', async () => {
        const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
        render(<MenuBar />);
        const launcher = screen.getByRole('button', { name: 'Open application menu' });

        const openFileMenu = () => {
            fireEvent.click(launcher);
            fireEvent.click(screen.getByRole('menuitem', { name: 'Trading accounts' }));
        };

        openFileMenu();
        fireEvent.click(screen.getByRole('button', { name: 'Close current chart' }));
        expect(closeActiveChartMock).toHaveBeenCalledTimes(1);
        expect(dispatchSpy.mock.calls.some(([event]) => (
            event.type === 'rtx:order-feedback'
            && (event as CustomEvent).detail?.message === 'Chart closed. Use Open Deleted to restore it.'
        ))).toBe(true);

        openFileMenu();
        fireEvent.click(screen.getByRole('button', { name: 'Restore chart' }));
        expect(dispatchSpy.mock.calls.some(([event]) => event.type === 'rtx:order-feedback')).toBe(true);

        openFileMenu();
        fireEvent.click(screen.getByRole('button', { name: 'Restore profile' }));
        const feedbackEvents = dispatchSpy.mock.calls
            .map(([event]) => event)
            .filter((event) => event.type === 'rtx:order-feedback') as CustomEvent[];
        expect(feedbackEvents.at(-1)?.detail).toEqual({
            message: 'Workspace "Market" restored.',
            type: 'success',
        });

        openFileMenu();
        fireEvent.click(screen.getByRole('button', { name: 'Login trade account' }));
        expect(await screen.findByRole('dialog', { name: 'Trade account login' })).toBeVisible();
        expect(screen.queryByTestId('file-menu')).not.toBeInTheDocument();
        expect(launcher).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(screen.getByRole('button', { name: 'Close login' }));
        expect(screen.queryByRole('dialog', { name: 'Trade account login' })).not.toBeInTheDocument();

        openFileMenu();
        fireEvent.click(screen.getByRole('button', { name: 'Login trade account' }));
        expect(screen.getAllByRole('dialog', { name: 'Trade account login' })).toHaveLength(1);
        expect(screen.queryByTestId('file-menu')).not.toBeInTheDocument();
    });

    it('opens the configured broker Web Trader and reports the result', async () => {
        const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
        render(<MenuBar />);

        fireEvent.click(screen.getByRole('button', { name: 'Open application menu' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Trading accounts' }));
        fireEvent.click(screen.getByRole('button', { name: 'Open web trader' }));

        await waitFor(() => expect(openWebTraderMock).toHaveBeenCalledTimes(1));
        const feedbackEvent = dispatchSpy.mock.calls
            .map(([event]) => event)
            .find((event) => (
                event.type === 'rtx:order-feedback'
                && (event as CustomEvent).detail?.message === 'Opened Test Broker Web Trader.'
            )) as CustomEvent | undefined;
        expect(feedbackEvent?.detail).toEqual({
            message: 'Opened Test Broker Web Trader.',
            type: 'success',
        });
    });

    it('closes on Escape and an outside click', () => {
        render(<MenuBar />);
        const launcher = screen.getByRole('button', { name: 'Open application menu' });

        fireEvent.click(launcher);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('menu', { name: 'Application menu' })).not.toBeInTheDocument();
        expect(launcher).toHaveFocus();

        fireEvent.click(launcher);
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('menu', { name: 'Application menu' })).not.toBeInTheDocument();
    });

    it.each(['Yellow on Black', 'Green and White', 'Green and Blue', 'Blue and White'] as const)('shows genuine chart color templates and applies %s only to the active chart', (scheme) => {
        useChartSettingsStore.setState({
            globalProperties: {
                ...defaultChartProperties,
                colors: { ...defaultChartProperties.colors },
            },
            symbolProperties: {},
        });
        const initialGlobalProperties = useChartSettingsStore.getState().globalProperties;

        render(<MenuBar chartSymbol="XAUUSD" />);
        fireEvent.click(screen.getByRole('button', { name: 'Open application menu' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Color Templates' }));

        const colorTemplatesMenu = screen.getByRole('menu', { name: 'Color Templates menu' });
        expect(within(colorTemplatesMenu).getAllByRole('menuitemradio').map(item => item.textContent)).toEqual([
            'Green on Black',
            'Green and White',
            'Green and Blue',
            'Blue and White',
            'Blue on Black',
            'Black on White',
            'Yellow on Black',
        ]);
        expect(within(colorTemplatesMenu).getByRole('menuitemradio', { name: 'Blue on Black' }))
            .toHaveAttribute('aria-checked', 'true');
        for (const unrelatedItem of [
            'Font Size',
            'Focus Chart',
            'menu.view.languages',
            'menu.view.toolbars',
            'menu.view.statusBar',
            'menu.view.chartsBar',
            'Search Symbols',
            'menu.view.depthOfMarket',
            'menu.view.marketWatch',
            'menu.view.dataWindow',
            'menu.view.navigator',
            'menu.view.toolbox',
            'menu.view.strategyTester',
            'menu.view.fullScreen',
        ]) {
            expect(within(colorTemplatesMenu).queryByText(unrelatedItem)).not.toBeInTheDocument();
        }

        fireEvent.click(within(colorTemplatesMenu).getByRole('menuitemradio', { name: scheme }));

        const chartSettings = useChartSettingsStore.getState();
        expect(chartSettings.globalProperties).toBe(initialGlobalProperties);
        expect(chartSettings.symbolProperties.XAUUSD).toMatchObject({
            colorScheme: scheme,
            colors: getPresetSchemeColors(scheme),
        });
        expect(screen.queryByRole('menu', { name: 'Application menu' })).not.toBeInTheDocument();
    });

    it('keeps the original actions reachable through the professional launcher', async () => {
        // Walks ~35 role queries across the full launcher menu tree; jsdom role lookups make this exceed the 10s default.
        const onSetAdvancedViewEnabled = vi.fn();
        const onSetAdvancedFontSize = vi.fn();
        const onSetFocusChart = vi.fn();
        const onLogout = vi.fn();
        const dispatchSpy = vi.spyOn(commandBus, 'dispatch');
        const clearAllSpy = vi.spyOn(drawingManager, 'clearAllDrawings');

        render(
            <MenuBar
                advancedViewEnabled
                advancedFontSize="normal"
                focusChart={false}
                activeDrawingTool={null}
                crosshairEnabled={false}
                accountId="200002"
                onSetAdvancedViewEnabled={onSetAdvancedViewEnabled}
                onSetAdvancedFontSize={onSetAdvancedFontSize}
                onSetFocusChart={onSetFocusChart}
                onLogout={onLogout}
            />,
        );

        const launcher = screen.getByRole('button', { name: 'Open application menu' });

        fireEvent.click(launcher);
        expect(screen.queryByText('Arijit Nayak')).not.toBeInTheDocument();
        expect(screen.queryByText('200002 - MetaQuotes-Demo')).not.toBeInTheDocument();
        expect(screen.queryByText('Demo')).not.toBeInTheDocument();
        expect(screen.queryByText('Current account 200002')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Terminal' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'View & interface' }));
        expect(screen.getByRole('menuitem', { name: 'Search Symbols' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Font Size' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Large' }));
        expect(onSetAdvancedFontSize).toHaveBeenCalledWith('large');

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Terminal' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'View & interface' }));
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Focus Chart' }));
        expect(onSetFocusChart).toHaveBeenCalledWith(true);

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Dark Theme' }));
        expect(onSetAdvancedViewEnabled).toHaveBeenCalledWith(false);

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Terminal' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'View & interface' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Search Symbols' }));
        expect(await screen.findByRole('dialog', { name: 'Symbols dialog' }, { timeout: 5_000 })).toBeInTheDocument();

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Chart settings' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Insert & drawing tools' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'menu.insert.objects' }));
        const stampsMenuItem = screen.getByRole('menuitem', { name: 'Stamps' });
        fireEvent.click(stampsMenuItem);
        expect(stampsMenuItem).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(screen.getByRole('menuitem', { name: 'Thumbs Up' }));
        expect(dispatchSpy).toHaveBeenCalledWith({
            type: 'SELECT_TOOL',
            payload: { tool: 'stamp', subtype: 'thumbsUp' },
        });

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Chart settings' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Chart controls' }));
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Crosshair' }));
        expect(dispatchSpy).toHaveBeenCalledWith({ type: 'TOGGLE_CROSSHAIR', payload: {} });

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Chart settings' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Chart controls' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'menu.charts.objects' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Selection Mode' }));
        expect(dispatchSpy).toHaveBeenCalledWith({ type: 'SELECT_TOOL', payload: { tool: 'cursor' } });

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Chart settings' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Chart controls' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'menu.charts.objects' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete All' }));
        expect(clearAllSpy).toHaveBeenCalledTimes(1);
        expect(dispatchSpy).toHaveBeenCalledWith({ type: 'SELECT_TOOL', payload: { tool: 'cursor' } });

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Trading accounts' }));
        expect(screen.getByText('Current account 200002')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Log Out' }));
        expect(onLogout).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('menu', { name: 'Application menu' })).not.toBeInTheDocument();
    }, 30_000);
});

describe('MenuBar Electron desktop menubar', () => {
    it('leaves trade login requests to App while the terminal is mounted', async () => {
        installElectronBridge();
        (window as Window & { __RTX_APP_ACTIVE__?: boolean }).__RTX_APP_ACTIVE__ = true;
        render(<MenuBar />);

        await act(async () => {
            window.dispatchEvent(new Event('rtx:requestTradeLogin'));
        });
        expect(screen.queryByRole('dialog', { name: 'Trade account login' })).not.toBeInTheDocument();

        delete (window as Window & { __RTX_APP_ACTIVE__?: boolean }).__RTX_APP_ACTIVE__;
        fireEvent(window, new Event('rtx:requestTradeLogin'));
        expect(await screen.findByRole('dialog', { name: 'Trade account login' })).toBeVisible();
    });

    it.each(['statusBar', 'chartsBar'] as const)('hides and restores %s from the desktop View menu', (bar) => {
        installElectronBridge();
        render(<MenuBar />);
        const stateKey = bar === 'statusBar' ? 'statusBarVisible' : 'chartsBarVisible';
        const otherKey = bar === 'statusBar' ? 'chartsBarVisible' : 'statusBarVisible';
        const viewMenu = screen.getByRole('menuitem', { name: 'View' });
        fireEvent.click(viewMenu);
        expect(screen.getByRole('menuitemcheckbox', { name: `menu.view.${bar}` })).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: `menu.view.${bar}` }));
        expect(useTerminalBarsStore.getState()[stateKey]).toBe(false);
        expect(useTerminalBarsStore.getState()[otherKey]).toBe(true);
        expect(viewMenu).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(viewMenu);
        expect(screen.getByRole('menuitemcheckbox', { name: `menu.view.${bar}` })).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: `menu.view.${bar}` }));
        expect(useTerminalBarsStore.getState()[stateKey]).toBe(true);
    });

    it('opens, closes, and reopens trade account login without a status bar', async () => {
        installElectronBridge();
        render(<MenuBar />);

        const fileButton = screen.getByRole('menuitem', { name: 'File' });
        const openTradeLogin = () => {
            fireEvent.click(fileButton);
            fireEvent.click(screen.getByRole('button', { name: 'Login trade account' }));
        };

        openTradeLogin();
        expect(await screen.findByRole('dialog', { name: 'Trade account login' })).toBeVisible();
        expect(screen.queryByRole('menu', { name: 'File menu' })).not.toBeInTheDocument();
        expect(fileButton).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(screen.getByRole('button', { name: 'Close login' }));
        expect(screen.queryByRole('dialog', { name: 'Trade account login' })).not.toBeInTheDocument();

        openTradeLogin();
        expect(screen.getAllByRole('dialog', { name: 'Trade account login' })).toHaveLength(1);
        expect(screen.queryByRole('menu', { name: 'File menu' })).not.toBeInTheDocument();
    });

    it('keeps the installed version and updater working alongside the Status Bar toggle', async () => {
        installElectronBridge();
        let notify: (data: import('../../types/trading').UpdateStatusPayload) => void = () => {};
        const checkForUpdates = vi.fn().mockResolvedValue({ ok: true });
        const downloadNow = vi.fn().mockResolvedValue({ ok: true });
        const installNow = vi.fn();
        const unsubscribe = vi.fn();
        Object.assign(window.electron!, {
            appVersion: '1.0.24',
            updater: { isSupported: true, checkForUpdates, downloadNow, installNow,
                onStatus: (listener: typeof notify) => { notify = listener; return unsubscribe; } },
        });
        const view = render(<MenuBar />);
        const openView = () => fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
        openView();
        expect(screen.getByText('Version 1.0.24')).toBeInTheDocument();
        expect(screen.getByRole('menuitemcheckbox', { name: 'menu.view.statusBar' })).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(screen.getByRole('menuitem', { name: 'Check updates' }));
        await waitFor(() => expect(checkForUpdates).toHaveBeenCalledTimes(1));
        act(() => notify({ status: 'available', percent: 0, message: 'Available', version: '1.0.25' }));
        openView();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Download update' }));
        await waitFor(() => expect(downloadNow).toHaveBeenCalledTimes(1));
        act(() => notify({ status: 'downloaded', percent: 100, message: 'Ready', version: '1.0.25' }));
        openView();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Install update' }));
        expect(installNow).toHaveBeenCalledTimes(1);
        view.unmount();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('renders the seven horizontal menus and keeps FileMenu behavior in the desktop shell', () => {
        installElectronBridge();
        render(<MenuBar />);

        expect(screen.queryByRole('button', { name: 'Open application menu' })).not.toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: 'Trading accounts' })).not.toBeInTheDocument();

        const menubar = screen.getByRole('menubar', { name: 'Desktop application menu' });
        expect(within(menubar).getAllByRole('menuitem').map(item => item.textContent)).toEqual([
            'File',
            'View',
            'Insert',
            'Charts',
            'Tools',
            'Window',
            'Help',
        ]);

        const fileButton = within(menubar).getByRole('menuitem', { name: 'File' });
        fireEvent.click(fileButton);
        expect(fileButton).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('menu', { name: 'File menu' })).toBeInTheDocument();
        expect(screen.getByTestId('file-menu')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Save workspace' }));
        expect(screen.queryByRole('menu', { name: 'File menu' })).not.toBeInTheDocument();

        fireEvent.click(within(menubar).getByRole('menuitem', { name: 'View' }));
        expect(within(screen.getByRole('menu', { name: 'View menu' })).getByRole('menuitem', { name: 'Theme' })).toBeInTheDocument();
    });

    it('logs out from the desktop File account header', () => {
        installElectronBridge();
        const onLogout = vi.fn();
        render(<MenuBar accountId="200002" onLogout={onLogout} />);

        expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
        expect(document.querySelector('.rtx-desktop-logout-button')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
        expect(screen.getByText('Current account 200002')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Log Out' }));
        expect(onLogout).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Current account 200002')).not.toBeInTheDocument();
    });

    it('reuses the canonical chart and drawing actions from the desktop root menus', () => {
        installElectronBridge();
        const dispatchSpy = vi.spyOn(commandBus, 'dispatch');
        render(<MenuBar />);

        fireEvent.click(screen.getByRole('menuitem', { name: 'Charts' }));
        const chartsMenu = screen.getByRole('menu', { name: 'Charts menu' });
        fireEvent.click(within(chartsMenu).getByRole('menuitemradio', { name: 'menu.charts.lineChart' }));
        expect(dispatchSpy).toHaveBeenLastCalledWith({
            type: 'SET_CHART_TYPE',
            payload: { chartType: 'line' },
        });
        expect(screen.queryByRole('menu', { name: 'Charts menu' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('menuitem', { name: 'Insert' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'menu.insert.objects' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Lines' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Trend Line' }));
        expect(dispatchSpy).toHaveBeenLastCalledWith({
            type: 'SELECT_TOOL',
            payload: { tool: 'trendline' },
        });
        expect(screen.queryByRole('menu', { name: 'Insert menu' })).not.toBeInTheDocument();
    });

    it('keeps the web-only launcher actions clickable from sensible desktop menus', () => {
        installElectronBridge();
        const windowDispatchSpy = vi.spyOn(window, 'dispatchEvent');
        render(<MenuBar />);

        fireEvent.click(screen.getByRole('menuitem', { name: 'Tools' }));
        fireEvent.click(within(screen.getByRole('menu', { name: 'Tools menu' })).getByRole('menuitem', { name: 'One Click Trading' }));
        expect(windowDispatchSpy.mock.calls.some(([event]) => event.type === 'toggle-one-click-trading')).toBe(true);
        expect(screen.queryByRole('menu', { name: 'Tools menu' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
        const calendar = within(screen.getByRole('menu', { name: 'View menu' })).getByRole('menuitem', { name: 'Economic Calendar' });
        expect(calendar).toBeDisabled();
        expect(calendar.querySelector('.rtx-menu-row__lock')).toBeInTheDocument();
        fireEvent.click(calendar);
        expect(windowDispatchSpy.mock.calls.some(([event]) => event.type === 'rtx:open-bottom-dock-tab')).toBe(false);
        expect(screen.getByRole('menu', { name: 'View menu' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }));
        fireEvent.click(within(screen.getByRole('menu', { name: 'Help menu' })).getByRole('menuitem', { name: 'Shortcuts' }));
        const shortcutEvent = windowDispatchSpy.mock.calls
            .map(([event]) => event)
            .find((event) => event.type === 'open-shortcut-help');
        expect(shortcutEvent).toBeDefined();
        expect(screen.queryByRole('menu', { name: 'Help menu' })).not.toBeInTheDocument();
    });

    it.each([true, false])('keeps desktop View appearance controls separate with drawing tools visible: %s', (visible) => {
        installElectronBridge();
        useDrawingSidebarStore.setState({ visible });
        render(<MenuBar advancedViewEnabled />);

        fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
        const viewMenu = screen.getByRole('menu', { name: 'View menu' });
        expect(within(viewMenu).queryByRole('menuitem', { name: 'Hide drawing tools' })).not.toBeInTheDocument();
        expect(within(viewMenu).queryByRole('menuitem', { name: 'Show drawing tools' })).not.toBeInTheDocument();
        expect(within(viewMenu).getByRole('menuitem', { name: 'Font Size' })).toBeVisible();
        expect(within(viewMenu).getByRole('menuitemcheckbox', { name: 'Focus Chart' })).toBeVisible();

        fireEvent.click(within(viewMenu).getByRole('menuitem', { name: 'Theme' }));
        const themeMenu = screen.getByRole('menu', { name: 'Theme menu' });
        expect(within(themeMenu).getAllByRole('menuitemradio').map(item => item.textContent)).toEqual([
            'Dark Theme',
            'Light Theme',
        ]);
        expect(within(themeMenu).getByRole('menuitemradio', { name: 'Light Theme' })).toHaveAttribute('aria-checked', 'true');
        expect(within(themeMenu).queryByRole('menuitem', { name: 'Font Size' })).not.toBeInTheDocument();
        expect(within(themeMenu).queryByRole('menuitemcheckbox', { name: 'Focus Chart' })).not.toBeInTheDocument();
        expect(useDrawingSidebarStore.getState().visible).toBe(visible);
    });

    it('changes font size directly from the desktop View submenu', () => {
        installElectronBridge();
        const onSetAdvancedFontSize = vi.fn();
        render(<MenuBar advancedFontSize="normal" onSetAdvancedFontSize={onSetAdvancedFontSize} />);

        for (const label of ['Small', 'Normal', 'Large']) {
            fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
            fireEvent.click(screen.getByRole('menuitem', { name: 'Font Size' }));
            const fontSizeMenu = screen.getByRole('menu', { name: 'Font Size menu' });
            expect(within(fontSizeMenu).getAllByRole('menuitemradio').map(item => item.textContent)).toEqual([
                'Small',
                'Normal',
                'Large',
            ]);
            expect(within(fontSizeMenu).getByRole('menuitemradio', { name: 'Normal' })).toHaveAttribute('aria-checked', 'true');
            fireEvent.click(within(fontSizeMenu).getByRole('menuitemradio', { name: label }));
            expect(onSetAdvancedFontSize).toHaveBeenLastCalledWith(label.toLowerCase());
            expect(screen.queryByRole('menu', { name: 'View menu' })).not.toBeInTheDocument();
            expect(screen.queryByRole('menu', { name: 'Font Size menu' })).not.toBeInTheDocument();
        }
    });

    it.each([false, true])('toggles Focus Chart directly from desktop View when currently %s', (focusChart) => {
        installElectronBridge();
        const onSetFocusChart = vi.fn();
        render(<MenuBar advancedViewEnabled focusChart={focusChart} onSetFocusChart={onSetFocusChart} />);

        fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
        const focusChartItem = within(screen.getByRole('menu', { name: 'View menu' }))
            .getByRole('menuitemcheckbox', { name: 'Focus Chart' });
        expect(focusChartItem).toHaveAttribute('aria-checked', String(focusChart));
        fireEvent.click(focusChartItem);
        expect(onSetFocusChart).toHaveBeenCalledWith(!focusChart);
        expect(screen.queryByRole('menu', { name: 'View menu' })).not.toBeInTheDocument();
    });

    it('applies active-chart color templates from desktop menus', () => {
        installElectronBridge();
        const originalGlobal = useChartSettingsStore.getState().globalProperties;
        render(<MenuBar chartSymbol="XAUUSD" />);

        fireEvent.click(screen.getByRole('menuitem', { name: 'Charts' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Color Templates' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Yellow on Black' }));
        const settings = useChartSettingsStore.getState();
        expect(settings.globalProperties).toBe(originalGlobal);
        expect(settings.symbolProperties.XAUUSD).toMatchObject({
            colorScheme: 'Yellow on Black', colors: getPresetSchemeColors('Yellow on Black'),
        });
        expect(screen.queryByRole('menu', { name: 'Charts menu' })).not.toBeInTheDocument();
    });

    it('supports desktop menubar keyboard navigation and restores focus on Escape', () => {
        installElectronBridge();
        render(<MenuBar />);

        const fileButton = screen.getByRole('menuitem', { name: 'File' });
        const viewButton = screen.getByRole('menuitem', { name: 'View' });
        fileButton.focus();

        fireEvent.keyDown(fileButton, { key: 'ArrowRight' });
        expect(viewButton).toHaveFocus();

        fireEvent.keyDown(viewButton, { key: 'ArrowDown' });
        expect(screen.getByRole('menu', { name: 'View menu' })).toBeInTheDocument();

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('menu', { name: 'View menu' })).not.toBeInTheDocument();
        expect(viewButton).toHaveFocus();
    });

    it('runs the real chart arrangement for each Window menu entry', () => {
        installElectronBridge();
        render(<MenuBar />);
        for (const [label, mode, hint] of [
            ['menu.window.tileWindows', 'grid', 'Alt+R'],
            ['menu.window.cascade', 'cascade', 'Shift+Alt+C'],
            ['menu.window.tileHorizontally', 'horizontal', 'Shift+Alt+H'],
            ['menu.window.tileVertically', 'vertical', 'Shift+Alt+V'],
        ]) {
            fireEvent.click(screen.getByRole('menuitem', { name: 'Window' }));
            const item = screen.getByRole('menuitem', { name: label });
            expect(item).toHaveTextContent(hint);
            fireEvent.click(item);
            expect(mode === 'cascade' ? arrangeChartsMock : tileWindowsMock).toHaveBeenLastCalledWith(mode);
            expect(screen.queryByRole('menu', { name: 'Window menu' })).not.toBeInTheDocument();
        }
    });

    it('opens Options through the shared command while the application menu is closed', async () => {
        render(<MenuBar />);
        fireEvent(window, new CustomEvent('open-terminal-options'));
        expect(await screen.findByRole('dialog', { name: 'Options' })).toBeInTheDocument();
    });

    it.each(['web', 'desktop'])('enables Arrange Icons only for minimized floating windows in %s', surface => {
        if (surface === 'desktop') installElectronBridge();
        const { rerender } = render(<MenuBar />);
        if (surface === 'desktop') {
            fireEvent.click(screen.getByRole('menuitem', { name: 'Window' }));
        } else {
            fireEvent.click(screen.getByRole('button', { name: 'Open application menu' }));
            fireEvent.click(screen.getByRole('menuitem', { name: 'Terminal' }));
            fireEvent.click(screen.getByRole('menuitem', { name: 'Window layout' }));
        }
        const disabled = screen.getByRole('menuitem', { name: 'menu.window.arrangeIcons' });
        expect(disabled).toBeDisabled();
        expect(disabled).toHaveAttribute('aria-description', 'Minimize a floating window before arranging icons');
        fireEvent.click(disabled);
        expect(dockStoreFixture.arrangeIcons).not.toHaveBeenCalled();
        dockStoreFixture.layout.floatingPanels = [{
            id: 'floating-chart', type: 'panel', ratio: 1, isFloating: true,
            children: [{ id: 'chart-b', title: 'BTCUSD,MN', component: 'Chart', minimized: true }],
        }];
        rerender(<MenuBar />);
        const enabled = screen.getByRole('menuitem', { name: 'menu.window.arrangeIcons' });
        expect(enabled).toBeEnabled();
        fireEvent.click(enabled);
        expect(dockStoreFixture.arrangeIcons).toHaveBeenCalledOnce();
    });

    it('applies terminal resolution through the desktop menu and keeps Reset Windows working', () => {
        installElectronBridge();
        render(<TerminalViewport role="main"><MenuBar /></TerminalViewport>);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Window' }));
        const resolution = screen.getByRole('menuitem', { name: 'menu.window.resolution' });
        expect(resolution).toBeEnabled();
        expect(resolution).toHaveAttribute('aria-haspopup', 'menu');
        fireEvent.click(resolution);
        expect(screen.getByRole('menuitemradio', { name: '1920 × 1080' })).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(screen.getByRole('menuitemradio', { name: '1280 × 720' }));
        expect(screen.getByRole('main')).toHaveStyle({ width: '1280px', height: '720px' });
        fireEvent.click(screen.getByRole('menuitem', { name: 'Window' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'menu.window.resolution' }));
        expect(screen.getByRole('menuitemradio', { name: '1280 × 720' })).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Auto (fit window)' }));
        expect(screen.getByRole('main')).toHaveStyle({ width: '100%', height: '100%' });
        fireEvent.click(screen.getByRole('menuitem', { name: 'Window' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Reset Windows' }));
        expect(dockStoreFixture.resetWindows).toHaveBeenCalledOnce();
        expect(dockStoreFixture.resetToDefaultLayout).not.toHaveBeenCalled();
    });

    it('applies terminal resolution through the web Window layout menu', () => {
        render(<TerminalViewport role="main"><MenuBar /></TerminalViewport>);
        fireEvent.click(screen.getByRole('button', { name: 'Open application menu' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Terminal' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Window layout' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'menu.window.resolution' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: '1280 × 720' }));
        expect(screen.getByRole('main')).toHaveStyle({ width: '1280px', height: '720px' });
        expect(screen.queryByRole('menu', { name: 'Application menu' })).not.toBeInTheDocument();
    });

    it('allows opening Profiles and switching workspace profiles from the desktop File menu', () => {
        installElectronBridge();
        render(<MenuBar />);

        const fileButton = screen.getByRole('menuitem', { name: 'File' });
        fireEvent.click(fileButton);

        const restoreProfileButton = screen.getByRole('button', { name: 'Restore profile' });
        expect(restoreProfileButton).toBeInTheDocument();

        const feedbackSpy = vi.fn();
        window.addEventListener('rtx:order-feedback', feedbackSpy);

        fireEvent.click(restoreProfileButton);
        expect(feedbackSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                detail: expect.objectContaining({
                    message: 'Workspace "Market" restored.',
                    type: 'success',
                }),
            }),
        );
        expect(screen.queryByRole('menu', { name: 'File menu' })).not.toBeInTheDocument();
        window.removeEventListener('rtx:order-feedback', feedbackSpy);
    });
});
