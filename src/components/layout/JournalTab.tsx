/**
 * JournalTab — MT5-style server journal panel
 * Fetches broker/account-scoped logs from GET /api/v1/journal.
 *
 * Filters:
 *   - Type  : All / Config / System / Network / History / User / Trade / API / Notify
 *   - Mode  : Full / Standard / Errors only
 *   - Time  : 1h / 2h / 3h / 6h / 12h / Today / Week / Month / All
 *   - Search: Free text filter (matches against log messages)
 *
 * Loads on activation or filter changes and refreshes on explicit user demand.
 */

import React, {
    useCallback,
    useDeferredValue,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { Icon } from '../ui/Icon';
import { journalApi, type JournalLogEntry } from '../../services/api';
import { useBrokerAccountSessionScope } from '../../hooks/useBrokerAccountSessionScope';
import { useAppStore } from '../../store/useAppStore';
import {
    getTradeOrderLatencySamples,
    TRADE_ORDER_LATENCY_EVENT,
    type TradeOrderLatencySample,
    type TradeOrderTerminalStatus,
} from '../../services/orderLatencyTelemetry';
import { copyTextToClipboard } from '../../utils/tradeShareLink';

// ─── Filter Options ──────────────────────────────────────────────────────────

const LOG_TYPES = [
    { value: 0, label: 'All' },
    { value: 1, label: 'Config' },
    { value: 2, label: 'System' },
    { value: 3, label: 'Network' },
    { value: 4, label: 'History' },
    { value: 5, label: 'User' },
    { value: 6, label: 'Trade' },
    { value: 7, label: 'API' },
    { value: 8, label: 'Notify' },
] as const;

const LOG_MODES = [
    { value: 2, label: 'Full' },
    { value: 0, label: 'Standard' },
    { value: 1, label: 'Errors' },
] as const;

const TIME_RANGES: { label: string; hours: number }[] = [
    { label: '1h', hours: 1 },
    { label: '2h', hours: 2 },
    { label: '3h', hours: 3 },
    { label: '6h', hours: 6 },
    { label: '12h', hours: 12 },
    { label: 'Today', hours: 24 },
    { label: 'Week', hours: 24 * 7 },
    { label: 'Month', hours: 24 * 30 },
    { label: 'All', hours: 0 },
];

const JOURNAL_HEADER_HEIGHT = 30;
const JOURNAL_ROW_HEIGHT = 30;
const JOURNAL_ROW_OVERSCAN = 8;
const JOURNAL_FALLBACK_VIEWPORT_HEIGHT = 320;

const JOURNAL_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
    year: '2-digit', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
});

// ─── Type highlight colours ───────────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = {
    config:  'text-zinc-400',
    system:  'text-zinc-300',
    network: 'text-zinc-400',
    history: 'text-zinc-400',
    user:    'text-zinc-300',
    trade:   'text-zinc-300',
    api:     'text-zinc-400',
    notify:  'text-zinc-400',
    all:     'text-zinc-500',
};

function getTypeColor(typeText: string): string {
    return TYPE_COLOR[typeText?.toLowerCase()] || 'text-zinc-400';
}

// Subtle row background — neutral gray for all types for a clean terminal look
const formatDateTime = (unixSec: number): string => {
    if (!unixSec) return '—';
    try {
        return JOURNAL_DATE_TIME_FORMATTER.format(new Date(unixSec * 1000)).replace(',', '');
    } catch {
        return String(unixSec);
    }
};

const formatLatencyMs = (latencyMs: number | undefined): string => {
    if (typeof latencyMs !== 'number' || !Number.isFinite(latencyMs) || latencyMs < 0) {
        return '\u2014';
    }

    const rounded = Number(latencyMs.toFixed(2));
    return `${Object.is(rounded, -0) ? 0 : rounded} ms`;
};

type ScopedTradeLatency = {
    latencyMs: number;
    sequence: number;
    sessionScope: string;
};

const getTerminalTradeLatency = (
    sample: TradeOrderLatencySample,
    sessionScope: string,
): ScopedTradeLatency | null => {
    if (sample.sessionScope !== sessionScope) return null;

    const isPlacementTerminal = sample.phase === 'placement_terminal';
    const isWebSocketTerminal = sample.transport === 'websocket'
        && (sample.phase === 'order_filled' || sample.phase === 'order_rejected');
    const isRestTerminal = sample.transport === 'rest'
        && (sample.phase === 'rest_completed' || sample.phase === 'rest_failed');
    if (!isPlacementTerminal && !isWebSocketTerminal && !isRestTerminal) return null;

    // The Journal label answers "how long did the order attempt take?". Prefer
    // the complete API-to-terminal duration so a WS recovery followed by REST
    // does not misleadingly show only the final transport leg.
    const transportLatency = isWebSocketTerminal
        ? sample.terminalRttMs
        : isRestTerminal
            ? sample.restRttMs
            : undefined;
    const latencyMs = typeof sample.totalMs === 'number' && Number.isFinite(sample.totalMs)
        ? sample.totalMs
        : transportLatency;
    if (typeof latencyMs !== 'number' || !Number.isFinite(latencyMs) || latencyMs < 0) return null;

    return {
        latencyMs,
        sequence: sample.sequence,
        sessionScope,
    };
};

