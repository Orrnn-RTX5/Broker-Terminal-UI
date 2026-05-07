/**
 * NewsImpactAnalyzer Component
 * Shows how economic news events affect symbol prices historically
 */

import { Icon } from './ui/Icon';
import { useState, useEffect } from 'react';
type EventCategory = 'Employment' | 'Inflation' | 'Interest Rates' | 'GDP' | 'PMI' | 'Trade Balance';
type ImpactLevel = 'Low' | 'Medium' | 'High';

interface EconomicEvent {
  id: string;
  type: string;
  category: EventCategory;
  time: string;
  impact: ImpactLevel;
  currency: string;
  affectedSymbols: string[];
  forecast?: string;
  previous?: string;
  actual?: string;
}

async function fetchEvents(): Promise<EconomicEvent[]> {
  const { apiClient } = await import('../api/client');
  const data = await apiClient.get<EconomicEvent[]>('/api/economic-calendar');
  if (!data) throw new Error('Failed to fetch economic calendar');
  return data;
}

export function NewsImpactAnalyzer() {
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [upcomingEvents, setUpcomingEvents] = useState<EconomicEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEvents()
      .then(events => {
        setUpcomingEvents(events);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // Update time every second for countdowns
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-900">
        <div className="text-zinc-400">Loading economic calendar...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-900">
        <div className="text-red-400">Error: {error}</div>
      </div>
    );
  }

  const getImpactColor = (impact: ImpactLevel) => {
    return impact === 'High' ? 'bg-red-500/20 text-red-400 border-red-500/50' :
      impact === 'Medium' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50' :
        'bg-emerald-500/20 text-emerald-400 border-emerald-500/50';
  };

  const getCountdown = (eventTime: string) => {
    const diff = new Date(eventTime).getTime() - currentTime;
    if (diff < 0) return 'LIVE';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-full overflow-auto bg-zinc-900 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="calendar" size="sm" className="w-5 h-5 text-cyan-400" />
          <h2 className="text-lg font-semibold text-white">Economic News Impact Analyzer</h2>
        </div>
      </div>

      {/* Upcoming Events (Next 24h) */}
      <div className="bg-zinc-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
          <Icon name="clock" size="sm" className="w-4 h-4 text-cyan-400" />
          Upcoming Events (Next 24h)
        </h3>
        <div className="space-y-2">
          {upcomingEvents.map(event => {
            const countdown = getCountdown(event.time);
            return (
              <div
                key={event.id}
                className="flex items-center justify-between p-3 bg-zinc-900 rounded hover:bg-zinc-700/50"
              >
                <div className="flex items-center gap-3 flex-1">
                  <div className={`font-mono text-sm ${countdown === 'LIVE' ? 'text-red-400 font-bold' : 'text-cyan-400'}`}>
                    {countdown}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-white">{event.type}</div>
                    <div className="text-xs text-zinc-500">
                      {event.currency} • {event.affectedSymbols.join(', ')}
                    </div>
                  </div>
                  <div className={`px-2 py-1 rounded border text-xs font-medium ${getImpactColor(event.impact)}`}>
                    {event.impact}
                  </div>
                  {event.forecast && (
                    <div className="text-xs text-zinc-400">
                      F: {event.forecast} | P: {event.previous}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
