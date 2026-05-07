/**
 * Dialog Components Tests
 * Comprehensive test suite for all dialog components
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SaveWorkspaceDialog } from './SaveWorkspaceDialog';
import { PrintSetupDialog } from './PrintSetupDialog';
import { PrintPreviewDialog } from './PrintPreviewDialog';
import { ExitConfirmDialog } from './ExitConfirmDialog';

describe('SaveWorkspaceDialog', () => {
    const mockHandlers = {
        onConfirm: jest.fn(),
        onCancel: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders with default workspace name', () => {
        render(<SaveWorkspaceDialog {...mockHandlers} />);

        const input = screen.getByLabelText('Workspace Name') as HTMLInputElement;
        expect(input.value).toBe('Default');
    });

    it('allows changing workspace name', () => {
        render(<SaveWorkspaceDialog {...mockHandlers} />);

        const input = screen.getByLabelText('Workspace Name') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'My Workspace' } });

        expect(input.value).toBe('My Workspace');
    });

    it('shows overwrite warning for existing workspace', async () => {
        render(<SaveWorkspaceDialog {...mockHandlers} existingWorkspace="Default" />);

        const saveBtn = screen.getByText('Save');
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(screen.getByText(/already exists/i)).toBeInTheDocument();
        });
    });

    it('calls onConfirm with workspace name', () => {
        render(<SaveWorkspaceDialog {...mockHandlers} />);

        const input = screen.getByLabelText('Workspace Name');
        fireEvent.change(input, { target: { value: 'Test' } });

        const saveBtn = screen.getByText('Save');
        fireEvent.click(saveBtn);

        // Shows overwrite warning first
        const overwriteBtn = screen.getByText('Overwrite');
        fireEvent.click(overwriteBtn);

        expect(mockHandlers.onConfirm).toHaveBeenCalledWith('Test');
    });

    it('calls onCancel when Cancel is clicked', () => {
        render(<SaveWorkspaceDialog {...mockHandlers} />);

        const cancelBtn = screen.getByText('Cancel');
        fireEvent.click(cancelBtn);

        expect(mockHandlers.onCancel).toHaveBeenCalledTimes(1);
    });

    it('supports keyboard shortcuts', () => {
        render(<SaveWorkspaceDialog {...mockHandlers} />);

        const input = screen.getByLabelText('Workspace Name');
        fireEvent.keyDown(input, { key: 'Escape' });

        expect(mockHandlers.onCancel).toHaveBeenCalledTimes(1);
    });
});

describe('PrintSetupDialog', () => {
    const mockHandlers = {
        onConfirm: jest.fn(),
        onCancel: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders with default settings', () => {
        render(<PrintSetupDialog {...mockHandlers} />);

        expect(screen.getByText('Print Setup')).toBeInTheDocument();
        expect(screen.getByText('Page Setup')).toBeInTheDocument();
        expect(screen.getByText('Margins (mm)')).toBeInTheDocument();
    });

    it('allows changing orientation', () => {
        render(<PrintSetupDialog {...mockHandlers} />);

        const orientationSelect = screen.getByLabelText('Orientation') as HTMLSelectElement;
        fireEvent.change(orientationSelect, { target: { value: 'portrait' } });

        expect(orientationSelect.value).toBe('portrait');
    });

    it('allows changing paper size', () => {
        render(<PrintSetupDialog {...mockHandlers} />);

        const paperSizeSelect = screen.getByLabelText('Paper Size') as HTMLSelectElement;
        fireEvent.change(paperSizeSelect, { target: { value: 'Letter' } });

        expect(paperSizeSelect.value).toBe('Letter');
    });

    it('allows changing margins', () => {
        render(<PrintSetupDialog {...mockHandlers} />);

        const topMarginInput = screen.getByLabelText('Top') as HTMLInputElement;
        fireEvent.change(topMarginInput, { target: { value: '15' } });

        expect(topMarginInput.value).toBe('15');
    });

    it('allows toggling print options', () => {
        render(<PrintSetupDialog {...mockHandlers} />);

        const headerCheckbox = screen.getByText('Include Header').previousSibling as HTMLInputElement;
        fireEvent.click(headerCheckbox);

        expect(headerCheckbox.checked).toBe(false);
    });

    it('calls onConfirm with settings', () => {
        render(<PrintSetupDialog {...mockHandlers} />);

        const applyBtn = screen.getByText('Apply Settings');
        fireEvent.click(applyBtn);

        expect(mockHandlers.onConfirm).toHaveBeenCalledWith(
            expect.objectContaining({
                orientation: 'landscape',
                paperSize: 'A4',
                quality: 'high',
            })
        );
    });
});

describe('PrintPreviewDialog', () => {
    const mockHandlers = {
        onPrint: jest.fn(),
        onClose: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders with default zoom level', () => {
        render(<PrintPreviewDialog {...mockHandlers} />);

        expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('allows zooming in', () => {
        render(<PrintPreviewDialog {...mockHandlers} />);

        const zoomInBtn = screen.getByTitle('Zoom In');
        fireEvent.click(zoomInBtn);

        expect(screen.getByText('110%')).toBeInTheDocument();
    });

    it('allows zooming out', () => {
        render(<PrintPreviewDialog {...mockHandlers} />);

        const zoomOutBtn = screen.getByTitle('Zoom Out');
        fireEvent.click(zoomOutBtn);

        expect(screen.getByText('90%')).toBeInTheDocument();
    });

    it('prevents zooming beyond limits', () => {
        render(<PrintPreviewDialog {...mockHandlers} />);

        const zoomInBtn = screen.getByTitle('Zoom In');

        // Click 20 times to exceed max
        for (let i = 0; i < 20; i++) {
            fireEvent.click(zoomInBtn);
        }

        expect(screen.getByText('200%')).toBeInTheDocument();
    });

    it('toggles orientation', () => {
        render(<PrintPreviewDialog {...mockHandlers} />);

        const toggleBtn = screen.getByText('landscape').closest('button')!;
        fireEvent.click(toggleBtn);

        expect(screen.getByText('portrait')).toBeInTheDocument();
    });

    it('calls onPrint when Print is clicked', () => {
        render(<PrintPreviewDialog {...mockHandlers} />);

        const printBtn = screen.getByText('Print');
        fireEvent.click(printBtn);

        expect(mockHandlers.onPrint).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when Cancel is clicked', () => {
        render(<PrintPreviewDialog {...mockHandlers} />);

        const cancelBtn = screen.getByText('Cancel');
        fireEvent.click(cancelBtn);

        expect(mockHandlers.onClose).toHaveBeenCalledTimes(1);
    });
});

describe('ExitConfirmDialog', () => {
    const mockHandlers = {
        onSave: jest.fn(),
        onDontSave: jest.fn(),
        onCancel: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders warning message', () => {
        render(<ExitConfirmDialog {...mockHandlers} />);

        expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
    });

    it('calls onSave when Save & Exit is clicked', () => {
        render(<ExitConfirmDialog {...mockHandlers} />);

        const saveBtn = screen.getByText('Save & Exit');
        fireEvent.click(saveBtn);

        expect(mockHandlers.onSave).toHaveBeenCalledTimes(1);
    });

    it('calls onDontSave when Don\'t Save is clicked', () => {
        render(<ExitConfirmDialog {...mockHandlers} />);

        const dontSaveBtn = screen.getByText('Don\'t Save');
        fireEvent.click(dontSaveBtn);

        expect(mockHandlers.onDontSave).toHaveBeenCalledTimes(1);
    });

    it('calls onCancel when Cancel is clicked', () => {
        render(<ExitConfirmDialog {...mockHandlers} />);

        const cancelBtn = screen.getByText('Cancel');
        fireEvent.click(cancelBtn);

        expect(mockHandlers.onCancel).toHaveBeenCalledTimes(1);
    });

    it('has proper button styling', () => {
        render(<ExitConfirmDialog {...mockHandlers} />);

        const saveBtn = screen.getByText('Save & Exit');
        const dontSaveBtn = screen.getByText('Don\'t Save');

        expect(saveBtn).toHaveClass('bg-zinc-700');
        expect(dontSaveBtn).toHaveClass('text-rose-600');
    });
});
