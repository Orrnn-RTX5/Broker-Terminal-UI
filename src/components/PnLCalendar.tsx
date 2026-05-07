/**
 * Profit/Loss Calendar View
 * Monthly calendar grid showing daily trading P&L with color intensity
 */

import { Icon } from './ui/Icon';
import React, { useState, useMemo } from 'react';
import { API_ENDPOINTS } from '../config/api';

// ============================================================================
// Types
// ============================================================================

interface DayData {
  date: string; // YYYY-MM-DD
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
}

interface MonthData {
  year: number;
  month: number; // 1-12
  days: Map<string, DayData>;
  monthlyPnL: number;
  bestDay: { date: string; pnl: number };
  worstDay: { date: string; pnl: number };
  tradingDays: number;
  avgDailyPnL: number;
}

type ViewMode = 'month' | 'year';

// ============================================================================
// Mock Data Generation
// ============================================================================

function generateDayData(date: Date): DayData {
  const dateStr = date.toISOString().split('T')[0];

  // Skip weekends (randomly skip some other days too)
  const dayOfWeek = date.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6 || Math.random() < 0.2) {
    return {
      date: dateStr,
      pnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      grossProfit: 0,
      grossLoss: 0,
    };
  }

  const trades = Math.floor(Math.random() * 15) + 1;
  const winRate = 0.3 + Math.random() * 0.5; // 30-80%
  const wins = Math.floor(trades * winRate);
  const losses = trades - wins;

  const avgWin = 100 + Math.random() * 500;
  const avgLoss = 50 + Math.random() * 300;

  const grossProfit = wins * avgWin;
  const grossLoss = losses * avgLoss;
  const pnl = grossProfit - grossLoss;

  return {
    date: dateStr,
    pnl: Math.round(pnl * 100) / 100,
    trades,
    wins,
    losses,
    winRate: Math.round(winRate * 100),
    grossProfit: Math.round(grossProfit * 100) / 100,
    grossLoss: Math.round(grossLoss * 100) / 100,
  };
}

function generateMonthData(year: number, month: number): MonthData {
  const days = new Map<string, DayData>();
  const daysInMonth = new Date(year, month, 0).getDate();

  let monthlyPnL = 0;
  let bestDay = { date: '', pnl: -Infinity };
  let worstDay = { date: '', pnl: Infinity };
  let tradingDays = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const dayData = generateDayData(date);
    days.set(dayData.date, dayData);

    if (dayData.trades > 0) {
      monthlyPnL += dayData.pnl;
      tradingDays++;

      if (dayData.pnl > bestDay.pnl) {
        bestDay = { date: dayData.date, pnl: dayData.pnl };
      }
      if (dayData.pnl < worstDay.pnl) {
        worstDay = { date: dayData.date, pnl: dayData.pnl };
      }
    }
  }

  const avgDailyPnL = tradingDays > 0 ? monthlyPnL / tradingDays : 0;

  return {
    year,
    month,
    days,
    monthlyPnL: Math.round(monthlyPnL * 100) / 100,
    bestDay,
    worstDay,
    tradingDays,
    avgDailyPnL: Math.round(avgDailyPnL * 100) / 100,
  };
}

// ============================================================================
// Main Component
// ============================================================================

