import { useUiTranslation } from '../../hooks/useUiTranslation';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import React, { useState, useMemo, useEffect } from 'react';
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

const PRIORITIES = ['High', 'Medium', 'Low', 'Holiday'] as const;
const CURRENCIES = ['ALL', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'NZD'];
const COUNTRIES = [
    'All Countries', 'United States', 'European Union', 'United Kingdom', 'Japan',
    'Australia', 'Canada', 'Switzerland', 'China', 'New Zealand', 'Germany', 'France'
];

function actualTone(actual: string): string {
    if (!actual) return '';
    return actual.includes('-') ? 'rtx-calendar-value--down' : 'rtx-calendar-value--up';
}

function ImpactMark({ priority }: { priority: CalendarEvent['priority'] }) {
    const tr = useUiTranslation();
    if (priority === 'Holiday') {
        return (
            <span className="rtx-calendar-impact rtx-calendar-impact--holiday" title={tr("Holiday")}>
                <Flag size={11} aria-hidden="true" />
            </span>
        );
    }

    return (
        <span
            className={`rtx-calendar-impact rtx-calendar-impact--${priority.toLowerCase()}`}
            title={tr(priority)}
            aria-label={tr(priority)}
        >
            <span className="rtx-calendar-impact__bar" />
            <span className="rtx-calendar-impact__bar" />
            <span className="rtx-calendar-impact__bar" />
        </span>
    );
}

// --- Components ---

