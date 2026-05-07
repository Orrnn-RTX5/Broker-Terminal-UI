/**
 * SavePictureDialog Component Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SavePictureDialog } from './SavePictureDialog';
import { ChartExporter } from '../../services/chartExporter';

vi.mock('../../services/chartExporter');

describe('SavePictureDialog', () => {
  let mockCanvas: HTMLCanvasElement;
  let mockOnClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockCanvas = document.createElement('canvas');
    mockCanvas.width = 800;
    mockCanvas.height = 600;
    mockOnClose = vi.fn();

    // Mock ChartExporter methods
    vi.mocked(ChartExporter.getPreview).mockReturnValue('data:image/png;base64,test');
    vi.mocked(ChartExporter.exportCanvas).mockResolvedValue(new Blob(['test'], { type: 'image/png' }));
    vi.mocked(ChartExporter.generateFilename).mockReturnValue('EURUSD_5m_2024-01-01.png');
    vi.mocked(ChartExporter.downloadBlob).mockImplementation(() => {});
  });

  it('should render when open', () => {
    render(
      <SavePictureDialog
        isOpen={true}
        onClose={mockOnClose}
        chartCanvas={mockCanvas}
        symbol="EURUSD"
        timeframe="5m"
      />
    );

    expect(screen.getByText('Save Chart As Picture')).toBeInTheDocument();
  });

  it('should not render when closed', () => {
    const { container } = render(
      <SavePictureDialog
        isOpen={false}
        onClose={mockOnClose}
        chartCanvas={mockCanvas}
        symbol="EURUSD"
        timeframe="5m"
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('should display preview on mount', () => {
    render(
      <SavePictureDialog
        isOpen={true}
        onClose={mockOnClose}
        chartCanvas={mockCanvas}
        symbol="EURUSD"
        timeframe="5m"
      />
    );

    expect(ChartExporter.getPreview).toHaveBeenCalledWith(mockCanvas, 300, 200);

    const img = screen.getByAltText('Chart preview');
    expect(img).toHaveAttribute('src', 'data:image/png;base64,test');
  });

  it('should allow format selection', () => {
    render(
      <SavePictureDialog
        isOpen={true}
        onClose={mockOnClose}
        chartCanvas={mockCanvas}
        symbol="EURUSD"
        timeframe="5m"
      />
    );

    const pngRadio = screen.getByLabelText(/PNG/i);
    const jpgRadio = screen.getByLabelText(/JPG/i);

    expect(pngRadio).toBeChecked();
    expect(jpgRadio).not.toBeChecked();

    fireEvent.click(jpgRadio);

    expect(jpgRadio).toBeChecked();
    expect(pngRadio).not.toBeChecked();
  });

  it('should show quality slider for JPG format', () => {
    render(
      <SavePictureDialog
        isOpen={true}
        onClose={mockOnClose}
        chartCanvas={mockCanvas}
        symbol="EURUSD"
        timeframe="5m"
      />
    );

    // Quality slider should not be visible for PNG
    expect(screen.queryByText(/Quality:/)).not.toBeInTheDocument();

    // Switch to JPG
    const jpgRadio = screen.getByLabelText(/JPG/i);
    fireEvent.click(jpgRadio);

    // Quality slider should now be visible
    expect(screen.getByText(/Quality:/)).toBeInTheDocument();
  });

  it('should allow scale selection', () => {
    render(
      <SavePictureDialog
        isOpen={true}
        onClose={mockOnClose}
        chartCanvas={mockCanvas}
        symbol="EURUSD"
        timeframe="5m"
      />
    );

    const scaleSelect = screen.getByDisplayValue(/1x - Standard/);
    expect(scaleSelect).toBeInTheDocument();

    fireEvent.change(scaleSelect, { target: { value: '2' } });
    expect(scaleSelect).toHaveValue('2');
  });

  it('should toggle overlay options', () => {
    render(
      <SavePictureDialog
        isOpen={true}
        onClose={mockOnClose}
        chartCanvas={mockCanvas}
        symbol="EURUSD"
        timeframe="5m"
      />
    );

    const symbolCheckbox = screen.getByLabelText(/Include Symbol & Timeframe/);
    const timestampCheckbox = screen.getByLabelText(/Include Timestamp/);
    const watermarkCheckbox = screen.getByLabelText(/Include Watermark/);

    expect(symbolCheckbox).toBeChecked();
    expect(timestampCheckbox).toBeChecked();
    expect(watermarkCheckbox).not.toBeChecked();

    fireEvent.click(symbolCheckbox);
    expect(symbolCheckbox).not.toBeChecked();

    fireEvent.click(watermarkCheckbox);
    expect(watermarkCheckbox).toBeChecked();
  });

  it('should show watermark input when watermark is enabled', () => {
    render(
      <SavePictureDialog
        isOpen={true}
        onClose={mockOnClose}
        chartCanvas={mockCanvas}
        symbol="EURUSD"
        timeframe="5m"
      />
    );

    const watermarkCheckbox = screen.getByLabelText(/Include Watermark/);

    // Watermark input should not be visible initially
    expect(screen.queryByPlaceholderText('Watermark text')).not.toBeInTheDocument();

    // Enable watermark
    fireEvent.click(watermarkCheckbox);

    // Watermark input should now be visible
    const watermarkInput = screen.getByPlaceholderText('Watermark text');
    expect(watermarkInput).toBeInTheDocument();
    expect(watermarkInput).toHaveValue('Trading Engine');
  });

  it('should export chart on save button click', async () => {
    render(
      <SavePictureDialog
        isOpen={true}
        onClose={mockOnClose}
        chartCanvas={mockCanvas}
        symbol="EURUSD"
        timeframe="5m"
      />
    );

    const saveButton = screen.getByText('Save Picture');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(ChartExporter.exportCanvas).toHaveBeenCalledWith(
        mockCanvas,
        expect.objectContaining({
          symbol: 'EURUSD',
          timeframe: '5m'
        }),
        expect.objectContaining({
          format: 'png',
          includeTimestamp: true,
          includeSymbolInfo: true
        })
      );
    });

    await waitFor(() => {
      expect(ChartExporter.downloadBlob).toHaveBeenCalled();
    });

    // Dialog should close after export
    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalled();
    }, { timeout: 1000 });
  });

  it('should handle export errors', async () => {
    vi.mocked(ChartExporter.exportCanvas).mockRejectedValue(new Error('Export failed'));

    render(
      <SavePictureDialog
        isOpen={true}
        onClose={mockOnClose}
        chartCanvas={mockCanvas}
        symbol="EURUSD"
        timeframe="5m"
      />
    );

    const saveButton = screen.getByText('Save Picture');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('Export failed')).toBeInTheDocument();
    });

    // Dialog should not close on error
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('should show error when no chart is available', async () => {
    render(
      <SavePictureDialog
        isOpen={true}
        onClose={mockOnClose}
        chartCanvas={null}
        chartContainer={null}
        symbol="EURUSD"
        timeframe="5m"
      />
    );

    const saveButton = screen.getByText('Save Picture');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('No chart available to export')).toBeInTheDocument();
    });
  });

  it('should close on cancel button click', () => {
    render(
      <SavePictureDialog
        isOpen={true}
        onClose={mockOnClose}
        chartCanvas={mockCanvas}
        symbol="EURUSD"
        timeframe="5m"
      />
    );

    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('should close on X button click', () => {
    render(
      <SavePictureDialog
        isOpen={true}
        onClose={mockOnClose}
        chartCanvas={mockCanvas}
        symbol="EURUSD"
        timeframe="5m"
      />
    );

    const closeButton = screen.getByRole('button', { name: '' }); // X button has no text
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('should disable buttons during export', async () => {
    vi.mocked(ChartExporter.exportCanvas).mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve(new Blob()), 1000))
    );

    render(
      <SavePictureDialog
        isOpen={true}
        onClose={mockOnClose}
        chartCanvas={mockCanvas}
        symbol="EURUSD"
        timeframe="5m"
      />
    );

    const saveButton = screen.getByText('Save Picture');
    const cancelButton = screen.getByText('Cancel');

    fireEvent.click(saveButton);

    // Buttons should be disabled during export
    await waitFor(() => {
      expect(saveButton).toBeDisabled();
      expect(cancelButton).toBeDisabled();
    });
  });

  it('should display symbol and timeframe in footer', () => {
    render(
      <SavePictureDialog
        isOpen={true}
        onClose={mockOnClose}
        chartCanvas={mockCanvas}
        symbol="GBPUSD"
        timeframe="1h"
      />
    );

    expect(screen.getByText('GBPUSD - 1h')).toBeInTheDocument();
  });
});
