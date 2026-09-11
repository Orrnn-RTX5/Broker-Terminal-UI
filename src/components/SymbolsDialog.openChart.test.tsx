// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SymbolsDialog } from './SymbolsDialog';

const brokerSymbol = 'XAUUSD.rtx';

describe('SymbolsDialog chart opening', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        instruments: [{
          id: 'gold-rtx',
          symbol: brokerSymbol,
          description: 'Gold against US Dollar',
          category: 'Commodities.Metals',
          digits: 2,
        }],
      }),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens the exact broker symbol from both row double-click and Open Chart', async () => {
    const onClose = vi.fn();
    const onOpenChart = vi.fn();

    render(
      <SymbolsDialog
        isOpen
        onClose={onClose}
        onOpenChart={onOpenChart}
      />,
    );

    const symbolLabels = await screen.findAllByText(brokerSymbol);
    const symbolRow = symbolLabels
      .map(label => label.closest('tr'))
      .find((row): row is HTMLTableRowElement => row !== null);

    expect(symbolRow).toBeDefined();
    fireEvent.doubleClick(symbolRow!);

    expect(onOpenChart).toHaveBeenLastCalledWith(brokerSymbol);
    expect(onClose).toHaveBeenCalledTimes(1);

    onOpenChart.mockClear();
    onClose.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Open Chart' }));

    expect(onOpenChart).toHaveBeenCalledWith(brokerSymbol);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses the authorized loaded catalog and original exact selection without a second network request', () => {
    const onOpenChart = vi.fn();
    const onClose = vi.fn();
    render(<SymbolsDialog isOpen onClose={onClose} onOpenChart={onOpenChart}
      title="Change chart symbol" chartActionLabel="Apply" initialSymbol="EURUSD.raw"
      instruments={[{ symbol: 'XAUUSD.rtx', description: 'Gold' }, { symbol: 'EURUSD.raw', description: 'Euro' }]} />);
    expect(screen.getByRole('dialog', { name: 'Change chart symbol' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onOpenChart).toHaveBeenCalledWith('EURUSD.raw');
    expect(onClose).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not consume Escape belonging to another local overlay', () => {
    const onClose = vi.fn();
    render(<><SymbolsDialog isOpen onClose={onClose} instruments={[{ symbol: brokerSymbol }]} />
      <div data-shortcut-scope="local"><input aria-label="Another editor" /></div></>);
    const other = screen.getByLabelText('Another editor'); other.focus();
    fireEvent.keyDown(other, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog'); dialog.focus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
