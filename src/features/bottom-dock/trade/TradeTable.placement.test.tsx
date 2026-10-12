import type { ComponentProps } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolboxTradePosition } from '../../../hooks/useToolboxTradeData';
import { TradeTable } from './TradeTable';
import { DEFAULT_TRADE_COLUMN_WIDTHS, TRADE_COLUMN_DEFS } from './tradeTabModel';

const translation = vi.hoisted(() => {
  const translate = (source: string, values?: Record<string, unknown>) => source.replace(
    /\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? ''),
  );
  return { translate, current: translate };
});
vi.mock('../../../hooks/useUiTranslation', () => ({
  useUiTranslation: () => translation.current,
}));
vi.mock('../../../components/ui/Icon', () => ({ Icon: () => null }));

beforeEach(() => { translation.current = translation.translate; });

const confirmedPosition = (ticket: number): ToolboxTradePosition => ({
  id: ticket, ticket, symbol: 'BTCUSD', side: 'BUY', volume: 0.01,
  price_open: 75000, openPrice: 75000, price_current: 75010,
  profit: 1, hasBackendProfit: true, hasBackendCurrentPrice: true,
  price_sl: 0, price_tp: 0, sl: 0, tp: 0,
  time_create: '2026-10-09T10:00:00Z',
} as ToolboxTradePosition);

const provisionalPosition = (placementState: ToolboxTradePosition['placementState']): ToolboxTradePosition => ({
  ...confirmedPosition(-1001),
  placementState, clientOrderId: 'order-one',
  profit: 0, hasBackendProfit: false, hasBackendCurrentPrice: false,
});

const createProps = (positions: ToolboxTradePosition[]): ComponentProps<typeof TradeTable> => ({
  account: null,
  columnWidths: DEFAULT_TRADE_COLUMN_WIDTHS,
  displayedLivePositions: positions,
  error: null,
  floatingProfitColor: 'text-profit',
  floatingProfitLabel: '8.00',
  footerCloseColumnWidth: '32px',
  footerMetricMenuOpen: false,
  footerProfitColumnWidth: '92px',
  formatMoney: value => Number(value ?? 0).toFixed(2),
  formatTradeLevel: value => Number(value) > 0 ? String(value) : '-',
  formatTradePoints: () => '10',
  formatTradePrice: value => String(value),
  formatTradeTime: value => String(value ?? '-'),
  formatTradeVolume: position => position.volume,
  getFooterMetricComment: () => '',
  getPositionKey: position => String(position.id),
  getTradePointsValue: () => null,
  handleTradeContextMenu: vi.fn(),
  isColumnVisible: () => true,
  liveEquity: null,
  loading: false,
  onClosePosition: vi.fn(),
  openModifyPosition: vi.fn(),
  profitMode: 'money',
  renderFooterMetricValue: () => null,
  resizingColumn: null,
  selectedPositionKey: null,
  setColumnWidths: vi.fn(),
  setSelectedPositionKey: vi.fn(),
  sortState: null,
  startColumnResize: vi.fn(),
  toggleFooterMetricMenu: vi.fn(),
  toggleSort: vi.fn(),
  totalLivePnL: 8,
  visibleFooterMetrics: [],
  visibleOptionalColumnCount: TRADE_COLUMN_DEFS.length,
  visibleTradeColumns: TRADE_COLUMN_DEFS,
  visibleTradeTableWidth: 1400,
});

