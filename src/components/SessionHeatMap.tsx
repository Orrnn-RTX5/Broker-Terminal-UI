/**
 * Session Heat Map / Session Map Panel
 * Trading session visualization with global market sessions and activity heatmap
 */

import { Icon } from './ui/Icon';
import { useState, useMemo, useEffect } from 'react';
import { useSessionMapStore } from '../store/useSessionMapStore';

interface Session {
  name: string;
  startHour: number; // UTC
  endHour: number; // UTC
  color: string;
  brightColor: string;
  region: string;
}

const SESSIONS: Session[] = [
  { name: 'Asian', startHour: 0, endHour: 9, color: '#8a8a8f', brightColor: '#60a5fa', region: 'Tokyo' },
  { name: 'London', startHour: 8, endHour: 17, color: '#22c55e', brightColor: '#4ade80', region: 'London' },
  { name: 'NY', startHour: 13, endHour: 22, color: '#ef4444', brightColor: '#f87171', region: 'New York' },
];

const SYMBOLS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD',
  'EURJPY', 'GBPJPY', 'EURGBP', 'AUDJPY', 'XAUUSD', 'BTCUSD'
];

export function SessionHeatMap() {
  const { selectedSymbol, timezone, setSelectedSymbol, setTimezone } = useSessionMapStore();
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update current time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Determine which sessions are currently active
  const activeSessions = useMemo(() => {
    const utcHour = currentTime.getUTCHours();
    return SESSIONS.filter(session => {
      if (session.startHour < session.endHour) {
        return utcHour >= session.startHour && utcHour < session.endHour;
      } else {
        // Handle sessions that cross midnight
        return utcHour >= session.startHour || utcHour < session.endHour;
      }
    });
  }, [currentTime]);

  // Calculate next session change
  const nextSessionChange = useMemo(() => {
    const utcHour = currentTime.getUTCHours();
    const utcMinute = currentTime.getUTCMinutes();
    const currentMinutes = utcHour * 60 + utcMinute;

    // Find all session boundaries (open and close times)
    const boundaries: { time: number; type: 'open' | 'close'; session: string }[] = [];
    SESSIONS.forEach(session => {
      boundaries.push({ time: session.startHour * 60, type: 'open', session: session.name });
      boundaries.push({ time: session.endHour * 60, type: 'close', session: session.name });
    });

    // Sort boundaries and find next one
    boundaries.sort((a, b) => a.time - b.time);

    const nextBoundary = boundaries.find(b => b.time > currentMinutes) || boundaries[0];
    const minutesUntil = nextBoundary.time > currentMinutes
      ? nextBoundary.time - currentMinutes
      : (24 * 60) - currentMinutes + nextBoundary.time;

    const hours = Math.floor(minutesUntil / 60);
    const minutes = minutesUntil % 60;

    return {
      type: nextBoundary.type,
      session: nextBoundary.session,
      hours,
      minutes,
    };
  }, [currentTime]);

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-zinc-300 overflow-auto">
      {/* Header */}
      <div className="bg-zinc-800 border-b border-zinc-700 p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="globe" size="lg" className="text-blue-400" />
          <h2 className="text-sm font-semibold text-white">Global Trading Sessions</h2>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className="bg-zinc-700 border border-zinc-600 rounded px-3 py-1.5 text-xs outline-none focus:border-zinc-600"
          >
            {SYMBOLS.map(sym => (
              <option key={sym} value={sym}>{sym}</option>
            ))}
          </select>

          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value as any)}
            className="bg-zinc-700 border border-zinc-600 rounded px-3 py-1.5 text-xs outline-none focus:border-zinc-600"
          >
            <option value="UTC">UTC</option>
            <option value="Local">Local Time</option>
            <option value="NY">New York</option>
            <option value="London">London</option>
            <option value="Tokyo">Tokyo</option>
          </select>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Current Sessions & Clock */}
        <div className="grid grid-cols-2 gap-4">
          {/* Active Sessions */}
          <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
            <h3 className="text-xs font-semibold mb-3 flex items-center gap-2">
              <Icon name="activity" size="sm" className="text-green-400" />
              Active Sessions
            </h3>
            {activeSessions.length === 0 ? (
              <div className="text-xs text-zinc-500">No sessions currently active</div>
            ) : (
              <div className="space-y-2">
                {activeSessions.map(session => (
                  <div
                    key={session.name}
                    className="flex items-center gap-2 text-xs"
                  >
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: session.brightColor }}
                    />
                    <span className="font-medium">{session.name}</span>
                    <span className="text-zinc-500">
                      ({session.startHour.toString().padStart(2, '0')}:00 - {session.endHour.toString().padStart(2, '0')}:00 UTC)
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Session Clock */}
          <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
            <h3 className="text-xs font-semibold mb-3 flex items-center gap-2">
              <Icon name="clock" size="sm" className="text-blue-400" />
              Next Session Change
            </h3>
            <div className="flex items-center gap-4">
              <div className="text-3xl font-bold text-white">
                {nextSessionChange.hours.toString().padStart(2, '0')}:
                {nextSessionChange.minutes.toString().padStart(2, '0')}
              </div>
              <div className="text-xs text-zinc-400">
                until {nextSessionChange.session} {nextSessionChange.type === 'open' ? 'opens' : 'closes'}
              </div>
            </div>
            <div className="mt-2 text-[10px] text-zinc-500">
              Current UTC: {currentTime.getUTCHours().toString().padStart(2, '0')}:
              {currentTime.getUTCMinutes().toString().padStart(2, '0')}:
              {currentTime.getUTCSeconds().toString().padStart(2, '0')}
            </div>
          </div>
        </div>

        {/* World Map with Sessions */}
        <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
          <h3 className="text-xs font-semibold mb-3">Global Session Map</h3>
          <WorldMapViz activeSessions={activeSessions} />
        </div>

        {/* 24h x 7d Activity Heatmap */}
        <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
          <h3 className="text-xs font-semibold mb-3">Weekly Activity Heatmap - {selectedSymbol}</h3>
          <ActivityHeatmapGrid symbol={selectedSymbol} currentTime={currentTime} />
        </div>

        {/* Per-Session Stats */}
        <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
          <h3 className="text-xs font-semibold mb-3">Session Statistics - {selectedSymbol}</h3>
          <SessionStatsTable symbol={selectedSymbol} />
        </div>

        {/* Best Trading Hours */}
        <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
          <h3 className="text-xs font-semibold mb-3 flex items-center gap-2">
            <Icon name="trending-up" size="sm" className="text-yellow-400" />
            Best Trading Hours Recommendation
          </h3>
          <BestHoursRecommendation symbol={selectedSymbol} />
        </div>
      </div>
    </div>
  );
}

