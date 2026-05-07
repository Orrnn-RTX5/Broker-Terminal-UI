/**
 * FileMenu Component Tests
 * Comprehensive test suite for File menu functionality
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileMenu } from './FileMenu';

describe('FileMenu Component', () => {
    const mockHandlers = {
        onSave: jest.fn(),
        onSaveAsPicture: jest.fn(),
        onOpenDataFolder: jest.fn(),
        onPrint: jest.fn(),
        onPrintPreview: jest.fn(),
        onPrintSetup: jest.fn(),
        onExit: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
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

            expect(openAccountBtn).toBeDisabled();
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
            render(<FileMenu {...mockHandlers} />);

            const saveAsPictureBtn = screen.getByText('Save As Picture').closest('button');
            fireEvent.click(saveAsPictureBtn!);

            expect(mockHandlers.onSaveAsPicture).toHaveBeenCalledTimes(1);
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
                expect(screen.getByText('Save Workspace')).toBeInTheDocument();
            });
        });

        it('opens PrintPreviewDialog when Print Preview is clicked', async () => {
            render(<FileMenu {...mockHandlers} />);

            const printPreviewBtn = screen.getByText('Print Preview').closest('button');
            fireEvent.click(printPreviewBtn!);

            await waitFor(() => {
                expect(screen.getByText('Print Preview')).toBeInTheDocument();
            });
        });

        it('opens PrintSetupDialog when Print Setup is clicked', async () => {
            render(<FileMenu {...mockHandlers} />);

            const printSetupBtn = screen.getByText('Print Setup').closest('button');
            fireEvent.click(printSetupBtn!);

            await waitFor(() => {
                expect(screen.getByText('Print Setup')).toBeInTheDocument();
            });
        });

        it('opens ExitConfirmDialog when Exit is clicked with unsaved changes', async () => {
            render(<FileMenu {...mockHandlers} hasUnsavedChanges={true} />);

            const exitBtn = screen.getByText('Exit').closest('button');
            fireEvent.click(exitBtn!);

            await waitFor(() => {
                expect(screen.getByText('Unsaved Changes')).toBeInTheDocument();
            });
        });

        it('calls onExit directly when no unsaved changes', () => {
            const mockWindowClose = jest.fn();
            global.window.close = mockWindowClose;

            render(<FileMenu {...mockHandlers} hasUnsavedChanges={false} />);

            const exitBtn = screen.getByText('Exit').closest('button');
            fireEvent.click(exitBtn!);

            expect(mockHandlers.onExit).toHaveBeenCalledTimes(1);
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

            const openAccountBtn = screen.getByText('Open an Account').closest('button');
            expect(openAccountBtn).toHaveClass('text-zinc-600');
            expect(openAccountBtn).toHaveClass('cursor-not-allowed');
        });
    });
});
