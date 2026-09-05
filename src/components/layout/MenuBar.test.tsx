// @vitest-environment jsdom

import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
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

vi.mock('../../services/webTrader', () => ({
    openWebTrader: openWebTraderMock,
}));

vi.mock('../../store/useDockLayoutStore', () => ({
    useDockLayoutStore: {
        getState: () => ({ closeActiveChart: closeActiveChartMock }),
    },
}));

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
    }) => (
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
    OptionsDialog: () => null,
}));

vi.mock('../SymbolsDialog', () => ({
    SymbolsDialog: ({ isOpen }: { isOpen: boolean }) => (
        isOpen ? <div role="dialog" aria-label="Symbols dialog" /> : null
    ),
}));

import { MenuBar } from './MenuBar';
import { commandBus } from '../../services/commandBus';
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
    delete window.electron;
    useChartSettingsStore.setState({
        globalProperties: {
            ...defaultChartProperties,
            colors: { ...defaultChartProperties.colors },
        },
        symbolProperties: {},
    });
    vi.restoreAllMocks();
});

describe('MenuBar hamburger launcher', () => {
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
        for (const label of [
            'Trading accounts',
            'Chart settings',
            'One Click Trading',
            'Light Theme',
            'Color Templates',
            'RTX5 Algo Trading',
            'RTX5 Terminal',
            'Economic Calendar',
            'Language',
            'Shortcuts',
            'Contact us',
            'About program',
        ]) {
            expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
        }
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

    it('wires chart close, restore, profile restore, and trade login to live application owners', () => {
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
        expect(dispatchSpy.mock.calls.some(([event]) => event.type === 'rtx:openLoginDialog')).toBe(true);
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

    it('shows genuine chart color templates and applies the choice only to the active chart', () => {
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
            'Black on White',
            'Yellow on Black',
        ]);
        expect(within(colorTemplatesMenu).getByRole('menuitemradio', { name: 'Green on Black' }))
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

        fireEvent.click(within(colorTemplatesMenu).getByRole('menuitemradio', { name: 'Yellow on Black' }));

        const chartSettings = useChartSettingsStore.getState();
        expect(chartSettings.globalProperties).toBe(initialGlobalProperties);
        expect(chartSettings.symbolProperties.XAUUSD).toMatchObject({
            colorScheme: 'Yellow on Black',
            colors: getPresetSchemeColors('Yellow on Black'),
        });
        expect(screen.queryByRole('menu', { name: 'Application menu' })).not.toBeInTheDocument();
    });

    it('keeps the original actions reachable through the professional launcher', () => {
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
        fireEvent.click(screen.getByRole('menuitem', { name: 'RTX5 Terminal' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'View & interface' }));
        expect(screen.getByRole('menuitem', { name: 'Search Symbols' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Font Size' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Large' }));
        expect(onSetAdvancedFontSize).toHaveBeenCalledWith('large');

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'RTX5 Terminal' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'View & interface' }));
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Focus Chart' }));
        expect(onSetFocusChart).toHaveBeenCalledWith(true);

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Dark Theme' }));
        expect(onSetAdvancedViewEnabled).toHaveBeenCalledWith(false);

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'RTX5 Terminal' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'View & interface' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Search Symbols' }));
        expect(screen.getByRole('dialog', { name: 'Symbols dialog' })).toBeInTheDocument();

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
    });
});

describe('MenuBar Electron desktop menubar', () => {
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

    it('leaves desktop Logout to the upper-right Account popup without duplicating it in File', () => {
        installElectronBridge();
        const onLogout = vi.fn();
        render(<MenuBar accountId="200002" onLogout={onLogout} />);

        expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
        expect(document.querySelector('.rtx-desktop-logout-button')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
        expect(screen.getByText('Current account 200002')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Log Out' })).not.toBeInTheDocument();
        expect(onLogout).not.toHaveBeenCalled();
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
        const documentDispatchSpy = vi.spyOn(document, 'dispatchEvent');
        render(<MenuBar />);

        fireEvent.click(screen.getByRole('menuitem', { name: 'Tools' }));
        fireEvent.click(within(screen.getByRole('menu', { name: 'Tools menu' })).getByRole('menuitem', { name: 'One Click Trading' }));
        expect(windowDispatchSpy.mock.calls.some(([event]) => event.type === 'toggle-one-click-trading')).toBe(true);
        expect(screen.queryByRole('menu', { name: 'Tools menu' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
        fireEvent.click(within(screen.getByRole('menu', { name: 'View menu' })).getByRole('menuitem', { name: 'Economic Calendar' }));
        const calendarEvent = windowDispatchSpy.mock.calls
            .map(([event]) => event)
            .find((event) => event.type === 'rtx:open-bottom-dock-tab') as CustomEvent | undefined;
        expect(calendarEvent?.detail).toEqual({ tab: 'Calendar' });
        expect(screen.queryByRole('menu', { name: 'View menu' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }));
        fireEvent.click(within(screen.getByRole('menu', { name: 'Help menu' })).getByRole('menuitem', { name: 'Shortcuts' }));
        const shortcutEvent = documentDispatchSpy.mock.calls
            .map(([event]) => event)
            .find((event) => event.type === 'keydown') as KeyboardEvent | undefined;
        expect(shortcutEvent).toMatchObject({ key: 'F1', code: 'F1', bubbles: true });
        expect(screen.queryByRole('menu', { name: 'Help menu' })).not.toBeInTheDocument();
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
});