// --- WORLD MAP VISUALIZATION ---
function WorldMapViz({ activeSessions }: { activeSessions: Session[] }) {
  return (
    <svg viewBox="0 0 800 400" className="w-full h-64">
      {/* Simple world map outline */}
      <g stroke="#52525b" strokeWidth="1" fill="none">
        {/* Continents (simplified) */}
        {/* North America */}
        <path d="M 100,100 L 150,80 L 200,90 L 220,120 L 200,150 L 150,140 L 100,130 Z" />
        {/* South America */}
        <path d="M 180,200 L 200,180 L 220,200 L 210,250 L 190,240 Z" />
        {/* Europe */}
        <path d="M 380,90 L 420,80 L 450,95 L 440,120 L 410,130 L 380,115 Z" />
        {/* Africa */}
        <path d="M 400,140 L 440,150 L 450,200 L 430,240 L 400,230 L 390,180 Z" />
        {/* Asia */}
        <path d="M 500,80 L 600,70 L 680,90 L 700,120 L 680,150 L 600,140 L 520,130 Z" />
        {/* Australia */}
        <path d="M 650,260 L 700,250 L 720,280 L 700,300 L 660,295 Z" />
      </g>

      {/* Session Regions */}
      {SESSIONS.map(session => {
        const isActive = activeSessions.some(s => s.name === session.name);
        const color = isActive ? session.brightColor : session.color;
        const opacity = isActive ? 0.7 : 0.3;

        let x = 0, y = 0, label = '';
        if (session.name === 'Asian') {
          x = 600;
          y = 110;
          label = 'Tokyo';
        } else if (session.name === 'London') {
          x = 400;
          y = 105;
          label = 'London';
        } else if (session.name === 'NY') {
          x = 160;
          y = 115;
          label = 'New York';
        }

        return (
          <g key={session.name}>
            {/* Session highlight circle */}
            <circle cx={x} cy={y} r="40" fill={color} opacity={opacity} />
            {/* City label */}
            <text
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#e4e4e7"
              fontSize="12"
              fontWeight="bold"
            >
              {label}
            </text>
            {/* Session time */}
            <text
              x={x}
              y={y + 15}
              textAnchor="middle"
              fill="#a1a1aa"
              fontSize="9"
            >
              {session.startHour.toString().padStart(2, '0')}:00-{session.endHour.toString().padStart(2, '0')}:00
            </text>
          </g>
        );
      })}

      {/* Overlap zones indicators */}
      {/* London-NY overlap (most active) */}
      <g opacity="0.5">
        <line x1="280" y1="110" x2="320" y2="110" stroke="#fbbf24" strokeWidth="3" />
        <text x="300" y="100" textAnchor="middle" fill="#fbbf24" fontSize="10">
          London-NY Overlap
        </text>
      </g>

      {/* Asian-London overlap */}
      <g opacity="0.5">
        <line x1="500" y1="95" x2="540" y2="95" stroke="#a78bfa" strokeWidth="2" />
        <text x="520" y="85" textAnchor="middle" fill="#a78bfa" fontSize="10">
          Asian-London
        </text>
      </g>
    </svg>
  );
}

