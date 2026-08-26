/**
 * JournalTab — MT5-style server journal panel
 * Fetches broker/account-scoped logs from GET /api/v1/journal.
 *
 * Filters:
 *   - Type  : All / Config / System / Network / History / User / Trade / API / Notify
 *   - Mode  : Full / Standard / Errors only
 *   - Time  : Last 1h / 6h / 24h / 7d / Custom
 *   - Search: Free text filter (matches against log messages)
 *
 * Auto-refreshes every 15 seconds while the tab is visible.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from '../ui/Icon';
import { journalApi, type JournalLogEntry } from '../../services/api';
import { useBrokerAccountSessionScope } from '../../hooks/useBrokerAccountSessionScope';
import { useAppStore } from '../../store/useAppStore';
import {
    getTradeOrderLatencySamples,
    TRADE_ORDER_LATENCY_EVENT,
    type TradeOrderLatencySample,
} from '../../services/orderLatencyTelemetry';

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
    { label: '6h', hours: 6 },
    { label: '24h', hours: 24 },
    { label: '7d', hours: 24 * 7 },
];

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
const ROW_BG: Record<string, string> = {
    system:  'bg-zinc-800/20',
    trade:   'bg-zinc-800/20',
    network: 'bg-zinc-800/20',
    api:     'bg-zinc-800/20',
    config:  'bg-zinc-800/20',
    notify:  'bg-zinc-800/20',
    user:    'bg-zinc-800/20',
};

function getRowBg(typeText: string, evenRow: boolean): string {
    const specific = ROW_BG[typeText?.toLowerCase()];
    if (specific) return specific;
    return evenRow ? 'bg-[#131316]' : 'bg-[#212121]';
}

const formatDateTime = (unixSec: number): string => {
    if (!unixSec) return '—';
    try {
        return new Date(unixSec * 1000).toLocaleString('en-US', {
            year: '2-digit', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false,
        }).replace(',', '');
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

    const isWebSocketTerminal = sample.transport === 'websocket'
        && (sample.phase === 'order_filled' || sample.phase === 'order_rejected');
    const isRestTerminal = sample.transport === 'rest'
        && (sample.phase === 'rest_completed' || sample.phase === 'rest_failed');
    if (!isWebSocketTerminal && !isRestTerminal) return null;

    // The Journal label answers "how long did the order attempt take?". Prefer
    // the complete API-to-terminal duration so a WS recovery followed by REST
    // does not misleadingly show only the final transport leg.
    const transportLatency = isWebSocketTerminal ? sample.terminalRttMs : sample.restRttMs;
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

type CopyStatus = 'idle' | 'copied' | 'error';

// ─── Component ────────────────────────────────────────────────────────────────

export function JournalTab() {
    const isAuthenticated = useAppStore(state => state.isAuthenticated);
    const sessionScope = useBrokerAccountSessionScope();
    const [lastTradeLatency, setLastTradeLatency] = useState<ScopedTradeLatency | null>(() => (
        getLatestTerminalTradeLatency(getTradeOrderLatencySamples(), sessionScope)
    ));
    const [serverLogs, setServerLogs] = useState<JournalLogEntry[]>([]);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null);
    const [errorRequestKey, setErrorRequestKey] = useState<string | null>(null);

    // Filters
    const [logType, setLogType] = useState(0);   // 0 = All
    const [logMode, setLogMode] = useState(2);   // 2 = Full
    const [timeRange, setTimeRange] = useState(24);  // hours; 24h default
    const [search, setSearch] = useState('');
    const [autoScroll, setAutoScroll] = useState(true);
    const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');

    const requestKey = JSON.stringify([sessionScope, logMode, logType]);

    const manualRefreshRef = useRef<() => void>(() => undefined);
    const tableBodyRef = useRef<HTMLDivElement>(null);
    const copyFeedbackTimerRef = useRef<number | null>(null);
    const copySequenceRef = useRef(0);

    useEffect(() => {
        const acceptSample = (sample: TradeOrderLatencySample): void => {
            const candidate = getTerminalTradeLatency(sample, sessionScope);
            if (!candidate) return;
            setLastTradeLatency(current => (
                current?.sessionScope === sessionScope && current.sequence >= candidate.sequence
                    ? current
                    : candidate
            ));
        };
        const handleLatency = (event: Event): void => {
            acceptSample((event as CustomEvent<TradeOrderLatencySample>).detail);
        };

        window.addEventListener(TRADE_ORDER_LATENCY_EVENT, handleLatency);
        setLastTradeLatency(getLatestTerminalTradeLatency(
            getTradeOrderLatencySamples(),
            sessionScope,
        ));

        return () => window.removeEventListener(TRADE_ORDER_LATENCY_EVENT, handleLatency);
    }, [sessionScope]);

    useEffect(() => {
        let disposed = false;
        let pollTimer: number | null = null;
        let activeController: AbortController | null = null;
        let requestSequence = 0;
        let hasSuccessfulResponse = false;

        const clearPollTimer = () => {
            if (pollTimer !== null) {
                window.clearTimeout(pollTimer);
                pollTimer = null;
            }
        };

        const scheduleNextPoll = (load: () => Promise<void>) => {
            if (disposed) return;
            clearPollTimer();
            pollTimer = window.setTimeout(() => { void load(); }, 15000);
        };

        const loadJournal = async (): Promise<void> => {
            if (disposed || !isAuthenticated) return;

            clearPollTimer();
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
                    { mode: logMode, type: logType },
                    { signal: controller.signal },
                );
                if (disposed || controller.signal.aborted || sequence !== requestSequence) return;

                hasSuccessfulResponse = true;
                setServerLogs(data.logs);
                setHasLoaded(true);
                setLoadedRequestKey(requestKey);
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
                    scheduleNextPoll(loadJournal);
                }
            }
        };

        setServerLogs([]);
        setHasLoaded(false);
        setLoadedRequestKey(null);
        setFetchError(null);
        setErrorRequestKey(null);
        setIsLoading(isAuthenticated);
        setIsRefreshing(false);

        const requestRefresh = () => { void loadJournal(); };
        manualRefreshRef.current = requestRefresh;
        if (isAuthenticated) void loadJournal();

        return () => {
            disposed = true;
            requestSequence += 1;
            clearPollTimer();
            activeController?.abort();
            if (manualRefreshRef.current === requestRefresh) {
                manualRefreshRef.current = () => undefined;
            }
        };
    }, [isAuthenticated, requestKey, logMode, logType]);

    const refreshJournal = useCallback(() => {
        manualRefreshRef.current();
    }, []);

    const ownsCurrentRequest = loadedRequestKey === requestKey;
    const scopeHasLoaded = hasLoaded && ownsCurrentRequest;
    const scopeFetchError = errorRequestKey === requestKey ? fetchError : null;

    // Client-side filtering
    const filteredLogs = React.useMemo(() => {
        const scopedLogs = loadedRequestKey === requestKey ? serverLogs : [];
        if (scopedLogs.length === 0) return scopedLogs;

        let filtered = scopedLogs;

        // Time filter
        if (timeRange) {
            const cutoff = Math.floor(Date.now() / 1000) - timeRange * 3600;
            filtered = filtered.filter(l => l.datetime >= cutoff);
        }

        // Type filter
        if (logType !== 0) {
            filtered = filtered.filter(l => l.type === logType);
        }

        // Search filter
        if (search.trim()) {
            const query = search.toLowerCase();
            filtered = filtered.filter(l => l.message.toLowerCase().includes(query) || l.source.toLowerCase().includes(query));
        }

        return filtered;
    }, [loadedRequestKey, requestKey, serverLogs, timeRange, logType, search]);

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
    }, [requestKey, timeRange, search]);

    const copyFilteredJournal = useCallback(async () => {
        if (filteredLogs.length === 0) return;

        const sequence = ++copySequenceRef.current;
        if (copyFeedbackTimerRef.current !== null) {
            window.clearTimeout(copyFeedbackTimerRef.current);
        }

        try {
            if (!navigator.clipboard?.writeText) {
                throw new Error('Clipboard access is unavailable');
            }
            await navigator.clipboard.writeText(serializeJournalLogs(filteredLogs));
            if (sequence !== copySequenceRef.current) return;
            setCopyStatus('copied');
        } catch {
            if (sequence !== copySequenceRef.current) return;
            setCopyStatus('error');
        }

        copyFeedbackTimerRef.current = window.setTimeout(() => {
            if (sequence === copySequenceRef.current) setCopyStatus('idle');
        }, 2000);
    }, [filteredLogs]);

    // The API returns newest-first. Auto-follow therefore tracks the top edge.
    useEffect(() => {
        if (autoScroll && tableBodyRef.current) {
            tableBodyRef.current.scrollTop = 0;
        }
    }, [filteredLogs, autoScroll]);

    const handleScroll = () => {
        const el = tableBodyRef.current;
        if (!el) return;
        setAutoScroll(el.scrollTop < 40);
    };

    const scopedLastTradeLatency = lastTradeLatency?.sessionScope === sessionScope
        ? lastTradeLatency.latencyMs
        : undefined;

    // ── Render ─────────────────────────────────────────────────────────────
    return (
        <div className="h-full flex flex-col bg-[#131316] text-[13px] font-normal font-sans">

            {/* ── Toolbar ─────────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-1.5 px-2 py-1 border-b border-zinc-700 bg-[#1a1a1a] shrink-0 select-none">

                {/* Type filter */}
                <div className="flex items-center gap-1">
                    <span className="text-[12px] font-normal text-zinc-500 uppercase tracking-normal">Type:</span>
                    <select
                        value={logType}
                        onChange={e => setLogType(Number(e.target.value))}
                        className="bg-zinc-800 text-zinc-300 text-[12px] font-normal border border-zinc-700 rounded px-1 py-0.5 cursor-pointer hover:border-zinc-500 outline-none"
                    >
                        {LOG_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                    </select>
                </div>

                {/* Mode filter */}
                <div className="flex items-center gap-1">
                    <span className="text-[12px] font-normal text-zinc-500 uppercase tracking-normal">Mode:</span>
                    <select
                        value={logMode}
                        onChange={e => setLogMode(Number(e.target.value))}
                        className="bg-zinc-800 text-zinc-300 text-[12px] font-normal border border-zinc-700 rounded px-1 py-0.5 cursor-pointer hover:border-zinc-500 outline-none"
                    >
                        {LOG_MODES.map(m => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                    </select>
                </div>

                {/* Time range pills */}
                <div className="flex items-center gap-0.5">
                    {TIME_RANGES.map(t => (
                        <button
                            key={t.label}
                            onClick={() => setTimeRange(t.hours)}
                            className={`rtx-journal-time-btn px-2 py-0.5 text-[12px] font-normal rounded transition-colors ${timeRange === t.hours
                                ? 'bg-zinc-600 text-white'
                                : 'text-zinc-400'
                                }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* Text search */}
                <div className="flex items-center gap-1 flex-1 min-w-[120px]">
                    <Icon name="search" size="xs" className="text-zinc-500" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Filter messages…"
                        className="flex-1 bg-zinc-800 text-zinc-300 text-[12px] font-normal border border-zinc-700 rounded px-1.5 py-0.5 outline-none focus:border-zinc-600 placeholder:text-zinc-600"
                    />
                </div>

                <div className="flex-1" />

                {/* Log count */}
                <span className="text-[12px] font-normal text-zinc-500">
                    {filteredLogs.length} entries
                </span>

                <span
                    data-testid="last-trade-latency"
                    role="status"
                    aria-live="polite"
                    className="text-[12px] font-normal text-zinc-400 whitespace-nowrap"
                    title="Latest locally measured total order-attempt time for this broker and account"
                >
                    Last trade latency: {formatLatencyMs(scopedLastTradeLatency)}
                </span>

                <button
                    type="button"
                    onClick={() => { void copyFilteredJournal(); }}
                    disabled={!scopeHasLoaded || filteredLogs.length === 0}
                    aria-label="Copy filtered journal"
                    title={`Copy ${filteredLogs.length} filtered journal ${filteredLogs.length === 1 ? 'entry' : 'entries'}`}
                    className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[12px] font-normal transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${copyStatus === 'copied'
                        ? 'border-emerald-700 text-emerald-400'
                        : copyStatus === 'error'
                            ? 'border-red-800 text-red-400'
                            : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                        }`}
                >
                    <Icon name={copyStatus === 'copied' ? 'check' : 'copy'} size="xs" />
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
                    onClick={() => setAutoScroll(current => !current)}
                    aria-pressed={autoScroll}
                    title="Toggle auto-follow newest entries"
                    className={`rounded border px-1.5 py-0.5 text-[12px] font-normal transition-colors ${autoScroll
                        ? 'border-zinc-600 bg-blue-950/30 text-blue-400'
                        : 'border-zinc-700 text-zinc-500 hover:border-zinc-500'
                        }`}
                >
                    ↑ Auto
                </button>

                <button
                    type="button"
                    onClick={refreshJournal}
                    disabled={!isAuthenticated || isLoading || isRefreshing}
                    aria-label="Refresh journal"
                    className="flex items-center gap-1 rounded border border-zinc-700 px-1.5 py-0.5 text-[12px] font-normal text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <Icon name="refresh" size="xs" className={isLoading || isRefreshing ? 'animate-spin' : ''} />
                    {isLoading ? 'Loading…' : isRefreshing ? 'Refreshing…' : 'Refresh'}
                </button>
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
                <div
                    ref={tableBodyRef}
                    onScroll={handleScroll}
                    className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700"
                >
                    <table className="rtx-journal-table w-full text-left border-collapse font-mono">
                        <thead className="sticky top-0 bg-[#191a1e] text-zinc-400 z-10 font-normal text-[12px] uppercase tracking-normal border-b border-zinc-600">
                            <tr className="h-[30px]">
                                <th className="p-1 pl-3 border-r border-zinc-700 w-36 whitespace-nowrap">Time</th>
                                <th className="p-1 border-r border-zinc-700 w-16">Code</th>
                                <th className="p-1 border-r border-zinc-700 w-20">Type</th>
                                <th className="p-1 border-r border-zinc-700 w-28">Source</th>
                                <th className="p-1 border-r border-zinc-700 w-24 whitespace-nowrap">Latency</th>
                                <th className="p-1 pl-2">Message</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/30 text-[13px] leading-[19.5px] font-normal">
                            {filteredLogs.map((log, i) => (
                                <tr
                                    key={log.id ?? log.client_order_id ?? log.request_id ?? log.position_ticket ?? log.order_ticket ?? `${log.datetime}-${log.code}-${log.type}-${i}`}
                                    className={`${getRowBg(log.type_text, i % 2 === 0)} h-[30px] hover:brightness-125 transition-all`}
                                >
                                    <td className="p-1 pl-3 border-r border-zinc-800/50 text-zinc-500 whitespace-nowrap">
                                        {formatDateTime(log.datetime)}
                                    </td>
                                    <td className={`p-1 border-r border-zinc-800/50 font-normal ${Number(log.code) ? 'text-red-400' : 'text-zinc-500'}`}>
                                        {log.code_text || (log.code === 0 ? 'OK' : String(log.code ?? ''))}
                                    </td>
                                    <td className="p-1 border-r border-zinc-800/50">
                                        <span className={`font-normal uppercase ${getTypeColor(log.type_text)}`}>
                                            {log.type_text || 'All'}
                                        </span>
                                    </td>
                                    <td className="p-1 border-r border-zinc-800/50 text-zinc-400 truncate max-w-[110px]" title={log.source}>
                                        {log.source}
                                    </td>
                                    <td className="p-1 border-r border-zinc-800/50 text-zinc-400 whitespace-nowrap">
                                        {formatLatencyMs(log.latency_ms)}
                                    </td>
                                    <td className={`p-1 pl-2 ${getTypeColor(log.type_text)} leading-snug`}>
                                        {log.message}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
