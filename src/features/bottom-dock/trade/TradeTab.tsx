import { lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RetainedLazyFeature } from '../../../startup/RetainedLazyFeature';
import { useUiTranslation } from '../../../hooks/useUiTranslation';
import { useAppStore, type Account } from '../../../store/useAppStore';
import { useChartSettingsStore } from '../../../store/useChartSettingsStore';
import { useLiveAccountMetrics } from '../../../hooks/useLiveAccountMetrics';
import type { ToolboxTradePosition } from '../../../hooks/useToolboxTradeData';
import { ContextMenu, type ContextMenuItemConfig } from '../../../components/ui/ContextMenu';
import { Icon } from '../../../components/ui/Icon';
import { formatPrice, resolveSpecDigits } from '../../../utils/symbolUtils';
import { rememberTradeHistoryPositionLevels } from '../../../utils/tradeHistoryLevelCache';
import {
  resolveTradeProfit,
  toBackendFinancialNumber,
} from '../../../components/BottomDock.trade';
import { onCommittedBrokerAccountSessionScopeChange } from '../../../services/brokerSession';
import { TRADE_MODIFIED_EVENT, type TradeModifiedEventDetail } from '../../../contracts/terminalEvents';
import type {
  BulkCancelOrdersAction,
  CancelOrderAction,
  CancelOrderWithoutConfirmAction,
  CloseBulkPositionsAction,
  ClosePositionAction,
  ModifyPositionAction,
} from '../../../contracts/tradeActions';
import { PendingOrdersPanel, type PendingOrderView } from './PendingOrdersPanel';
import { safeReadBoolean, safeReadJson, safeReadString } from '../preferences';
import { escapeHtml } from '../reporting';
import { getCurrentBrokerAccountSessionScopeKey, normalizeTradeSymbol } from '../sessionScope';
import { TradeMetricValue, UnavailableTradeMetric } from './TradeMetricValue';
import { TradeTable } from './TradeTable';
import { closePositionsBy, buildCloseByPairKey, findCloseByCounterpart, readCloseByLegTicket } from '../../../api/closeBy';
import { publishOrderFeedback } from '../../../app/trading/orderFeedback';
import { useConfirmStore } from '../../../store/useConfirmStore';
import { feedbackLabel, feedbackValue } from '../../../utils/uiFeedback';
import { formatOrderError } from '../../../utils/orderError';
import { api } from '../../../services/api';
import {
  ALL_TRADE_COLUMNS,
  clampTradeColumnWidth,
  DEFAULT_TRADE_COLUMNS,
  DEFAULT_TRADE_COLUMN_WIDTHS,
  DEFAULT_TRADE_FOOTER_METRICS,
  METRIC_UNAVAILABLE,
  normalizeTradeColumnWidths,
  TRADE_COLUMN_DEFS,
  TRADE_COLUMN_STORAGE_KEY,
  TRADE_COLUMN_WIDTH_STORAGE_KEY,
  TRADE_DEFAULT_SORT_DIRECTION,
  TRADE_FOOTER_METRIC_COMMENTS,
  TRADE_FOOTER_METRIC_DEFS,
  TRADE_FOOTER_METRIC_STORAGE_KEY,
  TRADE_PROFIT_MODE_STORAGE_KEY,
  TRADE_SHOW_ON_CHARTS_AUTO_UPDATE_STORAGE_KEY,
  TRADE_VOLUME_MODE_STORAGE_KEY,
  type TradeColumnKey,
  type TradeColumnVisibility,
  type TradeColumnWidthKey,
  type TradeColumnWidths,
  type TradeFooterMetricKey,
  type TradeFooterMetricVisibility,
  type TradeProfitMode,
  type TradeSortColumn,
  type TradeSortState,
  type TradeVolumeMode,
} from './tradeTabModel';

const ModifyPositionDialog = lazy(() => import('../../../components/ModifyPositionDialog').then(module => ({ default: module.ModifyPositionDialog })));
const EMPTY_PENDING_POSITIONS: ToolboxTradePosition[] = [];

type ModifyPositionContext = {
  position: ToolboxTradePosition;
  sessionScope: string;
  kind: 'position' | 'pending-order';
};

type TradeTabProps = {
  positions: ToolboxTradePosition[];
  pendingPositions?: ToolboxTradePosition[];
  account: Account | null;
  onClosePosition: ClosePositionAction;
  onModifyPosition: ModifyPositionAction;
  onCancelOrder?: CancelOrderAction;
  onCancelBulkOrders?: BulkCancelOrdersAction;
  onCancelOrderWithoutConfirm?: CancelOrderWithoutConfirmAction;
  onCloseBulk?: CloseBulkPositionsAction;
  formatMoney: (value: number | null | undefined) => string;
  loading: boolean;
  error: string | null;
};

