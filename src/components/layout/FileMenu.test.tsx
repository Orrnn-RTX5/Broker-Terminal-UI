/**
 * FileMenu Component Tests
 * Comprehensive test suite for File menu functionality
 */

import React from 'react';
import '@testing-library/jest-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { FileMenu } from './FileMenu';
import {
    clearActiveChartSources,
    registerActiveChartSource,
} from '../../services/activeChartSource';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { chartPrinter } from '../../services/chartPrinter';
import { getTerminalShortcutHint, TERMINAL_SHORTCUTS } from '../../services/shortcutCatalog';

const savePictureDialogMock = vi.hoisted(() => ({
    props: [] as any[],
}));
const workspaceProfilesMock = vi.hoisted(() => ({
    listWorkspaceProfiles: vi.fn(() => [] as Array<Record<string, string>>),
    restoreWorkspaceProfile: vi.fn(),
    saveCurrentWorkspaceProfile: vi.fn(),
    deleteWorkspaceProfile: vi.fn(),
    restoreBuiltinWorkspaceProfile: vi.fn(),
    BUILTIN_WORKSPACE_PROFILE_NAMES: ['Default', 'Euro', 'Market Overview'],
}));

// 1. Mock i18n translations
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
            t: (key: string) => mockTranslations[key] || key
        })
    };
});

// 2. Mock useAppStore Zustand store
vi.mock('../../store/useAppStore', () => {
    const mockStoreState = {
        selectedSymbol: 'EURUSD',
        timeframe: '5m',
        logout: vi.fn()
    };

    const mockUseAppStore = vi.fn((selector) => {
        return selector ? selector(mockStoreState) : mockStoreState;
    });
    (mockUseAppStore as any).getState = () => mockStoreState;

    return {
        useAppStore: mockUseAppStore
    };
});

// 3. Mock dynamic imported api client
vi.mock('../../services/api', () => ({
    default: {
        market: {
            getSymbols: vi.fn().mockResolvedValue([])
        }
    }
}));

vi.mock('../../hooks/useDesktopRelease', () => ({
    useDesktopRelease: () => ({
        release: {
            version: '9.9.9',
            tagName: 'v9.9.9',
            releaseUrl: 'https://github.com/rtx5-orrnn/rtx5-terminal-releases/releases/tag/v9.9.9',
            downloadUrl: 'https://github.com/rtx5-orrnn/rtx5-terminal-releases/releases/download/v9.9.9/RTX.Terminal.Setup.9.9.9.exe',
            assetName: 'RTX.Terminal.Setup.9.9.9.exe',
            assetSize: 123,
        },
        status: 'ready',
        error: null,
    }),
}));

// 4. Mock chartPrinter service
vi.mock('../../services/chartPrinter', () => ({
    chartPrinter: {
        getPreferences: vi.fn(() => ({})),
        printChart: vi.fn(),
        setPreferences: vi.fn(),
        captureActiveChartData: vi.fn(async () => ({ symbol: 'BTCUSD', timeframe: 'M1', chartCanvas: document.createElement('canvas'), indicators: [], drawings: [] })),
    }
}));

vi.mock('../../services/localWorkspaceProfiles', () => ({
    ...workspaceProfilesMock,
}));

// 5. Mock all child dialogs
vi.mock('../dialogs/SaveWorkspaceDialog', () => ({
    SaveWorkspaceDialog: ({ onConfirm, onCancel }: any) => (
        <div data-testid="save-workspace-dialog">
            <span>Save Workspace</span>
            <button onClick={() => onConfirm('Default')}>Confirm Save</button>
            <button onClick={onCancel}>Cancel Save</button>
        </div>
    )
}));

vi.mock('../dialogs/PrintSetupDialog', () => ({
    PrintSetupDialog: ({ onConfirm, onCancel }: any) => (
        <div data-testid="print-setup-dialog">
            <span>Print Setup</span>
            <button onClick={() => onConfirm({ paperSize: 'A4', orientation: 'landscape' })}>Confirm Print Setup</button>
            <button onClick={onCancel}>Cancel Print Setup</button>
        </div>
    )
}));