// --- ACTIVITY HEATMAP GRID (24h x 7d) ---
function ActivityHeatmapGrid({ symbol, currentTime }: { symbol: string; currentTime: Date }) {
  // Generate mock activity data (0-100 intensity)
  const activityData = useMemo(() => {
    const data: number[][] = [];
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    for (let day = 0; day < 7; day++) {
      const dayData: number[] = [];
      for (let hour = 0; hour < 24; hour++) {
        // Simulate higher activity during London-NY overlap (13-17 UTC)
        // and London open (8-12 UTC)
        let baseActivity = 20;
        if (hour >= 13 && hour <= 17) baseActivity = 80; // London-NY overlap
        else if (hour >= 8 && hour <= 12) baseActivity = 60; // London session
        else if (hour >= 0 && hour <= 3) baseActivity = 40; // Asian session
        else if (hour >= 18 && hour <= 22) baseActivity = 50; // NY afternoon

        // Weekend has lower activity
        if (day >= 5) baseActivity *= 0.3;

        // Add some randomness
        const activity = Math.min(100, Math.max(0, baseActivity + (Math.random() - 0.5) * 30));
        dayData.push(activity);
      }
      data.push(dayData);
    }
    return { data, days };
  }, [symbol]);

  const [hoveredCell, setHoveredCell] = useState<{ day: number; hour: number } | null>(null);

  // Get color based on intensity
  const getColor = (intensity: number) => {
    if (intensity < 20) return '#131316'; // zinc-900 (dark)
    if (intensity < 40) return '#222226'; // zinc-800
    if (intensity < 60) return '#22c55e'; // green-500
    if (intensity < 80) return '#eab308'; // yellow-500
    return '#ef4444'; // red-500 (high activity)
  };

  // Current time indicators
  const currentDayOfWeek = currentTime.getUTCDay(); // 0=Sunday
  const currentHour = currentTime.getUTCHours();
  const adjustedDay = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1; // Convert to Mon=0

  const cellSize = 20;
  const gap = 2;
  const labelWidth = 40;
  const labelHeight = 20;

  return (
    <div className="relative">
      <svg
        width={labelWidth + (cellSize + gap) * 24}
        height={labelHeight + (cellSize + gap) * 7}
        className="text-xs"
      >
        {/* Hour labels */}
        {Array.from({ length: 24 }, (_, hour) => (
          <text
            key={`hour-${hour}`}
            x={labelWidth + (cellSize + gap) * hour + cellSize / 2}
            y={labelHeight - 5}
            textAnchor="middle"
            fill="#a1a1aa"
            fontSize="9"
          >
            {hour.toString().padStart(2, '0')}
          </text>
        ))}

        {/* Day labels and cells */}
        {activityData.days.map((day, dayIdx) => (
          <g key={day}>
            <text
              x={labelWidth - 5}
              y={labelHeight + (cellSize + gap) * dayIdx + cellSize / 2}
              textAnchor="end"
              dominantBaseline="middle"
              fill="#a1a1aa"
              fontSize="10"
            >
              {day}
            </text>

            {activityData.data[dayIdx].map((intensity, hourIdx) => {
              const isCurrent = dayIdx === adjustedDay && hourIdx === currentHour;
              const isHovered = hoveredCell?.day === dayIdx && hoveredCell?.hour === hourIdx;

              return (
                <g key={`${dayIdx}-${hourIdx}`}>
                  <rect
                    x={labelWidth + (cellSize + gap) * hourIdx}
                    y={labelHeight + (cellSize + gap) * dayIdx}
                    width={cellSize}
                    height={cellSize}
                    fill={getColor(intensity)}
                    stroke={isCurrent ? '#8a8a8f' : isHovered ? '#fff' : 'none'}
                    strokeWidth={isCurrent ? 2 : 1}
                    rx="2"
                    onMouseEnter={() => setHoveredCell({ day: dayIdx, hour: hourIdx })}
                    onMouseLeave={() => setHoveredCell(null)}
                    style={{ cursor: 'pointer' }}
                  />
                  {isCurrent && (
                    <circle
                      cx={labelWidth + (cellSize + gap) * hourIdx + cellSize / 2}
                      cy={labelHeight + (cellSize + gap) * dayIdx + cellSize / 2}
                      r="3"
                      fill="#8a8a8f"
                    />
                  )}
                </g>
              );
            })}
          </g>
        ))}

        {/* Current time indicator line */}
        <line
          x1={labelWidth + (cellSize + gap) * currentHour + cellSize / 2}
          y1={labelHeight}
          x2={labelWidth + (cellSize + gap) * currentHour + cellSize / 2}
          y2={labelHeight + (cellSize + gap) * 7}
          stroke="#8a8a8f"
          strokeWidth="2"
          strokeDasharray="4 2"
          opacity="0.6"
        />
      </svg>

      {/* Hover tooltip */}
      {hoveredCell && (
        <div className="mt-2 text-xs bg-zinc-700 border border-zinc-600 rounded px-3 py-2">
          <div className="font-medium">
            {activityData.days[hoveredCell.day]} {hoveredCell.hour.toString().padStart(2, '0')}:00 UTC
          </div>
          <div className="text-zinc-400">
            Activity: {activityData.data[hoveredCell.day][hoveredCell.hour].toFixed(0)}%
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-3 flex items-center gap-2 text-[10px]">
        <span className="text-zinc-400">Activity:</span>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: '#131316' }} />
          <span className="text-zinc-500">Low</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: '#22c55e' }} />
          <span className="text-zinc-500">Medium</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: '#eab308' }} />
          <span className="text-zinc-500">High</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: '#ef4444' }} />
          <span className="text-zinc-500">Very High</span>
        </div>
      </div>
    </div>
  );
}