describe('Trade placement status presentation', () => {
  it.each([
    ['pending', 'Pending'], ['accepted', 'Accepted'], ['processing', 'Processing'],
  ] as const)('shows %s distinctly without adding a second row or enabling trade actions', (state, label) => {
    const props = createProps([provisionalPosition(state)]);
    const view = render(<TradeTable {...props} />);
    const row = view.container.querySelector('tbody tr') as HTMLTableRowElement;

    expect(within(row).getByText(label)).toBeVisible();
    expect(row.title).toContain(`${label} · BTCUSD`);
    expect(view.container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(within(row).getAllByText('…')).toHaveLength(4);
    for (const button of within(row).getAllByRole('button')) expect(button).toBeDisabled();
    fireEvent.click(row);
    fireEvent.doubleClick(row);
    fireEvent.contextMenu(row);
    expect(props.setSelectedPositionKey).not.toHaveBeenCalled();
    expect(props.openModifyPosition).not.toHaveBeenCalled();
    expect(props.handleTradeContextMenu).not.toHaveBeenCalled();
    expect(props.onClosePosition).not.toHaveBeenCalled();
  });

  it.each([
    ['rejected', 'Rejected'], ['expired', 'Expired'],
  ] as const)('shows the %s reason visibly and removes misleading progress placeholders', (state, label) => {
    const position = {
      ...provisionalPosition(state),
      placementErrorCode: 'TOO_MANY_ORDERS',
      placementErrorMessage: 'Account order limit reached.',
    };
    const props = createProps([position]);
    const view = render(<TradeTable {...props} />);
    const tradeRow = view.container.querySelector('tbody tr') as HTMLTableRowElement;
    const reason = screen.getByRole('status');

    expect(within(tradeRow).getByText(label)).toBeVisible();
    expect(reason).toHaveTextContent(`${label} · BTCUSD · buy · 0.01 lots: TOO_MANY_ORDERS: Account order limit reached.`);
    expect(reason).toHaveAttribute('title', reason.textContent);
    expect(reason).toHaveClass('truncate', 'font-normal');
    expect(reason.style.getPropertyValue('--rtx-type-size')).toBe('13px');
    expect(reason.closest('tr')).toHaveClass('text-loss');
    expect(reason.closest('td')).toHaveClass('text-left');
    for (const cell of within(tradeRow).getAllByRole('cell')) {
      expect(cell).toHaveClass('text-center');
    }
    expect(within(tradeRow).queryByText('…')).not.toBeInTheDocument();
    expect(within(tradeRow).getByRole('button', { name: label })).toBeDisabled();
    for (const button of within(tradeRow).getAllByRole('button')) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(props.onClosePosition).not.toHaveBeenCalled();
    expect(props.openModifyPosition).not.toHaveBeenCalled();
  });

  it.each(['pending', 'rejected'] as const)('keeps %s status visible when Ticket and Comment columns are hidden', state => {
    const props = createProps([{ ...provisionalPosition(state), placementErrorMessage: 'Order limit reached.' }]);
    props.visibleTradeColumns = TRADE_COLUMN_DEFS.filter(column => column.key !== 'ticket' && column.key !== 'comment');
    props.visibleOptionalColumnCount = props.visibleTradeColumns.length;
    props.isColumnVisible = key => key !== 'ticket' && key !== 'comment';
    const view = render(<TradeTable {...props} />);
    const symbolCell = view.container.querySelector('tbody tr td')!;
    expect(symbolCell).toHaveTextContent(state === 'pending' ? 'BTCUSDPending' : 'BTCUSDRejected');
    if (state === 'rejected') {
      expect(screen.getByRole('status')).toHaveTextContent('Order limit reached.');
      expect(screen.getByRole('status').closest('td')).toHaveAttribute('colspan', String(props.visibleOptionalColumnCount + 2));
    }
  });

  it('keeps eight confirmed rows, their actions, and account totals unchanged beside a rejection', () => {
    const confirmed = Array.from({ length: 8 }, (_, index) => confirmedPosition(100 + index));
    const props = createProps([
      { ...provisionalPosition('rejected'), placementErrorMessage: 'Order limit reached.' }, ...confirmed,
    ]);
    const view = render(<TradeTable {...props} />);
    expect(view.container.querySelectorAll('tbody tr.rtx-trade-row')).toHaveLength(9);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(view.container.querySelector('.rtx-trade-footer-floating')).toHaveTextContent('8.00USD');
    for (const position of confirmed) {
      const close = screen.getByRole('button', { name: `Close position ${position.ticket}` });
      expect(close).toBeEnabled();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Close position 100' }));
    expect(props.onClosePosition).toHaveBeenCalledExactlyOnceWith(100);
  });
});

describe('Trade row updates', () => {
  it('updates quote values without reformatting or translating static cells', () => {
    const translate = vi.fn(translation.translate);
    translation.current = translate;
    const position = confirmedPosition(100);
    const props = createProps([position]);
    const formatTradeTime = vi.fn(props.formatTradeTime);
    const formatTradePrice = vi.fn(props.formatTradePrice);
    const formatTradeLevel = vi.fn(props.formatTradeLevel);
    Object.assign(props, { formatTradeTime, formatTradePrice, formatTradeLevel });
    const view = render(<TradeTable {...props} />);
    formatTradeTime.mockClear();
    formatTradePrice.mockClear();
    formatTradeLevel.mockClear();
    translate.mockClear();

    for (let update = 1; update <= 20; update += 1) {
      view.rerender(<TradeTable {...props} displayedLivePositions={[{
        ...position, price_current: 75010 + update, profit: update,
        time_update: `2026-10-09T10:00:${String(update).padStart(2, '0')}Z`,
      }]} />);
    }

    expect(screen.getByTitle('Current price: 75030')).toHaveTextContent('75030');
    expect(screen.getByTitle('Profit: 20.000')).toHaveTextContent('20.000');
    expect(screen.getByTitle('Last update: 2026-10-09T10:00:20Z')).toHaveTextContent('2026-10-09T10:00:20Z');
    expect(formatTradeTime).toHaveBeenCalledTimes(20);
    expect(formatTradeTime).not.toHaveBeenCalledWith(position.time_create);
    expect(formatTradePrice).toHaveBeenCalledTimes(20);
    expect(formatTradePrice).not.toHaveBeenCalledWith(position.price_open, position.symbol);
    expect(formatTradeLevel).not.toHaveBeenCalled();
    const staticSources = new Set([
      'Symbol: {{value0}}', 'Ticket: {{value0}}', 'Open time: {{value0}}',
      'Type: {{value0}}', 'Volume: {{value0}} lots', 'Open price: {{value0}}',
      'Stop Loss: {{value0}}', 'Take Profit: {{value0}}', 'Swap: {{value0}}',
      'Account login: {{value0}}', 'Comment: {{value0}}', 'Close position {{value0}}',
    ]);
    expect(translate.mock.calls.filter(([source]) => staticSources.has(source))).toEqual([]);
  });

  it('refreshes changed static details and sends the latest quoted position to row actions', () => {
    const props = createProps([confirmedPosition(100)]);
    const view = render(<TradeTable {...props} />);
    const updated: ToolboxTradePosition = {
      ...props.displayedLivePositions[0], symbol: 'ETHUSD', side: 'SELL', volume: 0.25,
      price_open: 3500, price_sl: 3600, price_tp: 3400, swap: 2, account_login: 200002,
      time_create: '2026-10-09T11:00:00Z', comment: 'Updated protection',
    };
    view.rerender(<TradeTable {...props} displayedLivePositions={[updated]} />);
    expect(screen.getByTitle('Symbol: ETHUSD')).toHaveTextContent('ETHUSD');
    expect(screen.getByTitle('Type: sell')).toHaveTextContent('sell');
    expect(screen.getByTitle('Volume: 0.25 lots')).toHaveTextContent('0.25');
    expect(screen.getByTitle('Open price: 3500')).toHaveTextContent('3500');
    expect(screen.getByTitle('Open time: 2026-10-09T11:00:00Z')).toHaveTextContent('2026-10-09T11:00:00Z');
    expect(view.container.querySelector('.rtx-trade-sl-value')).toHaveTextContent('3600');
    expect(view.container.querySelector('.rtx-trade-tp-value')).toHaveTextContent('3400');
    expect(screen.getByTitle('Swap: 2.00')).toHaveTextContent('2.00');
    expect(screen.getByTitle('Account login: 200002')).toHaveTextContent('200002');
    expect(screen.getByTitle('Comment: Updated protection')).toHaveTextContent('Updated protection');

    const latest = { ...updated, price_current: 3490, profit: 25 };
    view.rerender(<TradeTable {...props} displayedLivePositions={[latest]} />);
    const row = view.container.querySelector('tbody tr')!;
    fireEvent.doubleClick(row);
    expect(props.openModifyPosition).toHaveBeenLastCalledWith(latest);
    fireEvent.click(view.container.querySelector('.rtx-trade-sl-value')!);
    expect(props.openModifyPosition).toHaveBeenLastCalledWith(latest);
    fireEvent.contextMenu(row);
    expect(props.handleTradeContextMenu).toHaveBeenLastCalledWith(expect.anything(), latest);
  });

  it('updates cached placement labels and failure details through an order lifecycle', () => {
    const pending = provisionalPosition('pending');
    const props = createProps([pending]);
    const view = render(<TradeTable {...props} />);
    view.rerender(<TradeTable {...props} displayedLivePositions={[{ ...pending, placementState: 'accepted' }]} />);
    expect(screen.getByRole('button', { name: 'Accepted' })).toBeDisabled();
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
    view.rerender(<TradeTable {...props} displayedLivePositions={[{
      ...pending, placementState: 'rejected', placementErrorMessage: 'Volume limit',
    }]} />);
    expect(screen.getByRole('button', { name: 'Rejected' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Volume limit');
    view.rerender(<TradeTable {...props} displayedLivePositions={[confirmedPosition(100)]} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close position 100' })).toBeEnabled();
  });

  it('updates account publications and totals without repeating row formatting', () => {
    const props = createProps([confirmedPosition(100), confirmedPosition(101)]);
    const formatTradeTime = vi.fn(props.formatTradeTime);
    props.formatTradeTime = formatTradeTime;
    const view = render(<TradeTable {...props} />);
    expect(formatTradeTime).toHaveBeenCalledTimes(4);
    formatTradeTime.mockClear();

    view.rerender(<TradeTable
      {...props}
      account={{ currency: 'EUR', publicationToken: 'publication-two' } as NonNullable<typeof props.account>}
      floatingProfitLabel="12.00"
      totalLivePnL={12}
      liveEquity={1012}
    />);

    expect(formatTradeTime).not.toHaveBeenCalled();
    expect(view.container.querySelector('.rtx-trade-footer')).toHaveAttribute('data-metrics-publication-token', 'publication-two');
    expect(view.container.querySelector('.rtx-trade-footer-floating')).toHaveTextContent('12.00EUR');
    expect(screen.getByRole('button', { name: 'Close position 100' })).toBeEnabled();
  });

  it('refreshes changed positions, selection, column visibility and profit mode', () => {
    const position = confirmedPosition(100);
    const props = createProps([position]);
    const view = render(<TradeTable {...props} />);
    view.rerender(<TradeTable {...props} displayedLivePositions={[{ ...position, price_current: 75042, profit: 5 }]} />);
    expect(screen.getByTitle('Current price: 75042')).toHaveTextContent('75042');
    expect(screen.getByTitle('Profit: 5.0000')).toHaveTextContent('5.0000');

    view.rerender(<TradeTable {...props} selectedPositionKey="100" />);
    expect(view.container.querySelector('tbody tr')).toHaveAttribute('aria-selected', 'true');

    view.rerender(<TradeTable {...props} isColumnVisible={key => key !== 'swap'} />);
    expect(screen.queryByTitle('Swap: 0.00')).not.toBeInTheDocument();

    view.rerender(<TradeTable {...props} profitMode="points" />);
    expect(screen.getByTitle('Profit Points: 10')).toHaveTextContent('10');
  });

  it('refreshes translated row labels when the language changes', () => {
    const props = createProps([confirmedPosition(100)]);
    const view = render(<TradeTable {...props} />);
    translation.current = (source, values) => `translated: ${translation.translate(source, values)}`;
    view.rerender(<TradeTable {...props} />);

    expect(screen.getByRole('button', { name: 'translated: Close position 100' })).toBeEnabled();
    expect(view.container.querySelector('tbody tr')?.getAttribute('title')).toContain('translated: Modify Position');
    expect(screen.getByTitle('translated: Current price: 75010')).toHaveTextContent('75010');
  });

  it('uses current trade actions and formatters after they change', () => {
    const position = confirmedPosition(100);
    const props = createProps([position]);
    const view = render(<TradeTable {...props} />);
    const current = {
      onClosePosition: vi.fn(),
      openModifyPosition: vi.fn(),
      handleTradeContextMenu: vi.fn(),
      setSelectedPositionKey: vi.fn(),
      formatTradePrice: (value: unknown) => `${value} updated`,
    };
    view.rerender(<TradeTable {...props} {...current} />);
    const row = view.container.querySelector('tbody tr')!;

    expect(screen.getByTitle('Current price: 75010 updated')).toHaveTextContent('75010 updated');
    fireEvent.click(screen.getByRole('button', { name: 'Close position 100' }));
    fireEvent.doubleClick(row);
    fireEvent.contextMenu(row);
    expect(current.onClosePosition).toHaveBeenCalledExactlyOnceWith(100);
    expect(current.openModifyPosition).toHaveBeenCalledExactlyOnceWith(position);
    expect(current.setSelectedPositionKey).toHaveBeenCalledWith('100');
    expect(current.handleTradeContextMenu).toHaveBeenCalledWith(expect.anything(), position);
    expect(props.onClosePosition).not.toHaveBeenCalled();
    expect(props.openModifyPosition).not.toHaveBeenCalled();
    expect(props.handleTradeContextMenu).not.toHaveBeenCalled();
    expect(props.setSelectedPositionKey).not.toHaveBeenCalled();
  });
});
