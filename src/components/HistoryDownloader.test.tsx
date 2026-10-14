import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadTask } from '../types/history';

const mocks = vi.hoisted(() => ({
  getAvailableSymbols: vi.fn(),
  getStorageStats: vi.fn(),
  getDownloadTasks: vi.fn(),
  downloadData: vi.fn(),
  pauseDownload: vi.fn(),
  resumeDownload: vi.fn(),
  cancelDownload: vi.fn(),
  clearSymbol: vi.fn(),
  clearAll: vi.fn(),
  showConfirm: vi.fn(),
}));

vi.mock('../services/historyDataManager', () => ({
  historyDataManager: {
    getAvailableSymbols: mocks.getAvailableSymbols,
    getStorageStats: mocks.getStorageStats,
    getDownloadTasks: mocks.getDownloadTasks,
    downloadData: mocks.downloadData,
    pauseDownload: mocks.pauseDownload,
    resumeDownload: mocks.resumeDownload,
    cancelDownload: mocks.cancelDownload,
    clearSymbol: mocks.clearSymbol,
    clearAll: mocks.clearAll,
  },
}));

vi.mock('../store/useConfirmStore', () => ({
  useConfirmStore: {
    getState: () => ({ showConfirm: mocks.showConfirm }),
  },
}));

import { HistoryDownloader } from './HistoryDownloader';

const symbols = [
  {
    symbol: 'EURUSD',
    availableDates: [],
    totalTicks: 1_250,
    firstDate: '2026-08-01',
    lastDate: '2026-08-03',
    downloadedDates: ['2026-08-01', '2026-08-02', '2026-08-03'],
    downloadProgress: 100,
  },
  {
    symbol: 'XAUUSD',
    availableDates: [],
    totalTicks: 0,
    firstDate: '',
    lastDate: '',
    downloadedDates: [],
    downloadProgress: 0,
  },
];

const storageStats = {
  totalSize: 2_048,
  tickCount: 1_250,
  symbolCount: 1,
  dateRanges: {
    EURUSD: { from: '2026-08-01', to: '2026-08-03' },
  },
  lastUpdate: new Date('2026-09-02T10:00:00.000Z').getTime(),
};

const renderLoadedDownloader = async () => {
  render(<HistoryDownloader />);
  const symbolSelect = screen.getByRole('combobox', { name: 'Select instrument' });
  await waitFor(() => expect(symbolSelect).toHaveValue('EURUSD'));
  return symbolSelect;
};

