import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
