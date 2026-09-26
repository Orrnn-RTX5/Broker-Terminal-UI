import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadMarketWatchCsv } from './marketWatchExport';

describe('downloadMarketWatchCsv', () => {
  const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalCreateObjectUrl) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl);
    else Reflect.deleteProperty(URL, 'createObjectURL');
    if (originalRevokeObjectUrl) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl);
    else Reflect.deleteProperty(URL, 'revokeObjectURL');
    vi.useRealTimers();
  });

  it('downloads the supplied snapshot and revokes its object URL after the click', () => {
    const csv = 'Symbol,Bid\nEURUSD,1.10000';
    const fileName = 'market-watch-2026-09-26T16-30-00.csv';
    const createObjectURL = vi.fn().mockReturnValue('blob:market-watch-export');
    const revokeObjectURL = vi.fn();
    let clickedDownload = '';
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedDownload = this.download;
    });

    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });

    downloadMarketWatchCsv(csv, fileName);

    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(clickedDownload).toBe(fileName);
    expect(document.querySelector(`a[download="${fileName}"]`)).not.toBeInTheDocument();
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(blob.size).toBe(new Blob([csv]).size);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:market-watch-export');
  });

  it('removes the temporary anchor and revokes immediately when the click throws', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:failed-market-watch-export');
    const revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('download blocked');
    });
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });

    expect(() => downloadMarketWatchCsv('Symbol\nEURUSD', 'market-watch.csv')).toThrow('download blocked');
    expect(document.querySelector('a[download="market-watch.csv"]')).not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:failed-market-watch-export');
  });
});
