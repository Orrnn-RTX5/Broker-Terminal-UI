import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { FileMenu } from './FileMenu';
import { MenuBar } from './MenuBar';
import {
    getWorkspaceProfile,
    listWorkspaceProfiles,
    saveCurrentWorkspaceProfile,
    WORKSPACE_PROFILE_RESTORED_EVENT,
} from '../../services/localWorkspaceProfiles';
import type { DockLayout } from '../../services/dockManager';
import { useAppStore } from '../../store/useAppStore';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { defaultChartProperties, useChartSettingsStore } from '../../store/useChartSettingsStore';
import { useWatchlistStore } from '../../store/useWatchlistStore';
import { useWorkspaceProfileSelectionStore } from '../../store/useWorkspaceProfileSelectionStore';

vi.mock('react-i18next', async (importOriginal) => ({
    ...await importOriginal<typeof import('react-i18next')>(),
    useTranslation: () => ({
        t: (key: string) => ({
            'menu.file.profiles': 'Profiles',
            'menu.file.save': 'Save',
        } as Record<string, string>)[key] || key,
        i18n: { language: 'en', resolvedLanguage: 'en', changeLanguage: vi.fn() },
    }),
}));

vi.mock('../../hooks/useUiTranslation', () => ({
    useUiTranslation: () => (source: string, values?: Record<string, unknown>) => (
        source.replace(/{{(\w+)}}/g, (_, key: string) => String(values?.[key] ?? ''))
    ),
}));

vi.mock('../ui/Icon', () => ({ Icon: () => null }));
vi.mock('../../services/chartPrinter', () => ({ chartPrinter: {} }));
vi.mock('../dialogs/PrintSetupDialog', () => ({ PrintSetupDialog: () => null }));
vi.mock('../dialogs/PrintPreviewDialog', () => ({ PrintPreviewDialog: () => null }));
vi.mock('../dialogs/ExitConfirmDialog', () => ({ ExitConfirmDialog: () => null }));
vi.mock('../dialogs/SavePictureDialog', () => ({ SavePictureDialog: () => null }));
vi.mock('../dialogs/OpenAccountDialog', () => ({ OpenAccountDialog: () => null }));

const ACCOUNT = '200003';
const PROFILE_SYMBOLS = ['BTCUSD', 'EURUSD', 'EURGBP', 'EURJPY', 'EURCHF', 'GBPUSD', 'USDJPY', 'XAUUSD'];

const createLayout = (symbol: string, timeframe = 'M15'): DockLayout => ({
    root: {
        id: 'root',
        type: 'split',
        direction: 'horizontal',
        ratio: 1,
        children: [{
            id: `chart-${symbol}`,
            title: `${symbol},${timeframe}`,
            component: 'Chart',
            props: { symbol, timeframe },
            ratio: 1,
        }],
    },
    floatingPanels: [],
    version: '2.6',
});

const setWorkspace = (symbol: string, showGrid = false) => {
    useDockLayoutStore.getState().setLayout(createLayout(symbol));
    useAppStore.setState({ selectedSymbol: symbol, orderVolume: 0.25, isAuthenticated: true });
    useChartSettingsStore.setState({
        globalProperties: {
            ...defaultChartProperties,
            showGrid,
            colors: { ...defaultChartProperties.colors },
        },
        symbolProperties: {},
    });
    useWatchlistStore.setState({
        watchlists: [{
            id: `watchlist-${symbol}`,
            name: `${symbol} desk`,
            symbols: [symbol],
            isDefault: false,
            createdAt: 10,
            updatedAt: 20,
        }],
        activeWatchlistId: `watchlist-${symbol}`,
    });
    localStorage.setItem('rtx5_selected_symbol', symbol);
    localStorage.setItem('rtx5_timeframe', 'M15');
    localStorage.setItem('rtx5_chart_type', 'candlestick');
};

const MenuPair = ({ accountId = ACCOUNT, onSave, showMenu = true }: {
    accountId?: string;
    onSave?: (name?: string) => void;
    showMenu?: boolean;
}) => (
    <>
        <FileMenu shortcutsOnly accountId={accountId} profileSymbols={PROFILE_SYMBOLS} />
        {showMenu && <FileMenu accountId={accountId} onSave={onSave} profileSymbols={PROFILE_SYMBOLS} profileShortcutsEnabled={false} />}
    </>
);

