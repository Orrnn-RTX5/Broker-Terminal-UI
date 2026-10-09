import {
  Fragment,
  type CSSProperties,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { ClosePositionAction } from '../../../contracts/tradeActions';
import type { ToolboxTradePosition } from '../../../hooks/useToolboxTradeData';
import { useUiTranslation } from '../../../hooks/useUiTranslation';
import type { Account } from '../../../store/useAppStore';
import {
  formatPositionProfit,
  resolveTradeProfit,
  toBackendFinancialNumber,
} from '../../../components/BottomDock.trade';
import { Icon } from '../../../components/ui/Icon';
import { TradeMetricValue, UnavailableTradeMetric } from './TradeMetricValue';
import {
  getTradeColumnDef,
  METRIC_UNAVAILABLE,
  TRADE_COLUMN_HOVER_COMMENTS,
  type TradeColumnDef,
  type TradeColumnKey,
  type TradeColumnWidthKey,
  type TradeColumnWidths,
  type TradeFooterMetricDef,
  type TradeFooterMetricKey,
  type TradeProfitMode,
  type TradeSortColumn,
  type TradeSortState,
} from './tradeTabModel';

type TradeTableProps = {
  account: Account | null;
  columnWidths: TradeColumnWidths;
  displayedLivePositions: ToolboxTradePosition[];
  error: string | null;
  floatingProfitColor: string;
  floatingProfitLabel: string;
  footerCloseColumnWidth: string;
  footerMetricMenuOpen: boolean;
  footerProfitColumnWidth: string;
  formatMoney: (value: number | null | undefined) => string;
  formatTradeLevel: (value: unknown, symbol: string) => string;
  formatTradePoints: (position: ToolboxTradePosition) => string;
  formatTradePrice: (value: unknown, symbol: string) => string;
  formatTradeTime: (value?: number | string | null) => string;
  formatTradeVolume: (position: ToolboxTradePosition) => number | string;
  getFooterMetricComment: (key: TradeFooterMetricKey) => string;
  getPositionKey: (position: ToolboxTradePosition) => string;
  getTradePointsValue: (position: ToolboxTradePosition) => number | null;
  handleTradeContextMenu: (
    event: ReactMouseEvent<HTMLTableRowElement>,
    position: ToolboxTradePosition,
  ) => void;
  isColumnVisible: (key: TradeColumnKey) => boolean;
  liveEquity: number | null;
  loading: boolean;
  onClosePosition: ClosePositionAction;
  openModifyPosition: (position: ToolboxTradePosition) => void;
  profitMode: TradeProfitMode;
  renderFooterMetricValue: (key: TradeFooterMetricKey) => ReactNode;
  resizingColumn: TradeColumnWidthKey | null;
  selectedPositionKey: string | null;
  setColumnWidths: Dispatch<SetStateAction<TradeColumnWidths>>;
  setSelectedPositionKey: Dispatch<SetStateAction<string | null>>;
  sortState: TradeSortState;
  startColumnResize: (event: ReactMouseEvent, key: TradeColumnWidthKey) => void;
  toggleFooterMetricMenu: (trigger: HTMLButtonElement) => void;
  toggleSort: (column: TradeSortColumn) => void;
  totalLivePnL: number | null;
  visibleFooterMetrics: TradeFooterMetricDef[];
  visibleOptionalColumnCount: number;
  visibleTradeColumns: TradeColumnDef[];
  visibleTradeTableWidth: number;
};

export function TradeTable({
  account,
  columnWidths,
  displayedLivePositions,
  error,
  floatingProfitColor,
  floatingProfitLabel,
  footerCloseColumnWidth,
  footerMetricMenuOpen,
  footerProfitColumnWidth,
  formatMoney,
  formatTradeLevel,
  formatTradePoints,
  formatTradePrice,
  formatTradeTime,
  formatTradeVolume,
  getFooterMetricComment,
  getPositionKey,
  getTradePointsValue,
  handleTradeContextMenu,
  isColumnVisible,
  liveEquity,
  loading,
  onClosePosition,
  openModifyPosition,
  profitMode,
  renderFooterMetricValue,
  resizingColumn,
  selectedPositionKey,
  setColumnWidths,
  setSelectedPositionKey,
  sortState,
  startColumnResize,
  toggleFooterMetricMenu,
  toggleSort,
  totalLivePnL,
  visibleFooterMetrics,
  visibleOptionalColumnCount,
  visibleTradeColumns,
  visibleTradeTableWidth,
}: TradeTableProps) {
  const tr = useUiTranslation();

  const renderColumnResizeHandle = (key: TradeColumnWidthKey) => (
    <button
      type="button"
      aria-label={tr('Resize {{value0}} column', { value0: tr(getTradeColumnDef(key).label) })}
      title={tr('Resize {{value0}} column', { value0: tr(getTradeColumnDef(key).label) })}
      tabIndex={-1}
      className={`absolute right-0 top-0 z-20 h-full w-[5px] translate-x-1/2 cursor-default border-0 bg-transparent p-0 ${resizingColumn === key ? 'bg-sky-400/70' : 'hover:bg-sky-400/50'}`}
      onMouseDown={(event) => startColumnResize(event, key)}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setColumnWidths(previous => ({
          ...previous,
          [key]: getTradeColumnDef(key).defaultWidth,
        }));
      }}
    />
  );

  const renderSortableHeader = (
    key: TradeColumnWidthKey,
    label: string,
    sortColumn: TradeSortColumn,
  ) => (
    <th
      key={key}
      className="relative px-1.5 py-[3px] text-center border-r border-zinc-700/70"
      style={{ width: columnWidths[key] }}
      title={tr(TRADE_COLUMN_HOVER_COMMENTS[key])}
      aria-sort={sortState?.column === sortColumn ? (sortState.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        title={tr('Sort by {{value0}}', { value0: tr(label) })}
        onClick={() => toggleSort(sortColumn)}
        className="relative flex w-full cursor-default items-center justify-center px-2 text-center hover:text-white"
      >
        <span>{tr(label)}</span>
        <span className="absolute right-0 inline-block w-[8px] text-center text-zinc-500">
          {sortState?.column === sortColumn ? (sortState.direction === 'asc' ? '^' : 'v') : ''}
        </span>
      </button>
      {renderColumnResizeHandle(key)}
    </th>
  );

  const renderHeader = (column: TradeColumnDef) => (
    <th
      key={column.key}
      className="relative px-1.5 py-[3px] text-center border-r border-zinc-700/70"
      style={{ width: columnWidths[column.key] }}
      title={tr(TRADE_COLUMN_HOVER_COMMENTS[column.key])}
    >
      <span className="block px-2">{tr(column.label)}</span>
      {renderColumnResizeHandle(column.key)}
    </th>
  );

  return (
    <div className="rtx-trade-scroll flex-1 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700">
      <table
        className="rtx-trade-table w-full text-center border-collapse table-fixed"
        style={{ minWidth: visibleTradeTableWidth, fontFamily: '"Segoe UI", Tahoma, Arial, sans-serif', fontVariantNumeric: 'tabular-nums' }}
      >
        <colgroup>
          <col style={{ width: columnWidths.symbol }} />
          {visibleTradeColumns.map(column => (
            <col key={column.key} style={{ width: columnWidths[column.key] }} />
          ))}
          <col style={{ width: columnWidths.close }} />
        </colgroup>
        <thead className="rtx-trade-table__head sticky top-0 bg-[#17181c] text-[#c9cfdb] z-10 font-normal text-[12px] leading-[18px] uppercase border-y border-zinc-700/70 select-none shadow-[0_1px_0_0_rgba(255,255,255,0.04)]">
          <tr className="h-[30px]">
            {renderSortableHeader('symbol', 'Symbol', 'symbol')}
            {visibleTradeColumns.map(column => {
              if (column.key === 'ticket') return renderSortableHeader('ticket', column.label, 'ticket');
              if (column.key === 'time') return renderSortableHeader('time', column.label, 'time_create');
              if (column.key === 'profit') return renderSortableHeader('profit', column.label, 'profit');
              return renderHeader(column);
            })}
            <th
              className="px-0.5 py-[3px] text-center"
              style={{ width: columnWidths.close }}
              aria-label={tr('Close position')}
              title={tr(TRADE_COLUMN_HOVER_COMMENTS.close)}
            />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/90 text-[#d8dde8] text-[13px] leading-[19.5px] font-normal">
          {displayedLivePositions.length === 0 && (loading || error) && (
            <tr>
              <td colSpan={visibleOptionalColumnCount + 2} className="h-16 text-center text-zinc-600 text-xs italic">
                {loading ? tr('Loading open positions...') : error}
              </td>
            </tr>
          )}
          {displayedLivePositions.map((position, index) => {
            const placementState = position.placementState;
            const isPendingPlacement = Boolean(
              placementState && !['filled', 'confirmed'].includes(placementState),
            );
            const isTerminalPlacementFailure = placementState === 'rejected' || placementState === 'expired';
            const placementLabel = placementState === 'accepted' ? tr('Accepted')
              : placementState === 'processing' ? tr('Processing')
                : placementState === 'rejected' ? tr('Rejected')
                  : placementState === 'expired' ? tr('Expired')
                    : tr('Pending');
            const placementPlaceholder = isTerminalPlacementFailure ? '-' : '…';
            const profitValue = resolveTradeProfit(position).value;
            const pointsValue = getTradePointsValue(position);
            const profitIsPositive = profitMode === 'points'
              ? pointsValue !== null && pointsValue >= 0
              : profitValue !== null && profitValue >= 0;
            const profitIsAvailable = profitMode === 'points'
              ? pointsValue !== null
              : profitValue !== null;
            const positionKey = getPositionKey(position);
            const isSelected = selectedPositionKey === positionKey;
            const symbolLabel = position.symbol ?? '-';
            const ticketLabel = isPendingPlacement ? placementLabel : String(position.ticket ?? position.id ?? '-');
            const openTime = position.time_create
              ?? position.openTime
              ?? position.open_time
              ?? position.time_open
              ?? position.time
              ?? position.chartEntryTime;
            const timeLabel = formatTradeTime(openTime);
            const sideLabel = String(position.side ?? '').toLowerCase() || '-';
            const volumeLabel = String(formatTradeVolume(position));
            const rawOpenPrice = Number(
              position.price_open
              ?? position.open_price
              ?? position.openPrice
              ?? position.entryPrice
              ?? position.chartEntryPrice
              ?? position.price,
            );
            const openPriceLabel = isPendingPlacement
              ? placementPlaceholder
              : formatTradePrice(rawOpenPrice, symbolLabel);
            const stopLossLabel = formatTradeLevel(position.price_sl ?? position.sl, symbolLabel);
            const takeProfitLabel = formatTradeLevel(position.price_tp ?? position.tp, symbolLabel);
            const rawCurrentPrice = position.hasBackendCurrentPrice === false
              ? null
              : toBackendFinancialNumber(position.price_current ?? position.current_price ?? position.currentPrice);
            const currentPriceLabel = isPendingPlacement
              ? placementPlaceholder
              : rawCurrentPrice === null
                ? METRIC_UNAVAILABLE
                : formatTradePrice(rawCurrentPrice, symbolLabel);
            const swapLabel = formatMoney(position.swap);
            const accountLoginLabel = String(position.account_login ?? '-');
            const timeUpdateLabel = formatTradeTime(position.time_update);
            const placementError = [position.placementErrorCode, position.placementErrorMessage]
              .filter(Boolean)
              .join(': ');
            const commentLabel = String(placementError || position.comment || '-');
            const profitLabel = isPendingPlacement
              ? placementPlaceholder
              : profitMode === 'points'
                ? formatTradePoints(position)
                : profitValue === null || Number.isNaN(profitValue)
                  ? METRIC_UNAVAILABLE
                  : formatPositionProfit(profitValue);
            const rowSummary = [
              symbolLabel,
              tr(sideLabel),
              tr('{{value0}} lots', { value0: volumeLabel }),
            ].join(' · ');
            const placementSummary = `${placementLabel} · ${rowSummary}${isTerminalPlacementFailure ? `: ${placementError || tr('Order failed')}` : ''}`;
            const rowComment = isPendingPlacement
              ? placementSummary
              : `${rowSummary}\n${tr('Ticket: {{value0}}', { value0: ticketLabel })}\n${tr('Modify Position')} · ${tr('Context menu')}`;

            return (
              <Fragment key={position.id ?? index}>
              <tr
                title={rowComment}
                data-placement-state={isPendingPlacement ? placementState : undefined}
                aria-selected={isSelected}
                className={`rtx-trade-row h-[30px] ${isSelected ? 'rtx-trade-row--selected' : ''} transition-colors group cursor-default`}
                onClick={() => {
                  if (!isPendingPlacement) setSelectedPositionKey(positionKey);
                }}
                onDoubleClick={() => {
                  if (isPendingPlacement) return;
                  setSelectedPositionKey(positionKey);
                  openModifyPosition(position);
                }}
                onContextMenu={(event) => {
                  if (isPendingPlacement) return;
                  handleTradeContextMenu(event, position);
                }}
              >
                {/* symbol */}
                <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center font-normal text-zinc-100 whitespace-nowrap" title={tr('Symbol: {{value0}}', { value0: symbolLabel })}>
                  {isPendingPlacement && !isColumnVisible('ticket') ? (
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{symbolLabel}</span>
                      <span className={`truncate ${isTerminalPlacementFailure ? 'text-loss' : 'text-zinc-400'}`}>{placementLabel}</span>
                    </span>
                  ) : <span>{symbolLabel}</span>}
                </td>

                {/* ticket */}
                {isColumnVisible('ticket') && (
                  <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-zinc-100 font-normal tabular-nums truncate" title={isPendingPlacement ? placementSummary : tr('Ticket: {{value0}}', { value0: ticketLabel })}>{ticketLabel}</td>
                )}

                {/* time_create */}
                {isColumnVisible('time') && (
                  <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-zinc-100 whitespace-nowrap" title={tr('Open time: {{value0}}', { value0: timeLabel })}>
                    {timeLabel}
                  </td>
                )}

                {/* side */}
                {isColumnVisible('side') && (
                  <td className="rtx-trade-side-cell px-1.5 py-[2px] border-r border-zinc-800 text-center font-normal text-[13px] text-zinc-100" title={tr('Type: {{value0}}', { value0: tr(sideLabel) })}>
                    <div className="flex items-center justify-center">
                      <span>{tr(sideLabel)}</span>
                    </div>
                  </td>
                )}

                {/* volume */}
                {isColumnVisible('volume') && (
                  <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center font-normal text-zinc-100 tabular-nums" title={tr('Volume: {{value0}} lots', { value0: volumeLabel })}>
                    {volumeLabel}
                  </td>
                )}

                {/* price_open */}
                {isColumnVisible('priceOpen') && (
                  <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-zinc-100 tabular-nums" title={tr('Open price: {{value0}}', { value0: openPriceLabel })}>
                    {openPriceLabel}
                  </td>
                )}

                {/* price_sl */}
                {isColumnVisible('sl') && (
                  <td
                    className="rtx-trade-sl-cell px-0 py-[2px] border-r border-zinc-800 text-center tabular-nums"
                    title={`${tr('Stop Loss: {{value0}}', { value0: stopLossLabel })} · ${tr('Modify Position')}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (isPendingPlacement) return;
                      setSelectedPositionKey(positionKey);
                      if (event.detail === 0) openModifyPosition(position);
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      if (isPendingPlacement) return;
                      setSelectedPositionKey(positionKey);
                      openModifyPosition(position);
                    }}
                  >
                    <button
                      type="button"
                      className={`rtx-trade-sl-value w-full cursor-pointer bg-transparent px-1 text-center font-normal ${(position.price_sl ?? position.sl) > 0 ? 'text-[#ff7676]' : 'text-zinc-100'}`}
                      disabled={isPendingPlacement}
                      aria-label={`${tr('Modify Position')} · ${tr('Stop Loss:')} #${position.id}`}
                    >
                      {stopLossLabel}
                    </button>
                  </td>
                )}

                {/* price_tp */}
                {isColumnVisible('tp') && (
                  <td
                    className="rtx-trade-tp-cell px-0 py-[2px] border-r border-zinc-800 text-center tabular-nums"
                    title={`${tr('Take Profit: {{value0}}', { value0: takeProfitLabel })} · ${tr('Modify Position')}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (isPendingPlacement) return;
                      setSelectedPositionKey(positionKey);
                      if (event.detail === 0) openModifyPosition(position);
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      if (isPendingPlacement) return;
                      setSelectedPositionKey(positionKey);
                      openModifyPosition(position);
                    }}
                  >
                    <button
                      type="button"
                      className={`rtx-trade-tp-value w-full cursor-pointer bg-transparent px-1 text-center font-normal ${(position.price_tp ?? position.tp) > 0 ? 'text-profit' : 'text-zinc-100'}`}
                      disabled={isPendingPlacement}
                      aria-label={`${tr('Modify Position')} · ${tr('Take Profit:')} #${position.id}`}
                    >
                      {takeProfitLabel}
                    </button>
                  </td>
                )}

                {/* price_current */}
                {isColumnVisible('priceCurrent') && (
                  <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-zinc-100 font-normal tabular-nums" title={tr('Current price: {{value0}}', { value0: currentPriceLabel })}>
                    {currentPriceLabel}
                  </td>
                )}

                {/* swap */}
                {isColumnVisible('swap') && (
                  <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-zinc-100 tabular-nums" title={tr('Swap: {{value0}}', { value0: swapLabel })}>{swapLabel}</td>
                )}

                {/* account_login */}
                {isColumnVisible('accountLogin') && (
                  <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-zinc-100 whitespace-nowrap tabular-nums" title={tr('Account login: {{value0}}', { value0: accountLoginLabel })}>
                    {accountLoginLabel}
                  </td>
                )}

                {/* time_update */}
                {isColumnVisible('timeUpdate') && (
                  <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-zinc-100 whitespace-nowrap tabular-nums" title={tr('Last update: {{value0}}', { value0: timeUpdateLabel })}>
                    {timeUpdateLabel}
                  </td>
                )}

                {/* comment */}
                {isColumnVisible('comment') && (
                  <td className="px-1.5 py-[2px] border-r border-zinc-800 text-center text-zinc-100 truncate" title={tr('Comment: {{value0}}', { value0: commentLabel })}>
                    {commentLabel}
                  </td>
                )}

                {/* profit */}
                {isColumnVisible('profit') && (
                  <td className={`px-1.5 py-[2px] text-center font-normal tabular-nums ${!profitIsAvailable ? 'text-zinc-500' : profitIsPositive ? 'rtx-trade-profit-value--positive text-profit' : 'rtx-trade-profit-value--negative text-loss'}`} title={`${tr(profitMode === 'points' ? 'Profit Points' : 'Profit')}: ${profitLabel}`}>
                    {profitLabel}
                  </td>
                )}

                {/* Close Button */}
                <td className="px-0.5 py-[2px] text-center">
                  <button
                    type="button"
                    aria-label={isPendingPlacement ? placementLabel : tr('Close position {{value0}}', { value0: position.ticket ?? position.id })}
                    title={isPendingPlacement ? rowComment : tr('Close position {{value0}}', { value0: ticketLabel })}
                    disabled={isPendingPlacement}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (isPendingPlacement) return;
                      onClosePosition(position.id);
                    }}
                    className="rtx-trade-close-button mx-auto flex h-6 w-6 cursor-default items-center justify-center rounded-sm border border-transparent text-[12px] font-normal leading-none text-zinc-400 hover:border-red-500/50 hover:bg-red-950/50 hover:text-red-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400 disabled:cursor-default disabled:text-zinc-600 disabled:hover:border-transparent disabled:hover:bg-transparent"
                  >
                    {isPendingPlacement ? (isTerminalPlacementFailure ? '!' : '…') : 'x'}
                  </button>
                </td>
              </tr>
              {isTerminalPlacementFailure && (
                <tr className="rtx-trade-placement-message text-loss" data-placement-state={placementState}>
                  <td colSpan={visibleOptionalColumnCount + 2} className="px-1.5 py-[2px] text-left">
                    <div
                      role="status"
                      className="truncate font-normal"
                      style={{ '--rtx-type-size': '13px', '--rtx-type-weight': 400 } as CSSProperties}
                      title={placementSummary}
                    >
                      {placementSummary}
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {/* Account summary follows the last trade and scrolls with the list. */}
      <div
        className="rtx-trade-footer bg-[#191a1e] border-t border-zinc-700 w-full text-[13px] font-normal text-zinc-300 tabular-nums"
        data-metrics-publication-token={account?.publicationToken}
        data-metrics-calculation-version={account?.calculationVersion}
        data-metrics-margin-calculation-version={account?.marginCalculationVersion}
        data-metrics-configuration-version={account?.configurationVersion}
        data-metrics-status={account?.metricsStatus ?? (liveEquity === null ? 'unavailable' : 'valid')}
      >
        <div className="rtx-trade-footer-inner flex w-max min-w-full items-center py-1" style={{ minWidth: `max(100%, ${visibleTradeTableWidth}px)` }}>
          <div className="rtx-trade-footer-metrics flex min-w-0 items-center gap-3 px-1.5">
            <button
              type="button"
              className="rtx-trade-footer-status inline-flex h-5 w-5 shrink-0 cursor-default items-center justify-center rounded-[3px] border border-zinc-700/70 bg-zinc-950/35 px-0 text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400"
              title={tr('Select footer metrics')}
              aria-label={tr('Footer metrics')}
              aria-haspopup="menu"
              aria-expanded={footerMetricMenuOpen}
              onClick={(event) => {
                event.stopPropagation();
                toggleFooterMetricMenu(event.currentTarget);
              }}
            >
              <Icon name="plus-circle" size="xs" className="text-current shrink-0" />
            </button>
            {visibleFooterMetrics.map(metric => (
              <span key={metric.key} className="rtx-trade-footer-metric" title={getFooterMetricComment(metric.key)}>
                <span className="rtx-trade-metric-label text-zinc-500">{tr(metric.label)}</span>
                {renderFooterMetricValue(metric.key)}
              </span>
            ))}
          </div>
          <div className="min-w-2 flex-1" />
          {Boolean(account?.calculationVersion || account?.marginCalculationVersion) && (
            <span
              className="rtx-trade-footer-calc shrink-0 text-zinc-500"
              title={`Calculation ${account?.calculationVersion || 'unknown'} · margin ${account?.marginCalculationVersion || 'unknown'} · ${account?.metricsStatus || (liveEquity === null ? 'unavailable' : 'valid')}`}
              data-testid="trade-footer-calculation-badge"
            >
              {account?.calculationVersion || '—'}
              {' · margin '}
              {account?.marginCalculationVersion || '—'}
              {' · '}
              {account?.metricsStatus || (liveEquity === null ? 'unavailable' : 'valid')}
            </span>
          )}
          {account?.marketClosed && <span className="shrink-0 text-zinc-500">Market closed</span>}
          <span
            className={`rtx-trade-footer-floating ${isColumnVisible('profit') ? 'rtx-trade-footer-floating--profit justify-center' : 'justify-end'} inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-center font-normal leading-none ${floatingProfitColor}`}
            style={isColumnVisible('profit') ? { width: footerProfitColumnWidth, flex: `0 0 ${footerProfitColumnWidth}` } : undefined}
            title={tr('Floating P/L: {{value0}} {{value1}}', { value0: floatingProfitLabel, value1: account?.currency || 'USD' })}
          >
            {totalLivePnL === null
              ? <UnavailableTradeMetric />
              : (
                <TradeMetricValue
                  value={totalLivePnL}
                  formatFn={formatMoney}
                  defaultColor={floatingProfitColor}
                  flashDirection={false}
                />
              )}
            <span className="rtx-trade-footer-currency">{account?.currency || 'USD'}</span>
          </span>
          <span className="rtx-trade-footer-close-spacer shrink-0" style={{ width: footerCloseColumnWidth, flex: `0 0 ${footerCloseColumnWidth}` }} aria-hidden="true" />
        </div>
      </div>
      {displayedLivePositions.length === 0 && !loading && !error && (
        <div
          className="rtx-trade-empty-state flex h-16 w-max min-w-full items-center justify-center text-center text-xs italic text-zinc-400"
          style={{ minWidth: `max(100%, ${visibleTradeTableWidth}px)` }}
        >
          {tr('No open positions')}
        </div>
      )}
    </div>
  );
}
