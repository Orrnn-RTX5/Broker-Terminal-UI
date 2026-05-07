import { Icon } from '../ui/Icon';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Flag } from 'lucide-react';
// --- Types ---

interface CalendarEvent {
    id: string;
    time: string; // ISO date string
    currency: string;
    event: string;
    priority: 'High' | 'Medium' | 'Low' | 'Holiday';
    period: string;
    actual: string;
    forecast: string;
    previous: string;
    country: string;
}

// --- Mock Data ---

const MOCK_EVENTS: CalendarEvent[] = [
    // Today
    { id: '1', time: '2026-01-19T09:00:00', currency: 'EUR', country: 'Germany', event: 'German PPI m/m', priority: 'Medium', period: 'Dec', actual: '0.2%', forecast: '0.1%', previous: '-0.1%' },
    { id: '2', time: '2026-01-19T10:30:00', currency: 'GBP', country: 'United Kingdom', event: 'Retail Sales m/m', priority: 'High', period: 'Dec', actual: '-1.2%', forecast: '-0.5%', previous: '0.1%' },
    { id: '3', time: '2026-01-19T14:30:00', currency: 'USD', country: 'United States', event: 'Empire State Manufacturing Index', priority: 'High', period: 'Jan', actual: '', forecast: '-4.9', previous: '-14.5' },
    { id: '4', time: '2026-01-19T16:00:00', currency: 'CAD', country: 'Canada', event: 'Bank of Canada Business Outlook Survey', priority: 'Medium', period: 'Q4', actual: '', forecast: '', previous: '' },

    // Tomorrow
    { id: '5', time: '2026-01-20T03:00:00', currency: 'CNY', country: 'China', event: 'GDP q/y', priority: 'High', period: 'Q4', actual: '', forecast: '5.3%', previous: '4.9%' },
    { id: '6', time: '2026-01-20T08:00:00', currency: 'GBP', country: 'United Kingdom', event: 'Claimant Count Change', priority: 'Medium', period: 'Dec', actual: '', forecast: '18.2K', previous: '16.0K' },
    { id: '7', time: '2026-01-20T11:00:00', currency: 'EUR', country: 'European Union', event: 'ZEW Economic Sentiment', priority: 'Medium', period: 'Jan', actual: '', forecast: '21.0', previous: '23.0' },

    // Day After
    { id: '8', time: '2026-01-21T08:30:00', currency: 'CAD', country: 'Canada', event: 'CPI m/m', priority: 'High', period: 'Dec', actual: '', forecast: '-0.3%', previous: '0.1%' },
    { id: '9', time: '2026-01-21T14:30:00', currency: 'USD', country: 'United States', event: 'Retail Sales m/m', priority: 'High', period: 'Dec', actual: '', forecast: '0.4%', previous: '0.3%' },

    // Holiday Example
    { id: '10', time: '2026-01-19T00:00:00', currency: 'USD', country: 'United States', event: 'Martin Luther King, Jr. Day', priority: 'Holiday', period: '', actual: '', forecast: '', previous: '' },
];

const PRIORITIES = ['High', 'Medium', 'Low', 'Holiday'];
const CURRENCIES = ['ALL', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'NZD'];
const COUNTRIES = [
    'All Countries', 'United States', 'European Union', 'United Kingdom', 'Japan',
    'Australia', 'Canada', 'Switzerland', 'China', 'New Zealand', 'Germany', 'France'
];

// --- Components ---

