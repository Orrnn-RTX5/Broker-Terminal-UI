/**
 * FileMenu Component Tests
 * Comprehensive test suite for File menu functionality
 */

import React from 'react';
import '@testing-library/jest-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileMenu } from './FileMenu';

// 1. Mock i18n translations
vi.mock('react-i18next', () => {
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
        'menu.file.loginMql5': 'Login to MQL5.community',
        'menu.file.exit': 'Exit',
    };
    return {
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

// 4. Mock chartPrinter service
vi.mock('../../services/chartPrinter', () => ({
    chartPrinter: {
        getPreferences: vi.fn(() => ({})),
        printChart: vi.fn(),
    }
}));

// 5. Mock all child dialogs
vi.mock('../dialogs/SaveWorkspaceDialog', () => ({
    SaveWorkspaceDialog: ({ onConfirm, onCancel }: any) => (
        <div data-testid="save-workspace-dialog">
            <span>Save Workspace</span>
            <button onClick={onConfirm}>Confirm Save</button>
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
    SavePictureDialog: ({ isOpen, onClose }: any) => isOpen ? (
        <div data-testid="save-picture-dialog">
            <span>Save Picture</span>
            <button onClick={onClose}>Close Save Picture</button>
        </div>
    ) : null
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
        vi.spyOn(window, 'alert').mockImplementation(() => { });
    });

    describe('Rendering', () => {
        it('renders all menu items', () => {
            render(<FileMenu {...mockHandlers} />);

            expect(screen.getByText('Save')).toBeInTheDocument();
            expect(screen.getByText('Save As Picture')).toBeInTheDocument();
            expect(screen.getByText('Open Data Folder')).toBeInTheDocument();
            expect(screen.getByText('Print')).toBeInTheDocument();
            expect(screen.getByText('Print Preview')).toBeInTheDocument();
            expect(screen.getByText('Print Setup')).toBeInTheDocument();
            expect(screen.getByText('Exit')).toBeInTheDocument();
        });

        it('displays keyboard shortcuts', () => {
            render(<FileMenu {...mockHandlers} />);

            expect(screen.getByText('Ctrl+S')).toBeInTheDocument();
            expect(screen.getByText('Ctrl+Shift+D')).toBeInTheDocument();
            expect(screen.getByText('Ctrl+P')).toBeInTheDocument();
        });

        it('disables unavailable items', () => {
            render(<FileMenu {...mockHandlers} />);

            const openAccountBtn = screen.getByText('Open an Account').closest('button');
            const loginBtn = screen.getByText('Login to Trade Account').closest('button');

            expect(openAccountBtn).not.toBeDisabled();
            expect(loginBtn).toBeDisabled();
        });
    });

    describe('Basic Actions', () => {
        it('calls onSave when Save is clicked', () => {
            render(<FileMenu {...mockHandlers} hasUnsavedChanges={false} />);

            const saveBtn = screen.getByText('Save').closest('button');
            fireEvent.click(saveBtn!);

            expect(mockHandlers.onSave).toHaveBeenCalledTimes(1);
        });

        it('calls onSaveAsPicture when Save As Picture is clicked', () => {
            (window as any).__activeChartCanvas = {} as any; // mock chart canvas to pass active check
            render(<FileMenu {...mockHandlers} />);

            const saveAsPictureBtn = screen.getByText('Save As Picture').closest('button');
            fireEvent.click(saveAsPictureBtn!);

            expect(mockHandlers.onSaveAsPicture).toHaveBeenCalledTimes(1);

            delete (window as any).__activeChartCanvas; // cleanup
        });

        it('calls onOpenDataFolder when Open Data Folder is clicked', () => {
            render(<FileMenu {...mockHandlers} />);

            const openDataFolderBtn = screen.getByText('Open Data Folder').closest('button');
            fireEvent.click(openDataFolderBtn!);

            expect(mockHandlers.onOpenDataFolder).toHaveBeenCalledTimes(1);
        });

        it('calls onPrint when Print is clicked', () => {
            render(<FileMenu {...mockHandlers} />);

            const printBtn = screen.getByText('Print').closest('button');
            fireEvent.click(printBtn!);

            expect(mockHandlers.onPrint).toHaveBeenCalledTimes(1);
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
