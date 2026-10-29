import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getStoredAccountLogin } from '../../../api/tradeGateway';
import { ContextMenu, type ContextMenuItemConfig } from '../../../components/ui/ContextMenu';
import { Icon } from '../../../components/ui/Icon';
import { useUiTranslation } from '../../../hooks/useUiTranslation';
import { useDialogFocusScope } from '../../../hooks/useDialogFocusScope';
import { useChartSettingsStore } from '../../../store/useChartSettingsStore';
import { useAppStore, type Trade } from '../../../store/useAppStore';
import { formatPrice, resolveSpecDigits } from '../../../utils/symbolUtils';
import { resolveMarketWatchPriceDigits } from '../../../components/market-watch/marketWatchPanelModel';
import { safeReadBoolean, safeReadJson, safeReadString } from '../preferences';
import { escapeHtml } from '../reporting';
import { getCurrentBrokerAccountSessionScopeKey, normalizeTradeSymbol } from '../sessionScope';
import {
  createDefaultHistoryCustomPeriod,
  getHistoryPeriodStart,
  getHistoryRowTime,
  HISTORY_PERIOD_PRESETS,
  parseLocalDateBoundary,
  type HistoryCustomPeriod,
  type HistoryPeriodFilter,
} from './historyFilters';
import { useHistoryDataController } from './useHistoryDataController';
import { useHistoryVirtualWindow } from './useHistoryVirtualWindow';
import { calculateHistoryFinancialSummary } from './historyFinancialSummary';
import './history-summary.css';
import './history-status.css';
import {
  DEFAULT_HISTORY_COLUMNS,
  getHistoryStatusBadgeClass,
  HISTORY_AUTO_ARRANGE_STORAGE_KEY,
  HISTORY_COLUMN_DEFS,
  HISTORY_COLUMN_STORAGE_KEY,
  HISTORY_GRID_STORAGE_KEY,
  HISTORY_SHOW_MILLISECONDS_STORAGE_KEY,
  HISTORY_SHOW_ON_CHARTS_AUTO_UPDATE_STORAGE_KEY,
  HISTORY_VOLUME_MODE_STORAGE_KEY,
  resolveHistoryRowStatus,
  type HistoryColumnKey,
  type HistoryColumnVisibility,
  type HistoryContextMenuState,
  type HistorySymbolFilter,
  type HistoryViewMode,
  type HistoryVolumeMode,
} from './historyTabModel';

type HistoryTabProps = {
    formatMoney: (value: number | undefined | null) => string;
    instrumentCatalog?: readonly unknown[];
    accountBalance?: number | null;
};