// Pass only displayed data and actions. Transport timestamps/status otherwise
// defeat memo() and repaint the entire table when no trade values changed.
export const TradeTab = memo(function TradeTab({
    positions,
    pendingPositions = EMPTY_PENDING_POSITIONS,
    account,
    onClosePosition,
    onCancelOrder,
    onCancelBulkOrders,
    onCancelOrderWithoutConfirm,
    onCloseBulk,
    formatMoney,
    loading,
    error,
}: TradeTabProps) {
    const tr = useUiTranslation();
    const accountId = useAppStore(s => s.accountId);
    const [modifyPositionContext, setModifyPositionContext] = useState<ModifyPositionContext | null>(null);
    const modifyPosition = modifyPositionContext?.position ?? null;
    const [sortState, setSortState] = useState<TradeSortState>(null);
    const [tradeContextMenu, setTradeContextMenu] = useState<{ x: number; y: number; position: ToolboxTradePosition } | null>(null);
    const [footerMetricMenu, setFooterMetricMenu] = useState<{
        x: number;
        y: number;
        trigger: HTMLButtonElement;
    } | null>(null);
    const [columnVisibility, setColumnVisibility] = useState<TradeColumnVisibility>(() => safeReadJson(TRADE_COLUMN_STORAGE_KEY, DEFAULT_TRADE_COLUMNS));
    const [columnWidths, setColumnWidths] = useState<TradeColumnWidths>(() => normalizeTradeColumnWidths(safeReadJson(TRADE_COLUMN_WIDTH_STORAGE_KEY, DEFAULT_TRADE_COLUMN_WIDTHS)));
    const [footerMetricVisibility, setFooterMetricVisibility] = useState<TradeFooterMetricVisibility>(() => safeReadJson(TRADE_FOOTER_METRIC_STORAGE_KEY, DEFAULT_TRADE_FOOTER_METRICS));
    const [profitMode, setProfitMode] = useState<TradeProfitMode>(() => safeReadString(TRADE_PROFIT_MODE_STORAGE_KEY, ['money', 'points'] as const, 'money'));
    const [volumeMode, setVolumeMode] = useState<TradeVolumeMode>(() => safeReadString(TRADE_VOLUME_MODE_STORAGE_KEY, ['lots', 'amounts'] as const, 'lots'));
    const [showOnChartsAutoUpdate, setShowOnChartsAutoUpdate] = useState<boolean>(() => safeReadBoolean(TRADE_SHOW_ON_CHARTS_AUTO_UPDATE_STORAGE_KEY, true));
    const [selectedPositionKey, setSelectedPositionKey] = useState<string | null>(null);
    const tradeTabRef = useRef<HTMLDivElement>(null);
    const [resizingColumn, setResizingColumn] = useState<TradeColumnWidthKey | null>(null);
    const columnResizeRef = useRef<{ key: TradeColumnWidthKey; startX: number; startWidth: number } | null>(null);

    // Local trade overrides: track modified fields since the Gateway API can lag after modification.
    const [tradeOverrides, setTradeOverrides] = useState<Record<number, { sl: number; tp: number; comment?: string }>>({});

    const openModifyPosition = useCallback((position: ToolboxTradePosition) => {
        setModifyPositionContext({
            position,
            sessionScope: getCurrentBrokerAccountSessionScopeKey(),
            kind: 'position',
        });
    }, []);

    const [tradeView, setTradeView] = useState<'positions' | 'pending'>('positions');
    const pendingCount = useAppStore((s) => s.orders?.length ?? 0);

    const openModifyPendingOrder = useCallback((order: PendingOrderView) => {
        const position: ToolboxTradePosition = {
            id: order.ticket,
            symbol: order.symbol,
            side: order.side,
            volume: order.volume,
            openPrice: order.price,
            sl: order.sl,
            tp: order.tp,
        } as ToolboxTradePosition;
        setModifyPositionContext({
            position,
            sessionScope: getCurrentBrokerAccountSessionScopeKey(),
            kind: 'pending-order',
        });
    }, []);

    // Position and placement updates arrive directly from useToolboxTradeData;
    // quote ticks do not subscribe this table or delay confirmed trade changes.

    useEffect(() => {
        const handleTradeModified = (event: Event) => {
            const detail = (event as CustomEvent<TradeModifiedEventDetail>).detail;
            const id = Number(detail?.id);
            const symbol = normalizeTradeSymbol(detail?.symbol);
            const sl = Number(detail?.sl);
            const tp = Number(detail?.tp);
            const comment = typeof detail?.comment === 'string' ? detail.comment : undefined;
            const sessionScope = String(detail?.sessionScope ?? '');
            if (
                !Number.isSafeInteger(id)
                || id <= 0
                || !symbol
                || !Number.isFinite(sl)
                || !Number.isFinite(tp)
                || sessionScope !== getCurrentBrokerAccountSessionScopeKey()
            ) return;

            const existingPosition = useAppStore.getState().positions.find(position => (
                position.id === id
                && normalizeTradeSymbol(position.symbol) === symbol
            ));
            if (!existingPosition) return;
            rememberTradeHistoryPositionLevels([
                { ...existingPosition, id, sl, tp, price_sl: sl, price_tp: tp },
            ], useAppStore.getState().accountId);
            setTradeOverrides(prev => ({
                ...prev,
                [id]: { sl, tp, comment: comment ?? prev[id]?.comment },
            }));
        };
        window.addEventListener(TRADE_MODIFIED_EVENT, handleTradeModified);
        return () => window.removeEventListener(TRADE_MODIFIED_EVENT, handleTradeModified);
    }, []);

    useEffect(() => onCommittedBrokerAccountSessionScopeChange(() => {
        setModifyPositionContext(null);
        setTradeOverrides({});
        setSelectedPositionKey(null);
        setTradeContextMenu(null);
    }), []);

    useEffect(() => {
        window.localStorage.setItem(TRADE_COLUMN_STORAGE_KEY, JSON.stringify(columnVisibility));
    }, [columnVisibility]);

    useEffect(() => {
        window.localStorage.setItem(TRADE_COLUMN_WIDTH_STORAGE_KEY, JSON.stringify(columnWidths));
    }, [columnWidths]);

    useEffect(() => {
        window.localStorage.setItem(TRADE_FOOTER_METRIC_STORAGE_KEY, JSON.stringify(footerMetricVisibility));
    }, [footerMetricVisibility]);

    useEffect(() => {
        window.localStorage.setItem(TRADE_PROFIT_MODE_STORAGE_KEY, profitMode);
    }, [profitMode]);

    useEffect(() => {
        window.localStorage.setItem(TRADE_VOLUME_MODE_STORAGE_KEY, volumeMode);
    }, [volumeMode]);

    useEffect(() => {
        window.localStorage.setItem(TRADE_SHOW_ON_CHARTS_AUTO_UPDATE_STORAGE_KEY, String(showOnChartsAutoUpdate));
    }, [showOnChartsAutoUpdate]);

    const [isLightSkin, setIsLightSkin] = useState(false);
    useEffect(() => {
        const root = document.documentElement;
        const check = () => setIsLightSkin(root.classList.contains('rtx-skin-untitled-light'));
        check();
        const obs = new MutationObserver(check);
        obs.observe(root, { attributes: true, attributeFilter: ['class'] });
        return () => obs.disconnect();
    }, []);

    // Display backend prices and P/L, with pending SL/TP edits from local overrides.
    const livePositions = useMemo(() => {
        return positions.map((position: ToolboxTradePosition) => {
            // Some gateway payloads still expose this documented wire alias even though the
            // canonical hook position type has already normalized it to `volume`.
            const pos = position as ToolboxTradePosition & { volume_lots?: number };
            const symbol = pos?.symbol ?? '';
            const openPrice = Number(
                pos?.price_open ?? pos?.open_price ?? pos?.openPrice ?? pos?.entryPrice ?? pos?.chartEntryPrice ?? pos?.price ?? 0
            );
            const livePrice = pos.hasBackendCurrentPrice === false
                ? null
                : toBackendFinancialNumber(pos?.price_current ?? pos?.current_price ?? pos?.currentPrice);

            const openTime = pos?.time_create ?? pos?.openTime ?? pos?.open_time ?? pos?.time ?? pos?.chartEntryTime;
            const volume = Number(pos?.volume_lots ?? pos?.volume ?? pos?.quantity ?? 0);

            // MERGE: HEAD's single-argument call. origin/main additionally threaded the
            // live prices and `{ accountCurrency }` into the resolver, but both branches
            // stripped the local-estimate paths out of resolveTradeProfit, so those inputs
            // no longer influence the result. `profitResolution.value` is null exactly when
            // `source !== 'backend'`, which is origin/main's livePnL derivation.
            const profitResolution = resolveTradeProfit(pos);
            const livePnL = profitResolution.value;

            // Apply local overrides while the Gateway API catches up.
            const override = tradeOverrides[pos?.id];
            const sl = override?.sl ?? pos?.price_sl ?? pos?.sl ?? 0;
            const tp = override?.tp ?? pos?.price_tp ?? pos?.tp ?? 0;
            const comment = override?.comment ?? pos?.comment ?? '';

            return {
                ...pos,
                symbol,
                volume,
                openPrice,
                price_open: openPrice,
                open_price: openPrice,
                currentPrice: livePrice,
                price_current: livePrice,
                current_price: livePrice,
                openTime,
                time_create: openTime,
                open_time: openTime,
                sl: Number(sl ?? 0),
                tp: Number(tp ?? 0),
                price_sl: Number(sl ?? 0),
                price_tp: Number(tp ?? 0),
                comment,
                profit: livePnL,
                unrealizedPnL: livePnL ?? pos?.unrealizedPnL,
                livePrice,
                livePnL,
                hasBackendProfit: profitResolution.source === 'backend',
                profitSource: profitResolution.source,
                profitWarnings: profitResolution.warnings,
            } as ToolboxTradePosition;
        });
    }, [positions, tradeOverrides]);

    const livePositionLevelSignature = useMemo(() => (
        livePositions
            .map((pos: ToolboxTradePosition) => [
                pos?.id ?? '',
                pos?.symbol ?? '',
                pos?.side ?? '',
                pos?.volume ?? '',
                pos?.openPrice ?? pos?.price_open ?? '',
                pos?.openTime ?? pos?.time_create ?? '',
                pos?.price_sl ?? pos?.sl ?? '',
                pos?.price_tp ?? pos?.tp ?? '',
            ].join(':'))
            .join('|')
    ), [livePositions]);

    useEffect(() => {
        rememberTradeHistoryPositionLevels(livePositions, accountId);
    // The stable signature intentionally prevents store object churn from rewriting the cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountId, livePositionLevelSignature]);

    // MERGE (union): Row-level totals. These drive the per-tile Floating P/L, Swap and
    // Commission displays only - they must never feed the account metrics, which are
    // backend-authoritative.
    const totalSwap = useMemo(() => livePositions.reduce((acc, pos) => acc + (Number(pos.swap) || 0), 0), [livePositions]);
    const totalCommission = useMemo(() => livePositions.reduce((acc, pos) => acc + (Number(pos.commission) || 0), 0), [livePositions]);
    // Equity / free margin / margin level come from the backend. When the backend omits one
    // it resolves to null and the footer renders a dash, not a zero. A quiet account keeps its
    // last published figures; the 1s clock only re-checks future-dated snapshots.
    const [metricsNow, setMetricsNow] = useState(Date.now);
    useEffect(() => {
        const timer = window.setInterval(() => setMetricsNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    // Every account total comes from the backend, including floating P/L, and follows
    // the live position profit stream between backend snapshots.
    const accountMetricResolution = useLiveAccountMetrics(account, livePositions, metricsNow);
    useEffect(() => {
        if (!account?.publicationToken) return;
        let nextFrame = 0;
        const frame = window.requestAnimationFrame(() => {
            nextFrame = window.requestAnimationFrame(() => {
                window.dispatchEvent(new CustomEvent('rtx:account-metrics-rendered', {
                    detail: { publication_token: account.publicationToken, rendered_at: performance.now() },
                }));
            });
        });
        return () => { window.cancelAnimationFrame(frame); window.cancelAnimationFrame(nextFrame); };
    }, [account?.publicationToken, account?.metricsScope]);
    const floatingPnL = accountMetricResolution.floatingPnL;
    // Kept nullable (HEAD) rather than `floatingPnL ?? 0` (origin/main) so the footer can
    // distinguish "backend reported 0" from "backend reported nothing" and render the
    // placeholder instead of a misleading zero.
    const totalLivePnL = floatingPnL;
    const floatingProfitColor = totalLivePnL !== null && totalLivePnL > 0
        ? 'text-profit'
        : totalLivePnL !== null && totalLivePnL < 0 ? 'text-loss' : 'text-zinc-100';
    const floatingProfitLabel = totalLivePnL === null ? METRIC_UNAVAILABLE : formatMoney(totalLivePnL);
    const accountBalance = accountMetricResolution.balance;
    const liveEquity = accountMetricResolution.equity;
    const margin = accountMetricResolution.margin;
    const liveFreeMargin = accountMetricResolution.freeMargin;
    const liveMarginLevel = accountMetricResolution.marginLevel;

    const formatMarginLevel = (value: number | null) => {
        if (value === null) return METRIC_UNAVAILABLE;
        if (value === 0 && margin === 0) return '\u221e';
        return `${value.toFixed(2)}%`;
    };

    const formatTradeTime = useCallback((value?: number | string | null) => {
        if (value === undefined || value === null || value === '' || value === 0) return '-';
        const textValue = String(value).trim();
        const numericValue = Number(textValue);
        const date = Number.isFinite(numericValue)
            ? new Date(numericValue > 1_000_000_000_000 ? numericValue : numericValue * 1000)
            : new Date(textValue);
        if (Number.isNaN(date.getTime())) return '-';
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }, []);

    // Spec digits only (live tick); unknown renders raw (never guessed).
    const lookupTradeTickDigits = useCallback((symbol: string): number | null => {
        const ticks = (useAppStore.getState().ticks ?? {}) as Record<string, { digits?: unknown } | undefined>;
        const tick = ticks[symbol] ?? ticks[symbol.toUpperCase()];
        return resolveSpecDigits(tick?.digits);
    }, []);

    const formatTradePrice = useCallback((value: unknown, symbol: string) => {
        const price = Number(value);
        return Number.isFinite(price) && price > 0 ? formatPrice(price, lookupTradeTickDigits(symbol) ?? undefined) : '-';
    }, [lookupTradeTickDigits]);

    const formatTradeLevel = useCallback((value: unknown, symbol: string) => {
        const price = Number(value);
        return Number.isFinite(price) && price > 0 ? formatPrice(price, lookupTradeTickDigits(symbol) ?? undefined) : '0.00';
    }, [lookupTradeTickDigits]);

    const getTradeTimeValue = useCallback((value?: number | string | null) => {
        if (value === undefined || value === null || value === '' || value === 0) return 0;
        const numericValue = Number(String(value).trim());
        if (Number.isFinite(numericValue)) return numericValue > 1_000_000_000_000 ? numericValue : numericValue * 1000;
        const parsed = new Date(String(value)).getTime();
        return Number.isFinite(parsed) ? parsed : 0;
    }, []);

    const getSortValue = useCallback((pos: ToolboxTradePosition, column: TradeSortColumn): string | number => {
        switch (column) {
            case 'symbol':
                return String(pos.symbol ?? '').toUpperCase();
            case 'ticket':
                return Number(pos.ticket ?? pos.id ?? 0);
            case 'time_create':
                return getTradeTimeValue(pos.time_create ?? pos.openTime ?? pos.open_time ?? pos.time);
            case 'profit':
                return Number(pos.profit ?? pos.unrealizedPnL ?? 0);
            default:
                return '';
        }
    }, [getTradeTimeValue]);

    const toggleSort = (column: TradeSortColumn) => {
        setSortState(prev => {
            if (!prev || prev.column !== column) {
                return { column, direction: TRADE_DEFAULT_SORT_DIRECTION[column] };
            }
            return { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
        });
    };

    const isColumnVisible = useCallback((key: TradeColumnKey) => columnVisibility[key] !== false, [columnVisibility]);

    const toggleColumn = useCallback((key: TradeColumnKey) => {
        setColumnVisibility(prev => ({ ...prev, [key]: prev[key] === false }));
    }, []);

    const showAllTradeColumns = useCallback(() => {
        setColumnVisibility(ALL_TRADE_COLUMNS);
    }, []);

    const resetTradeColumns = useCallback(() => {
        setColumnVisibility(DEFAULT_TRADE_COLUMNS);
        setColumnWidths(DEFAULT_TRADE_COLUMN_WIDTHS);
    }, []);

    const isFooterMetricVisible = useCallback((key: TradeFooterMetricKey) => footerMetricVisibility[key] !== false, [footerMetricVisibility]);

    const toggleFooterMetric = useCallback((key: TradeFooterMetricKey) => {
        setFooterMetricVisibility(prev => ({ ...prev, [key]: prev[key] === false }));
    }, []);

    const resetFooterMetrics = useCallback(() => {
        setFooterMetricVisibility({ ...DEFAULT_TRADE_FOOTER_METRICS });
    }, []);

    const toggleFooterMetricMenu = useCallback((trigger: HTMLButtonElement) => {
        const rect = trigger.getBoundingClientRect();
        setFooterMetricMenu(prev => (
            prev ? null : { x: rect.left, y: rect.bottom + 2, trigger }
        ));
    }, []);

    const footerMetricMenuItems = useMemo<ContextMenuItemConfig[]>(() => [
        { label: 'Reset Metrics', action: resetFooterMetrics, autoClose: false },
        { divider: true, label: '' },
        ...TRADE_FOOTER_METRIC_DEFS.map(metric => ({
            label: metric.label,
            checked: isFooterMetricVisible(metric.key),
            action: () => toggleFooterMetric(metric.key),
            autoClose: false,
        })),
    ], [isFooterMetricVisible, resetFooterMetrics, toggleFooterMetric]);

    const visibleFooterMetrics = useMemo(
        () => TRADE_FOOTER_METRIC_DEFS.filter(metric => isFooterMetricVisible(metric.key)),
        [isFooterMetricVisible]
    );

    const renderFooterMetricValue = (key: TradeFooterMetricKey) => {
        switch (key) {
            case 'positions':
                return <TradeMetricValue value={livePositions.length} />;
            case 'balance':
                return accountBalance === null ? <UnavailableTradeMetric /> : <TradeMetricValue value={accountBalance} formatFn={formatMoney} />;
            case 'equity':
                return liveEquity === null
                    ? <UnavailableTradeMetric />
                    : <TradeMetricValue value={liveEquity} formatFn={formatMoney} flashDirection={false} />;
            case 'margin':
                return margin === null ? <UnavailableTradeMetric /> : <TradeMetricValue value={margin} formatFn={formatMoney} />;
            case 'freeMargin':
                return liveFreeMargin === null
                    ? <UnavailableTradeMetric />
                    : <TradeMetricValue value={liveFreeMargin} formatFn={formatMoney} flashDirection={false} />;
            case 'marginLevel':
                return liveMarginLevel === null
                    ? <UnavailableTradeMetric />
                    : <TradeMetricValue value={liveMarginLevel} formatFn={formatMarginLevel} flashDirection={false} />;
            case 'swap':
                return <TradeMetricValue value={totalSwap} formatFn={formatMoney} defaultColor={totalSwap < 0 ? 'text-[#f87171]' : 'text-zinc-300'} />;
            case 'commission':
                return <TradeMetricValue value={totalCommission} formatFn={formatMoney} defaultColor={totalCommission < 0 ? 'text-[#f87171]' : 'text-zinc-300'} />;
            default:
                return null;
        }
    };

    const getFooterMetricComment = (key: TradeFooterMetricKey) => {
        let value = '';
        switch (key) {
            case 'positions':
                value = String(livePositions.length);
                break;
            case 'balance':
                value = accountBalance === null ? METRIC_UNAVAILABLE : `${formatMoney(accountBalance)} ${account?.currency || 'USD'}`;
                break;
            case 'equity':
                value = liveEquity === null ? METRIC_UNAVAILABLE : formatMoney(liveEquity);
                break;
            case 'margin':
                value = margin === null ? METRIC_UNAVAILABLE : formatMoney(margin);
                break;
            case 'freeMargin':
                value = liveFreeMargin === null ? METRIC_UNAVAILABLE : formatMoney(liveFreeMargin);
                break;
            case 'marginLevel':
                value = formatMarginLevel(liveMarginLevel);
                break;
            case 'swap':
                value = formatMoney(totalSwap);
                break;
            case 'commission':
                value = formatMoney(totalCommission);
                break;
        }
        return `${tr(TRADE_FOOTER_METRIC_COMMENTS[key])}: ${value}`;
    };

    const visibleTradeColumns = useMemo(
        () => TRADE_COLUMN_DEFS.filter(column => isColumnVisible(column.key)),
        [isColumnVisible]
    );

    const visibleTradeTableWidth = useMemo(() => {
        const effectiveCloseWidth = clampTradeColumnWidth('close', columnWidths.close);
        return (
            columnWidths.symbol
            + visibleTradeColumns.reduce((total, column) => total + columnWidths[column.key], 0)
            + effectiveCloseWidth
        );
    }, [columnWidths, visibleTradeColumns]);
    const footerProfitColumnWidth = `${(columnWidths.profit / visibleTradeTableWidth) * 100}%`;
    const footerCloseColumnWidth = `${(clampTradeColumnWidth('close', columnWidths.close) / visibleTradeTableWidth) * 100}%`;

    const visibleOptionalColumnCount = useMemo(
        () => visibleTradeColumns.length,
        [visibleTradeColumns]
    );

    const startColumnResize = useCallback((event: React.MouseEvent, key: TradeColumnWidthKey) => {
        event.preventDefault();
        event.stopPropagation();
        columnResizeRef.current = {
            key,
            startX: event.clientX,
            startWidth: columnWidths[key],
        };
        setResizingColumn(key);
    }, [columnWidths]);

    useEffect(() => {
        if (!resizingColumn) return undefined;

        const previousCursor = document.body.style.cursor;
        const previousUserSelect = document.body.style.userSelect;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const handleMouseMove = (event: MouseEvent) => {
            const resizeState = columnResizeRef.current;
            if (!resizeState) return;
            const nextWidth = resizeState.startWidth + event.clientX - resizeState.startX;
            setColumnWidths(prev => ({
                ...prev,
                [resizeState.key]: clampTradeColumnWidth(resizeState.key, nextWidth),
            }));
        };

        const handleMouseUp = () => {
            columnResizeRef.current = null;
            setResizingColumn(null);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.body.style.cursor = previousCursor;
            document.body.style.userSelect = previousUserSelect;
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [resizingColumn]);

    const getPositionKey = useCallback((pos: ToolboxTradePosition) => (
        String(pos.id ?? pos.ticket ?? `${pos.symbol ?? ''}-${pos.time_create ?? ''}`)
    ), []);

    const sortedLivePositions = useMemo(() => {
        if (!sortState) return livePositions;
        return [...livePositions].sort((a: ToolboxTradePosition, b: ToolboxTradePosition) => {
            const aValue = getSortValue(a, sortState.column);
            const bValue = getSortValue(b, sortState.column);
            const comparison = typeof aValue === 'string' || typeof bValue === 'string'
                ? String(aValue).localeCompare(String(bValue), undefined, { numeric: true })
                : Number(aValue) - Number(bValue);
            return sortState.direction === 'asc' ? comparison : -comparison;
        });
    }, [livePositions, sortState, getSortValue]);
    const displayedLivePositions = useMemo(
        () => [...pendingPositions, ...sortedLivePositions],
        [pendingPositions, sortedLivePositions],
    );

    useEffect(() => {
        if (!selectedPositionKey) return;
        if (!livePositions.some((position: ToolboxTradePosition) => getPositionKey(position) === selectedPositionKey)) {
            // Selection is derived from the externally refreshed position collection.
            setSelectedPositionKey(null);
        }
    }, [getPositionKey, livePositions, selectedPositionKey]);

    useEffect(() => {
        if (!selectedPositionKey) return;
        const clearSelection = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element) {
                const row = target.closest('.rtx-trade-row');
                if (row && tradeTabRef.current?.contains(row)) return;
                // The Trade context menu is portalled outside this panel.
                if (tradeContextMenu && target.closest('[role="menu"]')) return;
            }
            setSelectedPositionKey(null);
        };
        document.addEventListener('pointerdown', clearSelection, true);
        return () => document.removeEventListener('pointerdown', clearSelection, true);
    }, [selectedPositionKey, tradeContextMenu]);

    const getTradePointsValue = useCallback((pos: ToolboxTradePosition) => {
        const openPrice = Number(pos.price_open ?? pos.open_price ?? pos.openPrice ?? pos.entryPrice ?? pos.price);
        const currentPrice = Number(pos.price_current ?? pos.current_price ?? pos.currentPrice ?? pos.livePrice);
        if (pos.hasBackendCurrentPrice === false || !Number.isFinite(openPrice) || !Number.isFinite(currentPrice) || openPrice <= 0 || currentPrice <= 0) return null;
        // Spec digits only (position, then live tick); unknown precision
        // cannot express points — return null (renders METRIC_UNAVAILABLE).
        const ticks = (useAppStore.getState().ticks ?? {}) as Record<string, { digits?: unknown } | undefined>;
        const symbol = pos.symbol ?? '';
        const tick = ticks[symbol] ?? ticks[symbol.toUpperCase()];
        const specDigits = resolveSpecDigits(
          (pos as { digits?: unknown })?.digits,
          tick?.digits,
        );
        if (specDigits === null) return null;
        const pointSize = Math.pow(10, -specDigits);
        const direction = String(pos.side).toUpperCase() === 'BUY' ? 1 : -1;
        const points = ((currentPrice - openPrice) / pointSize) * direction;
        return Number.isFinite(points) ? points : null;
    }, []);

    const formatTradePoints = useCallback((pos: ToolboxTradePosition) => {
        const points = getTradePointsValue(pos);
        if (points === null) return METRIC_UNAVAILABLE;
        const absPoints = Math.abs(points);
        const fractionDigits = absPoints > 0 && absPoints < 10 ? 1 : 0;
        return points.toLocaleString('en-US', {
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: 1,
        }).replace(/,/g, ' ');
    }, [getTradePointsValue]);

    const formatTradeVolume = useCallback((pos: ToolboxTradePosition) => (
        typeof pos.volume === 'number' ? pos.volume.toFixed(2) : pos.volume ?? '0.00'
    ), []);

    const downloadTextFile = useCallback((content: string, filename: string, type: string) => {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }, []);

    const getVisibleReportColumns = () => {
        const columns: { label: string; value: (pos: ToolboxTradePosition) => string | number }[] = [
            { label: 'Symbol', value: pos => pos.symbol ?? '-' },
        ];
        if (isColumnVisible('ticket')) columns.push({ label: 'Ticket', value: pos => pos.ticket ?? pos.id ?? '-' });
        if (isColumnVisible('time')) columns.push({ label: 'Time', value: pos => formatTradeTime(pos.time_create ?? pos.openTime ?? pos.open_time ?? pos.time) });
        if (isColumnVisible('side')) columns.push({ label: 'Type', value: pos => String(pos.side ?? '').toLowerCase() || '-' });
        if (isColumnVisible('volume')) columns.push({ label: 'Volume', value: pos => formatTradeVolume(pos) });
        if (isColumnVisible('priceOpen')) columns.push({ label: 'Price Open', value: pos => formatTradePrice(pos.price_open ?? pos.open_price ?? pos.openPrice, pos.symbol ?? '') });
        if (isColumnVisible('sl')) columns.push({ label: 'S / L', value: pos => formatTradeLevel(pos.price_sl ?? pos.sl, pos.symbol ?? '') });
        if (isColumnVisible('tp')) columns.push({ label: 'T / P', value: pos => formatTradeLevel(pos.price_tp ?? pos.tp, pos.symbol ?? '') });
        if (isColumnVisible('priceCurrent')) columns.push({ label: 'Current Price', value: pos => formatTradePrice(pos.price_current ?? pos.current_price ?? pos.currentPrice ?? pos.livePrice, pos.symbol ?? '') });
        if (isColumnVisible('swap')) columns.push({ label: 'Swap', value: pos => formatMoney(pos.swap) });
        if (isColumnVisible('accountLogin')) columns.push({ label: 'Account Login', value: pos => pos.account_login ?? '-' });
        if (isColumnVisible('timeUpdate')) columns.push({ label: 'Time Update', value: pos => formatTradeTime(pos.time_update) });
        if (isColumnVisible('comment')) columns.push({ label: 'Comment', value: pos => pos.comment || '-' });
        if (isColumnVisible('profit')) {
            columns.push({
                label: profitMode === 'points' ? 'Profit Points' : 'Profit',
                value: pos => profitMode === 'points'
                    ? formatTradePoints(pos)
                    // MERGE: HEAD's self-contained form. origin/main read the memoized
                    // `pos.profitSource` / `pos.profit` instead; both yield the same output
                    // because livePositions stores `profit: livePnL` (null when unavailable)
                    // alongside `profitSource`. Resolving here keeps the report correct for
                    // any row shape and does not depend on `profitSource` being declared on
                    // ToolboxTradePosition.
                    : resolveTradeProfit(pos).value === null ? METRIC_UNAVAILABLE : formatMoney(resolveTradeProfit(pos).value),
            });
        }
        return columns;
    };

    const buildTradeReportHtml = (title: string) => {
        const columns = getVisibleReportColumns();
        const header = columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join('');
        const body = sortedLivePositions.map(position => (
            `<tr>${columns.map(column => `<td>${escapeHtml(column.value(position))}</td>`).join('')}</tr>`
        )).join('');
        return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
body{font-family:Segoe UI,Tahoma,Arial,sans-serif;font-size:12px;color:#111;background:#fff;margin:18px}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #bdbdbd;padding:4px 6px;text-align:center;white-space:nowrap}
th{background:#ececec;font-weight:600}
.summary{margin:0 0 12px 0;font-weight:600}
</style>
</head>
<body>
<div class="summary">${escapeHtml(title)} - ${sortedLivePositions.length} position(s)</div>
<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>
</body>
</html>`;
    };

    const openTradeOverview = () => {
        const url = URL.createObjectURL(new Blob([buildTradeReportHtml('Trade Overview')], { type: 'text/html' }));
        window.open(url, '_blank', 'noopener,noreferrer');
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    };

    const downloadTradeHtml = () => {
        downloadTextFile(buildTradeReportHtml('Trade Report'), 'trade-report.html', 'text/html');
    };

    const downloadTradeXml = () => {
        const columns = getVisibleReportColumns();
        const rows = sortedLivePositions.map(position => (
            `<Row>${columns.map(column => `<Cell><Data ss:Type="String">${escapeHtml(column.value(position))}</Data></Cell>`).join('')}</Row>`
        )).join('');
        const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Trade">
<Table>
<Row>${columns.map(column => `<Cell><Data ss:Type="String">${escapeHtml(column.label)}</Data></Cell>`).join('')}</Row>
${rows}
</Table>
</Worksheet>
</Workbook>`;
        downloadTextFile(xml, 'trade-report.xml', 'application/vnd.ms-excel');
    };

    const setShowTradeLevelsForSymbol = (symbol: string, visible: boolean) => {
        const store = useChartSettingsStore.getState();
        store.updateSymbolProperty(symbol, 'showTradeLevels', visible);
        window.dispatchEvent(new CustomEvent(visible ? 'rtx:refresh-trade-overlay' : 'rtx:flush-trade-overlay', { detail: { symbol } }));
    };

    const ensureTradeLevelsVisibleForLivePositions = useCallback((positions: ToolboxTradePosition[]) => {
        const symbols = Array.from(new Set(
            positions
                .map(position => String(position.symbol ?? '').trim())
                .filter(Boolean),
        ));
        if (symbols.length === 0) return;

        const store = useChartSettingsStore.getState();
        symbols.forEach(symbol => {
            const visible = store.symbolProperties[symbol]?.showTradeLevels ?? store.globalProperties.showTradeLevels;
            if (visible === false) {
                store.updateSymbolProperty(symbol, 'showTradeLevels', true);
            }
        });
    }, []);

    const closeByInFlightRef = useRef<Set<string>>(new Set());

    // Close-by: net this row against its opposite-side same-symbol counterpart.
    // Fail-closed: without a counterpart nothing is offered (menu item hidden)
    // and nothing is sent; the confirm dialog is the existing themed confirm
    // flow; positions are re-read from the backend after the call and every
    // failure is surfaced as user-visible feedback.
    const handleCloseByPosition = useCallback(async (position: ToolboxTradePosition): Promise<boolean> => {
        const counterpart = findCloseByCounterpart(position, positions);
        const rowTicket = readCloseByLegTicket(position);
        const pairTicket = counterpart ? readCloseByLegTicket(counterpart) : null;
        if (!counterpart || !rowTicket || !pairTicket) {
            publishOrderFeedback(
                [feedbackLabel('Close by'), feedbackValue(` #${String(position.ticket ?? position.id ?? '?')}: `), feedbackLabel('Failed'), feedbackValue(' — No opposite-side position for this symbol is available.')],
                'error',
            );
            return false;
        }
        const pairKey = buildCloseByPairKey(rowTicket, pairTicket);
        // Guard against double-click: skip if this pair is already closing.
        if (closeByInFlightRef.current.has(pairKey)) return false;
        const symbol = String(position.symbol ?? '').trim();
        const confirmed = await useConfirmStore.getState().showConfirm(
            `Close by #${rowTicket} and #${pairTicket}`,
            `Close positions #${rowTicket} and #${pairTicket} (${symbol}) against each other at the current market price? This action cannot be undone.`,
            { confirmLabel: 'Close by', danger: true },
        );
        if (!confirmed) return false;
        closeByInFlightRef.current.add(pairKey);
        try {
            // account_login rides in the body (gateway requires it in-body).
            await closePositionsBy(position, counterpart, { account_login: accountId ?? undefined });
            // Authoritative refresh through the trade-refresh controller
            // (it maps rows to the store shape; no direct setPositions cast).
            window.dispatchEvent(new Event('rtx:force-refresh-positions'));
            return true;
        } catch (err) {
            console.error('Failed to close positions by each other:', err);
            publishOrderFeedback(
                [feedbackLabel('Close by'), feedbackValue(` #${rowTicket} / #${pairTicket}: `), feedbackLabel('Failed'), feedbackValue(` — ${formatOrderError(err)}`)],
                'error',
            );
            // Converge with backend truth best-effort; the original error is already surfaced.
            window.dispatchEvent(new Event('rtx:force-refresh-positions'));
            return false;
        } finally {
            closeByInFlightRef.current.delete(pairKey);
        }
    }, [positions, accountId]);

    const handleTradeContextMenu = useCallback((event: React.MouseEvent<HTMLTableRowElement>, position: ToolboxTradePosition) => {
        event.preventDefault();
        event.stopPropagation();
        setSelectedPositionKey(getPositionKey(position));
        setTradeContextMenu({ x: event.clientX, y: event.clientY, position });
    }, [getPositionKey]);

    const buildTradeContextMenuItems = (position: ToolboxTradePosition): ContextMenuItemConfig[] => {
        const symbol = String(position.symbol ?? '');
        // Close-by is offered only while an opposite-side same-symbol
        // counterpart is present; the lowest-ticket one is named (see
        // findCloseByCounterpart). Otherwise the item stays hidden.
        const closeByCounterpart = findCloseByCounterpart(position, positions);
        const closeByTicket = closeByCounterpart ? readCloseByLegTicket(closeByCounterpart) : null;
        return [
            {
                label: 'New Order',
                shortcut: 'F9',
                icon: <Icon name="plus" size="xs" />,
                action: () => window.dispatchEvent(new CustomEvent('openOrderDialog', { detail: { symbol } })),
            },
            {
                label: 'Close Position',
                icon: <Icon name="check" size="xs" />,
                action: () => onClosePosition(position.id),
            },
            ...(closeByTicket ? [{
                label: `Close by #${closeByTicket}`,
                icon: <Icon name="check" size="xs" />,
                action: () => void handleCloseByPosition(position),
            } satisfies ContextMenuItemConfig] : []),
            {
                label: 'Modify or Delete',
                icon: <Icon name="settings" size="xs" />,
                action: () => openModifyPosition(position),
            },
            { divider: true },
            {
                label: 'Bulk Operations',
                submenu: [
                    { label: 'Close All', action: () => onCloseBulk?.('ALL') },
                    { label: 'Close In-Profit', action: () => onCloseBulk?.('WINNERS') },
                    { label: 'Close In-Loss', action: () => onCloseBulk?.('LOSERS') },
                    { label: `Close All ${symbol}`, action: () => onCloseBulk?.('ALL', symbol) },
                ],
            },
            { divider: true },
            {
                label: 'Depth of Market',
                shortcut: 'B',
                icon: <Icon name="box" size="xs" />,
                action: () => window.dispatchEvent(new CustomEvent('openDepthOfMarket', { detail: { symbol } })),
            },
            {
                label: 'Open Chart',
                shortcut: 'Space',
                icon: <Icon name="line-chart" size="xs" />,
                action: () => window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol } })),
            },
            { divider: true },
            {
                label: 'Trailing Stop',
                submenu: [
                    { label: 'Delete All', disabled: true },
                    { label: 'None', checked: true, disabled: true },
                    { divider: true },
                    ...[50, 55, 60, 65, 70, 75, 80, 85, 90, 95].map(points => ({
                        label: `${points} points`,
                        disabled: true,
                    })),
                ],
            },
            {
                label: 'Volumes',
                submenu: [
                    {
                        label: 'Lots',
                        checked: volumeMode === 'lots',
                        action: () => setVolumeMode('lots'),
                        autoClose: false,
                    },
                    {
                        label: 'Amounts',
                        disabled: true,
                    },
                ],
            },
            {
                label: 'Profit',
                submenu: [
                    {
                        label: 'as Money',
                        checked: profitMode === 'money',
                        action: () => setProfitMode('money'),
                        autoClose: false,
                    },
                    {
                        label: 'as Points',
                        checked: profitMode === 'points',
                        action: () => setProfitMode('points'),
                        autoClose: false,
                    },
                ],
            },
            { divider: true },
            { label: 'Deposit', icon: <Icon name="download" size="xs" />, disabled: true },
            { label: 'Withdrawal', icon: <Icon name="download" size="xs" />, disabled: true },
            { divider: true },
            {
                label: 'Report',
                submenu: [
                    { label: 'Overview', shortcut: 'Alt+E', action: openTradeOverview },
                    { label: 'Open XML (MS Office Excel 2007)', action: downloadTradeXml },
                    { label: 'HTML (Internet Explorer)', action: downloadTradeHtml },
                ],
            },
            {
                label: 'Show on Charts',
                submenu: [
                    {
                        label: `Add ${symbol} Deals`,
                        action: () => setShowTradeLevelsForSymbol(symbol, true),
                    },
                    {
                        label: 'Delete All Deals',
                        action: () => {
                            useChartSettingsStore.getState().updateGlobalProperty('showTradeLevels', false);
                            window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
                        },
                    },
                    {
                        label: 'Auto Update',
                        checked: showOnChartsAutoUpdate,
                        action: () => {
                            setShowOnChartsAutoUpdate(prev => {
                                const next = !prev;
                                window.dispatchEvent(new CustomEvent(next ? 'rtx:refresh-trade-overlay' : 'rtx:flush-trade-overlay'));
                                return next;
                            });
                        },
                        autoClose: false,
                    },
                ],
            },
            { label: 'Register as Signal', disabled: true },
            { divider: true },
            { label: 'Show Milliseconds', disabled: true },
            { label: 'Auto Arrange', checked: true, disabled: true, shortcut: 'A' },
            { label: 'Grid', checked: true, disabled: true, shortcut: 'G' },
            { divider: true },
            {
                label: 'Columns',
                submenu: [
                    { label: 'Show All Columns', action: showAllTradeColumns, autoClose: false },
                    { label: 'Reset Columns', action: resetTradeColumns, autoClose: false },
                    { divider: true },
                    ...TRADE_COLUMN_DEFS.map(column => ({
                        label: column.label,
                        checked: isColumnVisible(column.key),
                        action: () => toggleColumn(column.key),
                        autoClose: false,
                    })),
                    { divider: true },
                    { label: 'Market Value', disabled: true },
                    { label: 'Change %', disabled: true },
                    { label: 'Magic Number', disabled: true },
                ],
            },
        ];
    };

    useEffect(() => {
        if (showOnChartsAutoUpdate && livePositions.length > 0) {
            ensureTradeLevelsVisibleForLivePositions(livePositions);
            window.dispatchEvent(new CustomEvent('rtx:refresh-trade-overlay'));
        }
    }, [ensureTradeLevelsVisibleForLivePositions, showOnChartsAutoUpdate, livePositions]);

    return (
        <div ref={tradeTabRef} className="rtx-trade-tab h-full cursor-default flex flex-col relative bg-[#131316] overflow-hidden">
            <div className="flex items-center gap-1 px-2 pt-1">
                <button
                    type="button"
                    onClick={() => setTradeView('positions')}
                    aria-pressed={tradeView === 'positions'}
                    className={`text-xs px-2 py-0.5 rounded ${tradeView === 'positions' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                    {tr('Positions')}
                </button>
                <button
                    type="button"
                    onClick={() => setTradeView('pending')}
                    aria-pressed={tradeView === 'pending'}
                    className={`text-xs px-2 py-0.5 rounded ${tradeView === 'pending' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                    {tr('Pending Orders')}{pendingCount > 0 ? ` (${pendingCount})` : ''}
                </button>
            </div>
            {tradeView === 'pending' ? (
                <PendingOrdersPanel
                    onModifyOrder={openModifyPendingOrder}
                    onCancelOrder={async (ticket) => { await onCancelOrder?.(ticket); }}
                    onCancelBulkOrders={onCancelBulkOrders}
                    onCancelOrderWithoutConfirm={onCancelOrderWithoutConfirm}
                />
            ) : (
            <TradeTable
                account={account}
                columnWidths={columnWidths}
                displayedLivePositions={displayedLivePositions}
                error={error}
                floatingProfitColor={floatingProfitColor}
                floatingProfitLabel={floatingProfitLabel}
                footerCloseColumnWidth={footerCloseColumnWidth}
                footerMetricMenuOpen={footerMetricMenu !== null}
                footerProfitColumnWidth={footerProfitColumnWidth}
                formatMoney={formatMoney}
                formatTradeLevel={formatTradeLevel}
                formatTradePoints={formatTradePoints}
                formatTradePrice={formatTradePrice}
                formatTradeTime={formatTradeTime}
                formatTradeVolume={formatTradeVolume}
                getFooterMetricComment={getFooterMetricComment}
                getPositionKey={getPositionKey}
                getTradePointsValue={getTradePointsValue}
                handleTradeContextMenu={handleTradeContextMenu}
                isColumnVisible={isColumnVisible}
                liveEquity={liveEquity}
                loading={loading}
                onClosePosition={onClosePosition}
                openModifyPosition={openModifyPosition}
                profitMode={profitMode}
                renderFooterMetricValue={renderFooterMetricValue}
                resizingColumn={resizingColumn}
                selectedPositionKey={selectedPositionKey}
                setColumnWidths={setColumnWidths}
                setSelectedPositionKey={setSelectedPositionKey}
                sortState={sortState}
                startColumnResize={startColumnResize}
                toggleFooterMetricMenu={toggleFooterMetricMenu}
                toggleSort={toggleSort}
                totalLivePnL={totalLivePnL}
                visibleFooterMetrics={visibleFooterMetrics}
                visibleOptionalColumnCount={visibleOptionalColumnCount}
                visibleTradeColumns={visibleTradeColumns}
                visibleTradeTableWidth={visibleTradeTableWidth}
            />
            )}
            {footerMetricMenu && (
                <ContextMenu
                    variant={isLightSkin ? "mt5-light" : "mt5-dark"}
                    items={footerMetricMenuItems}
                    position={footerMetricMenu}
                    onClose={() => setFooterMetricMenu(null)}
                    ignoredElements={[footerMetricMenu.trigger]}
                />
            )}
            {tradeContextMenu && (
                <ContextMenu
                    variant={isLightSkin ? "mt5-light" : "mt5-dark"}
                    items={buildTradeContextMenuItems(tradeContextMenu.position)}
                    position={{ x: tradeContextMenu.x, y: tradeContextMenu.y }}
                    onClose={() => setTradeContextMenu(null)}
                />
            )}
            {/* Modify Position Dialog */}
            <RetainedLazyFeature active={modifyPosition !== null}>
            <ModifyPositionDialog
                isOpen={modifyPosition !== null}
                kind={modifyPositionContext?.kind ?? 'position'}
                onClosePosition={(id) => onClosePosition(id)}
                onClose={(modifiedSl?: number, modifiedTp?: number, modifiedComment?: string) => {
                    const closingContext = modifyPositionContext;
                    const currentPosition = closingContext
                        ? useAppStore.getState().positions.find(position => (
                            position.id === Number(closingContext.position.id)
                            && normalizeTradeSymbol(position.symbol) === normalizeTradeSymbol(closingContext.position.symbol)
                        ))
                        : null;
                    // Capture modified values in local overrides while the backend refresh catches up.
                    if (
                        closingContext
                        && currentPosition
                        && closingContext.sessionScope === getCurrentBrokerAccountSessionScopeKey()
                        && modifiedSl !== undefined
                        && modifiedTp !== undefined
                    ) {
                        setTradeOverrides(prev => ({
                            ...prev,
                            [closingContext.position.id]: { sl: modifiedSl, tp: modifiedTp, comment: modifiedComment ?? '' }
                        }));
                    }
                    setModifyPositionContext(current => current === closingContext ? null : current);
                }}
                position={modifyPosition}
            />
            </RetainedLazyFeature>
        </div>
    );
});