export const PnLCalendar: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(() => new Date());

  // Generate data for current month and surrounding months
  const monthsData = useMemo(() => {
    const data = new Map<string, MonthData>();

    // Generate 3 months of data
    for (let offset = -1; offset <= 1; offset++) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1);
      const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
      data.set(key, generateMonthData(date.getFullYear(), date.getMonth() + 1));
    }

    return data;
  }, [currentDate]);

  const currentMonthData = useMemo(() => {
    const key = `${currentDate.getFullYear()}-${currentDate.getMonth() + 1}`;
    return monthsData.get(key) || generateMonthData(currentDate.getFullYear(), currentDate.getMonth() + 1);
  }, [currentDate, monthsData]);

  // Year view data (12 months)
  const yearData = useMemo(() => {
    if (viewMode !== 'year') return [];

    const data: MonthData[] = [];
    for (let month = 1; month <= 12; month++) {
      const key = `${currentDate.getFullYear()}-${month}`;
      const existing = monthsData.get(key);
      data.push(existing || generateMonthData(currentDate.getFullYear(), month));
    }
    return data;
  }, [viewMode, currentDate, monthsData]);

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handlePrevYear = () => {
    setCurrentDate(new Date(currentDate.getFullYear() - 1, currentDate.getMonth(), 1));
  };

  const handleNextYear = () => {
    setCurrentDate(new Date(currentDate.getFullYear() + 1, currentDate.getMonth(), 1));
  };

  return (
    <div className="h-full flex flex-col bg-[#131316] text-zinc-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 bg-[#252526]">
        <div className="flex items-center gap-3">
          <Icon name="calendar" size="lg" className="text-blue-500" />
          <h2 className="text-sm font-semibold text-zinc-200">P&L Calendar</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex items-center gap-1 bg-zinc-800 rounded p-0.5">
            <button
              onClick={() => setViewMode('month')}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                viewMode === 'month' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Month
            </button>
            <button
              onClick={() => setViewMode('year')}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                viewMode === 'year' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Year
            </button>
          </div>
          {/* Navigation */}
          <button
            onClick={viewMode === 'month' ? handlePrevMonth : handlePrevYear}
            className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded transition-colors"
          >
            <Icon name="chevron-left" size="md" />
          </button>
          <span className="text-sm font-medium text-zinc-200 min-w-[120px] text-center">
            {viewMode === 'month'
              ? currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
              : currentDate.getFullYear()}
          </span>
          <button
            onClick={viewMode === 'month' ? handleNextMonth : handleNextYear}
            className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded transition-colors"
          >
            <Icon name="chevron-right" size="md" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {viewMode === 'month' ? (
          <MonthView data={currentMonthData} />
        ) : (
          <YearView data={yearData} currentYear={currentDate.getFullYear()} />
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Month View Component
// ============================================================================

interface MonthViewProps {
  data: MonthData;
}

const MonthView: React.FC<MonthViewProps> = ({ data }) => {
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);

  // Get calendar grid (includes leading/trailing days from other months)
  const calendarGrid = useMemo(() => {
    const firstDay = new Date(data.year, data.month - 1, 1);
    const startingDayOfWeek = firstDay.getDay(); // 0 = Sunday
    const daysInMonth = new Date(data.year, data.month, 0).getDate();

    const grid: (DayData | null)[] = [];

    // Add empty cells for days before month starts
    for (let i = 0; i < startingDayOfWeek; i++) {
      grid.push(null);
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(data.year, data.month - 1, day);
      const dateStr = date.toISOString().split('T')[0];
      grid.push(data.days.get(dateStr) || null);
    }

    return grid;
  }, [data]);

  // Split into weeks
  const weeks = useMemo(() => {
    const result: (DayData | null)[][] = [];
    for (let i = 0; i < calendarGrid.length; i += 7) {
      result.push(calendarGrid.slice(i, i + 7));
    }
    return result;
  }, [calendarGrid]);

  // Calculate weekly totals
  const weeklyTotals = useMemo(() => {
    return weeks.map(week => {
      const total = week.reduce((sum, day) => sum + (day?.pnl || 0), 0);
      return Math.round(total * 100) / 100;
    });
  }, [weeks]);

  // Get color intensity based on P&L
  const getPnLColor = (pnl: number): string => {
    if (pnl === 0) return 'bg-zinc-800';

    // Get max P&L for scaling
    const allPnLs = Array.from(data.days.values()).map(d => Math.abs(d.pnl));
    const maxPnL = Math.max(...allPnLs, 1);
    const intensity = Math.min(Math.abs(pnl) / maxPnL, 1);

    if (pnl > 0) {
      // Green gradient
      const opacity = Math.round(20 + intensity * 60); // 20-80% opacity
      return `bg-emerald-500/${opacity}`;
    } else {
      // Red gradient
      const opacity = Math.round(20 + intensity * 60);
      return `bg-red-500/${opacity}`;
    }
  };

  return (
    <div className="space-y-4">
      {/* Summary Stats Bar */}
      <div className="grid grid-cols-5 gap-3">
        <SummaryCard
          label="Monthly P&L"
          value={data.monthlyPnL}
          format="currency"
          valueColor={data.monthlyPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <SummaryCard
          label="Best Day"
          value={data.bestDay.pnl}
          format="currency"
          subtitle={new Date(data.bestDay.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          valueColor="text-emerald-400"
        />
        <SummaryCard
          label="Worst Day"
          value={data.worstDay.pnl}
          format="currency"
          subtitle={new Date(data.worstDay.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          valueColor="text-red-400"
        />
        <SummaryCard
          label="Trading Days"
          value={data.tradingDays}
          format="number"
        />
        <SummaryCard
          label="Avg Daily P&L"
          value={data.avgDailyPnL}
          format="currency"
          valueColor={data.avgDailyPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
      </div>

      {/* Calendar Grid */}
      <div className="bg-[#252526] rounded border border-zinc-700 p-3">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Week'].map((day) => (
                <th
                  key={day}
                  className={`text-xs font-semibold text-zinc-400 pb-2 ${
                    day === 'Week' ? 'pl-2 text-right' : 'text-center'
                  }`}
                >
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, weekIdx) => (
              <tr key={weekIdx}>
                {week.map((day, dayIdx) => (
                  <td key={dayIdx} className="p-1">
                    {day ? (
                      <DayCell
                        data={day}
                        color={getPnLColor(day.pnl)}
                        isHovered={hoveredDay === day.date}
                        onMouseEnter={() => setHoveredDay(day.date)}
                        onMouseLeave={() => setHoveredDay(null)}
                      />
                    ) : (
                      <div className="h-20 bg-zinc-900 rounded" />
                    )}
                  </td>
                ))}
                {/* Weekly Total */}
                <td className="p-1 pl-2">
                  <div className="h-20 flex items-center justify-end">
                    <span
                      className={`text-xs font-bold ${
                        weeklyTotals[weekIdx] >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {weeklyTotals[weekIdx] >= 0 ? '+' : ''}
                      {weeklyTotals[weekIdx].toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ============================================================================
// Day Cell Component
// ============================================================================

interface DayCellProps {
  data: DayData;
  color: string;
  isHovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const DayCell: React.FC<DayCellProps> = ({ data, color, isHovered, onMouseEnter, onMouseLeave }) => {
  const date = new Date(data.date);
  const dayNum = date.getDate();

  return (
    <div
      className={`h-20 ${color} rounded border border-zinc-700 p-2 cursor-pointer transition-all relative ${
        isHovered ? 'ring-2 ring-blue-500 scale-105 z-10' : ''
      }`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex flex-col h-full">
        <div className="text-[10px] text-zinc-400 mb-1">{dayNum}</div>
        {data.trades > 0 ? (
          <>
            <div className={`text-sm font-bold mb-1 ${data.pnl >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
              {data.pnl >= 0 ? '+' : ''}
              {data.pnl.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <div className="text-[9px] text-zinc-400">
              {data.trades} trade{data.trades > 1 ? 's' : ''}
            </div>
            <div className="text-[9px] text-zinc-500">
              {data.winRate}% win
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-700 text-xs">
            —
          </div>
        )}

      {/* Tooltip */}
      {isHovered && data.trades > 0 && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 pointer-events-none">
          <div className="bg-zinc-900 border border-zinc-700 rounded shadow-lg p-3 text-xs whitespace-nowrap">
            <div className="font-semibold text-zinc-200 mb-2">
              {date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            <div className="space-y-1">
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Net P&L:</span>
                <span className={`font-bold ${data.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Trades:</span>
                <span className="text-zinc-300">{data.trades}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Win Rate:</span>
                <span className="text-zinc-300">{data.winRate}% ({data.wins}W / {data.losses}L)</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Gross Profit:</span>
                <span className="text-emerald-400">+${data.grossProfit.toFixed(2)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-zinc-500">Gross Loss:</span>
                <span className="text-red-400">-${data.grossLoss.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

// ============================================================================
// Year View Component
// ============================================================================

interface YearViewProps {
  data: MonthData[];
  currentYear: number;
}

const YearView: React.FC<YearViewProps> = ({ data, currentYear }) => {
  const yearlyTotal = useMemo(() => {
    return data.reduce((sum, month) => sum + month.monthlyPnL, 0);
  }, [data]);

  const bestMonth = useMemo(() => {
    return data.reduce((best, month) => (month.monthlyPnL > best.monthlyPnL ? month : best), data[0]);
  }, [data]);

  const worstMonth = useMemo(() => {
    return data.reduce((worst, month) => (month.monthlyPnL < worst.monthlyPnL ? month : worst), data[0]);
  }, [data]);

  const totalTradingDays = useMemo(() => {
    return data.reduce((sum, month) => sum + month.tradingDays, 0);
  }, [data]);

  return (
    <div className="space-y-4">
      {/* Yearly Summary */}
      <div className="grid grid-cols-4 gap-3">
        <SummaryCard
          label={`${currentYear} Total P&L`}
          value={yearlyTotal}
          format="currency"
          valueColor={yearlyTotal >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <SummaryCard
          label="Best Month"
          value={bestMonth.monthlyPnL}
          format="currency"
          subtitle={new Date(bestMonth.year, bestMonth.month - 1).toLocaleDateString('en-US', { month: 'long' })}
          valueColor="text-emerald-400"
        />
        <SummaryCard
          label="Worst Month"
          value={worstMonth.monthlyPnL}
          format="currency"
          subtitle={new Date(worstMonth.year, worstMonth.month - 1).toLocaleDateString('en-US', { month: 'long' })}
          valueColor="text-red-400"
        />
        <SummaryCard
          label="Total Trading Days"
          value={totalTradingDays}
          format="number"
        />
      </div>

      {/* 12 Mini Month Grids */}
      <div className="grid grid-cols-3 gap-4">
        {data.map((monthData) => (
          <MiniMonthGrid key={`${monthData.year}-${monthData.month}`} data={monthData} />
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// Mini Month Grid Component (for Year View)
// ============================================================================

interface MiniMonthGridProps {
  data: MonthData;
}

const MiniMonthGrid: React.FC<MiniMonthGridProps> = ({ data }) => {
  const calendarGrid = useMemo(() => {
    const firstDay = new Date(data.year, data.month - 1, 1);
    const startingDayOfWeek = firstDay.getDay();
    const daysInMonth = new Date(data.year, data.month, 0).getDate();

    const grid: (DayData | null)[] = [];

    for (let i = 0; i < startingDayOfWeek; i++) {
      grid.push(null);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(data.year, data.month - 1, day);
      const dateStr = date.toISOString().split('T')[0];
      grid.push(data.days.get(dateStr) || null);
    }

    return grid;
  }, [data]);

  const weeks = useMemo(() => {
    const result: (DayData | null)[][] = [];
    for (let i = 0; i < calendarGrid.length; i += 7) {
      result.push(calendarGrid.slice(i, i + 7));
    }
    return result;
  }, [calendarGrid]);

  const getPnLColor = (pnl: number): string => {
    if (pnl === 0) return 'bg-zinc-800';

    const allPnLs = Array.from(data.days.values()).map(d => Math.abs(d.pnl));
    const maxPnL = Math.max(...allPnLs, 1);
    const intensity = Math.min(Math.abs(pnl) / maxPnL, 1);

    if (pnl > 0) {
      const opacity = Math.round(20 + intensity * 60);
      return `bg-emerald-500/${opacity}`;
    } else {
      const opacity = Math.round(20 + intensity * 60);
      return `bg-red-500/${opacity}`;
    }
  };

  const monthName = new Date(data.year, data.month - 1).toLocaleDateString('en-US', { month: 'long' });

  return (
    <div className="bg-[#252526] rounded border border-zinc-700 p-2">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-zinc-300">{monthName}</div>
        <div className={`text-xs font-bold ${data.monthlyPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {data.monthlyPnL >= 0 ? '+' : ''}
          {data.monthlyPnL.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {weeks.map((week, weekIdx) =>
          week.map((day, dayIdx) => (
            <div
              key={`${weekIdx}-${dayIdx}`}
              className={`h-5 ${day ? getPnLColor(day.pnl) : 'bg-zinc-900'} rounded-sm`}
              title={day ? `${new Date(day.date).getDate()}: ${day.pnl >= 0 ? '+' : ''}$${day.pnl.toFixed(2)}` : ''}
            />
          ))
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Summary Card Component
// ============================================================================

interface SummaryCardProps {
  label: string;
  value: number;
  format: 'currency' | 'number';
  subtitle?: string;
  valueColor?: string;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ label, value, format, subtitle, valueColor = 'text-zinc-200' }) => {
  const formattedValue = format === 'currency'
    ? `${value >= 0 ? '+' : ''}$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : value.toLocaleString('en-US');

  return (
    <div className="bg-[#252526] rounded border border-zinc-700 p-3">
      <div className="text-[10px] text-zinc-500 mb-1 uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-bold ${valueColor} mb-1`}>{formattedValue}</div>
      {subtitle && <div className="text-[10px] text-zinc-500">{subtitle}</div>}
    </div>
  );
};
