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
});
