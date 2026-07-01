import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { chartPrinter } from '../../services/chartPrinter';
import { defaultChartProperties, useChartSettingsStore } from '../../store/useChartSettingsStore';
import { ChartPropertiesDialog } from './ChartPropertiesDialog';
import { ExitConfirmDialog } from './ExitConfirmDialog';
import { PrintPreviewDialog } from './PrintPreviewDialog';
import { PrintSetupDialog } from './PrintSetupDialog';
import { SaveWorkspaceDialog } from './SaveWorkspaceDialog';

const unsavedChanges = {
  hasWorkspaceChanges: true,
  hasOpenTrades: true,
  hasDraftOrders: false,
  openTradesCount: 2,
  draftOrdersCount: 0,
};

describe('dialog components', () => {
  it('renders SaveWorkspaceDialog and cancels', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(<SaveWorkspaceDialog onConfirm={vi.fn()} onCancel={onCancel} />);

    expect(screen.getByLabelText('Workspace Name')).toHaveValue('Default');
    await user.click(screen.getByText('Cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders PrintSetupDialog and confirms current preferences', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(<PrintSetupDialog onConfirm={onConfirm} onCancel={vi.fn()} />);

    expect(screen.getByText('Print Setup')).toBeInTheDocument();
    await user.click(screen.getByText('OK'));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
        pageSize: 'A4',
        orientation: 'landscape',
        colorMode: 'color',
      }));
    });
  });

  it('renders PrintPreviewDialog and runs the print action', async () => {
    const user = userEvent.setup();
    const onPrint = vi.fn();
    const onClose = vi.fn();
    const printSpy = vi.spyOn(chartPrinter, 'printChart').mockResolvedValue();

    render(<PrintPreviewDialog onPrint={onPrint} onClose={onClose} />);

    expect(await screen.findByText('Print Preview')).toBeInTheDocument();
    await user.click(screen.getByTitle('Zoom In'));
    expect(await screen.findByText('125%')).toBeInTheDocument();

    await user.click(screen.getByText('Print'));

    await waitFor(() => {
      expect(printSpy).toHaveBeenCalledTimes(1);
      expect(onPrint).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('renders ExitConfirmDialog and confirms discard or save choices', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    const { rerender } = render(
      <ExitConfirmDialog
        isOpen
        changes={unsavedChanges}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
    await user.click(screen.getByText('Discard & Exit'));
    expect(onConfirm).toHaveBeenCalledWith(false);

    onConfirm.mockClear();
    rerender(
      <ExitConfirmDialog
        isOpen
        changes={unsavedChanges}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    await user.click(screen.getByText('Save & Exit'));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('dispatches chart shift runtime events from ChartPropertiesDialog', async () => {
    const user = userEvent.setup();
    const chartShiftHandler = vi.fn();

    useChartSettingsStore.setState({
      globalProperties: { ...defaultChartProperties, chartShift: false },
      symbolProperties: {},
    });
    window.addEventListener('rtx:chartShift', chartShiftHandler as EventListener);

    try {
      render(
        <ChartPropertiesDialog
          isOpen
          onClose={vi.fn()}
          symbol="XAUUSD"
          timeframe="M1"
        />
      );

      await user.click(screen.getByLabelText('Chart shift'));

      expect(useChartSettingsStore.getState().globalProperties.chartShift).toBe(true);
      expect(chartShiftHandler).toHaveBeenCalledTimes(1);
      expect((chartShiftHandler.mock.calls[0][0] as CustomEvent).detail).toEqual({ enabled: true });
    } finally {
      window.removeEventListener('rtx:chartShift', chartShiftHandler as EventListener);
    }
  });
});
