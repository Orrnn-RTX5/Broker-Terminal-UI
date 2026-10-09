import type { ComponentProps } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ToolboxTradePosition } from '../../../hooks/useToolboxTradeData';
import { TradeTable } from './TradeTable';
import { DEFAULT_TRADE_COLUMN_WIDTHS, TRADE_COLUMN_DEFS } from './tradeTabModel';

vi.mock('../../../hooks/useUiTranslation', () => ({
  useUiTranslation: () => (source: string, values?: Record<string, unknown>) => source.replace(
    /\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? ''),
  ),
}));
vi.mock('../../../components/ui/Icon', () => ({ Icon: () => null }));

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