// --- SESSION STATS TABLE ---
function SessionStatsTable({ symbol }: { symbol: string }) {
  const stats = useMemo(() => {
    // Generate mock stats based on symbol
    const baseSpread = symbol.includes('JPY') ? 1.2 : 0.8;
    const baseVolume = symbol === 'EURUSD' ? 1000 : 800;
    const baseVolatility = symbol.includes('XAU') ? 15 : 8;

    return SESSIONS.map(session => {
      let spreadMultiplier = 1;
      let volumeMultiplier = 1;
      let volatilityMultiplier = 1;

      if (session.name === 'London') {
        volumeMultiplier = 1.5;
        volatilityMultiplier = 1.3;
      } else if (session.name === 'NY') {
        volumeMultiplier = 1.4;
        volatilityMultiplier = 1.2;
        spreadMultiplier = 0.9;
      } else if (session.name === 'Asian') {
        volumeMultiplier = 0.7;
        volatilityMultiplier = 0.8;
        spreadMultiplier = 1.1;
      }

      return {
        session: session.name,
        color: session.color,
        avgSpread: (baseSpread * spreadMultiplier).toFixed(1),
        avgVolume: Math.round(baseVolume * volumeMultiplier),
        avgVolatility: (baseVolatility * volatilityMultiplier).toFixed(1),
      };
    });
  }, [symbol]);

  return (
    <table className="w-full text-xs">
      <thead className="border-b border-zinc-700">
        <tr>
          <th className="px-3 py-2 text-left font-medium text-zinc-400">Session</th>
          <th className="px-3 py-2 text-right font-medium text-zinc-400">Avg Spread (pips)</th>
          <th className="px-3 py-2 text-right font-medium text-zinc-400">Avg Volume</th>
          <th className="px-3 py-2 text-right font-medium text-zinc-400">Avg Volatility (%)</th>
        </tr>
      </thead>
      <tbody>
        {stats.map(stat => (
          <tr key={stat.session} className="border-b border-zinc-800">
            <td className="px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: stat.color }} />
                <span className="font-medium">{stat.session}</span>
              </div>
            </td>
            <td className="px-3 py-2 text-right">{stat.avgSpread}</td>
            <td className="px-3 py-2 text-right">{stat.avgVolume.toLocaleString()}</td>
            <td className="px-3 py-2 text-right">{stat.avgVolatility}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// --- BEST HOURS RECOMMENDATION ---
function BestHoursRecommendation({ symbol }: { symbol: string }) {
  const recommendation = useMemo(() => {
    // Analyze symbol characteristics
    const isEuroPair = symbol.includes('EUR');
    const isGbpPair = symbol.includes('GBP');
    const isJpyPair = symbol.includes('JPY');
    const isGold = symbol.includes('XAU');
    const isCrypto = symbol.includes('BTC') || symbol.includes('ETH');

    let bestHours: string;
    let reason: string;
    let sessionsToFocus: string[];

    if (isCrypto) {
      bestHours = '24/7 (crypto markets)';
      reason = 'Cryptocurrency markets operate 24/7 with generally consistent activity across all sessions.';
      sessionsToFocus = ['Asian', 'London', 'NY'];
    } else if (isEuroPair || isGbpPair) {
      bestHours = '08:00 - 17:00 UTC (London session) and 13:00 - 17:00 UTC (overlap)';
      reason = 'European currency pairs have highest liquidity during London session, with peak activity during London-NY overlap.';
      sessionsToFocus = ['London', 'NY'];
    } else if (isJpyPair) {
      bestHours = '00:00 - 09:00 UTC (Asian session) and 13:00 - 17:00 UTC (overlap)';
      reason = 'JPY pairs show increased activity during Asian session and London-NY overlap due to economic announcements and liquidity.';
      sessionsToFocus = ['Asian', 'London', 'NY'];
    } else if (isGold) {
      bestHours = '08:00 - 22:00 UTC (London + NY sessions)';
      reason = 'Gold trading is most active during European and US sessions, with significant moves during economic releases.';
      sessionsToFocus = ['London', 'NY'];
    } else {
      bestHours = '13:00 - 17:00 UTC (London-NY overlap)';
      reason = 'Highest liquidity and volatility occur during the London-NY overlap, offering the best trading opportunities.';
      sessionsToFocus = ['London', 'NY'];
    }

    return { bestHours, reason, sessionsToFocus };
  }, [symbol]);

  return (
    <div className="space-y-3">
      <div className="bg-zinc-900 border border-zinc-700 rounded p-3">
        <div className="text-xs font-medium text-yellow-400 mb-1">Recommended Trading Hours</div>
        <div className="text-sm font-semibold text-white">{recommendation.bestHours}</div>
      </div>

      <div className="text-xs text-zinc-400">
        {recommendation.reason}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-400">Focus on:</span>
        {recommendation.sessionsToFocus.map(sessionName => {
          const session = SESSIONS.find(s => s.name === sessionName);
          return (
            <div
              key={sessionName}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-xs"
              style={{ backgroundColor: `${session?.color}33` }}
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: session?.color }}
              />
              <span>{sessionName}</span>
            </div>
          );
        })}
      </div>

      {/* Volatility distribution chart */}
      <div className="mt-3">
        <div className="text-xs text-zinc-400 mb-2">Expected Volatility by Session</div>
        <svg width="100%" height="80">
          <g transform="translate(0, 10)">
            {SESSIONS.map((session, idx) => {
              const isRecommended = recommendation.sessionsToFocus.includes(session.name);
              const barHeight = isRecommended ? 50 : 30;
              const barWidth = 80;
              const x = idx * (barWidth + 20);

              return (
                <g key={session.name}>
                  <rect
                    x={x}
                    y={60 - barHeight}
                    width={barWidth}
                    height={barHeight}
                    fill={session.color}
                    opacity={isRecommended ? 0.8 : 0.4}
                    rx="3"
                  />
                  <text
                    x={x + barWidth / 2}
                    y={70}
                    textAnchor="middle"
                    fill="#a1a1aa"
                    fontSize="10"
                  >
                    {session.name}
                  </text>
                  {isRecommended && (
                    <text
                      x={x + barWidth / 2}
                      y={60 - barHeight - 5}
                      textAnchor="middle"
                      fill="#fbbf24"
                      fontSize="10"
                    >
                      ★
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