const getLatestTerminalTradeLatency = (
    samples: readonly TradeOrderLatencySample[],
    sessionScope: string,
): ScopedTradeLatency | null => samples.reduce<ScopedTradeLatency | null>((latest, sample) => {
    const candidate = getTerminalTradeLatency(sample, sessionScope);
    if (!candidate || (latest && latest.sequence >= candidate.sequence)) return latest;
    return candidate;
}, null);

type PlacementTerminalSample = TradeOrderLatencySample & {
    phase: 'placement_terminal';
    terminalStatus: TradeOrderTerminalStatus;
    totalMs: number;
};

const isPlacementTerminalSample = (
    sample: TradeOrderLatencySample,
    sessionScope: string,
): sample is PlacementTerminalSample => (
    sample.phase === 'placement_terminal'
    && sample.sessionScope === sessionScope
    && (
        sample.terminalStatus === 'filled'
        || sample.terminalStatus === 'rejected'
        || sample.terminalStatus === 'expired'
        || sample.terminalStatus === 'failed'
    )
    && typeof sample.totalMs === 'number'
    && Number.isFinite(sample.totalMs)
    && sample.totalMs >= 0
);

const getScopedPlacementTerminalSamples = (
    samples: readonly TradeOrderLatencySample[],
    sessionScope: string,
): PlacementTerminalSample[] => {
    const seenAttempts = new Set<string>();
    return samples
        .filter(sample => isPlacementTerminalSample(sample, sessionScope))
        .sort((left, right) => right.sequence - left.sequence)
        .filter(sample => {
            const attemptKey = sample.clientOrderId
                ? `${sample.sessionScope}:${sample.clientOrderId}`
                : `sequence:${sample.sequence}`;
            if (seenAttempts.has(attemptKey)) return false;
            seenAttempts.add(attemptKey);
            return true;
        });
};

const formatLocalOrderVolume = (volume: number | undefined): string => (
    typeof volume === 'number' && Number.isFinite(volume)
        ? String(Number(volume.toFixed(8)))
        : ''
);

const createLocalTerminalJournalEntry = (
    sample: PlacementTerminalSample,
): JournalLogEntry => {
    const subject = [
        sample.side,
        sample.symbol,
        formatLocalOrderVolume(sample.volume),
    ].filter(Boolean).join(' ');
    const errorDetails = [sample.errorCode, sample.errorMessage]
        .filter((value, index, values): value is string => (
            typeof value === 'string'
            && value.trim().length > 0
            && values.indexOf(value) === index
        ))
        .join(': ');
    const prefix = sample.terminalStatus === 'filled'
        ? 'Order executed'
        : sample.terminalStatus === 'rejected'
            ? 'Order rejected'
            : sample.terminalStatus === 'expired'
                ? 'Order expired'
                : 'Order failed';
    const message = `${prefix}${subject ? ` ${subject}` : ''}${errorDetails ? `: ${errorDetails}` : ''}`;
    const isFilled = sample.terminalStatus === 'filled';

    return {
        id: `local-order-${sample.clientOrderId || sample.traceId}-${sample.sequence}`,
        ...(sample.clientOrderId ? { client_order_id: sample.clientOrderId } : {}),
        latency_ms: sample.totalMs,
        code: isFilled ? 0 : 1,
        code_text: isFilled ? 'OK' : sample.errorCode || sample.terminalStatus.toUpperCase(),
        type: 6,
        type_text: 'Trade',
        datetime: Math.floor(sample.recordedAtEpochMs / 1000),
        source: 'Terminal',
        message,
    };
};

const getServerTerminalStatus = (
    log: JournalLogEntry,
): TradeOrderTerminalStatus | null => {
    if (log.type !== 6 && log.type_text.trim().toLowerCase() !== 'trade') return null;
    const terminalText = `${log.code_text} ${log.message}`.toLowerCase();
    if (/\b(filled|executed|completed)\b/.test(terminalText)) return 'filled';
    if (/\b(rejected|denied)\b/.test(terminalText)) return 'rejected';
    if (/\b(expired|timed out|timeout)\b/.test(terminalText)) return 'expired';
    if (/\b(failed|error)\b/.test(terminalText)) return 'failed';
    return null;
};

const hasExactServerAttemptId = (
    log: JournalLogEntry,
    sample: PlacementTerminalSample,
): boolean => (
    Boolean(sample.clientOrderId)
    && log.client_order_id !== undefined
    && String(log.client_order_id).trim() === sample.clientOrderId
);

