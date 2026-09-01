// @vitest-environment jsdom

import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

vi.mock('./FileMenu', () => ({
    FileMenu: ({
        onSave,
        accountId,
        onLogout,
    }: {
        onSave: () => void;
        accountId?: string;
        onLogout?: () => void;
    }) => (
        <div data-testid="file-menu">
            <button type="button" onClick={onSave}>Save workspace</button>
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
        const chartItems = within(chartsMenu).getAllByRole('menuitem');
        const chartItemNames = chartItems.map(item => item.getAttribute('aria-label'));
        const lineIndex = chartItemNames.indexOf('menu.charts.lineChart');
        const areaIndex = chartItemNames.indexOf('menu.charts.areaChart');

        expect(lineIndex).toBeGreaterThanOrEqual(0);
        expect(areaIndex).toBe(lineIndex + 1);

        fireEvent.click(within(chartsMenu).getByRole('menuitem', { name: 'menu.charts.lineChart' }));
        expect(dispatchSpy).toHaveBeenLastCalledWith({
            type: 'SET_CHART_TYPE',
            payload: { chartType: 'line' },
        });

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Chart settings' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Chart controls' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'menu.charts.areaChart' }));
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
            'MQL5 Algo Trading',
            'RTX5 Terminal',
            'Economic Calendar',
            'Language',
            'Shortcuts',
            'Contact us',
            'About program',
        ]) {
            expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
        }
        expect(screen.getByText('RTX Terminal')).toBeInTheDocument();
        expect(screen.queryByRole('menu', { name: 'Chart settings menu' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('menuitem', { name: 'Chart settings' }));
        expect(screen.getByRole('menu', { name: 'Chart settings menu' })).toBeInTheDocument();

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

    it('keeps the original actions reachable through the professional launcher', () => {
        const onSetAdvancedViewEnabled = vi.fn();
        const onSetAdvancedFontSize = vi.fn();
        const onSetFocusChart = vi.fn();
        const onLogout = vi.fn();
        const dispatchSpy = vi.spyOn(commandBus, 'dispatch');
        const clearAllSpy = vi.spyOn(drawingManager, 'clearAllDrawings');

        render(
            <MenuBar
                advancedViewEnabled={false}
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
        expect(screen.getByText('Arijit Nayak')).toBeInTheDocument();
        expect(screen.getByText('200002 - MetaQuotes-Demo')).toBeInTheDocument();
        expect(screen.getByText('Demo')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Color Templates' }));
        expect(screen.getByRole('menuitem', { name: 'Search Symbols' })).toBeInTheDocument();
        const themeMenuItem = screen.getByRole('menuitem', { name: 'Theme' });
        expect(themeMenuItem).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(themeMenuItem);
        expect(themeMenuItem).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(screen.getByRole('menuitem', { name: 'Font Size' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Large' }));
        expect(onSetAdvancedFontSize).toHaveBeenCalledWith('large');

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Color Templates' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Theme' }));
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Focus Chart' }));
        expect(onSetFocusChart).toHaveBeenCalledWith(true);

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Light Theme' }));
        expect(onSetAdvancedViewEnabled).toHaveBeenCalledWith(true);

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Color Templates' }));
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
        fireEvent.click(within(chartsMenu).getByRole('menuitem', { name: 'menu.charts.lineChart' }));
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