describe('HistoryDownloader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAvailableSymbols.mockResolvedValue(symbols);
    mocks.getStorageStats.mockResolvedValue(storageStats);
    mocks.getDownloadTasks.mockReturnValue([]);
    mocks.downloadData.mockResolvedValue('download-task-1');
    mocks.clearSymbol.mockResolvedValue(undefined);
    mocks.clearAll.mockResolvedValue(undefined);
    mocks.showConfirm.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses inclusive calendar days for presets and clears the selection for custom dates', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 13, 12));
    await renderLoadedDownloader();

    const presets = screen.getByRole('group', { name: 'Quick date range selection' });
    const fromDate = screen.getByLabelText('From date');
    const toDate = screen.getByLabelText('To date');

    expect(fromDate).toHaveValue('2026-10-07');
    expect(toDate).toHaveValue('2026-10-13');
    expect(within(presets).getByRole('button', { name: '7 Days' })).toHaveAttribute('aria-pressed', 'true');

    for (const [label, from] of [
      ['14 Days', '2026-09-30'],
      ['30 Days', '2026-09-14'],
      ['7 Days', '2026-10-07'],
    ]) {
      fireEvent.click(within(presets).getByRole('button', { name: label }));

      expect(fromDate).toHaveValue(from);
      expect(toDate).toHaveValue('2026-10-13');
      expect(within(presets).getByRole('button', { pressed: true })).toHaveTextContent(label);
      expect(screen.getByText(label, { selector: '.rtx-history-duration-badge' })).toBeInTheDocument();
    }

    fireEvent.change(fromDate, { target: { value: '2026-10-10' } });

    expect(within(presets).queryByRole('button', { pressed: true })).not.toBeInTheDocument();
    expect(screen.getByText('4 Days', { selector: '.rtx-history-duration-badge' })).toBeInTheDocument();
  });

  it('shows populated queue states and routes pause, resume, cancel, and dismiss actions', async () => {
    const taskBase = {
      dateRange: { from: '2026-08-01', to: '2026-08-03' },
      totalTicks: 1_000,
      startTime: 1_000,
    };
    const tasks: DownloadTask[] = [
      { ...taskBase, id: 'downloading', symbol: 'EURUSD', status: 'downloading', progress: 40, downloadedTicks: 400 },
      { ...taskBase, id: 'paused', symbol: 'XAUUSD', status: 'paused', progress: 25, downloadedTicks: 250 },
      { ...taskBase, id: 'completed', symbol: 'GBPUSD', status: 'completed', progress: 100, downloadedTicks: 1_000, endTime: 91_000 },
      { ...taskBase, id: 'failed', symbol: 'USDJPY', status: 'failed', progress: 10, downloadedTicks: 100, error: 'Connection interrupted' },
    ];
    mocks.getDownloadTasks.mockReturnValue(tasks);
    await renderLoadedDownloader();

    const queue = screen.getByRole('region', { name: 'Download queue' });
    expect(within(queue).getByText('2 active')).toBeInTheDocument();
    expect(within(queue).getByText('4 total')).toBeInTheDocument();
    expect(within(queue).getByRole('progressbar', { name: 'EURUSD Downloading' })).toHaveAttribute('aria-valuenow', '40');
    expect(within(queue).getByRole('progressbar', { name: 'XAUUSD Paused' })).toHaveAttribute('aria-valuenow', '25');
    expect(within(queue).getByRole('progressbar', { name: 'GBPUSD Completed' })).toHaveAttribute('aria-valuenow', '100');
    expect(within(queue).getByRole('progressbar', { name: 'USDJPY Failed' })).toHaveAttribute('aria-valuenow', '10');
    expect(within(queue).getByText('Completed in 1m 30s')).toBeInTheDocument();
    expect(within(queue).getByText('Connection interrupted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear cached data for EURUSD' })).toBeDisabled();
    expect(within(queue).getByRole('button', { name: 'Pause GBPUSD download' })).toBeDisabled();
    expect(within(queue).getByRole('button', { name: 'Pause USDJPY download' })).toBeDisabled();

    fireEvent.click(within(queue).getByRole('button', { name: 'Pause EURUSD download' }));
    fireEvent.click(within(queue).getByRole('button', { name: 'Resume XAUUSD download' }));
    fireEvent.click(within(queue).getByRole('button', { name: 'Cancel EURUSD download' }));
    fireEvent.click(within(queue).getByRole('button', { name: 'Dismiss GBPUSD download' }));
    fireEvent.click(within(queue).getByRole('button', { name: 'Dismiss USDJPY download' }));

    expect(mocks.pauseDownload).toHaveBeenCalledWith('downloading');
    expect(mocks.resumeDownload).toHaveBeenCalledWith('paused');
    expect(mocks.cancelDownload.mock.calls).toEqual([['downloading'], ['completed'], ['failed']]);
  });

  it('selects instruments from the symbol dropdown', async () => {
    const symbolSelect = await renderLoadedDownloader();

    expect(within(symbolSelect).getByText('EURUSD')).toBeInTheDocument();
    expect(within(symbolSelect).getByText('XAUUSD')).toBeInTheDocument();

    fireEvent.change(symbolSelect, {
      target: { value: 'XAUUSD' },
    });

    expect(symbolSelect).toHaveValue('XAUUSD');
  });

  it('shows reversed-date validation and disables downloading', async () => {
    await renderLoadedDownloader();
    const downloadButton = screen.getByRole('button', { name: 'Download history' });
    await waitFor(() => expect(downloadButton).toBeEnabled());

    fireEvent.change(screen.getByLabelText('From date'), {
      target: { value: '2026-09-02' },
    });
    fireEvent.change(screen.getByLabelText('To date'), {
      target: { value: '2026-09-01' },
    });

    expect(screen.getByText('The start date must be before the end date.')).toBeInTheDocument();
    expect(downloadButton).toBeDisabled();
    fireEvent.click(downloadButton);
    expect(mocks.downloadData).not.toHaveBeenCalled();
  });

  it('starts a download with the selected instrument and valid dates', async () => {
    await renderLoadedDownloader();

    fireEvent.change(screen.getByLabelText('From date'), {
      target: { value: '2026-08-01' },
    });
    fireEvent.change(screen.getByLabelText('To date'), {
      target: { value: '2026-08-03' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download history' }));

    await waitFor(() => {
      expect(mocks.downloadData).toHaveBeenCalledWith(
        'EURUSD',
        { from: '2026-08-01', to: '2026-08-03' },
        expect.any(Function),
      );
    });
  });

  it('uses the themed confirmation flow before clearing symbol history', async () => {
    await renderLoadedDownloader();
    const clearButton = screen.getByRole('button', { name: 'Clear cached data for EURUSD' });
    mocks.showConfirm.mockReset();
    mocks.showConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    fireEvent.click(clearButton);
    await waitFor(() => expect(mocks.showConfirm).toHaveBeenCalledTimes(1));
    expect(mocks.clearSymbol).not.toHaveBeenCalled();

    fireEvent.click(clearButton);
    await waitFor(() => expect(mocks.clearSymbol).toHaveBeenCalledWith('EURUSD'));
    expect(mocks.showConfirm).toHaveBeenNthCalledWith(
      2,
      'Clear symbol history',
      'Remove all locally cached historical data for EURUSD?',
    );
  });
});
