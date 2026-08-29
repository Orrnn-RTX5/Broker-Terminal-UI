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

  it('offers Area after Line and changes the active chart type', async () => {
    const user = userEvent.setup();
    const onChartTypeChange = vi.fn();

    useChartSettingsStore.setState({
      globalProperties: { ...defaultChartProperties, chartType: 'Line' },
      symbolProperties: {},
    });

    render(
      <ChartPropertiesDialog
        isOpen
        onClose={vi.fn()}
        symbol="XAUUSD"
        timeframe="M1"
        currentChartType="line"
        onChartTypeChange={onChartTypeChange}
      />
    );

    const lineLabel = screen.getByText('Line chart');
    const areaLabel = screen.getByText('Area chart');
    const chartTypeLabels = Array.from(
      lineLabel.closest('.rtx-cp-fieldset')?.querySelectorAll('.rtx-cp-radio-label') ?? [],
    ).map(label => label.textContent);

    expect(chartTypeLabels.indexOf('Area chart')).toBe(chartTypeLabels.indexOf('Line chart') + 1);
    await user.click(areaLabel);

    expect(onChartTypeChange).toHaveBeenCalledWith('area');
    expect(useChartSettingsStore.getState().globalProperties.chartType).toBe('Area');
    expect(useChartSettingsStore.getState().symbolProperties.XAUUSD.chartType).toBe('Area');
  });

  it('applies color schemes to the active symbol override', async () => {
    const user = userEvent.setup();

    useChartSettingsStore.setState({
      globalProperties: { ...defaultChartProperties },
      symbolProperties: {
        XAUUSD: {
          ...defaultChartProperties,
          colorScheme: 'Green on Black',
          colors: {
            ...defaultChartProperties.colors,
            barUp: '#10B981',
            barDown: '#EF4444',
            bullCandle: '#10B981',
            bearCandle: '#EF4444',
          },
        },
      },
    });

    render(
      <ChartPropertiesDialog
        isOpen
        onClose={vi.fn()}
        symbol="XAUUSD"
        timeframe="H1"
      />
    );

    await user.click(screen.getByText('Colors'));
    await user.selectOptions(screen.getByDisplayValue('Green on Black'), 'Yellow on Black');

    const { globalProperties, symbolProperties } = useChartSettingsStore.getState();

    expect(globalProperties.colorScheme).toBe('Yellow on Black');
    expect(symbolProperties.XAUUSD.colorScheme).toBe('Yellow on Black');
    expect(symbolProperties.XAUUSD.colors.barUp).toBe('#facc15');
    expect(symbolProperties.XAUUSD.colors.barDown).toBe('#facc15');
    expect(symbolProperties.XAUUSD.colors.bullCandle).toBe('#000000');
    expect(symbolProperties.XAUUSD.colors.bearCandle).toBe('#f8fafc');
  });

  it('keeps chart color scheme options styled for the dark modal', async () => {
    const user = userEvent.setup();
    document.documentElement.classList.remove('rtx-advanced-view', 'rtx-skin-untitled-light');

    useChartSettingsStore.setState({
      globalProperties: { ...defaultChartProperties },
      symbolProperties: {},
    });

    render(
      <ChartPropertiesDialog
        isOpen
        onClose={vi.fn()}
        symbol="XAUUSD"
        timeframe="H1"
      />
    );

    await user.click(screen.getByText('Colors'));

    expect(screen.getByRole('option', { name: 'Green on Black' })).toHaveStyle({
      backgroundColor: '#2b2b2b',
      color: '#cccccc',
    });
  });

  it('lets the advanced light skin own chart color scheme option styling', async () => {
    const user = userEvent.setup();
    const root = document.documentElement;
    let unmount: (() => void) | undefined;

    useChartSettingsStore.setState({
      globalProperties: { ...defaultChartProperties },
      symbolProperties: {},
    });

    root.classList.add('rtx-advanced-view', 'rtx-skin-untitled-light');

    try {
      ({ unmount } = render(
        <ChartPropertiesDialog
          isOpen
          onClose={vi.fn()}
          symbol="XAUUSD"
          timeframe="H1"
        />
      ));

      await user.click(screen.getByText('Colors'));

      const option = screen.getByRole('option', { name: 'Green on Black' });
      expect(option).not.toHaveStyle({
        backgroundColor: '#2b2b2b',
        color: '#cccccc',
      });
      expect(option.style.backgroundColor).toBe('');
      expect(option.style.color).toBe('');
    } finally {
      unmount?.();
      root.classList.remove('rtx-advanced-view', 'rtx-skin-untitled-light');
    }
  });
});