export function CalendarTab() {
    // State
    const [events, setEvents] = useState<CalendarEvent[]>(MOCK_EVENTS);
    const [filterPriority, setFilterPriority] = useState<string[]>(['High', 'Medium', 'Low', 'Holiday']);
    const [filterCurrency, setFilterCurrency] = useState<string[]>(['ALL']);
    const [filterCountry, setFilterCountry] = useState<string[]>(['All Countries']);
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, show: boolean } | null>(null);
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

    // Filter Logic
    const filteredEvents = useMemo(() => {
        return events.filter(e => {
            const matchPriority = filterPriority.includes(e.priority);
            const matchCurrency = filterCurrency.includes('ALL') || filterCurrency.includes(e.currency);
            const matchCountry = filterCountry.includes('All Countries') || filterCountry.includes(e.country);
            return matchPriority && matchCurrency && matchCountry;
        });
    }, [events, filterPriority, filterCurrency, filterCountry]);

    // Grouping Logic
    const groupedEvents = useMemo(() => {
        const groups: Record<string, CalendarEvent[]> = {};
        filteredEvents.forEach(e => {
            const date = new Date(e.time);
            const dateKey = date.toLocaleDateString('en-GB', {
                weekday: 'long',
                day: 'numeric',
                month: 'long'
            }); // "Monday, 19 January"
            if (!groups[dateKey]) groups[dateKey] = [];
            groups[dateKey].push(e);
        });
        // Sort groups by time (simple hack: using the first event's time)
        return Object.entries(groups).sort((a, b) => {
            return new Date(a[1][0].time).getTime() - new Date(b[1][0].time).getTime();
        });
    }, [filteredEvents]);

    // Helpers
    const getPriorityColor = (p: string) => {
        switch (p) {
            case 'High': return 'text-[#f87171]'; // Muted Red
            case 'Medium': return 'text-[#fbbf24]'; // Amber
            case 'Low': return 'text-[#60a5fa]'; // Soft Blue
            case 'Holiday': return 'text-zinc-500'; // Grey
            default: return 'text-zinc-400';
        }
    };

    const getPriorityIcon = (p: string) => {
        switch (p) {
            case 'High': return <Icon name="trending-up" size="xs" className="mr-1" />;
            case 'Medium': return <Icon name="trending-up" size="xs" className="mr-1 opacity-70" />; // Reuse or different icon
            case 'Low': return <Icon name="trending-down" size="xs" className="mr-1 opacity-50" />;
            case 'Holiday': return <Flag size={12} className="mr-1" />;
            default: return null;
        }
    };

    const formatTime = (isoString: string) => {
        return new Date(isoString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    };

    // Context Menu Handlers
    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, show: true });
    };

    const closeContextMenu = () => setContextMenu(null);

    useEffect(() => {
        const handleClick = () => closeContextMenu();
        document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    }, []);

    const toggleFilter = (list: string[], setList: Function, item: string, allKey: string = 'ALL') => {
        // Simple multi-select logic
        if (item === allKey) {
            setList([allKey]);
            return;
        }

        let newList = [...list];
        if (newList.includes(allKey)) newList = []; // Clear ALL if specific selected

        if (newList.includes(item)) {
            newList = newList.filter(i => i !== item);
        } else {
            newList.push(item);
        }

        if (newList.length === 0) newList = [allKey]; // Revert to ALL if empty
        setList(newList);
    };

    return (
        <div className="h-full flex flex-col bg-[#131316] font-sans text-[12px] relative" onContextMenu={handleContextMenu}>
            <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700">
                <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-[#191a1e] text-zinc-400 z-10 font-bold text-[10px] uppercase tracking-wider border-b border-zinc-600 shadow-sm">
                        <tr>
                            <th className="p-1 pl-3 border-r border-zinc-700 w-20">Time</th>
                            <th className="p-1 border-r border-zinc-700 w-16 text-center">Cur.</th>
                            <th className="p-1 border-r border-zinc-700 w-16 text-center">Imp.</th>
                            <th className="p-1 border-r border-zinc-700">Event</th>
                            <th className="p-1 border-r border-zinc-700 w-20 text-center">Period</th>
                            <th className="p-1 border-r border-zinc-700 w-20 text-right">Actual</th>
                            <th className="p-1 border-r border-zinc-700 w-20 text-right">Forecast</th>
                            <th className="p-1 w-20 text-right pr-3">Previous</th>
                        </tr>
                    </thead>
                    <tbody className="text-zinc-300">
                        {groupedEvents.map(([dateLabel, groupEvents]) => (
                            <React.Fragment key={dateLabel}>
                                {/* Date Header */}
                                <tr className="bg-[#262626] border-b border-zinc-800 sticky top-[25px] z-0">
                                    <td colSpan={8} className="p-1 pl-3 font-medium text-blue-400/90 text-[11px] border-b border-zinc-700/50">
                                        {dateLabel}
                                    </td>
                                </tr>
                                {/* Events */}
                                {groupEvents.map((e, i) => (
                                    <tr
                                        key={e.id}
                                        onClick={() => setSelectedEventId(e.id)}
                                        className={`
                                            ${selectedEventId === e.id ? 'bg-[#8a8a8f]/20' : (i % 2 === 0 ? 'bg-[#131316]' : 'bg-[#0f0f12]')}
                                            hover:bg-[#191a1e] transition-colors cursor-default
                                            ${e.priority === 'Holiday' ? 'text-zinc-500 italic' : ''}
                                            border-b border-zinc-800/50
                                        `}
                                    >
                                        <td className="p-1 pl-3 border-r border-zinc-800/50 text-zinc-400 font-mono text-[11px]">{formatTime(e.time)}</td>
                                        <td className="p-1 border-r border-zinc-800/50 text-center font-bold text-zinc-300">{e.currency}</td>
                                        <td className="p-1 border-r border-zinc-800/50 text-center">
                                            <div className={`flex items-center justify-center ${getPriorityColor(e.priority)}`}>
                                                {getPriorityIcon(e.priority)}
                                            </div>
                                        </td>
                                        <td className="p-1 border-r border-zinc-800/50 font-medium">
                                            {e.event}
                                        </td>
                                        <td className="p-1 border-r border-zinc-800/50 text-center text-zinc-500 text-[11px]">{e.period}</td>
                                        <td className={`p-1 border-r border-zinc-800/50 text-right font-mono ${e.actual && e.actual.includes('-') ? 'text-red-400' : 'text-emerald-400'}`}>
                                            {e.actual}
                                        </td>
                                        <td className="p-1 border-r border-zinc-800/50 text-right font-mono text-zinc-400">{e.forecast}</td>
                                        <td className="p-1 pr-3 text-right font-mono text-zinc-500">{e.previous}</td>
                                    </tr>
                                ))}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Context Menu */}
            {contextMenu && contextMenu.show && (
                <div
                    className="fixed bg-[#131316] border border-zinc-700 shadow-xl z-50 py-1 rounded w-56 text-[12px] text-zinc-200"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="px-3 py-1.5 hover:bg-[#8a8a8f] hover:text-white cursor-pointer flex justify-between items-center group relative">
                        <span>Add All Events</span>
                    </div>
                    <div className="px-3 py-1.5 hover:bg-[#8a8a8f] hover:text-white cursor-pointer flex justify-between items-center">
                        <span>Refresh</span>
                        <span className="text-zinc-500 group-hover:text-white text-[10px]">F5</span>
                    </div>
                    <div className="h-[1px] bg-zinc-700 my-1"></div>

                    {/* Priorities Submenu */}
                    <div className="px-3 py-1.5 hover:bg-[#8a8a8f] hover:text-white cursor-pointer flex justify-between items-center group relative">
                        <span>Priority</span>
                        <Icon name="chevron-right" size="xs" />

                        <div className="absolute left-full top-0 ml-1 bg-[#131316] border border-zinc-700 shadow-xl rounded w-40 hidden group-hover:block">
                            {PRIORITIES.map(p => (
                                <div
                                    key={p}
                                    className="px-3 py-1.5 hover:bg-[#8a8a8f] hover:text-white cursor-pointer flex items-center gap-2"
                                    onClick={() => toggleFilter(filterPriority, setFilterPriority, p, '')} // No 'ALL' for priority in this mock, just toggle
                                >
                                    {filterPriority.includes(p) && <Icon name="check" size="xs" />}
                                    <span className={!filterPriority.includes(p) ? 'pl-5' : ''}>{p}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Currencies Submenu */}
                    <div className="px-3 py-1.5 hover:bg-[#8a8a8f] hover:text-white cursor-pointer flex justify-between items-center group relative">
                        <span>Currency</span>
                        <Icon name="chevron-right" size="xs" />

                        <div className="absolute left-full top-0 ml-1 bg-[#131316] border border-zinc-700 shadow-xl rounded w-40 hidden group-hover:block max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700">
                            {CURRENCIES.map(c => (
                                <div
                                    key={c}
                                    className="px-3 py-1.5 hover:bg-[#8a8a8f] hover:text-white cursor-pointer flex items-center gap-2"
                                    onClick={() => toggleFilter(filterCurrency, setFilterCurrency, c, 'ALL')}
                                >
                                    {filterCurrency.includes(c) && <Icon name="check" size="xs" />}
                                    <span className={!filterCurrency.includes(c) ? 'pl-5' : ''}>{c}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Countries Submenu */}
                    <div className="px-3 py-1.5 hover:bg-[#8a8a8f] hover:text-white cursor-pointer flex justify-between items-center group relative">
                        <span>Country</span>
                        <Icon name="chevron-right" size="xs" />

                        <div className="absolute left-full top-0 ml-1 bg-[#131316] border border-zinc-700 shadow-xl rounded w-40 hidden group-hover:block max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700">
                            {COUNTRIES.map(c => (
                                <div
                                    key={c}
                                    className="px-3 py-1.5 hover:bg-[#8a8a8f] hover:text-white cursor-pointer flex items-center gap-2"
                                    onClick={() => toggleFilter(filterCountry, setFilterCountry, c, 'All Countries')}
                                >
                                    {filterCountry.includes(c) && <Icon name="check" size="xs" />}
                                    <span className={!filterCountry.includes(c) ? 'pl-5' : ''}>{c}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="h-[1px] bg-zinc-700 my-1"></div>
                    <div className="px-3 py-1.5 hover:bg-[#8a8a8f] hover:text-white cursor-pointer">Auto Arrange</div>
                    <div className="px-3 py-1.5 hover:bg-[#8a8a8f] hover:text-white cursor-pointer">Grid</div>
                </div>
            )}
        </div>
    );
}