vi.mock('../dialogs/PrintPreviewDialog', () => ({
    PrintPreviewDialog: ({ onPrint, onClose }: any) => (
        <div data-testid="print-preview-dialog">
            <span>Print Preview</span>
            <button onClick={onPrint}>Print from Preview</button>
            <button onClick={onClose}>Close Preview</button>
        </div>
    )
}));

vi.mock('../dialogs/SavePictureDialog', () => ({
    SavePictureDialog: (props: any) => {
        savePictureDialogMock.props.push(props);
        return props.isOpen ? (
            <div data-testid="save-picture-dialog">
                <span>Save Picture</span>
                <button onClick={props.onClose}>Close Save Picture</button>
            </div>
        ) : null;
    }
}));

vi.mock('../dialogs/ExitConfirmDialog', () => ({
    ExitConfirmDialog: ({ isOpen, onConfirm, onCancel }: any) => isOpen ? (
        <div data-testid="exit-confirm-dialog">
            <span>Unsaved Changes</span>
            <button onClick={() => onConfirm(true)}>Confirm Exit</button>
            <button onClick={onCancel}>Cancel Exit</button>
        </div>
    ) : null
}));

vi.mock('../dialogs/OpenAccountDialog', () => ({
    OpenAccountDialog: ({ isOpen, onClose }: any) => isOpen ? (
        <div data-testid="open-account-dialog">
            <span>Open Account</span>
            <button onClick={onClose}>Close Open Account</button>
        </div>
    ) : null
}));