const profileButton = (name: string) => screen.getByTitle(`Restore workspace ${name}`);

const expectSelectedProfile = (name: string) => {
    const restoreButtons = screen.getAllByTitle(/^Restore workspace /);
    const selected = restoreButtons.filter(button => button.classList.contains('bg-emerald-500/10'));
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAttribute('title', `Restore workspace ${name}`);
};

const restoredNames = (listener: ReturnType<typeof vi.fn>) => listener.mock.calls.map(
    ([event]) => (event as CustomEvent).detail.name as string,
);

const openSaveAs = async (name: string) => {
    fireEvent.click(screen.getByTitle('Save current workspace as a new profile'));
    const input = await screen.findByLabelText('Workspace Name');
    fireEvent.change(input, { target: { value: name } });
    const dialog = input.closest('.rtx-action-sheet') as HTMLElement;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
};

const openApplicationFileMenu = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Open application menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Trading accounts' }));
};

describe('FileMenu Profiles lifecycle with persisted workspaces', () => {
    const eventListeners: Array<() => void> = [];

    const observeRestorations = () => {
        const listener = vi.fn();
        window.addEventListener(WORKSPACE_PROFILE_RESTORED_EVENT, listener);
        eventListeners.push(() => window.removeEventListener(WORKSPACE_PROFILE_RESTORED_EVENT, listener));
        return listener;
    };

    beforeEach(() => {
        localStorage.clear();
        useWorkspaceProfileSelectionStore.setState({ accountId: '', profileName: 'Default' });
        useDockLayoutStore.setState({ recentlyClosedCharts: [] });
        setWorkspace('EURUSD');
    });

    afterEach(() => {
        eventListeners.splice(0).forEach(remove => remove());
        vi.restoreAllMocks();
    });

    it('restores once per shortcut when the permanent owner and visible menu coexist', () => {
        saveCurrentWorkspaceProfile({ accountId: ACCOUNT, profileName: 'Default' });
        localStorage.setItem('rtx5_active_profile', 'Research');
        render(<MenuPair />);
        expectSelectedProfile('Default');
        const restored = observeRestorations();

        fireEvent.keyDown(window, { key: 'F5', shiftKey: true });

        expect(restoredNames(restored)).toEqual(['Euro']);
        expectSelectedProfile('Euro');
        expect(useDockLayoutStore.getState().layout.root.children).toHaveLength(2);

        fireEvent.keyDown(window, { key: 'F5', ctrlKey: true });

        expect(restoredNames(restored)).toEqual(['Euro', 'Default']);
        expectSelectedProfile('Default');
        expect(useDockLayoutStore.getState().layout).toEqual(createLayout('EURUSD'));
    });

    it('synchronizes a successful Save As with the permanent keyboard owner and restores its snapshot', async () => {
        const onSave = vi.fn();
        setWorkspace('XAUUSD', true);
        render(<MenuPair onSave={onSave} />);

        await openSaveAs('Research');

        await waitFor(() => expect(onSave).toHaveBeenCalledWith('Research'));
        expectSelectedProfile('Research');
        expect(getWorkspaceProfile({ accountId: ACCOUNT, profileName: 'Research' })?.state.dockLayout)
            .toEqual(createLayout('XAUUSD'));
        const restored = observeRestorations();

        fireEvent.keyDown(window, { key: 'F5', ctrlKey: true });

        expect(restoredNames(restored)).toEqual(['Market Overview']);
        expectSelectedProfile('Market Overview');
        expect(localStorage.getItem('rtx5_timeframe')).toBe('H1');

        fireEvent.keyDown(window, { key: 'F5', shiftKey: true });

        expect(restoredNames(restored)).toEqual(['Market Overview', 'Research']);
        expectSelectedProfile('Research');
        expect(useAppStore.getState().selectedSymbol).toBe('XAUUSD');
        expect(useDockLayoutStore.getState().layout).toEqual(createLayout('XAUUSD'));
        expect(useChartSettingsStore.getState().globalProperties.showGrid).toBe(true);
        expect(useWatchlistStore.getState().activeWatchlistId).toBe('watchlist-XAUUSD');
    });

    it('keeps the restored selection while the menu closes and reopens and shortcuts continue to work', () => {
        const { rerender } = render(<MenuPair />);
        fireEvent.click(profileButton('Euro'));
        expectSelectedProfile('Euro');
        const restored = observeRestorations();

        rerender(<MenuPair showMenu={false} />);
        expect(screen.queryByTitle('Restore workspace Euro')).not.toBeInTheDocument();
        fireEvent.keyDown(window, { key: 'F5', shiftKey: true });
        expect(restoredNames(restored)).toEqual(['Market Overview']);

        rerender(<MenuPair />);
        expectSelectedProfile('Market Overview');
        expect(localStorage.getItem('rtx5_timeframe')).toBe('H1');
        fireEvent.keyDown(window, { key: 'F5', ctrlKey: true });
        expect(restoredNames(restored)).toEqual(['Market Overview', 'Euro']);
        expectSelectedProfile('Euro');
        expect(localStorage.getItem('rtx5_timeframe')).toBe('M15');
    });

    it('updates the menu and shortcut selection from a successful save event without a menu callback', () => {
        render(<MenuPair />);

        act(() => {
            saveCurrentWorkspaceProfile({ accountId: ACCOUNT, profileName: 'Research' });
        });

        expectSelectedProfile('Research');
        const restored = observeRestorations();
        fireEvent.keyDown(window, { key: 'F5', ctrlKey: true });
        expect(restoredNames(restored)).toEqual(['Market Overview']);
        expectSelectedProfile('Market Overview');
    });

    it('resets the selected profile on an account change and ignores events from the prior account', () => {
        saveCurrentWorkspaceProfile({ accountId: ACCOUNT, profileName: 'Research' });
        saveCurrentWorkspaceProfile({ accountId: '200004', profileName: 'Second Desk' });
        const { rerender } = render(<MenuPair />);
        fireEvent.click(profileButton('Research'));
        expectSelectedProfile('Research');

        rerender(<MenuPair accountId="200004" />);

        expectSelectedProfile('Default');
        expect(screen.queryByTitle('Restore workspace Research')).not.toBeInTheDocument();
        fireEvent.click(profileButton('Second Desk'));
        expectSelectedProfile('Second Desk');

        act(() => {
            const oldProfile = saveCurrentWorkspaceProfile({ accountId: ACCOUNT, profileName: 'Research' });
            window.dispatchEvent(new CustomEvent(WORKSPACE_PROFILE_RESTORED_EVENT, { detail: oldProfile }));
        });

        expectSelectedProfile('Second Desk');
        expect(screen.queryByTitle('Restore workspace Research')).not.toBeInTheDocument();
        const restored = observeRestorations();
        fireEvent.keyDown(window, { key: 'F5', ctrlKey: true });
        expect(restoredNames(restored)).toEqual(['Market Overview']);
        expect((restored.mock.calls[0][0] as CustomEvent).detail.accountId).toBe('200004');
    });

    it('restores the saved Default workspace when deleting the selected custom profile', () => {
        saveCurrentWorkspaceProfile({ accountId: ACCOUNT, profileName: 'Default' });
        setWorkspace('XAUUSD', true);
        saveCurrentWorkspaceProfile({ accountId: ACCOUNT, profileName: 'Research' });
        render(<MenuPair />);
        fireEvent.click(profileButton('Research'));
        expect(useAppStore.getState().selectedSymbol).toBe('XAUUSD');
        const restored = observeRestorations();

        fireEvent.click(screen.getByLabelText('Delete profile Research'));

        expect(restoredNames(restored)).toEqual(['Default']);
        expectSelectedProfile('Default');
        expect(getWorkspaceProfile({ accountId: ACCOUNT, profileName: 'Research' })).toBeNull();
        expect(screen.queryByTitle('Restore workspace Research')).not.toBeInTheDocument();
        expect(useDockLayoutStore.getState().layout).toEqual(createLayout('EURUSD'));
        expect(useAppStore.getState().selectedSymbol).toBe('EURUSD');
        expect(useChartSettingsStore.getState().globalProperties.showGrid).toBe(false);
        expect(useWatchlistStore.getState().activeWatchlistId).toBe('watchlist-EURUSD');

        fireEvent.keyDown(window, { key: 'F5', ctrlKey: true });

        expect(restoredNames(restored)).toEqual(['Default', 'Market Overview']);
        expectSelectedProfile('Market Overview');
    });

    it('overwrites a built-in name case-insensitively and exposes one selectable row', async () => {
        const original = saveCurrentWorkspaceProfile({ accountId: ACCOUNT, profileName: 'Default' });
        setWorkspace('XAUUSD', true);
        const onSave = vi.fn();
        render(<MenuPair onSave={onSave} />);

        await openSaveAs('default');
        expect(await screen.findByRole('button', { name: 'Overwrite' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }));

        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(listWorkspaceProfiles(ACCOUNT)).toHaveLength(1);
        expect(getWorkspaceProfile({ accountId: ACCOUNT, profileName: 'DEFAULT' })?.id).toBe(original.id);
        expect(screen.getAllByTitle(/^Restore workspace default$/i)).toHaveLength(1);
        expectSelectedProfile('Default');

        fireEvent.keyDown(window, { key: 'F5', shiftKey: true });
        fireEvent.keyDown(window, { key: 'F5', ctrlKey: true });

        expectSelectedProfile('Default');
        expect(useDockLayoutStore.getState().layout).toEqual(createLayout('XAUUSD'));
        expect(useChartSettingsStore.getState().globalProperties.showGrid).toBe(true);
    });

    it('keeps profile shortcuts working after MenuBar unmounts a successful Save As dialog owner', async () => {
        render(<MenuBar accountId={ACCOUNT} profileSymbols={PROFILE_SYMBOLS} />);
        openApplicationFileMenu();

        await openSaveAs('Research');

        await waitFor(() => {
            expect(screen.queryByLabelText('Workspace Name')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Open application menu' })).toHaveAttribute('aria-expanded', 'false');
        });
        expect(screen.queryByTitle('Restore workspace Research')).not.toBeInTheDocument();
        const restored = observeRestorations();

        fireEvent.keyDown(document.body, { key: 'F5', ctrlKey: true });

        expect(restoredNames(restored)).toEqual(['Market Overview']);
        expect(localStorage.getItem('rtx5_timeframe')).toBe('H1');
        openApplicationFileMenu();
        expectSelectedProfile('Market Overview');

        fireEvent.keyDown(document.body, { key: 'F5', shiftKey: true });

        expect(restoredNames(restored)).toEqual(['Market Overview', 'Research']);
        expect(useDockLayoutStore.getState().layout).toEqual(createLayout('EURUSD'));
    });

    it('blocks profile shortcuts on Save As buttons until the modal is canceled', async () => {
        render(<MenuBar accountId={ACCOUNT} profileSymbols={PROFILE_SYMBOLS} />);
        openApplicationFileMenu();
        fireEvent.click(screen.getByTitle('Save current workspace as a new profile'));
        const input = await screen.findByLabelText('Workspace Name');
        const dialog = input.closest('.rtx-action-sheet') as HTMLElement;
        const saveButton = within(dialog).getByRole('button', { name: 'Save' });
        saveButton.focus();
        const restored = observeRestorations();

        fireEvent.keyDown(saveButton, { key: 'F5', shiftKey: true });
        fireEvent.keyDown(saveButton, { key: 'F5', ctrlKey: true });

        expect(restored).not.toHaveBeenCalled();
        expect(useDockLayoutStore.getState().layout).toEqual(createLayout('EURUSD'));
        expectSelectedProfile('Default');
        expect(input).toBeInTheDocument();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        fireEvent.keyDown(document.body, { key: 'F5', shiftKey: true });

        expect(restoredNames(restored)).toEqual(['Euro']);
        expect(localStorage.getItem('rtx5_timeframe')).toBe('M15');
    });
});
