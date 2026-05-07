/**
 * Economic Calendar Component (MT5-style) - ENHANCED
 * Shows upcoming economic events with filters, alerts, real-time updates, and advanced features
 */

import { Icon } from './ui/Icon';
import React, { useState, useMemo, useEffect } from 'react';
import { api } from '../services/api';
import { API_ENDPOINTS } from '../config/api';
import { useAlertStore } from '../store/useAlertStore';

// ============================================================================
// Types
// ============================================================================

export interface EconomicEvent {
  id: string;
  time: string; // ISO date string
  currency: string;
  country: string;
  event: string;
  impact: 'High' | 'Medium' | 'Low';
  period: string;
  actual: string;
  forecast: string;
  previous: string;
  description?: string;
}

interface HistoricalOccurrence {
  date: string;
  actual: string;
  forecast: string;
  previous: string;
  pipMovement: number; // positive or negative
}

type DateRange = 'Today' | 'This Week' | 'Next Week' | 'Custom';
type ViewMode = 'day' | 'week';

interface EconomicCalendarProps {
  onClose?: () => void;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetch economic events from API
 * TODO: Implement actual API endpoint when backend is ready
 */
const fetchEconomicEvents = async (params?: { from?: string; to?: string; currencies?: string[]; impact?: string[] }): Promise<EconomicEvent[]> => {
  try {
    const data = await api.economicCalendar.getEvents(params);
    return data as any[];
  } catch (error) {
    console.error('[EconomicCalendar] Failed to fetch events:', error);
    return [];
  }
};

/**
 * Fetch historical data for an event
 * TODO: Implement actual API endpoint when backend is ready
 */
const fetchEventHistoricalData = async (_eventName: string): Promise<HistoricalOccurrence[]> => {
  try {
    // Placeholder: Replace with actual API call
    // const response = await fetch(`${API_ENDPOINTS.economicCalendar.history}?event=${encodeURIComponent(eventName)}`);
    // if (!response.ok) throw new Error('Failed to fetch historical data');
    // return await response.json();

    // Return empty array until API is implemented
    return [];
  } catch (error) {
    console.error('[EconomicCalendar] Failed to fetch historical data:', error);
    return [];
  }
};

// ============================================================================
// Main Component
// ============================================================================

export const EconomicCalendar: React.FC<EconomicCalendarProps> = ({ onClose }) => {
  const [events, setEvents] = useState<EconomicEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>('This Week');
  const [selectedCurrencies, setSelectedCurrencies] = useState<string[]>([]);
  const [selectedImpacts, setSelectedImpacts] = useState<string[]>(['High', 'Medium', 'Low']);
  const [detailEvent, setDetailEvent] = useState<EconomicEvent | null>(null);
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [currentTime, setCurrentTime] = useState(Date.now()); // For live countdown
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [favorites, setFavorites] = useState<string[]>(() => {
    const stored = localStorage.getItem('rtx5-event-favorites');
    return stored ? JSON.parse(stored) : [];
  });
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const { alerts, addAlert } = useAlertStore();
  const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY'];

  // Fetch events on mount
  useEffect(() => {
    const loadEvents = async () => {
      setIsLoading(true);

      const params: any = {};
      if (dateRange === 'Today') {
        params.from = new Date().toISOString().split('T')[0];
        params.to = params.from;
      } else if (dateRange === 'This Week') {
        const now = new Date();
        params.from = now.toISOString().split('T')[0];
        const nextWeek = new Date();
        nextWeek.setDate(now.getDate() + 7);
        params.to = nextWeek.toISOString().split('T')[0];
      } else if (dateRange === 'Custom' && customDateFrom && customDateTo) {
        params.from = customDateFrom;
        params.to = customDateTo;
      }

      if (selectedCurrencies.length > 0) params.currencies = selectedCurrencies;
      if (selectedImpacts.length > 0) params.impact = selectedImpacts.map(i => i.toLowerCase());

      const data = await fetchEconomicEvents(params);
      setEvents(data);
      setIsLoading(false);
    };

    loadEvents();
  }, [dateRange, customDateFrom, customDateTo, selectedCurrencies, selectedImpacts]);

  // Live countdown timer - updates every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Persist favorites to localStorage
  useEffect(() => {
    localStorage.setItem('rtx5-event-favorites', JSON.stringify(favorites));
  }, [favorites]);

  // Filter events by date range
  const filteredByDate = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return events.filter(event => {
      const eventDate = new Date(event.time);

      if (dateRange === 'Today') {
        const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
        return eventDay.getTime() === today.getTime();
      } else if (dateRange === 'This Week') {
        const weekEnd = new Date(today);
        weekEnd.setDate(weekEnd.getDate() + 7);
        return eventDate >= today && eventDate <= weekEnd;
      } else if (dateRange === 'Next Week') {
        const weekStart = new Date(today);
        weekStart.setDate(weekStart.getDate() + 7);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);
        return eventDate >= weekStart && eventDate <= weekEnd;
      } else if (dateRange === 'Custom' && customDateFrom && customDateTo) {
        const from = new Date(customDateFrom);
        const to = new Date(customDateTo);
        to.setHours(23, 59, 59);
        return eventDate >= from && eventDate <= to;
      }
      return true;
    });
  }, [events, dateRange, customDateFrom, customDateTo]);

  // Filter by currency, impact, and favorites
  const filteredEvents = useMemo(() => {
    return filteredByDate.filter(event => {
      const currencyMatch = selectedCurrencies.length === 0 || selectedCurrencies.includes(event.currency);
      const impactMatch = selectedImpacts.includes(event.impact);
      const favoriteMatch = !showFavoritesOnly || favorites.includes(event.event);
      return currencyMatch && impactMatch && favoriteMatch;
    });
  }, [filteredByDate, selectedCurrencies, selectedImpacts, showFavoritesOnly, favorites]);

  // Group by date for day view
  const groupedEvents = useMemo(() => {
    const groups: Record<string, EconomicEvent[]> = {};
    filteredEvents.forEach(event => {
      const date = new Date(event.time);
      const dateKey = date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(event);
    });

    return Object.entries(groups).sort((a, b) => {
      return new Date(a[1][0].time).getTime() - new Date(b[1][0].time).getTime();
    });
  }, [filteredEvents]);

  // Group by weekday for week view
  const weekViewData = useMemo(() => {
    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const grouped: Record<string, EconomicEvent[]> = {
      Monday: [],
      Tuesday: [],
      Wednesday: [],
      Thursday: [],
      Friday: []
    };

    filteredEvents.forEach(event => {
      const date = new Date(event.time);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
      if (grouped[dayName]) {
        grouped[dayName].push(event);
      }
    });

    return weekdays.map(day => ({
      day,
      events: grouped[day].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    }));
  }, [filteredEvents]);

  // Find next event with countdown
  const nextEvent = useMemo(() => {
    const now = new Date();
    const upcoming = filteredEvents
      .filter(e => new Date(e.time) > now)
      .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    return upcoming[0] || null;
  }, [filteredEvents]);

  // Get countdown string (HH:MM:SS)
  const getCountdown = (eventTime: string): { text: string; isLive: boolean; isUrgent: boolean } => {
    const now = currentTime;
    const event = new Date(eventTime);
    const diff = event.getTime() - now;

    // Event is happening now (within ±15 minutes window)
    if (Math.abs(diff) <= 15 * 60 * 1000) {
      return { text: 'LIVE', isLive: true, isUrgent: false };
    }

    // Event has passed
    if (diff < 0) {
      return { text: '-', isLive: false, isUrgent: false };
    }

    // Event is within 24 hours
    if (diff <= 24 * 60 * 60 * 1000) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      const isUrgent = diff <= 5 * 60 * 1000; // Less than 5 minutes
      return {
        text: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
        isLive: false,
        isUrgent
      };
    }

    // More than 24 hours away
    return { text: '-', isLive: false, isUrgent: false };
  };

  // Check if event is within 30 minutes
  const isUpcoming = (eventTime: string) => {
    const now = new Date();
    const event = new Date(eventTime);
    const diff = event.getTime() - now.getTime();
    return diff > 0 && diff <= 30 * 60 * 1000; // 30 minutes
  };

  // Get impact color
  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'High': return 'bg-red-500';
      case 'Medium': return 'bg-orange-500';
      case 'Low': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  // Get difference indicator
  const getDifferenceIndicator = (actual: string, forecast: string) => {
    if (!actual || !forecast) return null;

    const actualNum = parseFloat(actual.replace(/[^0-9.-]/g, ''));
    const forecastNum = parseFloat(forecast.replace(/[^0-9.-]/g, ''));

    if (isNaN(actualNum) || isNaN(forecastNum)) return null;

    if (actualNum > forecastNum) {
      return <Icon name="trending-up" size="sm" className="text-emerald-400" />;
    } else if (actualNum < forecastNum) {
      return <Icon name="trending-down" size="sm" className="text-red-400" />;
    }
    return <Icon name="minus" size="sm" className="text-zinc-500" />;
  };

  // Toggle currency filter
  const toggleCurrency = (currency: string) => {
    setSelectedCurrencies(prev =>
      prev.includes(currency)
        ? prev.filter(c => c !== currency)
        : [...prev, currency]
    );
  };

  // Toggle impact filter
  const toggleImpact = (impact: string) => {
    setSelectedImpacts(prev =>
      prev.includes(impact)
        ? prev.filter(i => i !== impact)
        : [...prev, impact]
    );
  };

  // Toggle favorite
  const toggleFavorite = (eventName: string) => {
    setFavorites(prev =>
      prev.includes(eventName)
        ? prev.filter(e => e !== eventName)
        : [...prev, eventName]
    );
  };

  // Check if event has alert
  const hasAlert = (event: EconomicEvent): boolean => {
    return alerts.some(alert =>
      alert.symbol === event.currency &&
      alert.status === 'active' &&
      alert.enabled
    );
  };

  // Handle set alert (5 minutes before event)
  const handleSetAlert = (event: EconomicEvent) => {
    const eventTime = new Date(event.time);
    const alertTime = new Date(eventTime.getTime() - 5 * 60 * 1000); // 5 minutes before

    // Create alert via useAlertStore
    addAlert({
      symbol: event.currency,
      condition: 'price_above', // Dummy condition
      price: 0, // Event-based alert
      expiration: eventTime.getTime(),
      notifyMethod: 'both',
      message: `Economic Event: ${event.event} in 5 minutes`
    });

    // Also dispatch custom event for chart integration if needed
    window.dispatchEvent(new CustomEvent('set-event-alert', {
      detail: {
        symbol: event.currency,
        event: event.event,
        time: event.time
      }
    }));
  };

  // Handle show on chart
  const handleShowOnChart = (event: EconomicEvent) => {
    window.dispatchEvent(new CustomEvent('addChartMarker', {
      detail: {
        time: event.time,
        name: event.event,
        currency: event.currency,
        impact: event.impact
      }
    }));
  };

  return (
    <div className="flex flex-col h-full bg-[#131316] text-zinc-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 bg-[#252526]">
        <div className="flex items-center gap-3">
          <Icon name="calendar" size="lg" className="text-blue-500" />
          <h2 className="text-sm font-semibold text-zinc-200">Economic Calendar</h2>
          {nextEvent && (
            <div className="flex items-center gap-2 ml-4 text-xs text-zinc-400">
              <Icon name="clock" size="xs" />
              <span>Next: {nextEvent.event} in {Math.floor((new Date(nextEvent.time).getTime() - new Date().getTime()) / 60000)}m</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 bg-zinc-800 rounded p-0.5">
            <button
              onClick={() => setViewMode('day')}
              className={`px-2 py-1 text-xs rounded transition-colors ${viewMode === 'day' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                }`}
            >
              Day
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={`px-2 py-1 text-xs rounded transition-colors ${viewMode === 'week' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                }`}
            >
              Week
            </button>
          </div>
          {/* Favorites Toggle */}
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${showFavoritesOnly ? 'bg-yellow-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}
            title="Show favorites only"
          >
            <Icon name="check-circle" size="xs" />
            {favorites.length > 0 && <span>({favorites.length})</span>}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-white transition-colors p-1 hover:bg-zinc-700/50 rounded"
            >
              <Icon name="x-close" size="md" />
            </button>
          )}
        </div>
      </div>

      {/* Date Range Selector */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-700 bg-[#131316]">
        <span className="text-xs text-zinc-500 mr-2">Range:</span>
        {(['Today', 'This Week', 'Next Week', 'Custom'] as DateRange[]).map((range) => (
          <button
            key={range}
            onClick={() => setDateRange(range)}
            className={`px-3 py-1 text-xs rounded transition-colors ${dateRange === range
              ? 'bg-blue-600 text-white'
              : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
              }`}
          >
            {range}
          </button>
        ))}
        {dateRange === 'Custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              value={customDateFrom}
              onChange={(e) => setCustomDateFrom(e.target.value)}
              className="bg-[#252526] border border-zinc-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-zinc-600"
            />
            <span className="text-zinc-600">to</span>
            <input
              type="date"
              value={customDateTo}
              onChange={(e) => setCustomDateTo(e.target.value)}
              className="bg-[#252526] border border-zinc-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-zinc-600"
            />
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-zinc-700 bg-[#252526]">
        <Icon name="filter" size="sm" className="text-zinc-500" />

        {/* Currency Filters */}
        <div className="flex flex-wrap gap-1">
          {currencies.map((currency) => (
            <button
              key={currency}
              onClick={() => toggleCurrency(currency)}
              className={`px-2 py-1 text-xs rounded transition-colors ${selectedCurrencies.includes(currency)
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
            >
              {currency}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-zinc-700 mx-2" />

        {/* Impact Filters */}
        <div className="flex gap-1">
          {['High', 'Medium', 'Low'].map((impact) => (
            <button
              key={impact}
              onClick={() => toggleImpact(impact)}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${selectedImpacts.includes(impact)
                ? 'bg-zinc-700 text-white'
                : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'
                }`}
            >
              <div className={`w-2 h-2 rounded-full ${getImpactColor(impact)}`} />
              {impact}
            </button>
          ))}
        </div>

        {selectedCurrencies.length > 0 && (
          <button
            onClick={() => setSelectedCurrencies([])}
            className="ml-auto text-xs text-zinc-500 hover:text-white"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" />
              Loading economic events...
            </div>
          </div>
        ) : viewMode === 'day' ? (
          <DayView
            groupedEvents={groupedEvents}
            isUpcoming={isUpcoming}
            getCountdown={getCountdown}
            getImpactColor={getImpactColor}
            getDifferenceIndicator={getDifferenceIndicator}
            favorites={favorites}
            toggleFavorite={toggleFavorite}
            hasAlert={hasAlert}
            handleSetAlert={handleSetAlert}
            handleShowOnChart={handleShowOnChart}
            setDetailEvent={setDetailEvent}
            expandedEventId={expandedEventId}
            setExpandedEventId={setExpandedEventId}
          />
        ) : (
          <WeekView
            weekViewData={weekViewData}
            getImpactColor={getImpactColor}
            favorites={favorites}
            toggleFavorite={toggleFavorite}
            setDetailEvent={setDetailEvent}
          />
        )}
      </div>

      {/* Event Detail Popup */}
      {detailEvent && (
        <EventDetailPopup
          event={detailEvent}
          onClose={() => setDetailEvent(null)}
          onSetAlert={handleSetAlert}
          onShowOnChart={handleShowOnChart}
          hasAlert={hasAlert(detailEvent)}
          isFavorite={favorites.includes(detailEvent.event)}
          toggleFavorite={() => toggleFavorite(detailEvent.event)}
        />
      )}
    </div>
  );
};

// ============================================================================
// Day View Component
// ============================================================================

interface DayViewProps {
  groupedEvents: [string, EconomicEvent[]][];
  isUpcoming: (time: string) => boolean;
  getCountdown: (time: string) => { text: string; isLive: boolean; isUrgent: boolean };
  getImpactColor: (impact: string) => string;
  getDifferenceIndicator: (actual: string, forecast: string) => React.ReactNode;
  favorites: string[];
  toggleFavorite: (eventName: string) => void;
  hasAlert: (event: EconomicEvent) => boolean;
  handleSetAlert: (event: EconomicEvent) => void;
  handleShowOnChart: (event: EconomicEvent) => void;
  setDetailEvent: (event: EconomicEvent) => void;
  expandedEventId: string | null;
  setExpandedEventId: (id: string | null) => void;
}

const DayView: React.FC<DayViewProps> = ({
  groupedEvents,
  isUpcoming,
  getCountdown,
  getImpactColor,
  getDifferenceIndicator,
  favorites,
  toggleFavorite,
  hasAlert,
  handleSetAlert,
  handleShowOnChart,
  setDetailEvent,
  expandedEventId,
  setExpandedEventId
}) => {
  return (
    <table className="w-full text-xs border-collapse">
      <thead className="sticky top-0 bg-[#191a1e] text-zinc-400 z-10">
        <tr>
          <th className="px-3 py-2 text-left font-medium w-16">Time</th>
          <th className="px-3 py-2 text-left font-medium w-20">Countdown</th>
          <th className="px-3 py-2 text-left font-medium w-12">Cur.</th>
          <th className="px-3 py-2 text-center font-medium w-20">Impact</th>
          <th className="px-3 py-2 text-left font-medium">Event</th>
          <th className="px-3 py-2 text-center font-medium w-16">Period</th>
          <th className="px-3 py-2 text-right font-medium w-20">Actual</th>
          <th className="px-3 py-2 text-right font-medium w-20">Forecast</th>
          <th className="px-3 py-2 text-right font-medium w-20">Previous</th>
          <th className="px-3 py-2 text-center font-medium w-24">Actions</th>
        </tr>
      </thead>
      <tbody>
        {groupedEvents.length === 0 ? (
          <tr>
            <td colSpan={10} className="text-center py-12 text-zinc-500">
              No events found for selected filters
            </td>
          </tr>
        ) : (
          groupedEvents.map(([dateLabel, events]) => (
            <React.Fragment key={dateLabel}>
              {/* Date Header */}
              <tr className="bg-[#262626] border-y border-zinc-800">
                <td colSpan={10} className="px-3 py-1.5 font-medium text-blue-400 text-xs">
                  {dateLabel}
                </td>
              </tr>
              {/* Events */}
              {events.map((event) => {
                const countdown = getCountdown(event.time);
                const isExpanded = expandedEventId === event.id;
                const [historicalData, setHistoricalData] = useState<HistoricalOccurrence[]>([]);
                const [isLoadingHistory, setIsLoadingHistory] = useState(false);

                const handleExpand = async () => {
                  const newExpandedId = isExpanded ? null : event.id;
                  setExpandedEventId(newExpandedId);

                  if (newExpandedId && historicalData.length === 0) {
                    setIsLoadingHistory(true);
                    const data = await fetchEventHistoricalData(event.event);
                    setHistoricalData(data);
                    setIsLoadingHistory(false);
                  }
                };

                return (
                  <React.Fragment key={event.id}>
                    <tr
                      className={`hover:bg-zinc-800/50 transition-colors border-b border-zinc-800/50 ${isUpcoming(event.time) ? 'bg-yellow-500/10 border-yellow-500/30' : ''
                        } ${countdown.isLive ? 'bg-red-500/10 border-red-500/30' : ''}`}
                    >
                      <td className="px-3 py-2 font-mono text-zinc-400">
                        {new Date(event.time).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false
                        })}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {countdown.isLive ? (
                          <span className="bg-red-600 text-white px-2 py-0.5 rounded font-bold text-[10px] animate-pulse">
                            LIVE
                          </span>
                        ) : countdown.isUrgent ? (
                          <span className="text-red-400 font-bold animate-pulse">
                            {countdown.text}
                          </span>
                        ) : countdown.text !== '-' ? (
                          <span className="text-yellow-400">{countdown.text}</span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-bold text-zinc-200">{event.currency}</td>
                      <td className="px-3 py-2 text-center">
                        <ImpactMeter impact={event.impact} getImpactColor={getImpactColor} />
                      </td>
                      <td className="px-3 py-2 font-medium">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleExpand}
                            className="text-zinc-500 hover:text-blue-400 transition-colors"
                          >
                            <Icon name="chevron-right" size="sm"
                              className={`transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            />
                          </button>
                          <span
                            className="cursor-pointer hover:text-blue-400"
                            onClick={() => setDetailEvent(event)}
                          >
                            {event.event}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center text-zinc-500">{event.period}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold ${event.actual ? 'text-white' : 'text-zinc-600'
                        }`}>
                        <div className="flex items-center justify-end gap-1">
                          {event.actual || '-'}
                          {getDifferenceIndicator(event.actual, event.forecast)}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-zinc-400">
                        {event.forecast || '-'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-zinc-500">
                        {event.previous || '-'}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1">
                          {/* Favorite */}
                          <button
                            onClick={() => toggleFavorite(event.event)}
                            className="p-1 text-zinc-500 hover:text-yellow-500 hover:bg-zinc-700/50 rounded transition-colors"
                            title="Add to favorites"
                          >
                            <Icon name="check-circle" size="xs" />
                          </button>
                          {/* Alert */}
                          <button
                            onClick={() => handleSetAlert(event)}
                            className={`p-1 transition-colors rounded ${hasAlert(event)
                              ? 'text-yellow-500 bg-yellow-500/10'
                              : 'text-zinc-500 hover:text-yellow-500 hover:bg-zinc-700/50'
                              }`}
                            title="Set alert (5 min before)"
                          >
                            {hasAlert(event) ? <Icon name="bell" size="xs" /> : <Icon name="bell" size="xs" />}
                          </button>
                          {/* Show on Chart */}
                          <button
                            onClick={() => handleShowOnChart(event)}
                            className="p-1 text-zinc-500 hover:text-blue-500 hover:bg-zinc-700/50 rounded transition-colors"
                            title="Show on chart"
                          >
                            <Icon name="line-chart" size="xs" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {/* Historical Data Expansion */}
                    {isExpanded && (
                      <tr className="bg-zinc-900/50 border-b border-zinc-800">
                        <td colSpan={10} className="px-8 py-3">
                          <div className="text-xs">
                            <div className="text-zinc-400 font-semibold mb-2">Historical Impact (Last 3 Occurrences)</div>
                            {isLoadingHistory ? (
                              <div className="flex items-center gap-2 text-zinc-500">
                                <div className="w-3 h-3 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" />
                                Loading historical data...
                              </div>
                            ) : historicalData.length === 0 ? (
                              <div className="text-zinc-600">No historical data available</div>
                            ) : (
                              <div className="grid grid-cols-3 gap-3">
                                {historicalData.map((occ, idx) => (
                                  <div key={idx} className="bg-[#131316] rounded p-2 border border-zinc-800">
                                    <div className="text-zinc-500 text-[10px] mb-1">{occ.date}</div>
                                    <div className="space-y-0.5">
                                      <div className="flex justify-between">
                                        <span className="text-zinc-500">Actual:</span>
                                        <span className="text-white font-mono">{occ.actual}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-zinc-500">Forecast:</span>
                                        <span className="text-zinc-400 font-mono">{occ.forecast}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-zinc-500">Previous:</span>
                                        <span className="text-zinc-500 font-mono">{occ.previous}</span>
                                      </div>
                                      <div className="flex justify-between border-t border-zinc-700 pt-0.5 mt-0.5">
                                        <span className="text-zinc-500">Pip Move:</span>
                                        <span className={`font-mono font-bold ${occ.pipMovement > 0 ? 'text-emerald-400' : occ.pipMovement < 0 ? 'text-red-400' : 'text-zinc-500'
                                          }`}>
                                          {occ.pipMovement > 0 ? '+' : ''}{occ.pipMovement} pips
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          ))
        )}
      </tbody>
    </table>
  );
};

// ============================================================================
// Week View Component
// ============================================================================

interface WeekViewProps {
  weekViewData: { day: string; events: EconomicEvent[] }[];
  getImpactColor: (impact: string) => string;
  favorites: string[];
  toggleFavorite: (eventName: string) => void;
  setDetailEvent: (event: EconomicEvent) => void;
}

const WeekView: React.FC<WeekViewProps> = ({
  weekViewData,
  getImpactColor,
  favorites,
  toggleFavorite,
  setDetailEvent
}) => {
  return (
    <div className="grid grid-cols-5 gap-2 p-3 h-full">
      {weekViewData.map(({ day, events }) => (
        <div key={day} className="bg-[#252526] rounded border border-zinc-700 flex flex-col">
          <div className="px-3 py-2 border-b border-zinc-700 text-center font-semibold text-zinc-300 text-xs">
            {day}
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-1">
            {events.length === 0 ? (
              <div className="text-center text-zinc-600 text-[10px] mt-4">No events</div>
            ) : (
              events.map((event) => (
                <div
                  key={event.id}
                  className={`rounded p-1.5 cursor-pointer hover:bg-zinc-700/50 transition-colors border ${event.impact === 'High' ? 'border-red-500/30 bg-red-500/5' :
                    event.impact === 'Medium' ? 'border-orange-500/30 bg-orange-500/5' :
                      'border-yellow-500/30 bg-yellow-500/5'
                    }`}
                  onClick={() => setDetailEvent(event)}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-mono text-[10px] text-zinc-400">
                      {new Date(event.time).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                      })}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(event.event);
                      }}
                      className="text-zinc-600 hover:text-yellow-500"
                    >
                      <Icon name="check-circle" size="xs" />
                    </button>
                  </div>
                  <div className="flex items-start gap-1">
                    <div className={`w-1.5 h-1.5 rounded-full mt-1 ${getImpactColor(event.impact)}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-medium text-zinc-200 truncate" title={event.event}>
                        {event.event}
                      </div>
                      <div className="text-[9px] text-zinc-500">{event.currency}</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

// ============================================================================
// Impact Meter Component
// ============================================================================

interface ImpactMeterProps {
  impact: 'High' | 'Medium' | 'Low';
  getImpactColor: (impact: string) => string;
}

const ImpactMeter: React.FC<ImpactMeterProps> = ({ impact, getImpactColor }) => {
  const bars = impact === 'High' ? 3 : impact === 'Medium' ? 2 : 1;
  const historicalVolatility = impact === 'High' ? '80-150 pips' : impact === 'Medium' ? '30-80 pips' : '10-30 pips';

  return (
    <div className="flex items-center justify-center gap-0.5 group relative">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className={`w-1 h-3 rounded-sm ${i <= bars ? getImpactColor(impact) : 'bg-zinc-700'
            }`}
        />
      ))}
      {/* Tooltip */}
      <div className="absolute bottom-full mb-2 hidden group-hover:block z-50 pointer-events-none">
        <div className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-300 whitespace-nowrap shadow-lg">
          Historical Volatility: {historicalVolatility}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Event Detail Popup
// ============================================================================

interface EventDetailPopupProps {
  event: EconomicEvent;
  onClose: () => void;
  onSetAlert: (event: EconomicEvent) => void;
  onShowOnChart: (event: EconomicEvent) => void;
  hasAlert: boolean;
  isFavorite: boolean;
  toggleFavorite: () => void;
}

const EventDetailPopup: React.FC<EventDetailPopupProps> = ({
  event,
  onClose,
  onSetAlert,
  onShowOnChart,
  hasAlert,
  isFavorite,
  toggleFavorite
}) => {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#131316] border border-zinc-700 rounded-lg shadow-2xl w-[500px] animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
          <div className="flex items-center gap-2">
            <Icon name="info" size="md" className="text-blue-500" />
            <h3 className="text-sm font-semibold text-zinc-200">Event Details</h3>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white transition-colors"
          >
            <Icon name="x-close" size="md" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <h4 className="text-base font-semibold text-white mb-2">{event.event}</h4>
            <div className="flex items-center gap-3 text-xs text-zinc-400">
              <span className="font-bold text-zinc-200">{event.currency}</span>
              <span>•</span>
              <span>{event.country}</span>
              <span>•</span>
              <span>{new Date(event.time).toLocaleString()}</span>
            </div>
          </div>

          {event.description && (
            <div className="text-xs text-zinc-400 bg-[#252526] rounded p-3">
              {event.description}
            </div>
          )}

          <div className="grid grid-cols-3 gap-4 text-xs">
            <div className="bg-[#252526] rounded p-3">
              <div className="text-zinc-500 mb-1">Actual</div>
              <div className={`text-lg font-bold font-mono ${event.actual ? 'text-white' : 'text-zinc-600'}`}>
                {event.actual || '-'}
              </div>
            </div>
            <div className="bg-[#252526] rounded p-3">
              <div className="text-zinc-500 mb-1">Forecast</div>
              <div className="text-lg font-bold font-mono text-zinc-400">
                {event.forecast || '-'}
              </div>
            </div>
            <div className="bg-[#252526] rounded p-3">
              <div className="text-zinc-500 mb-1">Previous</div>
              <div className="text-lg font-bold font-mono text-zinc-500">
                {event.previous || '-'}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-zinc-700 bg-[#252526]">
          <button
            onClick={toggleFavorite}
            className={`flex items-center gap-2 px-3 py-2 rounded transition-colors text-sm ${isFavorite
              ? 'bg-yellow-600 hover:bg-yellow-700 text-white'
              : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
              }`}
          >
            <Icon name="check-circle" size="sm" />
            {isFavorite ? 'Favorited' : 'Favorite'}
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => {
                onShowOnChart(event);
                onClose();
              }}
              className="flex items-center gap-2 px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded transition-colors"
            >
              <Icon name="line-chart" size="sm" />
              Show on Chart
            </button>
            <button
              onClick={() => {
                onSetAlert(event);
                onClose();
              }}
              className={`flex items-center gap-2 px-3 py-2 text-sm rounded transition-colors ${hasAlert
                ? 'bg-yellow-700 text-white'
                : 'bg-yellow-600 hover:bg-yellow-700 text-white'
                }`}
            >
              {hasAlert ? <Icon name="bell" size="sm" /> : <Icon name="bell" size="sm" />}
              {hasAlert ? 'Alert Set' : 'Set Alert'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
