import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadMarketWatchCsv, type MarketWatchExportResult } from '../../utils/marketWatchExport';
import { MarketWatchExportSheet } from './MarketWatchExportSheet';

vi.mock('../../utils/marketWatchExport', () => ({
  downloadMarketWatchCsv: vi.fn(),
}));

const result: MarketWatchExportResult = {
  destination: 'clipboard',
  symbolCount: 4,
  columnCount: 3,
  fileName: 'market-watch-2026-09-26T10-25-00.csv',
  csv: 'Symbol,Bid,Ask\nEURUSD,1.10001,1.10003\nBTCUSD,83250.00,83260.00',
};

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
const close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });

describe('MarketWatchExportSheet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(downloadMarketWatchCsv).mockReset();
    showModal.mockClear();
    close.mockClear();
    // JSDOM does not implement native modal opening or focus containment.
    // Reflect the open state so accessible-role queries match an open dialog.
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: close });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  });

  it('keeps a labelled clipboard receipt open until acknowledged', () => {
    const onDismiss = vi.fn();
    const { container } = render(<MarketWatchExportSheet result={result} onDismiss={onDismiss} />);
    const dialog = screen.getByRole('dialog', { name: 'Copied to clipboard' });

    expect(showModal).toHaveBeenCalledOnce();
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Your Market Watch data is ready to use.');
    expect(dialog.parentElement).toBe(document.body);
    expect(container).toBeEmptyDOMElement();
    expect(within(dialog).getByRole('region', { name: 'Destination' })).toHaveTextContent('System clipboard');
    expect(dialog).toHaveTextContent('No file was saved to your device.');
    expect(dialog).toHaveTextContent('Open Excel or another app, then paste your data.');

    act(() => { vi.advanceTimersByTime(300_000); });

    expect(dialog).toHaveAttribute('open');
    expect(onDismiss).not.toHaveBeenCalled();
    expect(downloadMarketWatchCsv).not.toHaveBeenCalled();
  });

  it('focuses Done on opening and restores the previous control on unmount', () => {
    render(<button type="button">Export Market Watch</button>);
    const trigger = screen.getByRole('button', { name: 'Export Market Watch' });
    trigger.focus();
    const { unmount } = render(<MarketWatchExportSheet result={result} onDismiss={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();

    unmount();

    expect(close).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
  });

  it.each(['Done', 'Dismiss'])('acknowledges the receipt with %s', (name) => {
    const onDismiss = vi.fn();
    render(<MarketWatchExportSheet result={result} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name }));

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(downloadMarketWatchCsv).not.toHaveBeenCalled();
  });

  it('dismisses with Escape without forwarding it to terminal shortcuts', () => {
    const onDismiss = vi.fn();
    const terminalShortcut = vi.fn();
    render(<MarketWatchExportSheet result={result} onDismiss={onDismiss} />);
    window.addEventListener('keydown', terminalShortcut);

    try {
      const unhandled = fireEvent.keyDown(screen.getByRole('button', { name: 'Done' }), { key: 'Escape' });

      expect(unhandled).toBe(false);
      expect(onDismiss).toHaveBeenCalledOnce();
      expect(terminalShortcut).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', terminalShortcut);
    }
  });

  it('routes native dialog cancellation through the dismissal callback', () => {
    const onDismiss = vi.fn();
    render(<MarketWatchExportSheet result={result} onDismiss={onDismiss} />);
    const cancel = new Event('cancel', { cancelable: true });

    fireEvent(screen.getByRole('dialog'), cancel);

    expect(cancel.defaultPrevented).toBe(true);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('downloads the captured CSV and identifies the browser destination and filename', () => {
    const onDismiss = vi.fn();
    render(<MarketWatchExportSheet result={result} onDismiss={onDismiss} />);
    expect(screen.getByText('TSV')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));

    expect(downloadMarketWatchCsv).toHaveBeenCalledExactlyOnceWith(result.csv, result.fileName);
    const dialog = screen.getByRole('dialog', { name: 'CSV download started' });
    expect(dialog).toHaveAttribute('data-outcome', 'success');
    expect(within(dialog).getByRole('region', { name: 'Destination' })).toHaveTextContent('Browser downloads');
    expect(screen.getByText(result.fileName)).toBeInTheDocument();
    expect(screen.getByText('CSV')).toBeInTheDocument();
    expect(screen.queryByText('No file was saved to your device.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download again' })).toBeInTheDocument();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('retains the clipboard destination on a download failure and clears the error after retry', () => {
    vi.mocked(downloadMarketWatchCsv).mockImplementationOnce(() => { throw new Error('Download unavailable'); });
    const onDismiss = vi.fn();
    render(<MarketWatchExportSheet result={result} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));

    expect(screen.getByRole('alert')).toHaveTextContent('The download could not be started. Please try again.');
    expect(screen.getByRole('dialog', { name: 'Copied to clipboard' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Destination' })).toHaveTextContent('System clipboard');
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));

    expect(downloadMarketWatchCsv).toHaveBeenNthCalledWith(2, result.csv, result.fileName);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'CSV download started' })).toBeInTheDocument();
  });

  it('recovers a failed initial export with a successful CSV download', () => {
    render(<MarketWatchExportSheet result={{ ...result, destination: 'failed' }} onDismiss={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Export needs attention' });

    expect(dialog).toHaveAttribute('data-outcome', 'error');
    expect(dialog).toHaveAccessibleDescription('Clipboard and download were unavailable. Try downloading a CSV copy.');
    expect(screen.queryByRole('region', { name: 'Destination' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));

    expect(downloadMarketWatchCsv).toHaveBeenCalledExactlyOnceWith(result.csv, result.fileName);
    expect(screen.getByRole('dialog', { name: 'CSV download started' })).toHaveAttribute('data-outcome', 'success');
    expect(screen.getByRole('region', { name: 'Destination' })).toHaveTextContent('Browser downloads');
  });
});
