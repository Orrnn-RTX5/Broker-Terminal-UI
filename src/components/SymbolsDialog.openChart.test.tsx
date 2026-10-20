// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SymbolsDialog } from './SymbolsDialog';
import { updateDynamicUrls } from '../config/api';

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
    vi.stubGlobal('__RTX_RUNTIME_CONFIG__', {
      CONFIG_SOURCE: 'deployment',
      API_HOST: 'https://broker.example',
      WS_HOST: 'wss://broker.example',
      BROKER_ID: 'test-broker',
      DEFAULT_MT5_SERVER: 'Test Broker-Live',
    });
    updateDynamicUrls();
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
    updateDynamicUrls();
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

  it('shows broker spec geometry only, never a 5-digit default (TERM-DIGITS-WL)', () => {
    const specValue = (label: string) => screen.getByText(label).closest('tr')?.querySelectorAll('td')[1]?.textContent;
    const view = render(<SymbolsDialog isOpen onClose={vi.fn()} initialSymbol="USDJPY" instruments={[{ symbol: 'USDJPY' }]} />);
    expect(specValue('Digits')).toBe('—');
    expect(specValue('Tick size')).toBe('—');
    expect(specValue('Contract size')).toBe('—');
    expect(specValue('Margin currency')).toBe('—');
    view.unmount();

    render(<SymbolsDialog isOpen onClose={vi.fn()} initialSymbol="IDX.CASH"
      instruments={[{ symbol: 'IDX.CASH', digits: 0, contract_size: 10 }]} />);
    expect(specValue('Digits')).toBe('0');
    expect(specValue('Tick size')).toBe('1');
    expect(specValue('Contract size')).toBe('10');
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

  it('centers and contains the web symbol browser at reference and compact viewport sizes', () => {
    setViewport(811, 505);
    render(<SymbolsDialog isOpen onClose={vi.fn()} instruments={[{ symbol: brokerSymbol }]} />);

    expect(screen.getByRole('dialog')).toHaveStyle({
      left: '16px', top: '16px', width: '779px', height: '473px',
    });
    expectDialogInsideViewport();

    setViewport(600, 400);
    fireEvent(window, new Event('resize'));
    expectDialogInsideViewport();
  });

  it('uses the enterprise presentation and keyboard-accessible tab semantics on web', async () => {
    render(<SymbolsDialog isOpen onClose={vi.fn()} instruments={[
      { symbol: brokerSymbol, category: 'Commodities.Metals' },
      { symbol: 'XAGUSD.raw', category: 'Commodities.Metals' },
    ]} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('data-presentation', 'enterprise');
    expect(screen.queryByRole('button', { name: 'Minimize' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Maximize' })).not.toBeInTheDocument();

    const specificationTab = screen.getByRole('tab', { name: 'Specification' });
    const barsTab = screen.getByRole('tab', { name: 'Bars' });
    expect(specificationTab).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(specificationTab, { key: 'ArrowRight' });
    expect(barsTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'rtx-symbols-tab-bars');
    expect(await screen.findByText(`No bars returned for ${brokerSymbol} M15.`)).toBeInTheDocument();
  });

  it('uses one keyboard tab stop per symbol collection and arrow-key row navigation', () => {
    render(<SymbolsDialog isOpen onClose={vi.fn()} instruments={[
      { symbol: brokerSymbol, category: 'Commodities.Metals' },
      { symbol: 'XAGUSD.raw', category: 'Commodities.Metals' },
    ]} />);

    const tree = screen.getByRole('group', { name: 'Instrument categories' });
    expect(within(tree).getAllByRole('button').filter(button => button.tabIndex === 0)).toHaveLength(1);
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();

    const catalog = screen.getByRole('table', { name: 'Available symbols' });
    const symbolRows = within(catalog).getAllByRole('row').slice(1);
    expect(symbolRows.filter(row => row.tabIndex === 0)).toHaveLength(1);

    fireEvent.keyDown(symbolRows[0], { key: 'ArrowDown' });
    expect(symbolRows[1]).toHaveFocus();
    expect(symbolRows[1]).toHaveAttribute('aria-selected', 'true');

    const categoryButton = within(tree).getByRole('button', { name: 'Commodities' });
    fireEvent.click(categoryButton);
    fireEvent.click(within(catalog).getAllByText(brokerSymbol)[0]);
    expect(within(tree).getAllByRole('button').filter(button => button.tabIndex === 0)).toEqual([categoryButton]);
  });

  it('keeps a mounted tree tab stop when the selected symbol is below a collapsed deep category', () => {
    render(<SymbolsDialog isOpen onClose={vi.fn()} instruments={[
      { symbol: brokerSymbol, category: 'Assets.Groups.Metals' },
    ]} />);

    const tree = screen.getByRole('group', { name: 'Instrument categories' });
    const tabStops = within(tree).getAllByRole('button').filter(button => button.tabIndex === 0);
    expect(tabStops).toHaveLength(1);
    expect(tabStops[0]).toHaveAccessibleName('Metals');
    expect(within(tree).queryByRole('button', { name: brokerSymbol })).not.toBeInTheDocument();
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

    view.rerender(<SymbolsDialog isOpen={false} {...props} />);
    setViewport(1000, 760);
    view.rerender(<SymbolsDialog isOpen {...props} />);
    expect(screen.getByRole('dialog')).toHaveStyle({
      left: '70px', top: '60px', width: '860px', height: '640px',
    });

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

  it('hides confirmed expired contracts until the user asks to show them', async () => {
    render(<SymbolsDialog isOpen onClose={vi.fn()} instruments={[
      { symbol: 'OLDUSD.rtx', description: 'Expired contract', expiration: '2000-01-01T00:00:00Z' },
      { symbol: brokerSymbol, description: 'Current contract', expiration: '2999-12-31T00:00:00Z' },
    ]} />);
    const catalog = within(screen.getByRole('table', { name: 'Available symbols' }));

    expect(catalog.getByText(brokerSymbol)).toBeInTheDocument();
    expect(catalog.queryByText('OLDUSD.rtx')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Bars' }));
    expect(screen.getByRole('combobox', { name: 'Bars symbol' })).toHaveValue(brokerSymbol);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    fireEvent.click(screen.getByRole('tab', { name: 'Specification' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show expired contracts' }));
    expect(within(screen.getByRole('table', { name: 'Available symbols' })).getByText('OLDUSD.rtx')).toBeInTheDocument();
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