describe('FileMenu Component', () => {
    const mockHandlers = {
        onSave: vi.fn(),
        onSaveAsPicture: vi.fn(),
        onOpenDataFolder: vi.fn(),
        onPrint: vi.fn(),
        onPrintPreview: vi.fn(),
        onPrintSetup: vi.fn(),
        onExit: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        savePictureDialogMock.props = [];
        clearActiveChartSources();
        useDockLayoutStore.setState({ recentlyClosedCharts: [] });
        workspaceProfilesMock.listWorkspaceProfiles.mockReturnValue([]);
        vi.spyOn(window, 'alert').mockImplementation(() => { });
    });

    describe('Rendering', () => {
        it('renders all menu items', () => {
            render(<FileMenu {...mockHandlers} />);

            expect(screen.getByText('Save')).toBeInTheDocument();
            expect(screen.getByText('Save As Picture')).toBeInTheDocument();
            expect(screen.getByText('Open Data Folder')).toBeInTheDocument();
            expect(screen.getByText('Download Desktop App')).toBeInTheDocument();
            expect(screen.getByText('v9.9.9')).toBeInTheDocument();
            expect(screen.getByText('Print')).toBeInTheDocument();
            expect(screen.getByText('Print Preview')).toBeInTheDocument();
            expect(screen.getByText('Print Setup')).toBeInTheDocument();
            expect(screen.getByText('Exit')).toBeInTheDocument();
        });

        it('displays keyboard shortcuts', () => {
            render(<FileMenu {...mockHandlers} />);

            expect(screen.getByText('Ctrl+S')).toBeInTheDocument();
            expect(screen.queryByText('Ctrl+Shift+D')).not.toBeInTheDocument();
            expect(screen.getByText('Ctrl+P')).toBeInTheDocument();
        });

        it.each([
            ['Close', 'file.close-chart', 'Shift+Alt+Q'],
            ['Save As Picture', 'file.save-picture', 'Ctrl+Shift+S'],
            ['Print Preview', 'file.print-preview', 'Ctrl+Shift+P'],
        ])('shows the executable catalog binding beside %s', (label, shortcutId, expectedHint) => {
            render(<FileMenu {...mockHandlers} />);
            expect(TERMINAL_SHORTCUTS.some(shortcut => shortcut.id === shortcutId)).toBe(true);
            expect(getTerminalShortcutHint(shortcutId)).toBe(expectedHint);
            const button = screen.getByText(label).closest('button')!;
            expect(within(button).getByText(getTerminalShortcutHint(shortcutId))).toBeInTheDocument();
            expect(within(button).queryByText('Ctrl+F4')).not.toBeInTheDocument();
        });

        it('disables unavailable items', () => {
            render(<FileMenu {...mockHandlers} />);

            const openAccountBtn = screen.getByText('Open an Account').closest('button');
            const loginBtn = screen.getByText('Login to Trade Account').closest('button');

            expect(openAccountBtn).not.toBeDisabled();
            expect(loginBtn).toBeDisabled();
        });

        it('shows professional icons for Profiles and Close', () => {
            render(<FileMenu {...mockHandlers} />);

            const profilesButton = screen.getByText('Profiles').closest('button');
            const closeButton = screen.getByText('Close').closest('button');

            expect(profilesButton?.querySelector('svg')).toBeInTheDocument();
            expect(closeButton?.querySelector('svg')).toBeInTheDocument();
        });
    });

    describe('Basic Actions', () => {
        it('keeps the active account and logout together at the top of the File section', () => {
            const onLogout = vi.fn();
            render(<FileMenu {...mockHandlers} accountId="200002" onLogout={onLogout} />);

            const accountHeader = screen.getByTestId('file-menu-account-header');
            const newChartButton = screen.getByText('New Chart').closest('button');
            const logoutButton = within(accountHeader).getByRole('menuitem', { name: 'Log Out' });

            expect(accountHeader).toHaveAttribute('aria-label', 'Current trading account 200002');
            expect(within(accountHeader).getByText('200002')).toBeInTheDocument();
            expect(accountHeader.compareDocumentPosition(newChartButton!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(screen.getAllByRole('menuitem', { name: 'Log Out' })).toHaveLength(1);
            expect(logoutButton.querySelector('svg')).not.toBeNull();
            expect(logoutButton).not.toHaveAttribute('data-desktop-logout');

            fireEvent.click(logoutButton);
            expect(onLogout).toHaveBeenCalledTimes(1);
        });

        it('shows desktop Log Out as text only and preserves its account action', () => {
            const originalElectron = Object.getOwnPropertyDescriptor(window, 'electron');
            Object.defineProperty(window, 'electron', { configurable: true, value: { window: {} } });
            try {
                const onLogout = vi.fn();
                render(<FileMenu {...mockHandlers} accountId="200002" onLogout={onLogout} />);
                const accountHeader = screen.getByTestId('file-menu-account-header');
                const logoutButton = within(accountHeader).getByRole('menuitem', { name: 'Log Out' });

                expect(logoutButton).toHaveTextContent(/^Log Out$/);
                expect(logoutButton.querySelector('svg')).toBeNull();
                expect(logoutButton).toHaveAttribute('data-desktop-logout', 'true');
                expect(logoutButton).toHaveAttribute('title', 'Log out of the current account');
                fireEvent.click(logoutButton);
                expect(onLogout).toHaveBeenCalledTimes(1);
            } finally {
                if (originalElectron) Object.defineProperty(window, 'electron', originalElectron);
                else delete window.electron;
            }
        });

        it('saves the named workspace through the canonical dialog', () => {
            render(<FileMenu {...mockHandlers} hasUnsavedChanges={false} />);

            const saveBtn = screen.getByText('Save').closest('button');
            fireEvent.click(saveBtn!);
            expect(screen.getByTestId('save-workspace-dialog')).toBeInTheDocument();
            expect(mockHandlers.onSave).not.toHaveBeenCalled();

            fireEvent.click(screen.getByText('Confirm Save'));

            expect(mockHandlers.onSave).toHaveBeenCalledWith('Default');
        });

        it('calls onSaveAsPicture when Save As Picture is clicked', () => {
            const chartContainer = document.createElement('div');
            const chartCanvas = document.createElement('canvas');
            chartCanvas.width = 800;
            chartCanvas.height = 600;
            chartContainer.appendChild(chartCanvas);
            document.body.appendChild(chartContainer);
            const unregister = registerActiveChartSource({
                id: 'file-menu-test-chart',
                getCanvas: () => chartCanvas,
                getContainer: () => chartContainer,
                getSymbol: () => 'XAUUSD',
                getTimeframe: () => 'M15',
            });

            render(<FileMenu {...mockHandlers} />);

            const saveAsPictureBtn = screen.getByText('Save As Picture').closest('button');
            fireEvent.click(saveAsPictureBtn!);

            expect(mockHandlers.onSaveAsPicture).toHaveBeenCalledTimes(1);
            expect(screen.getByTestId('save-picture-dialog')).toBeInTheDocument();
            expect(savePictureDialogMock.props.at(-1)).toMatchObject({
                chartCanvas,
                chartContainer,
                symbol: 'XAUUSD',
                timeframe: 'M15',
            });

            unregister();
            chartContainer.remove();
        });

        it('does not open Save Picture without an active registered chart source', () => {
            render(<FileMenu {...mockHandlers} />);

            const saveAsPictureBtn = screen.getByText('Save As Picture').closest('button');
            fireEvent.click(saveAsPictureBtn!);

            expect(mockHandlers.onSaveAsPicture).not.toHaveBeenCalled();
            expect(screen.queryByTestId('save-picture-dialog')).not.toBeInTheDocument();
            expect(window.alert).toHaveBeenCalledWith('No chart available to export. Please open a chart first.');
        });

        it('calls onOpenDataFolder when Open Data Folder is clicked', () => {
            render(<FileMenu {...mockHandlers} />);

            const openDataFolderBtn = screen.getByText('Open Data Folder').closest('button');
            fireEvent.click(openDataFolderBtn!);

            expect(mockHandlers.onOpenDataFolder).toHaveBeenCalledTimes(1);
        });

        it('closes the current chart through the canonical menu action', () => {
            const onCloseActiveChart = vi.fn();
            render(<FileMenu {...mockHandlers} onCloseActiveChart={onCloseActiveChart} />);

            fireEvent.click(screen.getByText('Close').closest('button')!);

            expect(onCloseActiveChart).toHaveBeenCalledTimes(1);
        });

        it('restores a recently closed chart from Open Deleted', () => {
            useDockLayoutStore.setState({
                recentlyClosedCharts: [{
                    id: 'closed-xauusd',
                    title: 'XAUUSD,M15',
                    component: 'Chart',
                    props: { symbol: 'XAUUSD', timeframe: 'M15' },
                }],
            });
            const restoreSpy = vi.spyOn(useDockLayoutStore.getState(), 'restoreClosedChart').mockReturnValue(true);
            const onChartRestored = vi.fn();
            render(<FileMenu {...mockHandlers} onChartRestored={onChartRestored} />);

            fireEvent.click(screen.getByRole('button', { name: 'XAUUSD,M15' }));

            expect(restoreSpy).toHaveBeenCalledWith('closed-xauusd');
            expect(onChartRestored).toHaveBeenCalledTimes(1);
        });

        it('lists and restores real account-scoped workspace profiles', async () => {
            workspaceProfilesMock.listWorkspaceProfiles.mockReturnValue([{
                id: 'profile-market',
                accountId: '200002',
                name: 'Market',
                createdAt: '2026-09-02T10:00:00.000Z',
                updatedAt: '2026-09-02T10:00:00.000Z',
            }]);
            workspaceProfilesMock.restoreWorkspaceProfile.mockReturnValue({
                status: 'restored',
                profile: { name: 'Market' },
            });
            const onProfileRestored = vi.fn();
            render(<FileMenu {...mockHandlers} accountId="200002" onProfileRestored={onProfileRestored} />);

            const profileButton = await screen.findByRole('button', { name: 'Market' });
            fireEvent.click(profileButton);

            expect(workspaceProfilesMock.restoreWorkspaceProfile).toHaveBeenCalledWith({
                accountId: '200002',
                profileName: 'Market',
            });
            expect(onProfileRestored).toHaveBeenCalledWith('Market');
        });

        it('restores builtin profiles like Euro via restoreBuiltinWorkspaceProfile when not saved yet', async () => {
            workspaceProfilesMock.listWorkspaceProfiles.mockReturnValue([]);
            workspaceProfilesMock.restoreWorkspaceProfile.mockReturnValue({ status: 'missing', profile: null });
            workspaceProfilesMock.restoreBuiltinWorkspaceProfile.mockReturnValue({
                status: 'restored',
                profile: { name: 'Euro' },
            });
            const onProfileRestored = vi.fn();
            render(<FileMenu {...mockHandlers} accountId="200002" onProfileRestored={onProfileRestored} />);

            const euroBtn = await screen.findByRole('button', { name: 'Euro' });
            fireEvent.click(euroBtn);

            expect(workspaceProfilesMock.restoreBuiltinWorkspaceProfile).toHaveBeenCalledWith('200002', 'Euro');
            expect(onProfileRestored).toHaveBeenCalledWith('Euro');
        });

        it('supports Next and Previous profile actions from the Profiles submenu', async () => {
            workspaceProfilesMock.listWorkspaceProfiles.mockReturnValue([]);
            workspaceProfilesMock.restoreWorkspaceProfile.mockReturnValue({ status: 'missing', profile: null });
            workspaceProfilesMock.restoreBuiltinWorkspaceProfile.mockReturnValue({
                status: 'restored',
                profile: { name: 'Euro' },
            });
            const onProfileRestored = vi.fn();
            render(<FileMenu {...mockHandlers} accountId="200002" onProfileRestored={onProfileRestored} />);

            const nextBtn = screen.getByText('Next').closest('button')!;
            fireEvent.click(nextBtn);

            expect(workspaceProfilesMock.restoreBuiltinWorkspaceProfile).toHaveBeenCalled();
            expect(onProfileRestored).toHaveBeenCalled();
        });

        it('opens Save Workspace dialog from Save As... in Profiles submenu', () => {
            render(<FileMenu {...mockHandlers} accountId="200002" />);

            const saveAsBtn = screen.getByText('Save As...').closest('button')!;
            fireEvent.click(saveAsBtn);

            expect(screen.getByTestId('save-workspace-dialog')).toBeInTheDocument();
        });

        it('deletes custom profile when selected in Delete submenu', () => {
            workspaceProfilesMock.listWorkspaceProfiles.mockReturnValue([{
                id: 'profile-custom-1',
                accountId: '200002',
                name: 'CustomStrategy',
                createdAt: '2026-09-02T10:00:00.000Z',
                updatedAt: '2026-09-02T10:00:00.000Z',
            }]);
            workspaceProfilesMock.deleteWorkspaceProfile.mockReturnValue(true);
            render(<FileMenu {...mockHandlers} accountId="200002" />);

            const deleteBtn = screen.getByLabelText('Delete profile CustomStrategy');
            fireEvent.click(deleteBtn);

            expect(workspaceProfilesMock.deleteWorkspaceProfile).toHaveBeenCalledWith({
                accountId: '200002',
                profileName: 'CustomStrategy',
            });
        });

        it('opens the established trade-account login flow', () => {
            const onLoginTrade = vi.fn();
            render(<FileMenu {...mockHandlers} onLoginTrade={onLoginTrade} />);

            const loginButton = screen.getByText('Login to Trade Account').closest('button')!;
            expect(loginButton).not.toBeDisabled();
            fireEvent.click(loginButton);

            expect(onLoginTrade).toHaveBeenCalledTimes(1);
        });

        it('calls onPrint when Print is clicked', async () => {
            render(<FileMenu {...mockHandlers} />);

            const printBtn = screen.getByText('Print').closest('button');
            fireEvent.click(printBtn!);

            await waitFor(() => expect(mockHandlers.onPrint).toHaveBeenCalledTimes(1));
        });

        it('uses the active account print preferences for direct printing', async () => {
            render(<FileMenu accountId="200002" />);

            fireEvent.click(screen.getByText('Print').closest('button')!);

            await waitFor(() => {
                expect(chartPrinter.getPreferences).toHaveBeenCalledWith('200002');
                expect(chartPrinter.printChart).toHaveBeenCalledTimes(1);
            });
        });
    });

    describe('Dialog Opening', () => {
        it('opens SaveWorkspaceDialog when Save is clicked with unsaved changes', async () => {
            render(<FileMenu {...mockHandlers} hasUnsavedChanges={true} />);

            const saveBtn = screen.getByText('Save').closest('button');
            fireEvent.click(saveBtn!);

            await waitFor(() => {
                expect(screen.getByTestId('save-workspace-dialog')).toBeInTheDocument();
            });
        });

        it('opens shortcut dialogs while the File menu is closed without rendering duplicate menu controls', async () => {
            render(<FileMenu shortcutsOnly />);
            expect(screen.queryByText('Print Preview')).not.toBeInTheDocument();
            await act(async () => { window.dispatchEvent(new CustomEvent('open-print-preview')); });
            expect(screen.getAllByTestId('print-preview-dialog')).toHaveLength(1);
            expect(chartPrinter.captureActiveChartData).toHaveBeenCalledOnce();
            fireEvent.click(screen.getByText('Close Preview'));

            const container = document.createElement('div');
            const canvas = document.createElement('canvas');
            container.appendChild(canvas); document.body.appendChild(container);
            const unregister = registerActiveChartSource({ id: 'shortcut-export', getContainer: () => container, getCanvas: () => canvas, getSymbol: () => 'EURUSD', getTimeframe: () => 'M5' });
            act(() => { window.dispatchEvent(new CustomEvent('open-save-picture')); });
            expect(screen.getByTestId('save-picture-dialog')).toBeInTheDocument();
            expect(savePictureDialogMock.props.at(-1)).toMatchObject({ symbol: 'EURUSD', timeframe: 'M5', chartCanvas: canvas });
            unregister(); container.remove();
        });

        it('does not handle the keyboard event a second time when the regular File submenu is mounted', async () => {
            render(<><FileMenu shortcutsOnly /><FileMenu /></>);
            await act(async () => { window.dispatchEvent(new CustomEvent('open-print-preview')); });
            expect(screen.getAllByTestId('print-preview-dialog')).toHaveLength(1);
            expect(chartPrinter.captureActiveChartData).toHaveBeenCalledOnce();
        });

        it('opens PrintPreviewDialog when Print Preview is clicked', async () => {
            render(<FileMenu {...mockHandlers} />);

            const printPreviewBtn = screen.getByText('Print Preview').closest('button');
            fireEvent.click(printPreviewBtn!);

            await waitFor(() => {
                expect(screen.getByTestId('print-preview-dialog')).toBeInTheDocument();
            });
        });

        it('opens PrintSetupDialog when Print Setup is clicked', async () => {
            render(<FileMenu {...mockHandlers} />);

            const printSetupBtn = screen.getByText('Print Setup').closest('button');
            fireEvent.click(printSetupBtn!);

            await waitFor(() => {
                expect(screen.getByTestId('print-setup-dialog')).toBeInTheDocument();
            });
        });

        it('opens ExitConfirmDialog when Exit is clicked with unsaved changes', async () => {
            render(<FileMenu {...mockHandlers} hasUnsavedChanges={true} />);

            const exitBtn = screen.getByText('Exit').closest('button');
            fireEvent.click(exitBtn!);

            await waitFor(() => {
                expect(screen.getByTestId('exit-confirm-dialog')).toBeInTheDocument();
            });
        });

        it('calls onExit directly when no unsaved changes', () => {
            const mockWindowClose = vi.spyOn(window, 'close').mockImplementation(() => { });

            render(<FileMenu {...mockHandlers} hasUnsavedChanges={false} />);

            const exitBtn = screen.getByText('Exit').closest('button');
            fireEvent.click(exitBtn!);

            expect(mockHandlers.onExit).toHaveBeenCalledTimes(1);
            mockWindowClose.mockRestore();
        });
    });

    describe('Accessibility', () => {
        it('has proper tooltips on buttons', () => {
            render(<FileMenu {...mockHandlers} />);

            const saveBtn = screen.getByText('Save').closest('button');
            expect(saveBtn).toHaveAttribute('title', 'Save workspace configuration');
        });

        it('supports keyboard navigation', () => {
            render(<FileMenu {...mockHandlers} />);

            const saveBtn = screen.getByText('Save').closest('button');
            saveBtn?.focus();

            expect(document.activeElement).toBe(saveBtn);
        });
    });

    describe('Styling', () => {
        it('applies correct hover states', () => {
            render(<FileMenu {...mockHandlers} />);

            const saveBtn = screen.getByText('Save').closest('button');
            expect(saveBtn).toHaveClass('hover:bg-[#2a2e39]');
            expect(saveBtn).toHaveClass('hover:text-white');
        });

        it('applies correct disabled styles', () => {
            render(<FileMenu {...mockHandlers} />);

            const loginBtn = screen.getByText('Login to Trade Account').closest('button');
            expect(loginBtn).toHaveClass('text-zinc-600');
            expect(loginBtn).toHaveClass('cursor-not-allowed');
        });
    });
});