export function CalendarTab() {
    const tr = useUiTranslation();
    const { i18n } = useTranslation();
    const locale = i18n.resolvedLanguage || i18n.language;
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
            const dateKey = date.toLocaleDateString(locale, {
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
    }, [filteredEvents, locale]);

    const formatTime = (isoString: string) => {
        return new Date(isoString).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
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

    const toggleFilter = (
        list: string[],
        setList: React.Dispatch<React.SetStateAction<string[]>>,
        item: string,
        allKey: string = 'ALL',
    ) => {
        if (item === allKey) {
            setList([allKey]);
            return;
        }

        let newList = [...list];
        if (newList.includes(allKey)) newList = [];

        if (newList.includes(item)) {
            newList = newList.filter(i => i !== item);
        } else {
            newList.push(item);
        }

        if (newList.length === 0) newList = allKey ? [allKey] : [...PRIORITIES];
        setList(newList);
    };

    const showAllEvents = () => {
        setFilterPriority([...PRIORITIES]);
        setFilterCurrency(['ALL']);
        setFilterCountry(['All Countries']);
        closeContextMenu();
    };

    const refreshEvents = () => {
        setEvents([...MOCK_EVENTS]);
        closeContextMenu();
    };

    return (
        <div className="rtx-calendar-tab h-full flex flex-col font-sans text-[14px] font-normal relative" onContextMenu={handleContextMenu}>
            <div className="rtx-calendar-tab__scroll">
                <table className="rtx-calendar-tab__table">
                    <thead className="rtx-calendar-tab__head font-normal text-[12px] leading-[18px]">
                        <tr>
                            <th className="rtx-calendar-tab__col--time">{tr("Time")}</th>
                            <th className="rtx-calendar-tab__col--currency">{tr("Cur.")}</th>
                            <th className="rtx-calendar-tab__col--impact">{tr("Imp.")}</th>
                            <th className="rtx-calendar-tab__col--event">{tr("Event")}</th>
                            <th className="rtx-calendar-tab__col--period">{tr("Period")}</th>
                            <th className="rtx-calendar-tab__col--actual">{tr("Actual")}</th>
                            <th className="rtx-calendar-tab__col--forecast">{tr("Forecast")}</th>
                            <th className="rtx-calendar-tab__col--previous">{tr("Previous")}</th>
                        </tr>
                    </thead>
                    <tbody className="rtx-calendar-tab__body text-[13px] font-normal leading-[19.5px]">
                        {groupedEvents.length === 0 && (
                            <tr className="rtx-calendar-empty">
                                <td colSpan={8}>{tr("No events match the current filters.")}</td>
                            </tr>
                        )}
                        {groupedEvents.map(([dateLabel, groupEvents]) => (
                            <React.Fragment key={dateLabel}>
                                <tr className="rtx-calendar-date">
                                    <td colSpan={8}>{dateLabel}</td>
                                </tr>
                                {groupEvents.map((e) => (
                                    <tr
                                        key={e.id}
                                        onClick={() => setSelectedEventId(e.id)}
                                        className="rtx-calendar-row"
                                        data-selected={selectedEventId === e.id || undefined}
                                        data-priority={e.priority}
                                    >
                                        <td className="rtx-calendar-tab__col--time">{formatTime(e.time)}</td>
                                        <td className="rtx-calendar-tab__col--currency">{e.currency}</td>
                                        <td className="rtx-calendar-tab__col--impact">
                                            <ImpactMark priority={e.priority} />
                                        </td>
                                        <td className="rtx-calendar-tab__col--event">{e.event}</td>
                                        <td className="rtx-calendar-tab__col--period">{e.period}</td>
                                        <td className={`rtx-calendar-tab__col--actual ${actualTone(e.actual)}`}>{e.actual}</td>
                                        <td className="rtx-calendar-tab__col--forecast">{e.forecast}</td>
                                        <td className="rtx-calendar-tab__col--previous">{e.previous}</td>
                                    </tr>
                                ))}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>

            {contextMenu && contextMenu.show && (
                <div
                    className="rtx-calendar-menu text-[14px] font-normal"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                    role="menu"
                    aria-label={tr("Calendar filters")}
                >
                    <button type="button" className="rtx-calendar-menu__item" role="menuitem" onClick={showAllEvents}>
                        {tr("Add All Events")}</button>
                    <button type="button" className="rtx-calendar-menu__item" role="menuitem" onClick={refreshEvents}>
                        <span>{tr("Refresh")}</span>
                        <span className="rtx-calendar-menu__shortcut text-[12px] font-normal">F5</span>
                    </button>
                    <div className="rtx-calendar-menu__divider" role="separator" />

                    <div className="rtx-calendar-menu__item" role="menuitem">
                        <span>{tr("Priority")}</span>
                        <Icon name="chevron-right" size="xs" className="rtx-calendar-menu__chevron" />
                        <div className="rtx-calendar-menu__submenu">
                            {PRIORITIES.map(p => (
                                <button
                                    type="button"
                                    key={p}
                                    className="rtx-calendar-menu__item rtx-calendar-menu__option"
                                    role="menuitem"
                                    data-checked={filterPriority.includes(p)}
                                    onClick={() => toggleFilter(filterPriority, setFilterPriority, p, '')}
                                >
                                    {filterPriority.includes(p) && <Icon name="check" size="xs" className="rtx-calendar-menu__check" />}
                                    <span>{tr(p)}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="rtx-calendar-menu__item" role="menuitem">
                        <span>{tr("Currency")}</span>
                        <Icon name="chevron-right" size="xs" className="rtx-calendar-menu__chevron" />
                        <div className="rtx-calendar-menu__submenu">
                            {CURRENCIES.map(c => (
                                <button
                                    type="button"
                                    key={c}
                                    className="rtx-calendar-menu__item rtx-calendar-menu__option"
                                    role="menuitem"
                                    data-checked={filterCurrency.includes(c)}
                                    onClick={() => toggleFilter(filterCurrency, setFilterCurrency, c, 'ALL')}
                                >
                                    {filterCurrency.includes(c) && <Icon name="check" size="xs" className="rtx-calendar-menu__check" />}
                                    <span>{c === 'ALL' ? tr('All') : c}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="rtx-calendar-menu__item" role="menuitem">
                        <span>{tr("Country")}</span>
                        <Icon name="chevron-right" size="xs" className="rtx-calendar-menu__chevron" />
                        <div className="rtx-calendar-menu__submenu">
                            {COUNTRIES.map(c => (
                                <button
                                    type="button"
                                    key={c}
                                    className="rtx-calendar-menu__item rtx-calendar-menu__option"
                                    role="menuitem"
                                    data-checked={filterCountry.includes(c)}
                                    onClick={() => toggleFilter(filterCountry, setFilterCountry, c, 'All Countries')}
                                >
                                    {filterCountry.includes(c) && <Icon name="check" size="xs" className="rtx-calendar-menu__check" />}
                                    <span>{tr(c)}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="rtx-calendar-menu__divider" role="separator" />
                    <button type="button" className="rtx-calendar-menu__item" role="menuitem">{tr("Auto Arrange")}</button>
                    <button type="button" className="rtx-calendar-menu__item" role="menuitem">{tr("Grid")}</button>
                </div>
            )}
        </div>
    );
}