const isMatchingServerTerminalRow = (
    log: JournalLogEntry,
    sample: PlacementTerminalSample,
): boolean => {
    if (!hasExactServerAttemptId(log, sample)) return false;
    return getServerTerminalStatus(log) !== null;
};

const mergeTerminalTradeJournalLogs = (
    serverLogs: readonly JournalLogEntry[],
    terminalSamples: readonly PlacementTerminalSample[],
): JournalLogEntry[] => {
    const mergedServerLogs = serverLogs.map(log => ({ ...log }));
    const claimedServerRows = new Set<number>();
    const localRows: JournalLogEntry[] = [];

    for (const sample of terminalSamples) {
        const matchingIndex = mergedServerLogs.findIndex((log, index) => (
            !claimedServerRows.has(index) && isMatchingServerTerminalRow(log, sample)
        ));
        if (matchingIndex < 0) {
            localRows.push(createLocalTerminalJournalEntry(sample));
            continue;
        }

        claimedServerRows.add(matchingIndex);
        const serverTerminalStatus = getServerTerminalStatus(mergedServerLogs[matchingIndex]);
        if (
            mergedServerLogs[matchingIndex].latency_ms === undefined
            && serverTerminalStatus === sample.terminalStatus
        ) {
            mergedServerLogs[matchingIndex] = {
                ...mergedServerLogs[matchingIndex],
                latency_ms: sample.totalMs,
            };
        }
    }

    return [...localRows, ...mergedServerLogs].sort((left, right) => right.datetime - left.datetime);
};

const sanitizeClipboardCell = (value: unknown): string => String(value ?? '')
    .replace(/[\t\r\n]+/g, ' ')
    .trim();

const serializeJournalLogs = (logs: JournalLogEntry[]): string => {
    const header = ['Time', 'Code', 'Type', 'Source', 'Latency', 'Message'].join('\t');
    const rows = logs.map(log => [
        formatDateTime(log.datetime),
        log.code_text || (log.code === 0 ? 'OK' : String(log.code ?? '')),
        log.type_text || 'All',
        log.source,
        formatLatencyMs(log.latency_ms),
        log.message,
    ].map(sanitizeClipboardCell).join('\t'));

    return [header, ...rows].join('\n');
};

const getJournalLogKey = (log: JournalLogEntry, index: number): React.Key => (
    log.id
    ?? log.client_order_id
    ?? log.request_id
    ?? log.position_ticket
    ?? log.order_ticket
    ?? `${log.datetime}-${log.code}-${log.type}-${index}`
);

type JournalLogTableProps = {
    logs: JournalLogEntry[];
    autoScroll: boolean;
    onAutoScrollChange: (enabled: boolean) => void;
};

