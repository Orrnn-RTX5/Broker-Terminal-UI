import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { chartPrinter } from '../../services/chartPrinter';
import { commandBus } from '../../services/commandBus';
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
  it.each(['Close', 'Escape', 'Backdrop', 'OK'])('retains enabled OHLC after %s dismissal and reopening', async (dismissal) => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    useChartSettingsStore.setState({
      globalProperties: { ...defaultChartProperties },
      symbolProperties: {},
    });
    const props = { isOpen: true, onClose, symbol: 'XAUUSD', timeframe: 'M1' };
    const { rerender } = render(<ChartPropertiesDialog {...props} />);
    await user.click(screen.getByText('Show', { exact: true }));
    await user.click(screen.getByLabelText('Show OHLC'));
    if (dismissal === 'Close') await user.click(screen.getByLabelText('Close chart properties'));
    else if (dismissal === 'Escape') await user.keyboard('{Escape}');
    else if (dismissal === 'Backdrop') await user.click(document.querySelector('.rtx-cp-backdrop')!);
    else await user.click(screen.getByText('OK', { exact: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useChartSettingsStore.getState().symbolProperties.XAUUSD.showOHLC).toBe(true);
    expect(useChartSettingsStore.getState().globalProperties.showOHLC).toBe(false);
    rerender(<ChartPropertiesDialog {...props} isOpen={false} />);
    rerender(<ChartPropertiesDialog {...props} />);
    expect(screen.getByLabelText('Show OHLC')).toBeChecked();
    // An explicit Cancel still undoes changes made during this opening.
    await user.click(screen.getByLabelText('Show OHLC'));
    await user.click(screen.getByText('Cancel', { exact: true }));
    expect(useChartSettingsStore.getState().symbolProperties.XAUUSD.showOHLC).toBe(true);
  });

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

  it('renders PrintPreviewDialog and delegates the print action exactly once', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const printSpy = vi.spyOn(chartPrinter, 'printChart').mockResolvedValue();
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/png;base64,test');
    const chartData = {
      chartCanvas: canvas,
      symbol: 'BTCUSD',
      timeframe: '1m',
      dateRange: { from: new Date('2024-01-01'), to: new Date('2024-01-02') },
      indicators: [],
      drawings: [],
    };
    const preferences = chartPrinter.getPreferences();
    const onPrint = vi.fn(() => chartPrinter.printChart(chartData, preferences));

    render(
      <PrintPreviewDialog
        onPrint={onPrint}
        onClose={onClose}
        chartData={chartData}
        preferences={preferences}
      />,
    );

    expect(await screen.findByText('Print Preview')).toBeInTheDocument();
    fireEvent.load(screen.getByTitle('Print Preview'));
    await user.click(screen.getByTitle('Actual size'));
    await user.click(screen.getByTitle('Zoom In'));
    expect(await screen.findByText('125%')).toBeInTheDocument();

    await user.click(screen.getByText('Print'));

    await waitFor(() => {
      expect(printSpy).toHaveBeenCalledTimes(1);
      expect(onPrint).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it('loads and saves PrintSetupDialog preferences for the supplied account', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const accountPreferences = {
      ...chartPrinter.getPreferences(),
      orientation: 'portrait' as const,
    };
    const loadSpy = vi.spyOn(chartPrinter, 'loadPreferences').mockResolvedValue(accountPreferences);
    const saveSpy = vi.spyOn(chartPrinter, 'savePreferences').mockResolvedValue({
      local: true,
      remote: false,
    });

    render(
      <PrintSetupDialog
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        accountId="account-200001"
      />,
    );

    expect(await screen.findByDisplayValue('Portrait')).toBeInTheDocument();
    await user.click(screen.getByText('Save these preferences as default'));
    await user.click(screen.getByText('OK'));

    await waitFor(() => {
      expect(loadSpy).toHaveBeenCalledWith('account-200001');
      expect(saveSpy).toHaveBeenCalledWith('account-200001', accountPreferences);
      expect(onConfirm).toHaveBeenCalledWith(accountPreferences);
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

  it('dispatches a targeted chart-shift command without mutating global defaults', async () => {
    const user = userEvent.setup();
    const dispatchSpy = vi.spyOn(commandBus, 'dispatch');

    useChartSettingsStore.setState({
      globalProperties: { ...defaultChartProperties, chartShift: false },
      symbolProperties: {},
    });
    render(
      <ChartPropertiesDialog
        isOpen
        onClose={vi.fn()}
        symbol="XAUUSD"
        timeframe="M1"
        targetContextId="trading-chart:chart-a"
      />
    );

    await user.click(screen.getByLabelText('Chart shift'));

    expect(useChartSettingsStore.getState().globalProperties.chartShift).toBe(false);
    expect(useChartSettingsStore.getState().symbolProperties.XAUUSD.chartShift).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'SET_CHART_SHIFT',
      payload: { enabled: true, targetContextId: 'trading-chart:chart-a' },
    });
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
    expect(useChartSettingsStore.getState().globalProperties.chartType).toBe('Line');
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

    expect(globalProperties.colorScheme).toBe('Green on Black');
    expect(symbolProperties.XAUUSD.colorScheme).toBe('Yellow on Black');
    expect(symbolProperties.XAUUSD.colors.barUp).toBe('#facc15');
    expect(symbolProperties.XAUUSD.colors.barDown).toBe('#facc15');
    expect(symbolProperties.XAUUSD.colors.bullCandle).toBe('#000000');
    expect(symbolProperties.XAUUSD.colors.bearCandle).toBe('#f8fafc');
  });

  it('restores chart properties and runtime state when Cancel is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onChartTypeChange = vi.fn();
    const dispatchSpy = vi.spyOn(commandBus, 'dispatch');

    useChartSettingsStore.setState({
      globalProperties: { ...defaultChartProperties },
      symbolProperties: {
        XAUUSD: {
          ...defaultChartProperties,
          chartType: 'Candlesticks',
          chartShift: false,
          chartAutoScroll: true,
          showGrid: true,
        },
      },
    });

    render(
      <ChartPropertiesDialog
        isOpen
        onClose={onClose}
        symbol="XAUUSD"
        timeframe="M1"
        currentChartType="candlestick"
        targetContextId="trading-chart:chart-a"
        onChartTypeChange={onChartTypeChange}
      />,
    );

    await user.click(screen.getByText('Area chart'));
    await user.click(screen.getByLabelText('Chart shift'));
    await user.click(screen.getByText('Show'));
    await user.click(screen.getByLabelText('Show grid'));
    await user.click(screen.getByText('Cancel'));

    expect(useChartSettingsStore.getState().symbolProperties.XAUUSD).toMatchObject({
      chartType: 'Candlesticks',
      chartShift: false,
      chartAutoScroll: true,
      showGrid: true,
    });
    expect(onChartTypeChange).toHaveBeenLastCalledWith('candlestick');
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'SET_CHART_SHIFT',
      payload: { enabled: false, targetContextId: 'trading-chart:chart-a' },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
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
