/**
 * Trade Journal V2 / Trading Diary
 * Advanced trade journaling system with calendar view, annotations, and analytics
 */

import { Icon } from './ui/Icon';
import { useState, useMemo } from 'react';
import { useTradeJournalStore, type SetupTag, type TradeAnnotation } from '../store/useTradeJournalStore';

interface Trade {
  id: number;
  date: string; // YYYY-MM-DD
  openTime: string;
  closeTime: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  volume: number;
  openPrice: number;
  closePrice: number;
  profit: number;
  commission: number;
  swap: number;
}

type ViewMode = 'calendar' | 'list' | 'analytics';
type SessionType = 'Asian' | 'London' | 'NY';

export function TradeJournalV2() {
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [showAnnotationForm, setShowAnnotationForm] = useState(false);
  const [showJournalForm, setShowJournalForm] = useState(false);

  // Filters
  const [filterSymbol, setFilterSymbol] = useState('ALL');
  const [filterTag, setFilterTag] = useState<SetupTag | 'ALL'>('ALL');
  const [filterPLMin, setFilterPLMin] = useState('');
  const [filterPLMax, setFilterPLMax] = useState('');

  const { annotations, addAnnotation, getAnnotation, addJournalEntry, getEntriesByDate } =
    useTradeJournalStore();

  // Generate 60 mock trades over 90 days
  const trades = useMemo(() => generateMockTrades(), []);

  // Filter trades
  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      if (filterSymbol !== 'ALL' && t.symbol !== filterSymbol) return false;
      if (filterTag !== 'ALL') {
        const ann = getAnnotation(t.id);
        if (!ann || !ann.tags.includes(filterTag)) return false;
      }
      if (filterPLMin && t.profit < parseFloat(filterPLMin)) return false;
      if (filterPLMax && t.profit > parseFloat(filterPLMax)) return false;
      return true;
    });
  }, [trades, filterSymbol, filterTag, filterPLMin, filterPLMax, getAnnotation]);

  // Get trades for selected date
  const selectedDateTrades = useMemo(() => {
    if (!selectedDate) return [];
    return filteredTrades.filter(t => t.date === selectedDate);
  }, [selectedDate, filteredTrades]);

  // Calculate monthly P&L by date
  const dailyPL = useMemo(() => {
    const plMap = new Map<string, number>();
    filteredTrades.forEach(t => {
      const current = plMap.get(t.date) || 0;
      plMap.set(t.date, current + t.profit);
    });
    return plMap;
  }, [filteredTrades]);

  // Get unique symbols
  const symbols = useMemo(() => {
    const unique = new Set(trades.map(t => t.symbol));
    return ['ALL', ...Array.from(unique)];
  }, [trades]);

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-zinc-300 overflow-hidden">
      {/* Header */}
      <div className="bg-zinc-800 border-b border-zinc-700 p-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">Trade Journal V2</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                viewMode === 'calendar'
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
              }`}
            >
              <Icon name="calendar" size="sm" className="inline mr-1" />
              Calendar
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                viewMode === 'list'
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
              }`}
            >
              List
            </button>
            <button
              onClick={() => setViewMode('analytics')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                viewMode === 'analytics'
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
              }`}
            >
              Analytics
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <div className="flex items-center gap-1.5">
            <Icon name="filter" size="xs" className="text-zinc-400" />
            <select
              value={filterSymbol}
              onChange={(e) => setFilterSymbol(e.target.value)}
              className="bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs outline-none focus:border-zinc-600"
            >
              {symbols.map(sym => (
                <option key={sym} value={sym}>{sym}</option>
              ))}
            </select>
          </div>

          <select
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value as SetupTag | 'ALL')}
            className="bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs outline-none focus:border-zinc-600"
          >
            <option value="ALL">All Tags</option>
            <option value="breakout">Breakout</option>
            <option value="reversal">Reversal</option>
            <option value="trend">Trend</option>
            <option value="range">Range</option>
            <option value="news">News</option>
            <option value="scalp">Scalp</option>
            <option value="swing">Swing</option>
          </select>

          <input
            type="number"
            placeholder="Min P&L"
            value={filterPLMin}
            onChange={(e) => setFilterPLMin(e.target.value)}
            className="bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs outline-none focus:border-zinc-600 w-20"
          />
          <input
            type="number"
            placeholder="Max P&L"
            value={filterPLMax}
            onChange={(e) => setFilterPLMax(e.target.value)}
            className="bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs outline-none focus:border-zinc-600 w-20"
          />

          <button
            onClick={() => {
              setFilterSymbol('ALL');
              setFilterTag('ALL');
              setFilterPLMin('');
              setFilterPLMax('');
            }}
            className="px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-xs transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'calendar' && (
          <CalendarView
            currentMonth={currentMonth}
            setCurrentMonth={setCurrentMonth}
            dailyPL={dailyPL}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            selectedDateTrades={selectedDateTrades}
            onTradeClick={(trade) => {
              setSelectedTrade(trade);
              setShowAnnotationForm(true);
            }}
            onAddJournalEntry={() => setShowJournalForm(true)}
          />
        )}

        {viewMode === 'list' && (
          <ListView
            trades={filteredTrades}
            onTradeClick={(trade) => {
              setSelectedTrade(trade);
              setShowAnnotationForm(true);
            }}
          />
        )}

        {viewMode === 'analytics' && (
          <AnalyticsView trades={filteredTrades} annotations={annotations} />
        )}
      </div>

      {/* Annotation Form Modal */}
      {showAnnotationForm && selectedTrade && (
        <AnnotationFormModal
          trade={selectedTrade}
          onClose={() => {
            setShowAnnotationForm(false);
            setSelectedTrade(null);
          }}
          onSave={(annotation) => {
            addAnnotation(annotation);
            setShowAnnotationForm(false);
            setSelectedTrade(null);
          }}
        />
      )}

      {/* Journal Entry Form Modal */}
      {showJournalForm && (
        <JournalEntryFormModal
          selectedDate={selectedDate || new Date().toISOString().split('T')[0]}
          onClose={() => setShowJournalForm(false)}
          onSave={(entry) => {
            addJournalEntry(entry);
            setShowJournalForm(false);
          }}
        />
      )}
    </div>
  );
}

// --- CALENDAR VIEW ---
interface CalendarViewProps {
  currentMonth: Date;
  setCurrentMonth: (date: Date) => void;
  dailyPL: Map<string, number>;
  selectedDate: string | null;
  setSelectedDate: (date: string | null) => void;
  selectedDateTrades: Trade[];
  onTradeClick: (trade: Trade) => void;
  onAddJournalEntry: () => void;
}

function CalendarView({
  currentMonth,
  setCurrentMonth,
  dailyPL,
  selectedDate,
  setSelectedDate,
  selectedDateTrades,
  onTradeClick,
  onAddJournalEntry,
}: CalendarViewProps) {
  const { getEntriesByDate } = useTradeJournalStore();

  const monthDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = firstDay.getDay();
    const days: (Date | null)[] = [];

    // Fill leading nulls
    for (let i = 0; i < startOffset; i++) {
      days.push(null);
    }

    // Fill month days
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push(new Date(year, month, d));
    }

    return days;
  }, [currentMonth]);

  const previousMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  return (
    <div className="flex gap-3 p-4 h-full">
      {/* Calendar Grid */}
      <div className="flex-1">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={previousMonth}
            className="p-1.5 hover:bg-zinc-800 rounded transition-colors"
          >
            <Icon name="chevron-left" size="lg" />
          </button>
          <h3 className="text-sm font-semibold">
            {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </h3>
          <button
            onClick={nextMonth}
            className="p-1.5 hover:bg-zinc-800 rounded transition-colors"
          >
            <Icon name="chevron-right" size="lg" />
          </button>
        </div>

        {/* Day Headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="text-center text-xs text-zinc-500 font-medium py-1">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Days */}
        <div className="grid grid-cols-7 gap-1">
          {monthDays.map((day, idx) => {
            if (!day) {
              return <div key={`empty-${idx}`} className="aspect-square" />;
            }

            const dateStr = day.toISOString().split('T')[0];
            const pl = dailyPL.get(dateStr) || 0;
            const hasTrades = pl !== 0;
            const isSelected = dateStr === selectedDate;
            const hasJournalEntry = getEntriesByDate(dateStr).length > 0;

            let bgColor = 'bg-zinc-800';
            if (hasTrades) {
              if (pl > 0) bgColor = 'bg-green-900/30 border border-green-700/50';
              else bgColor = 'bg-red-900/30 border border-red-700/50';
            }
            if (isSelected) {
              bgColor += ' ring-2 ring-blue-500';
            }

            return (
              <div
                key={dateStr}
                onClick={() => setSelectedDate(dateStr)}
                className={`aspect-square p-1 rounded cursor-pointer hover:bg-zinc-700 transition-colors ${bgColor} relative`}
              >
                <div className="text-xs text-zinc-300">{day.getDate()}</div>
                {hasTrades && (
                  <div
                    className={`text-[10px] font-medium mt-0.5 ${
                      pl > 0 ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    ${pl.toFixed(0)}
                  </div>
                )}
                {hasJournalEntry && (
                  <div className="absolute top-0.5 right-0.5">
                    <Icon name="edit" size="sm" className="text-blue-400" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Date Trades */}
      {selectedDate && (
        <div className="w-80 bg-zinc-800 border border-zinc-700 rounded p-3">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold">
              {new Date(selectedDate).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </h4>
            <button
              onClick={onAddJournalEntry}
              className="p-1 hover:bg-zinc-700 rounded transition-colors"
              title="Add journal entry"
            >
              <Icon name="plus" size="sm" />
            </button>
          </div>

          {selectedDateTrades.length === 0 ? (
            <div className="text-xs text-zinc-500 text-center py-4">No trades on this day</div>
          ) : (
            <div className="space-y-2 max-h-[calc(100vh-200px)] overflow-auto">
              {selectedDateTrades.map(trade => (
                <TradeCard key={trade.id} trade={trade} onClick={() => onTradeClick(trade)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- TRADE CARD ---
function TradeCard({ trade, onClick }: { trade: Trade; onClick: () => void }) {
  const { getAnnotation } = useTradeJournalStore();
  const annotation = getAnnotation(trade.id);
  const isProfit = trade.profit >= 0;

  return (
    <div
      onClick={onClick}
      className="bg-zinc-900 border border-zinc-700 rounded p-2 cursor-pointer hover:bg-zinc-800 transition-colors"
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-white">{trade.symbol}</span>
          <span
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
              trade.type === 'BUY' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
            }`}
          >
            {trade.type}
          </span>
        </div>
        <span className={`text-xs font-bold ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
          ${trade.profit.toFixed(2)}
        </span>
      </div>

      <div className="text-[10px] text-zinc-400 mb-1">
        {new Date(trade.openTime).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        })}
        {' → '}
        {new Date(trade.closeTime).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </div>

      {annotation && annotation.tags.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {annotation.tags.map(tag => (
            <span
              key={tag}
              className="text-[9px] px-1.5 py-0.5 bg-blue-900/50 text-zinc-300 rounded"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// --- LIST VIEW ---
function ListView({ trades, onTradeClick }: { trades: Trade[]; onTradeClick: (trade: Trade) => void }) {
  const { getAnnotation } = useTradeJournalStore();

  return (
    <div className="p-4">
      <table className="w-full text-xs">
        <thead className="bg-zinc-800 sticky top-0">
          <tr className="border-b border-zinc-700">
            <th className="px-3 py-2 text-left font-medium text-zinc-400">Date</th>
            <th className="px-3 py-2 text-left font-medium text-zinc-400">Symbol</th>
            <th className="px-3 py-2 text-left font-medium text-zinc-400">Type</th>
            <th className="px-3 py-2 text-right font-medium text-zinc-400">Volume</th>
            <th className="px-3 py-2 text-right font-medium text-zinc-400">P&L</th>
            <th className="px-3 py-2 text-left font-medium text-zinc-400">Tags</th>
            <th className="px-3 py-2 text-center font-medium text-zinc-400">Emotion</th>
          </tr>
        </thead>
        <tbody>
          {trades.map(trade => {
            const annotation = getAnnotation(trade.id);
            const isProfit = trade.profit >= 0;

            return (
              <tr
                key={trade.id}
                onClick={() => onTradeClick(trade)}
                className="border-b border-zinc-800 hover:bg-zinc-800 cursor-pointer"
              >
                <td className="px-3 py-2 text-zinc-400">{trade.date}</td>
                <td className="px-3 py-2 font-medium">{trade.symbol}</td>
                <td
                  className={`px-3 py-2 font-medium ${
                    trade.type === 'BUY' ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {trade.type}
                </td>
                <td className="px-3 py-2 text-right">{trade.volume.toFixed(2)}</td>
                <td className={`px-3 py-2 text-right font-medium ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                  ${trade.profit.toFixed(2)}
                </td>
                <td className="px-3 py-2">
                  {annotation && annotation.tags.length > 0 ? (
                    <div className="flex gap-1 flex-wrap">
                      {annotation.tags.map(tag => (
                        <span
                          key={tag}
                          className="text-[9px] px-1.5 py-0.5 bg-blue-900/50 text-zinc-300 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-zinc-600">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {annotation ? (
                    <span className="text-yellow-400">{'★'.repeat(annotation.emotionRating)}</span>
                  ) : (
                    <span className="text-zinc-600">-</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// --- ANALYTICS VIEW ---
function AnalyticsView({ trades, annotations }: { trades: Trade[]; annotations: TradeAnnotation[] }) {
  // Performance by tag
  const tagPerformance = useMemo(() => {
    const tagMap = new Map<SetupTag, { wins: number; losses: number; totalPL: number; count: number }>();

    annotations.forEach(ann => {
      const trade = trades.find(t => t.id === ann.tradeId);
      if (!trade) return;

      ann.tags.forEach(tag => {
        const existing = tagMap.get(tag) || { wins: 0, losses: 0, totalPL: 0, count: 0 };
        existing.count++;
        existing.totalPL += trade.profit;
        if (trade.profit > 0) existing.wins++;
        else existing.losses++;
        tagMap.set(tag, existing);
      });
    });

    return Array.from(tagMap.entries()).map(([tag, data]) => ({
      tag,
      winRate: data.count > 0 ? (data.wins / data.count) * 100 : 0,
      totalPL: data.totalPL,
      count: data.count,
    }));
  }, [trades, annotations]);

  // Win rate by day of week
  const dayOfWeekStats = useMemo(() => {
    const dayMap = new Map<number, { wins: number; total: number }>();

    trades.forEach(trade => {
      const day = new Date(trade.date).getDay();
      const existing = dayMap.get(day) || { wins: 0, total: 0 };
      existing.total++;
      if (trade.profit > 0) existing.wins++;
      dayMap.set(day, existing);
    });

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days.map((name, idx) => {
      const data = dayMap.get(idx) || { wins: 0, total: 0 };
      return {
        day: name,
        winRate: data.total > 0 ? (data.wins / data.total) * 100 : 0,
        total: data.total,
      };
    });
  }, [trades]);

  // Win rate by session
  const sessionStats = useMemo(() => {
    const getSession = (time: string): SessionType => {
      const hour = new Date(time).getUTCHours();
      if (hour >= 0 && hour < 8) return 'Asian';
      if (hour >= 8 && hour < 16) return 'London';
      return 'NY';
    };

    const sessionMap = new Map<SessionType, { wins: number; total: number }>();

    trades.forEach(trade => {
      const session = getSession(trade.openTime);
      const existing = sessionMap.get(session) || { wins: 0, total: 0 };
      existing.total++;
      if (trade.profit > 0) existing.wins++;
      sessionMap.set(session, existing);
    });

    return ['Asian', 'London', 'NY'].map(session => {
      const data = sessionMap.get(session as SessionType) || { wins: 0, total: 0 };
      return {
        session,
        winRate: data.total > 0 ? (data.wins / data.total) * 100 : 0,
        total: data.total,
      };
    });
  }, [trades]);

  // Streak tracker
  const streaks = useMemo(() => {
    const sortedTrades = [...trades].sort(
      (a, b) => new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime()
    );

    let currentStreak = 0;
    let bestStreak = 0;
    let worstStreak = 0;
    let tempStreak = 0;

    sortedTrades.forEach(trade => {
      if (trade.profit > 0) {
        tempStreak = tempStreak > 0 ? tempStreak + 1 : 1;
        if (tempStreak > bestStreak) bestStreak = tempStreak;
      } else {
        tempStreak = tempStreak < 0 ? tempStreak - 1 : -1;
        if (tempStreak < worstStreak) worstStreak = tempStreak;
      }
    });

    currentStreak = tempStreak;

    return { currentStreak, bestStreak, worstStreak };
  }, [trades]);

  // Monthly summary
  const monthlySummary = useMemo(() => {
    const totalTrades = trades.length;
    const winningTrades = trades.filter(t => t.profit > 0);
    const losingTrades = trades.filter(t => t.profit < 0);
    const totalPL = trades.reduce((sum, t) => sum + t.profit, 0);
    const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;
    const avgWin = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + t.profit, 0) / winningTrades.length
      : 0;
    const avgLoss = losingTrades.length > 0
      ? losingTrades.reduce((sum, t) => sum + t.profit, 0) / losingTrades.length
      : 0;
    const profitFactor =
      avgLoss !== 0
        ? (winningTrades.reduce((sum, t) => sum + t.profit, 0) /
            Math.abs(losingTrades.reduce((sum, t) => sum + t.profit, 0))) || 0
        : 0;
    const expectancy = totalTrades > 0 ? totalPL / totalTrades : 0;

    return {
      totalTrades,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      expectancy,
      totalPL,
    };
  }, [trades]);

  return (
    <div className="p-4 space-y-4">
      {/* Monthly Summary */}
      <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
        <h3 className="text-sm font-semibold mb-3">Monthly Summary</h3>
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label="Total Trades" value={monthlySummary.totalTrades.toString()} />
          <MetricCard label="Win Rate" value={`${monthlySummary.winRate.toFixed(1)}%`} />
          <MetricCard
            label="Avg Win"
            value={`$${monthlySummary.avgWin.toFixed(2)}`}
            color="text-green-400"
          />
          <MetricCard
            label="Avg Loss"
            value={`$${monthlySummary.avgLoss.toFixed(2)}`}
            color="text-red-400"
          />
          <MetricCard label="Profit Factor" value={monthlySummary.profitFactor.toFixed(2)} />
          <MetricCard label="Expectancy" value={`$${monthlySummary.expectancy.toFixed(2)}`} />
          <MetricCard
            label="Total P&L"
            value={`$${monthlySummary.totalPL.toFixed(2)}`}
            color={monthlySummary.totalPL >= 0 ? 'text-green-400' : 'text-red-400'}
          />
        </div>
      </div>

      {/* Streak Tracker */}
      <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
        <h3 className="text-sm font-semibold mb-3">Streak Tracker</h3>
        <div className="grid grid-cols-3 gap-3">
          <MetricCard
            label="Current Streak"
            value={`${streaks.currentStreak > 0 ? '+' : ''}${streaks.currentStreak}`}
            color={streaks.currentStreak >= 0 ? 'text-green-400' : 'text-red-400'}
          />
          <MetricCard label="Best Streak" value={`+${streaks.bestStreak}`} color="text-green-400" />
          <MetricCard label="Worst Streak" value={`${streaks.worstStreak}`} color="text-red-400" />
        </div>
      </div>

      {/* Performance by Tag */}
      {tagPerformance.length > 0 && (
        <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
          <h3 className="text-sm font-semibold mb-3">Performance by Setup Type</h3>
          <table className="w-full text-xs">
            <thead className="border-b border-zinc-700">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-zinc-400">Tag</th>
                <th className="px-3 py-2 text-right font-medium text-zinc-400">Count</th>
                <th className="px-3 py-2 text-right font-medium text-zinc-400">Win Rate</th>
                <th className="px-3 py-2 text-right font-medium text-zinc-400">Total P&L</th>
              </tr>
            </thead>
            <tbody>
              {tagPerformance.map(({ tag, winRate, totalPL, count }) => (
                <tr key={tag} className="border-b border-zinc-800">
                  <td className="px-3 py-2 capitalize">{tag}</td>
                  <td className="px-3 py-2 text-right">{count}</td>
                  <td className="px-3 py-2 text-right">{winRate.toFixed(1)}%</td>
                  <td
                    className={`px-3 py-2 text-right font-medium ${
                      totalPL >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    ${totalPL.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Win Rate by Day of Week */}
      <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
        <h3 className="text-sm font-semibold mb-3">Win Rate by Day of Week</h3>
        <svg width="100%" height="120" className="text-xs">
          <g transform="translate(40, 10)">
            {dayOfWeekStats.map((stat, idx) => {
              const barWidth = 40;
              const maxHeight = 80;
              const barHeight = (stat.winRate / 100) * maxHeight;
              const x = idx * (barWidth + 10);
              const y = maxHeight - barHeight;

              return (
                <g key={stat.day}>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    fill={stat.winRate >= 50 ? '#22c55e' : '#ef4444'}
                    opacity="0.8"
                  />
                  <text x={x + barWidth / 2} y={maxHeight + 15} fill="#a1a1aa" textAnchor="middle" fontSize="10">
                    {stat.day}
                  </text>
                  <text x={x + barWidth / 2} y={y - 5} fill="#e4e4e7" textAnchor="middle" fontSize="10">
                    {stat.winRate.toFixed(0)}%
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Win Rate by Session */}
      <div className="bg-zinc-800 border border-zinc-700 rounded p-4">
        <h3 className="text-sm font-semibold mb-3">Win Rate by Trading Session</h3>
        <svg width="100%" height="120" className="text-xs">
          <g transform="translate(40, 10)">
            {sessionStats.map((stat, idx) => {
              const barWidth = 60;
              const maxHeight = 80;
              const barHeight = (stat.winRate / 100) * maxHeight;
              const x = idx * (barWidth + 20);
              const y = maxHeight - barHeight;

              return (
                <g key={stat.session}>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    fill={stat.winRate >= 50 ? '#22c55e' : '#ef4444'}
                    opacity="0.8"
                  />
                  <text x={x + barWidth / 2} y={maxHeight + 15} fill="#a1a1aa" textAnchor="middle" fontSize="10">
                    {stat.session}
                  </text>
                  <text x={x + barWidth / 2} y={y - 5} fill="#e4e4e7" textAnchor="middle" fontSize="10">
                    {stat.winRate.toFixed(0)}%
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}

// --- METRIC CARD ---
function MetricCard({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded p-2">
      <div className="text-[10px] text-zinc-400 uppercase mb-1">{label}</div>
      <div className={`text-sm font-bold ${color}`}>{value}</div>
    </div>
  );
}

// --- ANNOTATION FORM MODAL ---
interface AnnotationFormModalProps {
  trade: Trade;
  onClose: () => void;
  onSave: (annotation: TradeAnnotation) => void;
}

function AnnotationFormModal({ trade, onClose, onSave }: AnnotationFormModalProps) {
  const { getAnnotation } = useTradeJournalStore();
  const existing = getAnnotation(trade.id);

  const [notes, setNotes] = useState(existing?.notes || '');
  const [tags, setTags] = useState<SetupTag[]>(existing?.tags || []);
  const [emotionRating, setEmotionRating] = useState(existing?.emotionRating || 3);
  const [preTradePlan, setPreTradePlan] = useState(existing?.preTradePlan || '');
  const [postTradeReview, setPostTradeReview] = useState(existing?.postTradeReview || '');
  const [lessonsLearned, setLessonsLearned] = useState(existing?.lessonsLearned || '');

  const allTags: SetupTag[] = ['breakout', 'reversal', 'trend', 'range', 'news', 'scalp', 'swing'];

  const toggleTag = (tag: SetupTag) => {
    setTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const handleSave = () => {
    onSave({
      tradeId: trade.id,
      notes,
      tags,
      emotionRating,
      preTradePlan,
      postTradeReview,
      lessonsLearned,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-zinc-800 border-b border-zinc-700 p-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Annotate Trade #{trade.id} - {trade.symbol}
          </h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Trade Info */}
          <div className="bg-zinc-900 border border-zinc-700 rounded p-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-zinc-400">Symbol:</span> <span className="font-medium">{trade.symbol}</span></div>
              <div><span className="text-zinc-400">Type:</span> <span className={trade.type === 'BUY' ? 'text-green-400' : 'text-red-400'}>{trade.type}</span></div>
              <div><span className="text-zinc-400">P&L:</span> <span className={trade.profit >= 0 ? 'text-green-400' : 'text-red-400'}>${trade.profit.toFixed(2)}</span></div>
              <div><span className="text-zinc-400">Date:</span> {trade.date}</div>
            </div>
          </div>

          {/* Setup Tags */}
          <div>
            <label className="block text-xs font-medium mb-2">Setup Type</label>
            <div className="flex gap-2 flex-wrap">
              {allTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`px-3 py-1.5 rounded text-xs capitalize transition-colors ${
                    tags.includes(tag)
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Emotion Rating */}
          <div>
            <label className="block text-xs font-medium mb-2">Emotion Rating (1-5)</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(rating => (
                <button
                  key={rating}
                  onClick={() => setEmotionRating(rating)}
                  className={`w-10 h-10 rounded transition-colors ${
                    emotionRating >= rating
                      ? 'bg-yellow-500 text-yellow-900'
                      : 'bg-zinc-700 text-zinc-500'
                  }`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          {/* Pre-Trade Plan */}
          <div>
            <label className="block text-xs font-medium mb-2">Pre-Trade Plan</label>
            <textarea
              value={preTradePlan}
              onChange={(e) => setPreTradePlan(e.target.value)}
              placeholder="What was your plan before entering this trade?"
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs outline-none focus:border-zinc-600 resize-none"
              rows={3}
            />
          </div>

          {/* Post-Trade Review */}
          <div>
            <label className="block text-xs font-medium mb-2">Post-Trade Review</label>
            <textarea
              value={postTradeReview}
              onChange={(e) => setPostTradeReview(e.target.value)}
              placeholder="How did the trade unfold? Did it go as planned?"
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs outline-none focus:border-zinc-600 resize-none"
              rows={3}
            />
          </div>

          {/* Lessons Learned */}
          <div>
            <label className="block text-xs font-medium mb-2">Lessons Learned</label>
            <textarea
              value={lessonsLearned}
              onChange={(e) => setLessonsLearned(e.target.value)}
              placeholder="What did you learn from this trade?"
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs outline-none focus:border-zinc-600 resize-none"
              rows={3}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium mb-2">Additional Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional observations..."
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs outline-none focus:border-zinc-600 resize-none"
              rows={2}
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-zinc-800 border-t border-zinc-700 p-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-xs transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-xs transition-colors"
          >
            Save Annotation
          </button>
        </div>
      </div>
    </div>
  );
}

// --- JOURNAL ENTRY FORM MODAL ---
interface JournalEntryFormModalProps {
  selectedDate: string;
  onClose: () => void;
  onSave: (entry: { date: string; preTradePlan: string; postTradeReview: string; lessonsLearned: string; mood: number }) => void;
}

function JournalEntryFormModal({ selectedDate, onClose, onSave }: JournalEntryFormModalProps) {
  const [preTradePlan, setPreTradePlan] = useState('');
  const [postTradeReview, setPostTradeReview] = useState('');
  const [lessonsLearned, setLessonsLearned] = useState('');
  const [mood, setMood] = useState(3);

  const handleSave = () => {
    onSave({
      date: selectedDate,
      preTradePlan,
      postTradeReview,
      lessonsLearned,
      mood,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg w-full max-w-xl max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-zinc-800 border-b border-zinc-700 p-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Journal Entry - {selectedDate}</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium mb-2">Pre-Trade Plan</label>
            <textarea
              value={preTradePlan}
              onChange={(e) => setPreTradePlan(e.target.value)}
              placeholder="What's your trading plan for today?"
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs outline-none focus:border-zinc-600 resize-none"
              rows={4}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-2">Post-Trade Review</label>
            <textarea
              value={postTradeReview}
              onChange={(e) => setPostTradeReview(e.target.value)}
              placeholder="How did today's trading go?"
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs outline-none focus:border-zinc-600 resize-none"
              rows={4}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-2">Lessons Learned</label>
            <textarea
              value={lessonsLearned}
              onChange={(e) => setLessonsLearned(e.target.value)}
              placeholder="What did you learn today?"
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs outline-none focus:border-zinc-600 resize-none"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-2">Mood (1-5)</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(rating => (
                <button
                  key={rating}
                  onClick={() => setMood(rating)}
                  className={`w-10 h-10 rounded transition-colors ${
                    mood >= rating
                      ? 'bg-yellow-500 text-yellow-900'
                      : 'bg-zinc-700 text-zinc-500'
                  }`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-zinc-800 border-t border-zinc-700 p-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-xs transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded text-xs transition-colors"
          >
            Save Entry
          </button>
        </div>
      </div>
    </div>
  );
}

// --- MOCK DATA GENERATOR ---
function generateMockTrades(): Trade[] {
  // TODO: Replace with API call to /api/trades/history
  return [];
}