const JournalLogTable = React.memo(function JournalLogTable({
    logs,
    autoScroll,
    onAutoScrollChange,
}: JournalLogTableProps) {
    const scrollViewportRef = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState({
        scrollTop: 0,
        height: JOURNAL_FALLBACK_VIEWPORT_HEIGHT,
    });

    useLayoutEffect(() => {
        const element = scrollViewportRef.current;
        if (!element) return;

        const measure = () => {
            const height = element.clientHeight || JOURNAL_FALLBACK_VIEWPORT_HEIGHT;
            setViewport(current => current.height === height ? current : { ...current, height });
        };

        measure();
        if (typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    useLayoutEffect(() => {
        if (!autoScroll) return;
        const element = scrollViewportRef.current;
        if (element) element.scrollTop = 0;
        setViewport(current => current.scrollTop === 0 ? current : { ...current, scrollTop: 0 });
    }, [autoScroll, logs]);

    const handleScroll = useCallback(() => {
        const element = scrollViewportRef.current;
        if (!element) return;

        const scrollTop = element.scrollTop;
        const height = element.clientHeight || JOURNAL_FALLBACK_VIEWPORT_HEIGHT;
        setViewport(current => (
            current.scrollTop === scrollTop && current.height === height
                ? current
                : { scrollTop, height }
        ));

        const shouldAutoScroll = scrollTop < 40;
        if (shouldAutoScroll !== autoScroll) onAutoScrollChange(shouldAutoScroll);
    }, [autoScroll, onAutoScrollChange]);

    const virtualWindow = useMemo(() => {
        const rowViewportHeight = Math.max(
            JOURNAL_ROW_HEIGHT,
            viewport.height - JOURNAL_HEADER_HEIGHT,
        );
        const maxScrollTop = Math.max(
            0,
            JOURNAL_HEADER_HEIGHT + logs.length * JOURNAL_ROW_HEIGHT - viewport.height,
        );
        const effectiveScrollTop = Math.min(viewport.scrollTop, maxScrollTop);
        const startIndex = Math.max(
            0,
            Math.floor(effectiveScrollTop / JOURNAL_ROW_HEIGHT) - JOURNAL_ROW_OVERSCAN,
        );
        const endIndex = Math.min(
            logs.length,
            Math.ceil((effectiveScrollTop + rowViewportHeight) / JOURNAL_ROW_HEIGHT)
                + JOURNAL_ROW_OVERSCAN,
        );

        return {
            startIndex,
            endIndex,
            topSpacerHeight: startIndex * JOURNAL_ROW_HEIGHT,
            bottomSpacerHeight: (logs.length - endIndex) * JOURNAL_ROW_HEIGHT,
        };
    }, [logs.length, viewport]);

    const visibleLogs = logs.slice(virtualWindow.startIndex, virtualWindow.endIndex);

    return (
        <div
            ref={scrollViewportRef}
            data-testid="journal-scroll-viewport"
            onScroll={handleScroll}
            className="virtualized-list flex-1 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700"
        >
            <table
                aria-rowcount={logs.length + 1}
                className="rtx-journal-table w-full table-fixed text-center border-collapse"
                style={{ fontFamily: '"Segoe UI", Tahoma, Arial, sans-serif', fontVariantNumeric: 'tabular-nums' }}
            >
                <thead className="rtx-journal-table__head sticky top-0 bg-[#17181c] text-[#c9cfdb] z-10 font-normal text-[12px] uppercase tracking-normal border-y border-zinc-700/70 select-none">
                    <tr className="h-[30px]">
                        <th className="px-1.5 py-[3px] w-36 whitespace-nowrap">Time</th>
                        <th className="px-1.5 py-[3px] w-16">Code</th>
                        <th className="px-1.5 py-[3px] w-20">Type</th>
                        <th className="px-1.5 py-[3px] w-28">Source</th>
                        <th className="px-1.5 py-[3px] w-24 whitespace-nowrap">Latency</th>
                        <th className="px-1.5 py-[3px] text-left">Message</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/90 text-zinc-100 text-[13px] leading-[19.5px] font-normal">
                    {virtualWindow.topSpacerHeight > 0 && (
                        <tr aria-hidden="true" style={{ height: virtualWindow.topSpacerHeight }}>
                            <td colSpan={6} className="p-0 border-0" />
                        </tr>
                    )}
                    {visibleLogs.map((log, visibleIndex) => {
                        const absoluteIndex = virtualWindow.startIndex + visibleIndex;
                        return (
                            <tr
                                key={getJournalLogKey(log, absoluteIndex)}
                                data-testid="journal-rendered-row"
                                aria-rowindex={absoluteIndex + 2}
                                className="rtx-journal-row h-[30px] bg-[#131316] transition-colors hover:bg-[#202126]"
                            >
                                <td className="px-1.5 py-[2px] text-center text-zinc-100 whitespace-nowrap">
                                    {formatDateTime(log.datetime)}
                                </td>
                                <td
                                    className={`px-1.5 py-[2px] text-center truncate whitespace-nowrap font-normal ${Number(log.code) ? 'text-red-400' : 'text-zinc-100'}`}
                                    title={log.code_text || (log.code === 0 ? 'OK' : String(log.code ?? ''))}
                                >
                                    {log.code_text || (log.code === 0 ? 'OK' : String(log.code ?? ''))}
                                </td>
                                <td className="px-1.5 py-[2px] text-center truncate whitespace-nowrap" title={log.type_text || 'All'}>
                                    <span className={`font-normal uppercase ${getTypeColor(log.type_text)}`}>
                                        {log.type_text || 'All'}
                                    </span>
                                </td>
                                <td className="px-1.5 py-[2px] text-center text-zinc-100 truncate max-w-[110px]" title={log.source}>
                                    {log.source}
                                </td>
                                <td className="px-1.5 py-[2px] text-center text-zinc-100 whitespace-nowrap">
                                    {formatLatencyMs(log.latency_ms)}
                                </td>
                                <td
                                    className={`px-1.5 py-[2px] text-left truncate whitespace-nowrap ${getTypeColor(log.type_text)} leading-snug`}
                                    title={log.message}
                                >
                                    {log.message}
                                </td>
                            </tr>
                        );
                    })}
                    {virtualWindow.bottomSpacerHeight > 0 && (
                        <tr aria-hidden="true" style={{ height: virtualWindow.bottomSpacerHeight }}>
                            <td colSpan={6} className="p-0 border-0" />
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
});

type CopyStatus = 'idle' | 'copied' | 'error';

// ─── Component ────────────────────────────────────────────────────────────────

type JournalTabSurfaceProps = {
    isAuthenticated: boolean;
    sessionScope: string;
};

function JournalTabSurface({ isAuthenticated, sessionScope }: JournalTabSurfaceProps) {
    const [lastTradeLatency, setLastTradeLatency] = useState<ScopedTradeLatency | null>(() => (
        getLatestTerminalTradeLatency(getTradeOrderLatencySamples(), sessionScope)
    ));
    const [serverLogs, setServerLogs] = useState<JournalLogEntry[]>([]);
    const [terminalTradeSamples, setTerminalTradeSamples] = useState<PlacementTerminalSample[]>(() => (
        getScopedPlacementTerminalSamples(getTradeOrderLatencySamples(), sessionScope)
    ));
    const [hasLoaded, setHasLoaded] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null);
    const [loadedSessionScope, setLoadedSessionScope] = useState<string | null>(null);
    const [errorRequestKey, setErrorRequestKey] = useState<string | null>(null);

    // Filters
    const [logType, setLogType] = useState(0);   // 0 = All
    const [logMode, setLogMode] = useState(2);   // 2 = Full
    const [timeRange, setTimeRange] = useState(0);  // 0 = All, matching the terminal-history default
    const [search, setSearch] = useState('');
    const [autoScroll, setAutoScroll] = useState(true);
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');

    // Keep the controls urgent. React can apply the heavier table/query update
    // immediately after the selected pill or native select has painted.
    const deferredLogType = useDeferredValue(logType);
    const deferredLogMode = useDeferredValue(logMode);
    const deferredTimeRange = useDeferredValue(timeRange);
    const deferredSearch = useDeferredValue(search);
    const isFilterSettling = logType !== deferredLogType
        || logMode !== deferredLogMode
        || timeRange !== deferredTimeRange
        || search !== deferredSearch;

    const requestKey = JSON.stringify([sessionScope, deferredLogMode, deferredLogType]);

    const manualRefreshRef = useRef<() => void>(() => undefined);
    const loadedSessionScopeRef = useRef<string | null>(null);
    const cachedResponsesRef = useRef(new Map<string, JournalLogEntry[]>());
    const cacheSessionScopeRef = useRef(sessionScope);
    const copyFeedbackTimerRef = useRef<number | null>(null);
    const copySequenceRef = useRef(0);

    useEffect(() => {
        const acceptSample = (sample: TradeOrderLatencySample): void => {
            const candidate = getTerminalTradeLatency(sample, sessionScope);
            if (candidate) {
                setLastTradeLatency(current => (
                    current?.sessionScope === sessionScope && current.sequence >= candidate.sequence
                        ? current
                        : candidate
                ));
            }
            if (!isPlacementTerminalSample(sample, sessionScope)) return;
            setTerminalTradeSamples(current => getScopedPlacementTerminalSamples(
                [...current, sample],
                sessionScope,
            ).slice(0, 200));
        };
        const handleLatency = (event: Event): void => {
            acceptSample((event as CustomEvent<TradeOrderLatencySample>).detail);
        };

        window.addEventListener(TRADE_ORDER_LATENCY_EVENT, handleLatency);
        const retainedSamples = getTradeOrderLatencySamples();
        setLastTradeLatency(getLatestTerminalTradeLatency(retainedSamples, sessionScope));
        setTerminalTradeSamples(getScopedPlacementTerminalSamples(retainedSamples, sessionScope));

        return () => window.removeEventListener(TRADE_ORDER_LATENCY_EVENT, handleLatency);
    }, [sessionScope]);

    useEffect(() => {
        let disposed = false;
        let activeController: AbortController | null = null;
        let requestSequence = 0;

        if (cacheSessionScopeRef.current !== sessionScope) {
            cachedResponsesRef.current.clear();
            cacheSessionScopeRef.current = sessionScope;
        }

        const cachedLogs = isAuthenticated
            ? cachedResponsesRef.current.get(requestKey)
            : undefined;
        const canReuseCurrentResponse = isAuthenticated
            && loadedSessionScopeRef.current === sessionScope;
        let hasSuccessfulResponse = cachedLogs !== undefined || canReuseCurrentResponse;

        const loadJournal = async (): Promise<void> => {
            if (disposed || !isAuthenticated) return;

            const sequence = ++requestSequence;
            activeController?.abort();
            const controller = new AbortController();
            activeController = controller;

            if (hasSuccessfulResponse) {
                setIsRefreshing(true);
            } else {
                setIsLoading(true);
            }
            setFetchError(null);
            setErrorRequestKey(null);

            try {
                const data = await journalApi.getLogs(
                    { mode: deferredLogMode, type: deferredLogType },
                    { signal: controller.signal },
                );
                if (disposed || controller.signal.aborted || sequence !== requestSequence) return;

                hasSuccessfulResponse = true;
                cachedResponsesRef.current.set(requestKey, data.logs);
                loadedSessionScopeRef.current = sessionScope;
                setServerLogs(data.logs);
                setHasLoaded(true);
                setLoadedRequestKey(requestKey);
                setLoadedSessionScope(sessionScope);
                setFetchError(null);
                setErrorRequestKey(null);
            } catch (err) {
                if (disposed || controller.signal.aborted || sequence !== requestSequence) return;
                setFetchError(err instanceof Error ? err.message : 'Failed to load journal');
                setErrorRequestKey(requestKey);
            } finally {
                if (!disposed && sequence === requestSequence) {
                    if (activeController === controller) activeController = null;
                    setIsLoading(false);
                    setIsRefreshing(false);
                }
            }
        };

        setFetchError(null);
        setErrorRequestKey(null);
        setIsRefreshing(false);

        if (cachedLogs !== undefined) {
            loadedSessionScopeRef.current = sessionScope;
            setServerLogs(cachedLogs);
            setHasLoaded(true);
            setLoadedRequestKey(requestKey);
            setLoadedSessionScope(sessionScope);
            setIsLoading(false);
        } else if (!canReuseCurrentResponse) {
            loadedSessionScopeRef.current = null;
            setServerLogs([]);
            setHasLoaded(false);
            setLoadedRequestKey(null);
            setLoadedSessionScope(null);
            setIsLoading(isAuthenticated);
        } else {
            // Keep the last response mounted while a new Type/Mode query loads.
            // This avoids a full table teardown and gives immediate filter feedback.
            setIsLoading(false);
        }

        const requestRefresh = () => { void loadJournal(); };
        manualRefreshRef.current = requestRefresh;
        if (isAuthenticated) void loadJournal();

        return () => {
            disposed = true;
            requestSequence += 1;
            activeController?.abort();
            if (manualRefreshRef.current === requestRefresh) {
                manualRefreshRef.current = () => undefined;
            }
        };
    }, [isAuthenticated, requestKey, deferredLogMode, deferredLogType, sessionScope]);

    const refreshJournal = useCallback(() => {
        manualRefreshRef.current();
    }, []);

    const scopeHasLoaded = hasLoaded && loadedSessionScope === sessionScope;
    const ownsCurrentRequest = scopeHasLoaded
        && loadedRequestKey === requestKey
        && !isFilterSettling;
    const scopeFetchError = !isFilterSettling && errorRequestKey === requestKey
        ? fetchError
        : null;

    // Client-side filtering
    const filteredLogs = useMemo(() => {
        const scopedServerLogs = loadedSessionScope === sessionScope ? serverLogs : [];
        const scopedLogs = mergeTerminalTradeJournalLogs(scopedServerLogs, terminalTradeSamples);
        if (scopedLogs.length === 0) return scopedLogs;

        let filtered = scopedLogs;

        // Time filter
        if (deferredTimeRange) {
            const cutoff = Math.floor(Date.now() / 1000) - deferredTimeRange * 3600;
            filtered = filtered.filter(l => l.datetime >= cutoff);
        }

        // Type filter
        if (loadedRequestKey === requestKey && deferredLogType !== 0) {
            filtered = filtered.filter(l => l.type === deferredLogType);
        }

        // The server applies Mode before returning its rows. Mirror Errors mode
        // for local terminal rows so successful orders do not leak into it.
        if (loadedRequestKey === requestKey && deferredLogMode === 1) {
            filtered = filtered.filter(l => l.code !== 0);
        }

        // Search filter
        if (deferredSearch.trim()) {
            const query = deferredSearch.toLowerCase();
            filtered = filtered.filter(l => l.message.toLowerCase().includes(query) || l.source.toLowerCase().includes(query));
        }

        return filtered;
    }, [loadedRequestKey, requestKey, loadedSessionScope, sessionScope, serverLogs, terminalTradeSamples, deferredTimeRange, deferredLogType, deferredLogMode, deferredSearch]);

    useEffect(() => () => {
        copySequenceRef.current += 1;
        if (copyFeedbackTimerRef.current !== null) {
            window.clearTimeout(copyFeedbackTimerRef.current);
        }
    }, []);

    useEffect(() => {
        copySequenceRef.current += 1;
        if (copyFeedbackTimerRef.current !== null) {
            window.clearTimeout(copyFeedbackTimerRef.current);
            copyFeedbackTimerRef.current = null;
        }
        setCopyStatus('idle');
    }, [sessionScope, logMode, logType, timeRange, search]);

    const copyFilteredJournal = useCallback(async () => {
        if (filteredLogs.length === 0) return;

        const sequence = ++copySequenceRef.current;
        if (copyFeedbackTimerRef.current !== null) {
            window.clearTimeout(copyFeedbackTimerRef.current);
        }

        const copied = await copyTextToClipboard(serializeJournalLogs(filteredLogs));
        if (sequence !== copySequenceRef.current) return;
        setCopyStatus(copied ? 'copied' : 'error');

        copyFeedbackTimerRef.current = window.setTimeout(() => {
            if (sequence === copySequenceRef.current) setCopyStatus('idle');
        }, 2000);
    }, [filteredLogs]);

    const handleAutoScrollChange = useCallback((enabled: boolean) => {
        setAutoScroll(current => current === enabled ? current : enabled);
    }, []);

    const scopedLastTradeLatency = lastTradeLatency?.sessionScope === sessionScope
        ? lastTradeLatency.latencyMs
        : undefined;

    // ── Render ─────────────────────────────────────────────────────────────
    return (
        <div
            aria-busy={isFilterSettling || isLoading || isRefreshing}
            className="h-full flex flex-col bg-[#131316] text-[13px] font-normal font-sans"
        >

            {/* ── Toolbar ─────────────────────────────────────────────────── */}
            <div className={`rtx-journal-toolbar ${showAdvancedFilters ? 'rtx-journal-toolbar--expanded' : ''} flex h-[31px] min-h-[31px] items-center gap-2 border-b border-zinc-700 bg-[#191a1e] px-1.5 py-1 shrink-0 select-none text-[12px] font-normal text-zinc-300 tabular-nums`}>

                {/* Type filter */}
                <div className="rtx-journal-advanced-control flex items-center gap-1.5 shrink-0">
                    <span className="rtx-journal-toolbar__label text-[13px] font-medium text-zinc-400 uppercase tracking-[0.02em]">Type</span>
                    <select
                        aria-label="Journal type"
                        value={logType}
                        onChange={e => setLogType(Number(e.target.value))}
                        className="rtx-journal-control h-7 min-w-[94px] cursor-pointer border border-zinc-600 bg-zinc-800 px-2 py-0 text-[13px] font-medium text-zinc-200 outline-none hover:border-zinc-500"
                    >
                        {LOG_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                    </select>
                </div>

                {/* Mode filter */}
                <div className="rtx-journal-advanced-control flex items-center gap-1.5 shrink-0">
                    <span className="rtx-journal-toolbar__label text-[13px] font-medium text-zinc-400 uppercase tracking-[0.02em]">Mode</span>
                    <select
                        aria-label="Journal mode"
                        value={logMode}
                        onChange={e => setLogMode(Number(e.target.value))}
                        className="rtx-journal-control h-7 min-w-[112px] cursor-pointer border border-zinc-600 bg-zinc-800 px-2 py-0 text-[13px] font-medium text-zinc-200 outline-none hover:border-zinc-500"
                    >
                        {LOG_MODES.map(m => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                    </select>
                </div>

                {/* Time range pills */}
                <div className="rtx-journal-periods flex items-center gap-1 shrink-0">
                    {TIME_RANGES.map(t => (
                        <button
                            key={t.label}
                            type="button"
                            aria-pressed={timeRange === t.hours}
                            onClick={() => setTimeRange(t.hours)}
                            className={`rtx-journal-control rtx-journal-time-btn h-[22px] min-w-[42px] border border-transparent px-2 py-0 text-[12px] font-normal transition-colors ${timeRange === t.hours
                                ? 'bg-zinc-700/70 text-white'
                                : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200'
                                }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                <button
                    type="button"
                    onClick={() => { void copyFilteredJournal(); }}
                    disabled={!ownsCurrentRequest || filteredLogs.length === 0}
                    aria-label="Copy filtered journal"
                    title={`Copy ${filteredLogs.length} filtered journal ${filteredLogs.length === 1 ? 'entry' : 'entries'}`}
                    className={`rtx-journal-control rtx-journal-primary-action flex h-[22px] min-w-[72px] shrink-0 items-center justify-center gap-1.5 border px-2 py-0 text-[12px] font-normal transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${copyStatus === 'copied'
                        ? 'border-emerald-700 text-emerald-400'
                        : copyStatus === 'error'
                            ? 'border-red-800 text-red-400'
                            : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                        }`}
                >
                    <Icon name={copyStatus === 'copied' ? 'check' : 'copy'} size="sm" />
                    {copyStatus === 'copied' ? 'Copied' : copyStatus === 'error' ? 'Failed' : 'Copy'}
                </button>
                <span role="status" aria-live="polite" className="sr-only">
                    {copyStatus === 'copied'
                        ? `${filteredLogs.length} filtered journal ${filteredLogs.length === 1 ? 'entry' : 'entries'} copied`
                        : copyStatus === 'error'
                            ? 'Unable to copy the filtered journal'
                            : ''}
                </span>

                <button
                    type="button"
                    aria-expanded={showAdvancedFilters}
                    onClick={() => setShowAdvancedFilters(current => !current)}
                    className="rtx-journal-control h-[22px] border border-transparent px-2 text-[12px] font-normal text-zinc-500 hover:bg-zinc-800/70 hover:text-zinc-200"
                >
                    Filters
                </button>

                {/* Text search */}
                <div className="rtx-journal-advanced-control relative h-7 min-w-[220px] max-w-[400px] flex-[1_1_260px]">
                    <Icon name="search" size="sm" className="pointer-events-none absolute left-2 top-1/2 z-[1] -translate-y-1/2 text-zinc-500" />
                    <input
                        type="text"
                        aria-label="Filter journal messages"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Filter messages…"
                        className="rtx-journal-control h-7 w-full border border-zinc-600 bg-zinc-800 py-0 pl-7 pr-2 text-[13px] font-normal text-zinc-200 outline-none placeholder:text-zinc-500 hover:border-zinc-500"
                    />
                </div>

                <div className="ml-auto flex max-w-full shrink-0 flex-nowrap items-center justify-end gap-2">

                {/* Log count */}
                <span className="min-w-[88px] text-right text-[13px] font-normal text-zinc-400 whitespace-nowrap">
                    {filteredLogs.length} records
                </span>

                <span
                    data-testid="last-trade-latency"
                    role="status"
                    aria-live="polite"
                    className="rtx-journal-advanced-control min-w-[196px] border-l border-zinc-700/50 pl-3 text-[13px] font-normal text-zinc-400 whitespace-nowrap"
                    title="Latest locally measured total order-attempt time for this broker and account"
                >
                    Last trade latency: {formatLatencyMs(scopedLastTradeLatency)}
                </span>

                <button
                    type="button"
                    onClick={() => setAutoScroll(current => !current)}
                    aria-pressed={autoScroll}
                    title="Toggle auto-follow newest entries"
                    className={`rtx-journal-control rtx-journal-advanced-control rtx-journal-auto h-7 min-w-[68px] border px-2.5 py-0 text-[13px] font-medium transition-colors ${autoScroll
                        ? 'border-zinc-600 bg-blue-950/30 text-blue-400'
                        : 'border-zinc-700 text-zinc-500 hover:border-zinc-500'
                        }`}
                >
                    ↑ Auto
                </button>

                <button
                    type="button"
                    onClick={refreshJournal}
                    disabled={!isAuthenticated || isFilterSettling || isLoading || isRefreshing}
                    aria-label="Refresh journal"
                    className="rtx-journal-control rtx-journal-refresh flex h-[22px] items-center justify-center gap-1 border border-transparent bg-zinc-800 px-2 py-0 text-[12px] font-normal text-zinc-300 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <Icon name="refresh" size="sm" className={isLoading || isRefreshing ? 'animate-spin' : ''} />
                    {isLoading ? 'Loading…' : isRefreshing ? 'Refreshing…' : 'Refresh'}
                </button>
                </div>
            </div>

            {/* ── Status rows ──────────────────────────────────────────────── */}
            {!isAuthenticated && (
                <div className="flex flex-1 items-center justify-center text-xs text-zinc-500">
                    Sign in to view the server journal
                </div>
            )}

            {isAuthenticated && scopeHasLoaded && scopeFetchError && (
                <div role="status" className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-900/60 bg-amber-950/30 px-3 py-1 text-[12px] font-normal text-amber-300">
                    <span>Refresh failed. Showing the latest response for this account.</span>
                    <button type="button" onClick={refreshJournal} className="underline underline-offset-2 hover:text-amber-100">
                        Retry
                    </button>
                </div>
            )}

            {isAuthenticated && !scopeHasLoaded && (isLoading || !scopeFetchError) && (
                <div role="status" className="flex flex-1 items-center justify-center gap-2 text-xs text-zinc-500">
                    <Icon name="refresh" size="sm" className="animate-spin" />
                    Loading server journal…
                </div>
            )}

            {isAuthenticated && !scopeHasLoaded && !isLoading && scopeFetchError && (
                <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
                    <span className="text-xs text-red-400">Unable to load the server journal</span>
                    <span className="max-w-xl text-[12px] font-normal text-zinc-500">{scopeFetchError}</span>
                    <button type="button" onClick={refreshJournal} className="rounded bg-zinc-700 px-3 py-1 text-[12px] font-normal text-zinc-200 hover:bg-zinc-600">
                        Retry
                    </button>
                </div>
            )}

            {isAuthenticated && scopeHasLoaded && filteredLogs.length === 0 && (
                <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs italic">
                    No journal entries for the selected filters
                </div>
            )}

            {/* ── Log table ────────────────────────────────────────────────── */}
            {isAuthenticated && scopeHasLoaded && filteredLogs.length > 0 && (
                <JournalLogTable
                    logs={filteredLogs}
                    autoScroll={autoScroll}
                    onAutoScrollChange={handleAutoScrollChange}
                />
            )}
        </div>
    );
}

const MemoizedJournalTabSurface = React.memo(JournalTabSurface);
MemoizedJournalTabSurface.displayName = 'JournalTabSurface';

export function JournalTab() {
    const isAuthenticated = useAppStore(state => state.isAuthenticated);
    const sessionScope = useBrokerAccountSessionScope();

    return (
        <MemoizedJournalTabSurface
            isAuthenticated={isAuthenticated}
            sessionScope={sessionScope}
        />
    );
}