export function HistoryTab({ formatMoney, instrumentCatalog = [], accountBalance = null }: HistoryTabProps) {
    const tr = useUiTranslation();
    const accountId = useAppStore((state) => state.accountId);
    const activeChartSymbol = useAppStore((state) => state.selectedSymbol);
    const activeLogin = Number.parseInt(String(accountId ?? getStoredAccountLogin() ?? ''), 10);
    const activeScopeKey = getCurrentBrokerAccountSessionScopeKey();
    const {
        historyData,
        historyLoadedAt,
        loading,
        ordersPending,
        error,
        sessionResetVersion,
        fetchHistory,
        financialDealsAvailable,
        balanceHistory,
        balanceHistoryError,
    } = useHistoryDataController(activeLogin, activeScopeKey);
    const [historyView, setHistoryView] = useState<HistoryViewMode>('positions');
    const [periodFilter, setPeriodFilter] = useState<HistoryPeriodFilter>('all');
    const [symbolFilter, setSymbolFilter] = useState<HistorySymbolFilter>({ mode: 'all' });
    const [customPeriod, setCustomPeriod] = useState<HistoryCustomPeriod>(createDefaultHistoryCustomPeriod);
    const [customPeriodDraft, setCustomPeriodDraft] = useState<HistoryCustomPeriod>(createDefaultHistoryCustomPeriod);
    const [customPeriodDialogOpen, setCustomPeriodDialogOpen] = useState(false);
    const customPeriodDialogRef = useRef<HTMLFormElement>(null);
    useDialogFocusScope({
        isOpen: customPeriodDialogOpen,
        dialogRef: customPeriodDialogRef,
        onClose: () => setCustomPeriodDialogOpen(false),
    });
    const [customPeriodError, setCustomPeriodError] = useState<string | null>(null);
    const [historyContextMenu, setHistoryContextMenu] = useState<HistoryContextMenuState | null>(null);
    const [selectedTradeKey, setSelectedTradeKey] = useState<string | null>(null);
    const [columnVisibility, setColumnVisibility] = useState<HistoryColumnVisibility>(() => (
        safeReadJson(HISTORY_COLUMN_STORAGE_KEY, DEFAULT_HISTORY_COLUMNS)
    ));
    const [volumeMode, setVolumeMode] = useState<HistoryVolumeMode>(() => (
        safeReadString(HISTORY_VOLUME_MODE_STORAGE_KEY, ['lots', 'amounts'] as const, 'lots')
    ));
    const [showMilliseconds, setShowMilliseconds] = useState(() => (
        safeReadBoolean(HISTORY_SHOW_MILLISECONDS_STORAGE_KEY, false)
    ));
    const [autoArrange, setAutoArrange] = useState(() => (
        safeReadBoolean(HISTORY_AUTO_ARRANGE_STORAGE_KEY, true)
    ));
    const [showGrid, setShowGrid] = useState(() => (
        safeReadBoolean(HISTORY_GRID_STORAGE_KEY, true)
    ));
    const [showOnChartsAutoUpdate, setShowOnChartsAutoUpdate] = useState(() => (
        safeReadBoolean(HISTORY_SHOW_ON_CHARTS_AUTO_UPDATE_STORAGE_KEY, true)
    ));
    const [isLightSkin, setIsLightSkin] = useState(false);
    const [filterNow, setFilterNow] = useState(Date.now);
    useEffect(() => {
        if (periodFilter === 'all' || periodFilter === 'custom') return;
        const timer = window.setInterval(() => setFilterNow(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, [periodFilter]);
    const selectPeriod = useCallback((period: HistoryPeriodFilter) => {
        setFilterNow(Date.now());
        setPeriodFilter(period);
    }, []);
    const periodRange = useMemo(() => {
        const now = Math.max(filterNow, historyLoadedAt);
        return {
            start: periodFilter === 'custom' ? parseLocalDateBoundary(customPeriod.from, false)
                : getHistoryPeriodStart(periodFilter, now),
            end: periodFilter === 'custom' ? parseLocalDateBoundary(customPeriod.to, true) : now,
        };
    }, [customPeriod, filterNow, historyLoadedAt, periodFilter]);

    useEffect(() => {
        if (sessionResetVersion === 0) return;
        // A broker-session reset intentionally resets all locally selected History controls.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setHistoryContextMenu(null);
        setSelectedTradeKey(null);
        setHistoryView('positions');
        setSymbolFilter({ mode: 'all' });
        setPeriodFilter('all');
    }, [sessionResetVersion]);
    useEffect(() => {
        const root = document.documentElement;
        const check = () => setIsLightSkin(root.classList.contains('rtx-skin-untitled-light'));
        check();
        const observer = new MutationObserver(check);
        observer.observe(root, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        window.localStorage.setItem(HISTORY_COLUMN_STORAGE_KEY, JSON.stringify(columnVisibility));
    }, [columnVisibility]);
    useEffect(() => {
        window.localStorage.setItem(HISTORY_VOLUME_MODE_STORAGE_KEY, volumeMode);
    }, [volumeMode]);
    useEffect(() => {
        window.localStorage.setItem(HISTORY_SHOW_MILLISECONDS_STORAGE_KEY, String(showMilliseconds));
    }, [showMilliseconds]);
    useEffect(() => {
        window.localStorage.setItem(HISTORY_AUTO_ARRANGE_STORAGE_KEY, String(autoArrange));
    }, [autoArrange]);
    useEffect(() => {
        window.localStorage.setItem(HISTORY_GRID_STORAGE_KEY, String(showGrid));
    }, [showGrid]);
    useEffect(() => {
        window.localStorage.setItem(HISTORY_SHOW_ON_CHARTS_AUTO_UPDATE_STORAGE_KEY, String(showOnChartsAutoUpdate));
    }, [showOnChartsAutoUpdate]);

    const historyRows = useMemo(() => {
        const rows = historyView === 'positions'
            ? historyData.positions
            : historyView === 'deals'
                ? historyData.deals
                : historyView === 'orders'
                    ? historyData.orders
                    : [...historyData.orders, ...historyData.deals];
        return [...rows].sort((left, right) => getHistoryRowTime(right) - getHistoryRowTime(left));
    }, [historyData, historyView]);

    const availableSymbols = useMemo(() => {
        const symbols = new Map<string, string>();
        [...historyData.positions, ...historyData.deals, ...historyData.orders].forEach((trade) => {
            const display = String(trade.symbol ?? '').trim();
            const normalized = normalizeTradeSymbol(display);
            if (normalized && !symbols.has(normalized)) symbols.set(normalized, display || normalized);
        });
        return Array.from(symbols.entries())
            .sort((left, right) => left[0].localeCompare(right[0]))
            .map(([normalized, display]) => ({ normalized, display }));
    }, [historyData]);

    const { contractSizeBySymbol, digitsBySymbol } = useMemo(() => {
        const sizes = new Map<string, number>();
        const digitsMap = new Map<string, number>();
        instrumentCatalog.forEach((instrument) => {
            if (!instrument || typeof instrument !== 'object') return;
            const record = instrument as Record<string, unknown>;
            const specification = record.brokerSpecification && typeof record.brokerSpecification === 'object'
                ? record.brokerSpecification as Record<string, unknown>
                : {};
            const symbol = normalizeTradeSymbol(record.symbol ?? record.name ?? specification.symbol);
            const size = Number(record.contractSize ?? record.contract_size ?? specification.contract_size ?? specification.contractSize);
            if (symbol && Number.isFinite(size) && size > 0) sizes.set(symbol, size);
            const resolvedDigits = resolveSpecDigits(record.digits, specification.digits);
            if (symbol && resolvedDigits !== null && !digitsMap.has(symbol)) {
                digitsMap.set(symbol, resolvedDigits);
            }
        });
        return { contractSizeBySymbol: sizes, digitsBySymbol: digitsMap };
    }, [instrumentCatalog]);

    const currentSymbol = normalizeTradeSymbol(activeChartSymbol);
    const matchesCurrentHistoryFilters = useCallback((trade: Trade) => {
        const { start, end } = periodRange;
        const selectedSymbol = symbolFilter.mode === 'current'
            ? currentSymbol
            : symbolFilter.mode === 'symbol'
                ? normalizeTradeSymbol(symbolFilter.symbol)
                : '';
        const rowSymbol = normalizeTradeSymbol(trade.symbol);
        if (symbolFilter.mode !== 'all' && (!selectedSymbol || rowSymbol !== selectedSymbol)) return false;
        const openTime = Date.parse(trade.openTime || '');
        const closeTime = Date.parse(trade.closeTime || '');
        const isOrderRow = historyView === 'orders' || (historyView === 'orders-and-deals' && trade.historySource === 'order');
        const rowTimes = isOrderRow
            ? [openTime]
            : historyView === 'positions'
                ? [openTime, closeTime]
                : [closeTime, openTime];
        const validRowTimes = rowTimes.filter(time => Number.isFinite(time));
        if (periodFilter === 'custom') {
            return start !== null
                && end !== null
                && validRowTimes.some(time => time >= start && time <= end);
        }
        return start === null || validRowTimes.some(time => time >= start && end !== null && time <= end);
    }, [currentSymbol, historyView, periodFilter, periodRange, symbolFilter]);
    const filteredOrders = useMemo(
        () => historyRows.filter(matchesCurrentHistoryFilters),
        [historyRows, matchesCurrentHistoryFilters],
    );
    const filteredPositionHistory = useMemo(
        () => historyData.positions.filter(matchesCurrentHistoryFilters),
        [historyData.positions, matchesCurrentHistoryFilters],
    );

    const financialSummary = useMemo(() => {
        const { start, end } = periodRange;
        const inPeriod = (time: number | null) => periodFilter === 'all' || (
            time !== null && end !== null && (start === null || time >= start) && time <= end
        );
        const selectedSymbol = symbolFilter.mode === 'current' ? currentSymbol
            : symbolFilter.mode === 'symbol' ? normalizeTradeSymbol(symbolFilter.symbol) : '';
        // Execution time governs financial totals in every table view. Position
        // aggregates and orders never contribute again to the deal totals.
        const dealTimesAvailable = periodFilter === 'all' || historyData.deals.every(deal => getHistoryRowTime(deal) > 0);
        const deals = financialDealsAvailable && dealTimesAvailable ? historyData.deals.filter(deal => (
            inPeriod(getHistoryRowTime(deal) || null)
            && (symbolFilter.mode === 'all' || normalizeTradeSymbol(deal.symbol) === selectedSymbol)
        )) : null;
        // Cash movements have no instrument; filter them by period only.
        const cashTimesAvailable = periodFilter === 'all' || balanceHistory?.every(operation => operation.time !== null);
        const operations = cashTimesAvailable ? balanceHistory?.filter(operation => inPeriod(operation.time)) ?? null : null;
        return calculateHistoryFinancialSummary(deals, operations);
    }, [balanceHistory, currentSymbol, financialDealsAvailable, historyData.deals, periodFilter, periodRange, symbolFilter]);

    const viewError = historyView === 'positions'
        ? historyData.errors.positions
        : historyView === 'deals'
            ? historyData.errors.deals
            : historyView === 'orders'
                ? historyData.errors.orders
                : [historyData.errors.orders, historyData.errors.deals].filter(Boolean).join(' · ') || null;
    const displayError = error ?? viewError;

    const getTradeKey = (trade: Trade) => [
        trade.historySource ?? trade.type,
        trade.positionId ?? '',
        trade.dealTicket ?? trade.orderTicket ?? trade.id,
        trade.openTime,
        trade.closeTime ?? '',
    ].join(':');

    useEffect(() => {
        if (!selectedTradeKey) return;
        if (!filteredOrders.some(order => getTradeKey(order) === selectedTradeKey)) {
            // The selected row disappeared from the externally refreshed history result.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSelectedTradeKey(null);
            setHistoryContextMenu(null);
        }
    }, [filteredOrders, selectedTradeKey]);

    const formatTs = (value?: string) => {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        const pad = (number: number, length = 2) => String(number).padStart(length, '0');
        const milliseconds = showMilliseconds ? `.${pad(date.getMilliseconds(), 3)}` : '';
        return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${milliseconds}`;
    };

    // Spec digits only (broker catalog, registered spec, then live tick); unknown renders raw (never guessed).
    const lookupHistoryTickDigits = (symbol: string, observedPrice?: number): number | null => {
        const normalized = normalizeTradeSymbol(symbol);
        const ticks = (useAppStore.getState().ticks ?? {}) as Record<string, { digits?: unknown } | undefined>;
        const tick = ticks[symbol] ?? ticks[normalized];
        return resolveMarketWatchPriceDigits(
            normalized || symbol,
            digitsBySymbol.get(normalized),
            tick?.digits,
            observedPrice,
        );
    };

    const formatPriceCell = (value: number | undefined, symbol: string) => {
        const price = Number(value);
        if (!Number.isFinite(price) || price <= 0) return '-';
        const digits = lookupHistoryTickDigits(symbol, price);
        return digits !== null
            ? formatPrice(price, digits)
            : formatPrice(Number(price.toFixed(8)), undefined);
    };

    const formatLevelCell = (value: number | undefined, symbol: string) => {
        const price = Number(value);
        if (!Number.isFinite(price) || price <= 0) return '0.00';
        const digits = lookupHistoryTickDigits(symbol, price);
        return digits !== null
            ? formatPrice(price, digits)
            : formatPrice(Number(price.toFixed(8)), undefined);
    };

    const moneyColor = (value: number | undefined | null) => {
        const numeric = Number(value ?? 0);
        if (numeric > 0) return 'text-profit';
        if (numeric < 0) return 'text-loss';
        return 'text-zinc-100';
    };

    const isColumnVisible = (key: HistoryColumnKey) => columnVisibility[key] !== false;
    const visibleColumnCount = 10 + HISTORY_COLUMN_DEFS.filter(column => isColumnVisible(column.key)).length;
    const summaryTrailingColumns = 1 + ['commission', 'swap', 'fee', 'changePercent', 'magicNumber', 'comment']
        .filter(key => isColumnVisible(key as HistoryColumnKey)).length;
    const formatSummaryMoney = (value: number | null) => value === null || !Number.isFinite(value) ? '—' : formatMoney(value);
    const toggleColumn = (key: HistoryColumnKey) => {
        setColumnVisibility(current => ({ ...current, [key]: current[key] === false }));
    };

    const getHistoryTicket = (trade: Trade): number | string => {
        if (historyView === 'positions') return trade.positionId ?? trade.id ?? '-';
        if (trade.historySource === 'deal') return trade.dealTicket ?? trade.id ?? '-';
        if (trade.historySource === 'order') return trade.orderTicket ?? trade.id ?? '-';
        return trade.id ?? '-';
    };

    const getHistoryContractSize = (trade: Trade): number | null => {
        const explicit = Number(trade.contractSize);
        if (Number.isFinite(explicit) && explicit > 0) return explicit;
        return contractSizeBySymbol.get(normalizeTradeSymbol(trade.symbol)) ?? null;
    };

    const numberFormatters = useMemo(() => ({
        lots: new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 }),
        money: new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        amount: new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
    }), []);
    const formatGroupedNumber = (value: number, minimumFractionDigits = 0, maximumFractionDigits = 2): string => (
        (maximumFractionDigits === 8 ? numberFormatters.lots
            : minimumFractionDigits === 2 ? numberFormatters.money : numberFormatters.amount)
            .format(value).replace(/,/g, ' ')
    );

    const formatHistoryVolume = (trade: Trade): string => {
        const lots = Number(trade.volume);
        if (!Number.isFinite(lots)) return '-';
        if (volumeMode === 'lots') return formatGroupedNumber(lots, 2, 8);
        const contractSize = getHistoryContractSize(trade);
        return contractSize === null ? '\u2014' : formatGroupedNumber(lots * contractSize, 0, 2);
    };

    const getHistoryMarketValue = (trade: Trade): number | null => {
        const price = Number(trade.openPrice);
        const lots = Number(trade.volume);
        const contractSize = getHistoryContractSize(trade);
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(lots) || contractSize === null) return null;
        const value = price * lots * contractSize;
        return Number.isFinite(value) ? value : null;
    };

    const getHistoryChangePercent = (trade: Trade): number | null => {
        const openPrice = Number(trade.openPrice);
        const closePrice = Number(trade.closePrice);
        if (!Number.isFinite(openPrice) || !Number.isFinite(closePrice) || openPrice <= 0 || closePrice <= 0) return null;
        const value = ((closePrice - openPrice) / openPrice) * 100;
        return Number.isFinite(value) ? value : null;
    };

    const formatHistoryPercent = (trade: Trade): string => {
        const value = getHistoryChangePercent(trade);
        return value === null ? '\u2014' : `${value.toFixed(2)} %`;
    };

    const getHistoryRowSymbol = (trade?: Trade): string => {
        const rowSymbol = String(trade?.symbol ?? '').trim();
        if (trade) return rowSymbol;
        if (symbolFilter.mode === 'symbol') return symbolFilter.symbol;
        if (symbolFilter.mode === 'current') return activeChartSymbol;
        return activeChartSymbol || availableSymbols[0]?.display || '';
    };

    const openCustomPeriodDialog = () => {
        setCustomPeriodDraft(customPeriod);
        setCustomPeriodError(null);
        setCustomPeriodDialogOpen(true);
    };

    const applyCustomPeriod = () => {
        const start = parseLocalDateBoundary(customPeriodDraft.from, false);
        const end = parseLocalDateBoundary(customPeriodDraft.to, true);
        if (start === null || end === null || start > end) {
            setCustomPeriodError('Choose a valid date range');
            return;
        }
        setCustomPeriod(customPeriodDraft);
        setPeriodFilter('custom');
        setCustomPeriodDialogOpen(false);
        setCustomPeriodError(null);
    };

    const historyViewLabel = historyView === 'positions'
        ? 'Positions'
        : historyView === 'deals'
            ? 'Deals'
            : historyView === 'orders'
                ? 'Orders'
                : 'Orders & Deals';

    const periodFilterLabel = periodFilter === 'custom' ? `${customPeriod.from} - ${customPeriod.to}`
        : HISTORY_PERIOD_PRESETS.find(([period]) => period === periodFilter)![1];

    const symbolFilterLabel = symbolFilter.mode === 'all'
        ? 'All Symbols'
        : symbolFilter.mode === 'current'
            ? (currentSymbol || 'Current Symbol')
            : symbolFilter.symbol;

    const downloadTextFile = (content: string, filename: string, type: string) => {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    };

    const getHistoryReportColumns = () => [
        { label: 'Time', value: (trade: Trade): string | number => formatTs(trade.openTime) },
        { label: 'Symbol', value: (trade: Trade): string | number => trade.symbol || '-' },
        ...(isColumnVisible('ticket') ? [{ label: 'Ticket', value: (trade: Trade): string | number => getHistoryTicket(trade) }] : []),
        { label: 'Type', value: (trade: Trade): string | number => String(trade.orderType || trade.side || trade.type || '-').toLowerCase() },
        { label: 'Volume', value: (trade: Trade): string | number => formatHistoryVolume(trade) },
        { label: 'Price', value: (trade: Trade): string | number => formatPriceCell(trade.openPrice, trade.symbol) },
        { label: 'S/L', value: (trade: Trade): string | number => formatLevelCell(trade.sl, trade.symbol) },
        { label: 'T/P', value: (trade: Trade): string | number => formatLevelCell(trade.tp, trade.symbol) },
        { label: 'Time', value: (trade: Trade): string | number => formatTs(trade.closeTime) },
        { label: 'Price', value: (trade: Trade): string | number => formatPriceCell(trade.closePrice, trade.symbol) },
        ...(isColumnVisible('marketValue') ? [{ label: 'Market Value', value: (trade: Trade): string | number => {
            const value = getHistoryMarketValue(trade);
            return value === null ? '\u2014' : formatGroupedNumber(value, 2, 2);
        } }] : []),
        ...(isColumnVisible('commission') ? [{ label: 'Commission', value: (trade: Trade): string | number => formatMoney(trade.commission) }] : []),
        ...(isColumnVisible('swap') ? [{ label: 'Swap', value: (trade: Trade): string | number => formatMoney(trade.swap) }] : []),
        ...(isColumnVisible('fee') ? [{ label: 'Fee', value: (trade: Trade): string | number => formatMoney(trade.fee) }] : []),
        { label: 'Profit', value: (trade: Trade): string | number => formatMoney(trade.profit) },
        ...(isColumnVisible('changePercent') ? [{ label: 'Change %', value: (trade: Trade): string | number => formatHistoryPercent(trade) }] : []),
        ...(isColumnVisible('magicNumber') ? [{ label: 'Magic Number', value: (trade: Trade): string | number => trade.magicNumber ?? '-' }] : []),
        ...(isColumnVisible('comment') ? [{ label: 'Comment', value: (trade: Trade): string | number => trade.comment || '-' }] : []),
    ];

    const buildHistoryReportHtml = (title: string) => {
        const columns = getHistoryReportColumns();
        const header = columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join('');
        const body = filteredOrders.map(order => (
            `<tr>${columns.map(column => `<td>${escapeHtml(column.value(order))}</td>`).join('')}</tr>`
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
<div class="summary">${escapeHtml(title)} - ${filteredOrders.length} record(s)</div>
<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>
</body>
</html>`;
    };

    const openHistoryOverview = () => {
        const url = URL.createObjectURL(new Blob([buildHistoryReportHtml('History Overview')], { type: 'text/html' }));
        window.open(url, '_blank', 'noopener,noreferrer');
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    };

    const downloadHistoryHtml = () => {
        downloadTextFile(buildHistoryReportHtml('History Report'), 'history-report.html', 'text/html');
    };

    const downloadHistoryXml = () => {
        const columns = getHistoryReportColumns();
        const rows = filteredOrders.map(order => (
            `<Row>${columns.map(column => `<Cell><Data ss:Type="String">${escapeHtml(column.value(order))}</Data></Cell>`).join('')}</Row>`
        )).join('');
        const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="History">
<Table>
<Row>${columns.map(column => `<Cell><Data ss:Type="String">${escapeHtml(column.label)}</Data></Cell>`).join('')}</Row>
${rows}
</Table>
</Worksheet>
</Workbook>`;
        downloadTextFile(xml, 'history-report.xml', 'application/vnd.ms-excel');
    };

    const setTradeHistoryForSymbol = (symbol: string, visible: boolean) => {
        if (!symbol) return;
        const store = useChartSettingsStore.getState();
        store.updateSymbolProperty(symbol, 'showTradeHistory', visible);
        store.updateSymbolProperty(symbol, 'showTradeHistoryArrows', visible);
        window.dispatchEvent(new CustomEvent(visible ? 'rtx:refresh-trade-overlay' : 'rtx:flush-trade-overlay', { detail: { symbol } }));
    };

    const deleteAllTradeHistoryFromCharts = () => {
        const store = useChartSettingsStore.getState();
        store.updateGlobalProperty('showTradeHistory', false);
        store.updateGlobalProperty('showTradeHistoryArrows', false);
        const symbols = new Set([
            ...Object.keys(store.symbolProperties),
            ...availableSymbols.map(({ display }) => display),
        ]);
        symbols.forEach(symbol => {
            store.updateSymbolProperty(symbol, 'showTradeHistory', false);
            store.updateSymbolProperty(symbol, 'showTradeHistoryArrows', false);
        });
        setShowOnChartsAutoUpdate(false);
        window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
    };

    const enableTradeHistoryAutoUpdate = () => {
        const store = useChartSettingsStore.getState();
        store.updateGlobalProperty('showTradeHistory', true);
        store.updateGlobalProperty('showTradeHistoryArrows', true);
        filteredPositionHistory.forEach(order => {
            const symbol = String(order.symbol ?? '').trim();
            if (!symbol) return;
            store.updateSymbolProperty(symbol, 'showTradeHistory', true);
            store.updateSymbolProperty(symbol, 'showTradeHistoryArrows', true);
        });
        setShowOnChartsAutoUpdate(true);
        window.dispatchEvent(new CustomEvent('rtx:refresh-trade-overlay'));
    };

    useEffect(() => {
        if (!showOnChartsAutoUpdate || filteredPositionHistory.length === 0) return;
        const symbols = Array.from(new Set(
            filteredPositionHistory.map(order => String(order.symbol ?? '').trim()).filter(Boolean),
        ));
        const needsChartHistory = symbols.some(symbol => {
            const store = useChartSettingsStore.getState();
            const properties = store.symbolProperties[symbol] ?? store.globalProperties;
            return properties.showTradeHistory !== true || properties.showTradeHistoryArrows !== true;
        });
        // Opening History must not redraw the chart when entry and close
        // markers are already enabled for these symbols.
        if (!needsChartHistory) return;
        const frame = window.requestAnimationFrame(() => {
            const store = useChartSettingsStore.getState();
            symbols.forEach(symbol => {
                const properties = store.symbolProperties[symbol] ?? store.globalProperties;
                if (properties.showTradeHistory !== true) store.updateSymbolProperty(symbol, 'showTradeHistory', true);
                if (properties.showTradeHistoryArrows !== true) store.updateSymbolProperty(symbol, 'showTradeHistoryArrows', true);
            });
            window.dispatchEvent(new CustomEvent('rtx:refresh-trade-overlay'));
        });
        return () => window.cancelAnimationFrame(frame);
    }, [filteredPositionHistory, showOnChartsAutoUpdate]);

    const buildHistoryContextMenuItems = (trade?: Trade): ContextMenuItemConfig[] => {
        const symbol = getHistoryRowSymbol(trade);
        const symbolsSubmenu: ContextMenuItemConfig[] = [
            { label: 'All Symbols', checked: symbolFilter.mode === 'all', action: () => setSymbolFilter({ mode: 'all' }) },
            {
                label: 'Current Symbol',
                checked: symbolFilter.mode === 'current',
                disabled: !currentSymbol,
                action: () => setSymbolFilter({ mode: 'current' }),
            },
            { divider: true },
            ...availableSymbols.map(({ normalized, display }) => ({
                label: display,
                checked: symbolFilter.mode === 'symbol' && normalizeTradeSymbol(symbolFilter.symbol) === normalized,
                action: () => setSymbolFilter({ mode: 'symbol', symbol: display }),
            })),
        ];
        return [
            {
                label: 'New Order',
                shortcut: 'F9',
                icon: <Icon name="plus" size="xs" />,
                disabled: !symbol,
                action: () => window.dispatchEvent(new CustomEvent('openOrderDialog', { detail: { symbol } })),
            },
            { label: 'Positions', checked: historyView === 'positions', action: () => setHistoryView('positions') },
            { label: 'Deals', checked: historyView === 'deals', action: () => setHistoryView('deals') },
            { label: 'Orders', checked: historyView === 'orders', action: () => setHistoryView('orders') },
            { label: 'Orders & Deals', checked: historyView === 'orders-and-deals', action: () => setHistoryView('orders-and-deals') },
            { divider: true },
            { label: 'Symbols', submenu: symbolsSubmenu },
            {
                label: 'Volumes',
                submenu: [
                    { label: 'Lots', checked: volumeMode === 'lots', action: () => setVolumeMode('lots'), autoClose: false },
                    { label: 'Amounts', checked: volumeMode === 'amounts', action: () => setVolumeMode('amounts'), autoClose: false },
                ],
            },
            { divider: true },
            ...HISTORY_PERIOD_PRESETS.map(([period, label]) => ({
                label, checked: periodFilter === period, action: () => selectPeriod(period),
            })),
            {
                label: 'Custom Period',
                checked: periodFilter === 'custom',
                icon: <Icon name="settings" size="xs" />,
                action: openCustomPeriodDialog,
            },
            { divider: true },
            {
                label: 'Report',
                submenu: [
                    { label: 'Overview', shortcut: 'Alt+E', action: openHistoryOverview },
                    { label: 'Open XML (MS Office Excel 2007)', action: downloadHistoryXml },
                    { label: 'HTML (Internet Explorer)', action: downloadHistoryHtml },
                ],
            },
            {
                label: 'Show on Charts',
                submenu: [
                    { label: `Add ${symbol} Deals`, disabled: !symbol, action: () => setTradeHistoryForSymbol(symbol, true) },
                    { label: 'Delete All Deals', action: deleteAllTradeHistoryFromCharts },
                    {
                        label: 'Auto Update',
                        checked: showOnChartsAutoUpdate,
                        action: () => {
                            if (showOnChartsAutoUpdate) deleteAllTradeHistoryFromCharts();
                            else enableTradeHistoryAutoUpdate();
                        },
                        autoClose: false,
                    },
                ],
            },
            { label: 'Register as Signal', disabled: true },
            { divider: true },
            {
                label: 'Show Milliseconds',
                checked: showMilliseconds,
                action: () => setShowMilliseconds(current => !current),
                autoClose: false,
            },
            {
                label: 'Auto Arrange',
                checked: autoArrange,
                shortcut: 'A',
                action: () => setAutoArrange(current => !current),
                autoClose: false,
            },
            {
                label: 'Grid',
                checked: showGrid,
                shortcut: 'G',
                action: () => setShowGrid(current => !current),
                autoClose: false,
            },
            { divider: true },
            {
                label: 'Columns',
                submenu: HISTORY_COLUMN_DEFS.map(column => ({
                    label: column.label,
                    checked: isColumnVisible(column.key),
                    action: () => toggleColumn(column.key),
                    autoClose: false,
                })),
            },
        ];
    };

    const handleHistoryContextMenu = (event: React.MouseEvent<HTMLElement>, trade?: Trade) => {
        event.preventDefault();
        event.stopPropagation();
        if (trade) setSelectedTradeKey(getTradeKey(trade));
        setHistoryContextMenu({ x: event.clientX, y: event.clientY, ...(trade ? { trade } : {}) });
    };

    const historyViewportReset = useMemo(() => ({ historyView, periodFilter, symbolFilter, customPeriod, activeScopeKey, activeLogin }),
        [historyView, periodFilter, symbolFilter, customPeriod, activeScopeKey, activeLogin]);
    const { scrollRef: historyScrollRef, window: historyVirtualWindow, onScroll: syncHistoryViewport }
        = useHistoryVirtualWindow(filteredOrders.length, historyViewportReset);
    const visibleHistoryOrders = filteredOrders.slice(historyVirtualWindow.startIndex, historyVirtualWindow.endIndex);
    const historyRowsLoading = filteredOrders.length === 0 && (
        loading || (ordersPending && (historyView === 'orders' || historyView === 'orders-and-deals'))
    );

    const headerDividerClass = '';
    const cellDividerClass = '';
    const rowDividerClass = 'divide-y divide-zinc-800/90';

    return (
        <div className="rtx-history-tab h-full flex flex-col relative bg-[#131316] overflow-hidden">
            <div className="rtx-history-toolbar flex h-7 min-h-[28px] flex-nowrap items-center justify-between gap-1.5 px-1.5 py-0 border-b border-zinc-700 bg-[#191a1e] shrink-0 text-[11.5px] font-normal text-zinc-300 tabular-nums">
                <div className="rtx-history-toolbar__periods flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto whitespace-nowrap" role="group" aria-label={tr('History time filters')}>
                    {HISTORY_PERIOD_PRESETS.map(([period, label]) => (
                        <button
                            key={period}
                            type="button"
                            aria-pressed={periodFilter === period}
                            onClick={() => selectPeriod(period)}
                            className={`rtx-history-time-btn shrink-0 px-1.5 py-0.5 text-[11.5px] leading-[16px] font-normal rounded-sm transition-colors ${periodFilter === period ? 'bg-zinc-700/70 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                        >
                            {tr(label)}
                        </button>
                    ))}
                    <button
                        type="button"
                        aria-pressed={periodFilter === 'custom'}
                        onClick={openCustomPeriodDialog}
                        className={`rtx-history-time-btn shrink-0 px-1.5 py-0.5 text-[11.5px] leading-[16px] font-normal rounded-sm transition-colors ${periodFilter === 'custom' ? 'bg-zinc-700/70 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                    >
                        {tr('Custom Period')}
                    </button>
                </div>
                <div className="rtx-history-toolbar__meta flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                    <span className="hidden shrink-0 text-[11.5px] font-normal text-zinc-500 lg:inline">{tr(historyViewLabel)} · {tr(symbolFilterLabel)} · {tr(periodFilterLabel)}</span>
                    <span className="shrink-0 whitespace-nowrap text-[11.5px] font-normal text-zinc-500">{filteredOrders.length} {tr(" records")}</span>
                    <button
                        type="button"
                        onClick={() => fetchHistory({ force: true })}
                        disabled={loading}
                        className="rtx-history-refresh-btn shrink-0 text-[11.5px] leading-[16px] font-normal px-1.5 py-0.5 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center gap-1 disabled:cursor-wait disabled:opacity-50"
                    >
                        <Icon name="refresh" size="xs" className={loading ? 'animate-spin' : ''} />
                        {loading ? tr("Loading…") : tr("Refresh")}
                    </button>
                </div>
            </div>

            {displayError && filteredOrders.length > 0 && (
                <div
                    role="status"
                    className="rtx-history-status-warning shrink-0 border-b border-amber-700/50 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-300"
                >
                    {tr('Partial history data')}: {displayError}
                </div>
            )}

            <div
                ref={historyScrollRef}
                className="rtx-trade-scroll flex-1 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700"
                aria-label={tr('History records')}
                onScroll={syncHistoryViewport}
                onContextMenu={(event) => handleHistoryContextMenu(event)}
            >
                <table
                    className="rtx-trade-table rtx-history-table w-full text-center border-collapse"
                    aria-rowcount={filteredOrders.length + 2}
                    data-auto-arrange={autoArrange ? 'true' : 'false'}
                    data-grid={showGrid ? 'true' : 'false'}
                    style={{
                        fontFamily: '"Segoe UI", Tahoma, Arial, sans-serif',
                        fontVariantNumeric: 'tabular-nums',
                        tableLayout: autoArrange ? 'auto' : 'fixed',
                    }}
                >
                    <thead className="rtx-trade-table__head sticky top-0 bg-[#17181c] text-[#c9cfdb] z-10 font-normal text-[12px] leading-[18px] uppercase border-y border-zinc-700/70 select-none shadow-[0_1px_0_0_rgba(255,255,255,0.04)]">
                        <tr className="h-[30px]">
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-28`}>{tr("Time")}</th>
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-20`}>{tr("Symbol")}</th>
                            {isColumnVisible('ticket') && <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-20`}>{tr("Ticket")}</th>}
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-14`}>{tr("Type")}</th>
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-16`}>{tr(volumeMode === 'lots' ? "Volume" : "Amount")}</th>
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-22`}>{tr("Price")}</th>
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-20`}>S/L</th>
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-20`}>T/P</th>
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-28`}>{tr("Time")}</th>
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-22`}>{tr("Price")}</th>
                            {isColumnVisible('status') && <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-22`}>{tr("Status")}</th>}
                            {isColumnVisible('marketValue') && <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-24`}>{tr("Market Value")}</th>}
                            {isColumnVisible('commission') && <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-20`}>{tr("Commission")}</th>}
                            {isColumnVisible('swap') && <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-20`}>{tr("Swap")}</th>}
                            {isColumnVisible('fee') && <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-20`}>{tr("Fee")}</th>}
                            <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-20`}>{tr("Profit")}</th>
                            {isColumnVisible('changePercent') && <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-20`}>{tr("Change %")}</th>}
                            {isColumnVisible('magicNumber') && <th className={`px-1.5 py-[3px] text-center ${headerDividerClass} w-24`}>{tr("Magic Number")}</th>}
                            {isColumnVisible('comment') && <th className="px-1.5 py-[3px] text-center w-28">{tr("Comment")}</th>}
                        </tr>
                    </thead>
                    <tbody className={`${rowDividerClass} text-[#d8dde8] text-[13px] leading-[19.5px] font-normal`}>
                        {filteredOrders.length === 0 && (
                            <tr>
                                <td colSpan={Math.max(1, visibleColumnCount)} className="h-16 text-center text-zinc-600 text-xs italic">
                                    {historyRowsLoading ? tr("Loading trade history…") : displayError ? displayError : tr("No history records for the selected filters")}
                                </td>
                            </tr>
                        )}
                        {historyVirtualWindow.topSpacerHeight > 0 && (
                            <tr aria-hidden="true" className="rtx-history-spacer-row" style={{ height: historyVirtualWindow.topSpacerHeight }}>
                                <td colSpan={Math.max(1, visibleColumnCount)} style={{ height: historyVirtualWindow.topSpacerHeight, padding: 0, border: 0, lineHeight: 0 }} />
                            </tr>
                        )}
                        {visibleHistoryOrders.map((order, visibleIndex) => {
                            const index = historyVirtualWindow.startIndex + visibleIndex;
                            const sideLabel = String(order.orderType || order.side || order.type || '-').toLowerCase();
                            const tradeKey = getTradeKey(order);
                            const isSelected = tradeKey === selectedTradeKey;
                            const ticket = getHistoryTicket(order);
                            const volumeLabel = formatHistoryVolume(order);
                            const marketValue = getHistoryMarketValue(order);
                            const marketValueLabel = marketValue === null ? '\u2014' : formatGroupedNumber(marketValue, 2, 2);
                            const changePercent = getHistoryChangePercent(order);
                            const changePercentLabel = formatHistoryPercent(order);
                            const profitLabel = formatMoney(order.profit);
                            const rowStatus = resolveHistoryRowStatus(order);
                            const closePriceCellLabel = rowStatus !== 'FILLED' && !(Number(order.closePrice) > 0)
                                ? '—'
                                : formatPriceCell(order.closePrice, order.symbol);
                            return (
                                <tr
                                    key={`${tradeKey}-${index}`}
                                    aria-selected={isSelected}
                                    className={`rtx-trade-row rtx-history-row h-[30px] transition-colors cursor-default ${isSelected ? 'rtx-trade-row--selected' : ''}`}
                                    onClick={() => setSelectedTradeKey(tradeKey)}
                                    onContextMenu={(event) => handleHistoryContextMenu(event, order)}
                                >
                                    <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center text-zinc-100 tabular-nums whitespace-nowrap`} title={tr("Open time: {{value0}}", { value0: formatTs(order.openTime) })}>{formatTs(order.openTime)}</td>
                                    <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center font-normal text-zinc-100 whitespace-nowrap`} title={tr("Symbol: {{value0}}", { value0: order.symbol || '-' })}>{order.symbol || '-'}</td>
                                    {isColumnVisible('ticket') && <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center text-zinc-100 tabular-nums whitespace-nowrap`} title={tr("Ticket: {{value0}}", { value0: ticket })}>{ticket}</td>}
                                    <td className={`text-zinc-100 px-1.5 py-[2px] ${cellDividerClass} text-center font-normal text-[13px]`} title={tr("Type: {{value0}}", { value0: tr(sideLabel) })}>
                                        <div className="flex items-center justify-center"><span>{tr(sideLabel)}</span></div>
                                    </td>
                                    <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center font-normal text-zinc-100 tabular-nums`} title={tr(volumeMode === 'lots' ? "Volume: {{value0}}" : "Amount: {{value0}}", { value0: volumeLabel })}>{volumeLabel}</td>
                                    <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center text-zinc-100 tabular-nums`} title={tr("Open price: {{value0}}", { value0: formatPriceCell(order.openPrice, order.symbol) })}>{formatPriceCell(order.openPrice, order.symbol)}</td>
                                    <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center tabular-nums`} title={tr("Stop Loss: {{value0}}", { value0: formatLevelCell(order.sl, order.symbol) })}>
                                        <span className={(order.sl ?? 0) > 0 ? "text-[#ff7676] bg-red-950/20 px-1 rounded-sm font-normal" : "text-zinc-100 font-normal"}>{formatLevelCell(order.sl, order.symbol)}</span>
                                    </td>
                                    <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center tabular-nums`} title={tr("Take Profit: {{value0}}", { value0: formatLevelCell(order.tp, order.symbol) })}>
                                        <span className={(order.tp ?? 0) > 0 ? "rtx-history-tp-value text-profit px-1 rounded-sm font-normal" : "text-zinc-100 font-normal"}>{formatLevelCell(order.tp, order.symbol)}</span>
                                    </td>
                                    <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center text-zinc-100 tabular-nums whitespace-nowrap`} title={tr("Close time: {{value0}}", { value0: formatTs(order.closeTime) })}>{formatTs(order.closeTime)}</td>
                                    <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center text-zinc-100 tabular-nums`} title={tr("Close price: {{value0}}", { value0: closePriceCellLabel })}>{closePriceCellLabel}</td>
                                    {isColumnVisible('status') && (
                                        <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center whitespace-nowrap`} data-testid={`history-row-status-${order.id}`} title={tr("Status: {{value0}}", { value0: tr(rowStatus) })}>
                                            <span className={getHistoryStatusBadgeClass(rowStatus)}>{tr(rowStatus)}</span>
                                        </td>
                                    )}
                                    {isColumnVisible('marketValue') && <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center text-zinc-100 tabular-nums`} title={tr("Market Value: {{value0}}", { value0: marketValueLabel })}>{marketValueLabel}</td>}
                                    {isColumnVisible('commission') && <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center tabular-nums ${moneyColor(order.commission)}`} title={tr("Commission: {{value0}}", { value0: formatMoney(order.commission) })}>{formatMoney(order.commission)}</td>}
                                    {isColumnVisible('swap') && <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center tabular-nums ${moneyColor(order.swap)}`} title={tr("Swap: {{value0}}", { value0: formatMoney(order.swap) })}>{formatMoney(order.swap)}</td>}
                                    {isColumnVisible('fee') && <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center tabular-nums ${moneyColor(order.fee)}`} title={tr("Fee: {{value0}}", { value0: formatMoney(order.fee) })}>{formatMoney(order.fee)}</td>}
                                    <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center font-normal tabular-nums ${moneyColor(order.profit)}`} title={tr("Profit: {{value0}}", { value0: profitLabel })}>{profitLabel}</td>
                                    {isColumnVisible('changePercent') && <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center tabular-nums ${moneyColor(changePercent)}`} title={tr("Change %: {{value0}}", { value0: changePercentLabel })}>{changePercentLabel}</td>}
                                    {isColumnVisible('magicNumber') && <td className={`px-1.5 py-[2px] ${cellDividerClass} text-center text-zinc-100 tabular-nums`} title={tr("Magic Number: {{value0}}", { value0: order.magicNumber ?? '-' })}>{order.magicNumber ?? '-'}</td>}
                                    {isColumnVisible('comment') && <td className="px-1.5 py-[2px] text-center text-zinc-100 whitespace-nowrap" title={tr("Comment: {{value0}}", { value0: order.comment || '-' })}>{order.comment || '-'}</td>}
                                </tr>
                            );
                        })}
                        {historyVirtualWindow.bottomSpacerHeight > 0 && (
                            <tr aria-hidden="true" className="rtx-history-spacer-row" style={{ height: historyVirtualWindow.bottomSpacerHeight }}>
                                <td colSpan={Math.max(1, visibleColumnCount)} style={{ height: historyVirtualWindow.bottomSpacerHeight, padding: 0, border: 0, lineHeight: 0 }} />
                            </tr>
                        )}
                    </tbody>
                    <tfoot>
                        <tr className="rtx-history-summary-row" aria-rowindex={filteredOrders.length + 2}>
                            <td colSpan={visibleColumnCount - summaryTrailingColumns}>
                                <div role="group" aria-label={tr('History financial summary')} className="rtx-history-summary-values">
                                    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
                                        <circle cx="6" cy="6" r="4.5" stroke="currentColor" />
                                        <path d="M3.5 6h5" stroke="currentColor" />
                                    </svg>
                                    {([
                                        ['Profit', financialSummary.profit],
                                        ['Credit', financialSummary.credit],
                                        ['Deposit', financialSummary.deposit],
                                        ['Withdrawal', financialSummary.withdrawal],
                                        ['Balance', accountBalance],
                                    ] as const).map(([label, value]) => (
                                        <span key={label} className={label === 'Profit' ? moneyColor(value) : undefined} title={value === null ? (
                                            label === 'Balance' ? tr('Account balance unavailable')
                                                : label === 'Profit' ? tr('Complete backend deal history unavailable')
                                                    : balanceHistoryError ?? tr(balanceHistory === null ? 'Balance history loading' : 'Balance history timestamps unavailable')
                                        ) : undefined}>{tr(label)}: {formatSummaryMoney(value)}{' '}</span>
                                    ))}
                                </div>
                            </td>
                            {isColumnVisible('commission') && <td aria-label={tr('Total commission')}>{formatSummaryMoney(financialSummary.commission)}</td>}
                            {isColumnVisible('swap') && <td aria-label={tr('Total swap')}>{formatSummaryMoney(financialSummary.swap)}</td>}
                            {isColumnVisible('fee') && <td aria-label={tr('Total fee')}>{formatSummaryMoney(financialSummary.fee)}</td>}
                            <td className={moneyColor(financialSummary.grossProfit)} aria-label={tr('Total gross profit')}>{formatSummaryMoney(financialSummary.grossProfit)}</td>
                            {isColumnVisible('changePercent') && <td />}
                            {isColumnVisible('magicNumber') && <td />}
                            {isColumnVisible('comment') && <td />}
                        </tr>
                    </tfoot>
                </table>
            </div>

            {historyContextMenu && (
                <ContextMenu
                    variant={isLightSkin ? 'mt5-light' : 'mt5-dark'}
                    density="compact"
                    items={buildHistoryContextMenuItems(historyContextMenu.trade)}
                    position={{ x: historyContextMenu.x, y: historyContextMenu.y }}
                    onClose={() => setHistoryContextMenu(null)}
                />
            )}

            {customPeriodDialogOpen && (
                <div
                    className="rtx-history-period-backdrop fixed inset-0 z-[4100] flex items-center justify-center bg-black/45"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) setCustomPeriodDialogOpen(false);
                    }}
                >
                    <form
                        ref={customPeriodDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label={tr('Custom history period')}
                        tabIndex={-1}
                        className="rtx-history-period-dialog w-[360px] rounded-sm border border-zinc-600 bg-[#202126] p-4 text-[12px] text-zinc-200 shadow-2xl"
                        onSubmit={(event) => {
                            event.preventDefault();
                            applyCustomPeriod();
                        }}
                    >
                        <div className="mb-3 text-[13px] font-semibold">{tr('Custom Period')}</div>
                        <div className="grid grid-cols-2 gap-3">
                            <label className="flex flex-col gap-1">
                                <span>{tr('From')}</span>
                                <input
                                    aria-label={tr('From')}
                                    type="date"
                                    value={customPeriodDraft.from}
                                    onChange={(event) => setCustomPeriodDraft(current => ({ ...current, from: event.target.value }))}
                                    className="rtx-history-period-input rounded-sm border border-zinc-600 bg-[#15161a] px-2 py-1.5 text-zinc-100"
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span>{tr('To')}</span>
                                <input
                                    aria-label={tr('To')}
                                    type="date"
                                    value={customPeriodDraft.to}
                                    onChange={(event) => setCustomPeriodDraft(current => ({ ...current, to: event.target.value }))}
                                    className="rtx-history-period-input rounded-sm border border-zinc-600 bg-[#15161a] px-2 py-1.5 text-zinc-100"
                                />
                            </label>
                        </div>
                        {customPeriodError && <div role="alert" className="mt-2 text-[#ff7676]">{tr(customPeriodError)}</div>}
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setCustomPeriodDialogOpen(false)}
                                className="rounded-sm border border-zinc-600 px-3 py-1.5 hover:bg-zinc-700/60"
                            >
                                {tr('Cancel')}
                            </button>
                            <button
                                type="submit"
                                className="rtx-history-period-apply rounded-sm bg-[#0078d4] px-3 py-1.5 text-white hover:bg-[#1686d9]"
                            >
                                {tr('Apply')}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}
