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
    const state = { isAuthenticated: false, selectedSymbol: 'XAUUSD' };
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

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('MenuBar hamburger launcher', () => {
    it('places Area immediately after Line and dispatches the two chart types independently', () => {
        const dispatchSpy = vi.spyOn(commandBus, 'dispatch');

        render(<MenuBar />);
        const launcher = screen.getByRole('button', { name: 'Open application menu' });

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Charts' }));

        const chartsMenu = screen.getByRole('menu', { name: 'Charts menu' });
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
        fireEvent.click(screen.getByRole('menuitem', { name: 'Charts' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'menu.charts.areaChart' }));
        expect(dispatchSpy).toHaveBeenLastCalledWith({
            type: 'SET_CHART_TYPE',
            payload: { chartType: 'area' },
        });
    });

    it('shows all seven root menus and opens each submenu only after a click', () => {
        render(<MenuBar />);

        const launcher = screen.getByRole('button', { name: 'Open application menu' });
        expect(launcher).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('menu', { name: 'Application menu' })).not.toBeInTheDocument();

        fireEvent.click(launcher);

        expect(launcher).toHaveAttribute('aria-expanded', 'true');
        for (const label of ['File', 'View', 'Insert', 'Charts', 'Tools', 'Window', 'Help']) {
            expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
        }
        expect(screen.queryByRole('menu', { name: 'View menu' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
        expect(screen.getByRole('menu', { name: 'View menu' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('menuitem', { name: 'Theme' }));
        expect(screen.getByRole('menu', { name: 'Theme menu' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('menuitem', { name: 'menu.view.languages' }));
        expect(screen.queryByRole('menu', { name: 'Theme menu' })).not.toBeInTheDocument();
        expect(screen.getByRole('menu', { name: 'menu.view.languages menu' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('menuitem', { name: 'Tools' }));
        expect(screen.queryByRole('menu', { name: 'View menu' })).not.toBeInTheDocument();
        expect(screen.getByRole('menu', { name: 'Tools menu' })).toBeInTheDocument();
    });

    it('keeps the specialized File menu and closes after a leaf action', () => {
        render(<MenuBar />);
        fireEvent.click(screen.getByRole('button', { name: 'Open application menu' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));

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

    it('groups the former right-toolbar actions into View, Insert, Charts, and File', () => {
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
        fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
        expect(screen.getByRole('menuitem', { name: 'Search Symbols' })).toBeInTheDocument();
        const themeMenuItem = screen.getByRole('menuitem', { name: 'Theme' });
        expect(themeMenuItem).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(themeMenuItem);
        expect(themeMenuItem).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(screen.getByRole('menuitem', { name: 'Font Size' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Large' }));
        expect(onSetAdvancedFontSize).toHaveBeenCalledWith('large');

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Theme' }));
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Focus Chart' }));
        expect(onSetFocusChart).toHaveBeenCalledWith(true);

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Theme' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Light Theme' }));
        expect(onSetAdvancedViewEnabled).toHaveBeenCalledWith(true);

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Search Symbols' }));
        expect(screen.getByRole('dialog', { name: 'Symbols dialog' })).toBeInTheDocument();

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Insert' }));
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
        fireEvent.click(screen.getByRole('menuitem', { name: 'Charts' }));
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Crosshair' }));
        expect(dispatchSpy).toHaveBeenCalledWith({ type: 'TOGGLE_CROSSHAIR', payload: {} });

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Charts' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'menu.charts.objects' }));
        fireEvent.click(screen.getByRole('menuitemradio', { name: 'Selection Mode' }));
        expect(dispatchSpy).toHaveBeenCalledWith({ type: 'SELECT_TOOL', payload: { tool: 'cursor' } });

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Charts' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'menu.charts.objects' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete All' }));
        expect(clearAllSpy).toHaveBeenCalledTimes(1);
        expect(dispatchSpy).toHaveBeenCalledWith({ type: 'SELECT_TOOL', payload: { tool: 'cursor' } });

        fireEvent.click(launcher);
        fireEvent.click(screen.getByRole('menuitem', { name: 'File' }));
        expect(screen.getByText('Current account 200002')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Log Out' }));
        expect(onLogout).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('menu', { name: 'Application menu' })).not.toBeInTheDocument();
    });
});
