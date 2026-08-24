/**
 * JournalTab — MT5-style server journal panel
 * Fetches live logs from GET /api/v1/journal with full filter support.
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
import { useSystemJournalStore } from '../../store/useSystemJournalStore';

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

// ─── Component ────────────────────────────────────────────────────────────────

export function JournalTab() {
    const { logs: localLogs } = useSystemJournalStore();
    const [serverLogs, setServerLogs] = useState<JournalLogEntry[] | null>(null);
    const [fetchError, setFetchError] = useState<string | null>(null);

    // Filters
    const [logType, setLogType] = useState(0);   // 0 = All
    const [logMode, setLogMode] = useState(2);   // 2 = Full
    const [timeRange, setTimeRange] = useState(24);  // hours; 24h default
    const [search, setSearch] = useState('');

    const loadJournal = useCallback(async () => {
        try {
            const from = Math.floor(Date.now() / 1000) - timeRange * 3600;
            const data = await journalApi.getLogs({
                mode: logMode,
                type: logType,
                from,
                filter: search,
            });
            setServerLogs(data.logs || []);
            setFetchError(null);
        } catch (err) {
            setFetchError(err instanceof Error ? err.message : 'Journal API error');
        }
    }, [logMode, logType, timeRange, search]);

    useEffect(() => {
        void loadJournal();
        const timer = window.setInterval(() => { void loadJournal(); }, 15000);
        return () => window.clearInterval(timer);
    }, [loadJournal]);

    const logs = serverLogs ?? localLogs;

    // Auto-scroll
    const [autoScroll, setAutoScroll] = useState(true);
    const bottomRef = useRef<HTMLDivElement>(null);
    const tableBodyRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom
    useEffect(() => {
        if (autoScroll && bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, autoScroll]);

    // Client-side filtering
    const filteredLogs = React.useMemo(() => {
        if (logs.length === 0) return logs;

        let filtered = logs;

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
    }, [logs, timeRange, logType, search]);

    // ── Scroll detector — disable auto-scroll when user scrolls up ─────────
    const handleScroll = () => {
        const el = tableBodyRef.current;
        if (!el) return;
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        setAutoScroll(distFromBottom < 40);
    };

    // ── Render ─────────────────────────────────────────────────────────────
    return (
        <div className="h-full flex flex-col bg-[#131316] text-[12px] font-mono">

            {/* ── Toolbar ─────────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-1.5 px-2 py-1 border-b border-zinc-700 bg-[#1a1a1a] shrink-0 select-none">

                {/* Type filter */}
                <div className="flex items-center gap-1">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Type:</span>
                    <select
                        value={logType}
                        onChange={e => setLogType(Number(e.target.value))}
                        className="bg-zinc-800 text-zinc-300 text-[10px] border border-zinc-700 rounded px-1 py-0.5 cursor-pointer hover:border-zinc-500 outline-none"
                    >
                        {LOG_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                    </select>
                </div>

                {/* Mode filter */}
                <div className="flex items-center gap-1">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Mode:</span>
                    <select
                        value={logMode}
                        onChange={e => setLogMode(Number(e.target.value))}
                        className="bg-zinc-800 text-zinc-300 text-[10px] border border-zinc-700 rounded px-1 py-0.5 cursor-pointer hover:border-zinc-500 outline-none"
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
                            className={`rtx-journal-time-btn px-2 py-0.5 text-[10px] rounded transition-colors ${timeRange === t.hours
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
                        className="flex-1 bg-zinc-800 text-zinc-300 text-[10px] border border-zinc-700 rounded px-1.5 py-0.5 outline-none focus:border-zinc-600 placeholder:text-zinc-600"
                    />
                </div>

                <div className="flex-1" />

                {/* Log count */}
                <span className="text-[10px] text-zinc-500">
                    {filteredLogs.length} entries{fetchError ? ' (local)' : ''}
                </span>

                {/* Auto-scroll toggle */}
                <button
                    onClick={() => setAutoScroll(p => !p)}
                    title="Toggle auto-scroll"
                    className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${autoScroll
                        ? 'border-zinc-600 text-blue-400 bg-blue-950/30'
                        : 'border-zinc-700 text-zinc-500 hover:border-zinc-500'
                        }`}
                >
                    ↓ Auto
                </button>
            </div>

            {/* ── Status rows ──────────────────────────────────────────────── */}
            {filteredLogs.length === 0 && (
                <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs italic">
                    No journal entries for the selected filters
                </div>
            )}

            {/* ── Log table ────────────────────────────────────────────────── */}
            {filteredLogs.length > 0 && (
                <div
                    ref={tableBodyRef}
                    onScroll={handleScroll}
                    className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700"
                >
                    <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-[#191a1e] text-zinc-400 z-10 font-bold text-[10px] uppercase tracking-wider border-b border-zinc-600">
                            <tr>
                                <th className="p-1 pl-3 border-r border-zinc-700 w-36 whitespace-nowrap">Time</th>
                                <th className="p-1 border-r border-zinc-700 w-16">Code</th>
                                <th className="p-1 border-r border-zinc-700 w-20">Type</th>
                                <th className="p-1 border-r border-zinc-700 w-28">Source</th>
                                <th className="p-1 pl-2">Message</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/30">
                            {filteredLogs.map((log, i) => (
                                <tr
                                    key={i}
                                    className={`${getRowBg(log.type_text, i % 2 === 0)} hover:brightness-125 transition-all`}
                                >
                                    <td className="p-1 pl-3 border-r border-zinc-800/50 text-zinc-500 whitespace-nowrap text-[10px]">
                                        {formatDateTime(log.datetime)}
                                    </td>
                                    <td className={`p-1 border-r border-zinc-800/50 text-[10px] font-bold ${Number(log.code) ? 'text-red-400' : 'text-zinc-500'}`}>
                                        {log.code_text || (log.code === 0 ? 'OK' : String(log.code ?? ''))}
                                    </td>
                                    <td className="p-1 border-r border-zinc-800/50">
                                        <span className={`text-[10px] font-bold uppercase ${getTypeColor(log.type_text)}`}>
                                            {log.type_text || 'All'}
                                        </span>
                                    </td>
                                    <td className="p-1 border-r border-zinc-800/50 text-zinc-400 text-[11px] truncate max-w-[110px]" title={log.source}>
                                        {log.source}
                                    </td>
                                    <td className={`p-1 pl-2 ${getTypeColor(log.type_text)} leading-snug`}>
                                        {log.message}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div ref={bottomRef} />
                </div>
            )}
        </div>
    );
}
