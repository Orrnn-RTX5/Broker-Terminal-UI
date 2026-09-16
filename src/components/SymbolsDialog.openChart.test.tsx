// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SymbolsDialog } from './SymbolsDialog';

const brokerSymbol = 'XAUUSD.rtx';

const setViewport = (width: number, height: number) => {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
};

const expectDialogInsideViewport = () => {
  const dialog = screen.getByRole('dialog');
  // jsdom does not calculate layout, so include CSS minimums when checking
  // the effective bounds supplied by the component's window geometry.
  const width = Math.max(parseFloat(dialog.style.width), parseFloat(dialog.style.minWidth));
  const height = Math.max(parseFloat(dialog.style.height), parseFloat(dialog.style.minHeight));
  const left = parseFloat(dialog.style.left);
  const top = parseFloat(dialog.style.top);

  expect(width).toBeGreaterThan(0);
  expect(height).toBeGreaterThan(0);
  expect(left).toBeGreaterThanOrEqual(16);
  expect(top).toBeGreaterThanOrEqual(16);
  expect(left + width).toBeLessThanOrEqual(window.innerWidth - 16);
  expect(top + height).toBeLessThanOrEqual(window.innerHeight - 16);
};

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

  it('centers the larger desktop symbol browser with room for its catalog and actions', () => {
    vi.stubGlobal('electron', { window: {} });
    setViewport(1000, 760);

    render(<SymbolsDialog isOpen onClose={vi.fn()} instruments={[{ symbol: brokerSymbol }]} />);

    expect(screen.getByRole('dialog')).toHaveStyle({
      left: '70px', top: '60px', width: '860px', height: '640px',
    });
    expectDialogInsideViewport();
  });

  it('keeps desktop window bounds visible on small screens, reopening, resizing and dragging', () => {
    vi.stubGlobal('electron', { window: {} });
    setViewport(600, 460);
    const props = { onClose: vi.fn(), instruments: [{ symbol: brokerSymbol }] };
    const view = render(<SymbolsDialog isOpen {...props} />);
    expectDialogInsideViewport();

    view.rerender(<SymbolsDialog isOpen={false} {...props} />);
    setViewport(540, 400);
    view.rerender(<SymbolsDialog isOpen {...props} />);
    expectDialogInsideViewport();

    setViewport(480, 360);
    fireEvent(window, new Event('resize'));
    expectDialogInsideViewport();

    setViewport(1000, 760);
    fireEvent(window, new Event('resize'));
    const titlebar = screen.getByText('Symbols').closest('.rtx-symbols-dialog__titlebar')!;
    fireEvent.mouseDown(titlebar, { clientX: 30, clientY: 30 });
    fireEvent.mouseMove(window, { clientX: 2000, clientY: 2000 });
    fireEvent.mouseUp(window);
    expectDialogInsideViewport();

    fireEvent.mouseDown(titlebar, { clientX: 30, clientY: 30 });
    fireEvent.mouseMove(window, { clientX: -2000, clientY: -2000 });
    fireEvent.mouseUp(window);
    expectDialogInsideViewport();
  });

  it('filters desktop symbols, clears the search and opens the exact selected broker symbol', () => {
    vi.stubGlobal('electron', { window: {} });
    const onOpenChart = vi.fn();
    const onClose = vi.fn();
    render(<SymbolsDialog isOpen onClose={onClose} onOpenChart={onOpenChart} instruments={[
      { symbol: brokerSymbol, description: 'Gold against US Dollar' },
      { symbol: 'XAGUSD.raw', description: 'Silver against US Dollar' },
    ]} />);
    const catalog = within(screen.getByRole('table', { name: 'Available symbols' }));
    const search = screen.getByRole('textbox', { name: 'Search symbols' });

    fireEvent.change(search, { target: { value: 'silver' } });
    expect(catalog.queryByText(brokerSymbol)).not.toBeInTheDocument();
    fireEvent.click(catalog.getByText('XAGUSD.raw'));

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(search).toHaveValue('');
    expect(catalog.getByText(brokerSymbol)).toBeInTheDocument();
    expect(catalog.getByText('XAGUSD.raw')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Chart' }));
    expect(onOpenChart).toHaveBeenCalledWith('XAGUSD.raw');
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
