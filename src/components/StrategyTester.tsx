/**
 * Strategy Tester / Backtesting Panel
 * MT5-style strategy tester with simulated backtest engine
 */

import { Icon } from './ui/Icon';
import { useState } from 'react';
import { useBacktestStore, type BacktestResults, type Trade } from '../store/useBacktestStore';

type Strategy = 'ma_crossover' | 'rsi' | 'bollinger';
type TabType = 'Results' | 'Graph' | 'TradeLog';

const STRATEGIES = [
    { id: 'ma_crossover' as Strategy, name: 'Moving Average Crossover' },
    { id: 'rsi' as Strategy, name: 'RSI Overbought/Oversold' },
    { id: 'bollinger' as Strategy, name: 'Bollinger Band Bounce' }
];

const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN1'];

// Simulated backtest engine
function runBacktest(
    strategy: Strategy,
    symbol: string,
    timeframe: string,
    dateFrom: string,
    dateTo: string,
    initialDeposit: number,
    spread: number,
    commission: number,
    onProgress: (progress: number, currentDate: string) => void
): Promise<BacktestResults> {
    return new Promise((resolve) => {
        const trades: Trade[] = [];
        let balance = initialDeposit;
        const equityCurve: { date: string; balance: number }[] = [];

        // Simulate backtest processing
        const totalSteps = 100;
        let step = 0;

        const interval = setInterval(() => {
            step++;
            const progress = (step / totalSteps) * 100;

            // Generate current date being processed
            const daysFromStart = Math.floor((step / totalSteps) * 90); // 90-day backtest
            const currentDate = new Date(dateFrom);
            currentDate.setDate(currentDate.getDate() + daysFromStart);

            onProgress(progress, currentDate.toISOString().split('T')[0]);

            if (step >= totalSteps) {
                clearInterval(interval);

                // Generate simulated trades based on strategy
                const numTrades = Math.floor(Math.random() * 30) + 20; // 20-50 trades

                for (let i = 0; i < numTrades; i++) {
                    const tradeDate = new Date(dateFrom);
                    tradeDate.setDate(tradeDate.getDate() + Math.floor(Math.random() * 90));

                    const type: 'BUY' | 'SELL' = Math.random() > 0.5 ? 'BUY' : 'SELL';
                    const volume = Math.random() * 0.5 + 0.1; // 0.1-0.6 lots
                    const price = 1.0 + Math.random() * 0.2; // Random price

                    // Simulate win/loss based on strategy
                    let winProbability = 0.55; // Base 55% win rate
                    if (strategy === 'ma_crossover') winProbability = 0.52;
                    if (strategy === 'rsi') winProbability = 0.58;
                    if (strategy === 'bollinger') winProbability = 0.54;

                    const isWin = Math.random() < winProbability;
                    const profitPips = isWin
                        ? Math.random() * 50 + 20 // 20-70 pips win
                        : -(Math.random() * 40 + 10); // -10 to -50 pips loss

                    const profit = profitPips * volume * 10 - commission; // Simplified P&L
                    balance += profit;

                    trades.push({
                        id: i + 1,
                        time: tradeDate.toISOString(),
                        type,
                        symbol,
                        volume,
                        price,
                        sl: type === 'BUY' ? price - 0.005 : price + 0.005,
                        tp: type === 'BUY' ? price + 0.01 : price - 0.01,
                        profit,
                        balance
                    });

                    // Add to equity curve
                    equityCurve.push({
                        date: tradeDate.toISOString().split('T')[0],
                        balance
                    });
                }

                // Sort trades by time
                trades.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

                // Calculate statistics
                const winningTrades = trades.filter(t => t.profit > 0);
                const losingTrades = trades.filter(t => t.profit < 0);

                const grossProfit = winningTrades.reduce((sum, t) => sum + t.profit, 0);
                const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.profit, 0));
                const netProfit = balance - initialDeposit;

                // Calculate max drawdown
                let maxBalance = initialDeposit;
                let maxDrawdown = 0;
                trades.forEach(t => {
                    if (t.balance > maxBalance) maxBalance = t.balance;
                    const drawdown = maxBalance - t.balance;
                    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
                });

                // Calculate consecutive wins/losses
                let maxConsecutiveWins = 0;
                let maxConsecutiveLosses = 0;
                let currentWinStreak = 0;
                let currentLossStreak = 0;

                trades.forEach(t => {
                    if (t.profit > 0) {
                        currentWinStreak++;
                        currentLossStreak = 0;
                        if (currentWinStreak > maxConsecutiveWins) maxConsecutiveWins = currentWinStreak;
                    } else {
                        currentLossStreak++;
                        currentWinStreak = 0;
                        if (currentLossStreak > maxConsecutiveLosses) maxConsecutiveLosses = currentLossStreak;
                    }
                });

                const results: BacktestResults = {
                    netProfit,
                    grossProfit,
                    grossLoss,
                    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 0,
                    expectedPayoff: trades.length > 0 ? netProfit / trades.length : 0,
                    totalTrades: trades.length,
                    winRate: (winningTrades.length / trades.length) * 100,
                    lossRate: (losingTrades.length / trades.length) * 100,
                    largestWin: winningTrades.length > 0 ? Math.max(...winningTrades.map(t => t.profit)) : 0,
                    largestLoss: losingTrades.length > 0 ? Math.min(...losingTrades.map(t => t.profit)) : 0,
                    averageWin: winningTrades.length > 0 ? grossProfit / winningTrades.length : 0,
                    averageLoss: losingTrades.length > 0 ? grossLoss / losingTrades.length : 0,
                    maxConsecutiveWins,
                    maxConsecutiveLosses,
                    maxDrawdown,
                    maxDrawdownPercent: (maxDrawdown / initialDeposit) * 100,
                    sharpeRatio: Math.random() * 2 + 0.5, // Simulated 0.5-2.5
                    recoveryFactor: maxDrawdown > 0 ? netProfit / maxDrawdown : 0,
                    trades,
                    equityCurve: equityCurve.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                };

                resolve(results);
            }
        }, 50); // 50ms per step = ~5 seconds total
    });
}

export function StrategyTester() {
    const [settingsCollapsed, setSettingsCollapsed] = useState(false);
    const [activeTab, setActiveTab] = useState<TabType>('Results');

    // Settings
    const [strategy, setStrategy] = useState<Strategy>('ma_crossover');
    const [symbol, setSymbol] = useState('EURUSD');
    const [timeframe, setTimeframe] = useState('H1');
    const [dateFrom, setDateFrom] = useState(() => {
        const date = new Date();
        date.setMonth(date.getMonth() - 3);
        return date.toISOString().split('T')[0];
    });
    const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
    const [initialDeposit, setInitialDeposit] = useState(10000);
    const [spread, setSpread] = useState(10);
    const [commission, setCommission] = useState(5);

    const { isRunning, progress, currentDate, estimatedTimeRemaining, results, startBacktest, stopBacktest, setProgress, setResults, reset } = useBacktestStore();

    const handleStart = async () => {
        startBacktest();

        const backtestResults = await runBacktest(
            strategy,
            symbol,
            timeframe,
            dateFrom,
            dateTo,
            initialDeposit,
            spread,
            commission,
            (prog, date) => setProgress(prog, date)
        );

        setResults(backtestResults);
    };

    const handleStop = () => {
        stopBacktest();
    };

    return (
        <div className="h-full flex bg-[#131316] text-zinc-300">
            {/* Settings Panel */}
            <div
                className={`bg-[#252525] border-r border-zinc-700 flex flex-col transition-all duration-300 ${settingsCollapsed ? 'w-8' : 'w-64'
                    }`}
            >
                {settingsCollapsed ? (
                    <button
                        onClick={() => setSettingsCollapsed(false)}
                        className="p-2 hover:bg-zinc-700 transition-colors"
                        title="Expand Settings"
                    >
                        <Icon name="chevron-right" size="sm" className="w-4 h-4" />
                    </button>
                ) : (
                    <>
                        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
                            <span className="text-sm font-semibold text-zinc-100">Settings</span>
                            <button
                                onClick={() => setSettingsCollapsed(true)}
                                className="p-1 hover:bg-zinc-700 rounded transition-colors"
                            >
                                <Icon name="chevron-left" size="sm" className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 p-3 space-y-3">
                            {/* Strategy Selector */}
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1">Strategy</label>
                                <select
                                    value={strategy}
                                    onChange={(e) => setStrategy(e.target.value as Strategy)}
                                    disabled={isRunning}
                                    className="w-full bg-zinc-800 text-zinc-100 px-2 py-1.5 rounded text-xs border border-zinc-700 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
                                >
                                    {STRATEGIES.map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Symbol */}
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1">Symbol</label>
                                <input
                                    type="text"
                                    value={symbol}
                                    onChange={(e) => setSymbol(e.target.value)}
                                    disabled={isRunning}
                                    className="w-full bg-zinc-800 text-zinc-100 px-2 py-1.5 rounded text-xs border border-zinc-700 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
                                />
                            </div>

                            {/* Timeframe */}
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1">Timeframe</label>
                                <select
                                    value={timeframe}
                                    onChange={(e) => setTimeframe(e.target.value)}
                                    disabled={isRunning}
                                    className="w-full bg-zinc-800 text-zinc-100 px-2 py-1.5 rounded text-xs border border-zinc-700 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
                                >
                                    {TIMEFRAMES.map(tf => (
                                        <option key={tf} value={tf}>{tf}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Date Range */}
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1">From</label>
                                <input
                                    type="date"
                                    value={dateFrom}
                                    onChange={(e) => setDateFrom(e.target.value)}
                                    disabled={isRunning}
                                    className="w-full bg-zinc-800 text-zinc-100 px-2 py-1.5 rounded text-xs border border-zinc-700 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1">To</label>
                                <input
                                    type="date"
                                    value={dateTo}
                                    onChange={(e) => setDateTo(e.target.value)}
                                    disabled={isRunning}
                                    className="w-full bg-zinc-800 text-zinc-100 px-2 py-1.5 rounded text-xs border border-zinc-700 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
                                />
                            </div>

                            {/* Initial Deposit */}
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1">Initial Deposit</label>
                                <input
                                    type="number"
                                    value={initialDeposit}
                                    onChange={(e) => setInitialDeposit(Number(e.target.value))}
                                    disabled={isRunning}
                                    className="w-full bg-zinc-800 text-zinc-100 px-2 py-1.5 rounded text-xs border border-zinc-700 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
                                />
                            </div>

                            {/* Spread */}
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1">Spread (points)</label>
                                <input
                                    type="number"
                                    value={spread}
                                    onChange={(e) => setSpread(Number(e.target.value))}
                                    disabled={isRunning}
                                    className="w-full bg-zinc-800 text-zinc-100 px-2 py-1.5 rounded text-xs border border-zinc-700 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
                                />
                            </div>

                            {/* Commission */}
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1">Commission ($)</label>
                                <input
                                    type="number"
                                    value={commission}
                                    onChange={(e) => setCommission(Number(e.target.value))}
                                    disabled={isRunning}
                                    className="w-full bg-zinc-800 text-zinc-100 px-2 py-1.5 rounded text-xs border border-zinc-700 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
                                />
                            </div>

                            {/* Optimization (disabled) */}
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    disabled
                                    className="w-4 h-4 bg-zinc-800 border border-zinc-700 rounded opacity-50"
                                />
                                <label className="text-xs text-zinc-600">Optimization (Coming Soon)</label>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="p-3 border-t border-zinc-700 space-y-2">
                            {!isRunning ? (
                                <button
                                    onClick={handleStart}
                                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium transition-colors"
                                >
                                    <Icon name="play" size="sm" className="w-4 h-4" />
                                    Start
                                </button>
                            ) : (
                                <button
                                    onClick={handleStop}
                                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-medium transition-colors"
                                >
                                    <Icon name="rectangle" size="sm" className="w-4 h-4" />
                                    Stop
                                </button>
                            )}
                            {results && (
                                <button
                                    onClick={reset}
                                    className="w-full px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-xs font-medium transition-colors"
                                >
                                    Reset
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Progress Bar */}
                {(isRunning || progress > 0) && (
                    <div className="bg-[#191a1e] border-b border-zinc-700 p-3">
                        <div className="flex items-center justify-between mb-2 text-xs">
                            <span className="text-zinc-400">
                                {isRunning ? 'Processing...' : 'Complete'}
                            </span>
                            <div className="flex items-center gap-3">
                                {currentDate && (
                                    <span className="text-zinc-500">Date: {currentDate}</span>
                                )}
                                {isRunning && (
                                    <span className="text-zinc-500">~{estimatedTimeRemaining}s remaining</span>
                                )}
                                <span className="text-zinc-300 font-bold">{progress.toFixed(0)}%</span>
                            </div>
                        </div>
                        <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                            <div
                                className="bg-zinc-8000 h-full transition-all duration-300"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Results Tabs */}
                {results && (
                    <>
                        <div className="flex items-center bg-[#131316] border-b border-zinc-700">
                            {(['Results', 'Graph', 'TradeLog'] as TabType[]).map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`px-4 py-2 text-xs font-medium transition-colors border-r border-zinc-700/50 ${activeTab === tab
                                        ? 'text-white bg-[#191a1e] shadow-[inset_0_2px_0_0_#8a8a8f] font-semibold'
                                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#191a1e]/50'
                                        }`}
                                >
                                    {tab === 'TradeLog' ? 'Trade Log' : tab}
                                </button>
                            ))}
                        </div>

                        <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700 bg-[#131316]">
                            {activeTab === 'Results' && <ResultsTab results={results} />}
                            {activeTab === 'Graph' && <GraphTab results={results} initialDeposit={initialDeposit} />}
                            {activeTab === 'TradeLog' && <TradeLogTab trades={results.trades} />}
                        </div>
                    </>
                )}

                {/* Empty State */}
                {!results && progress === 0 && (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center">
                            <Icon name="trending-up" size="sm" className="w-16 h-16 text-zinc-700 mx-auto mb-4" />
                            <p className="text-zinc-500 text-sm">Configure settings and click Start to run backtest</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// Results Tab Component
function ResultsTab({ results }: { results: BacktestResults }) {
    const formatMoney = (val: number) => {
        return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' }).format(val);
    };

    const formatPercent = (val: number) => {
        return `${val.toFixed(2)}%`;
    };

    return (
        <div className="p-4">
            <div className="grid grid-cols-2 gap-4 max-w-4xl">
                {/* Column 1 */}
                <div className="space-y-3">
                    <StatRow label="Total Net Profit" value={formatMoney(results.netProfit)} valueColor={results.netProfit >= 0 ? 'text-green-400' : 'text-red-400'} />
                    <StatRow label="Gross Profit" value={formatMoney(results.grossProfit)} valueColor="text-green-400" />
                    <StatRow label="Gross Loss" value={formatMoney(-results.grossLoss)} valueColor="text-red-400" />
                    <StatRow label="Profit Factor" value={results.profitFactor.toFixed(2)} />
                    <StatRow label="Expected Payoff" value={formatMoney(results.expectedPayoff)} />
                    <StatRow label="Total Trades" value={results.totalTrades.toString()} />
                    <StatRow label="Win Rate" value={formatPercent(results.winRate)} valueColor="text-green-400" />
                    <StatRow label="Loss Rate" value={formatPercent(results.lossRate)} valueColor="text-red-400" />
                    <StatRow label="Largest Win" value={formatMoney(results.largestWin)} valueColor="text-green-400" />
                    <StatRow label="Largest Loss" value={formatMoney(results.largestLoss)} valueColor="text-red-400" />
                </div>

                {/* Column 2 */}
                <div className="space-y-3">
                    <StatRow label="Average Win" value={formatMoney(results.averageWin)} valueColor="text-green-400" />
                    <StatRow label="Average Loss" value={formatMoney(-results.averageLoss)} valueColor="text-red-400" />
                    <StatRow label="Max Consecutive Wins" value={results.maxConsecutiveWins.toString()} />
                    <StatRow label="Max Consecutive Losses" value={results.maxConsecutiveLosses.toString()} />
                    <StatRow label="Max Drawdown" value={formatMoney(results.maxDrawdown)} valueColor="text-red-400" />
                    <StatRow label="Max Drawdown %" value={formatPercent(results.maxDrawdownPercent)} valueColor="text-red-400" />
                    <StatRow label="Sharpe Ratio" value={results.sharpeRatio.toFixed(2)} />
                    <StatRow label="Recovery Factor" value={results.recoveryFactor.toFixed(2)} />
                </div>
            </div>
        </div>
    );
}

function StatRow({ label, value, valueColor = 'text-zinc-100' }: { label: string; value: string; valueColor?: string }) {
    return (
        <div className="flex items-center justify-between py-1 border-b border-zinc-800">
            <span className="text-xs text-zinc-400">{label}:</span>
            <span className={`text-xs font-mono font-bold ${valueColor}`}>{value}</span>
        </div>
    );
}

// Graph Tab Component
function GraphTab({ results, initialDeposit }: { results: BacktestResults; initialDeposit: number }) {
    const equityCurve = results.equityCurve;
    if (equityCurve.length === 0) return <div className="p-4 text-zinc-500 text-sm">No equity data</div>;

    const width = 800;
    const height = 400;
    const padding = { top: 20, right: 40, bottom: 40, left: 60 };

    const minBalance = Math.min(initialDeposit, ...equityCurve.map(d => d.balance));
    const maxBalance = Math.max(initialDeposit, ...equityCurve.map(d => d.balance));
    const balanceRange = maxBalance - minBalance;

    // Create SVG path
    const points = equityCurve.map((d, i) => {
        const x = padding.left + (i / (equityCurve.length - 1)) * (width - padding.left - padding.right);
        const y = padding.top + (1 - (d.balance - minBalance) / balanceRange) * (height - padding.top - padding.bottom);
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');

    return (
        <div className="p-4 flex items-center justify-center">
            <svg width={width} height={height} className="bg-zinc-900 rounded">
                {/* Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
                    const y = padding.top + ratio * (height - padding.top - padding.bottom);
                    const value = maxBalance - ratio * balanceRange;
                    return (
                        <g key={ratio}>
                            <line
                                x1={padding.left}
                                y1={y}
                                x2={width - padding.right}
                                y2={y}
                                stroke="#3f3f46"
                                strokeWidth="1"
                            />
                            <text x={padding.left - 10} y={y + 4} className="text-[10px] fill-zinc-500" textAnchor="end">
                                ${value.toFixed(0)}
                            </text>
                        </g>
                    );
                })}

                {/* Equity curve */}
                <path d={points} fill="none" stroke="#8a8a8f" strokeWidth="2" />

                {/* Initial deposit line */}
                <line
                    x1={padding.left}
                    y1={padding.top + (1 - (initialDeposit - minBalance) / balanceRange) * (height - padding.top - padding.bottom)}
                    x2={width - padding.right}
                    y2={padding.top + (1 - (initialDeposit - minBalance) / balanceRange) * (height - padding.top - padding.bottom)}
                    stroke="#71717a"
                    strokeWidth="1"
                    strokeDasharray="5,5"
                />

                {/* Axes */}
                <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke="#71717a" strokeWidth="2" />
                <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="#71717a" strokeWidth="2" />

                {/* Labels */}
                <text x={width / 2} y={height - 10} className="text-xs fill-zinc-400" textAnchor="middle">Time</text>
                <text x={20} y={height / 2} className="text-xs fill-zinc-400" textAnchor="middle" transform={`rotate(-90, 20, ${height / 2})`}>Balance ($)</text>
            </svg>
        </div>
    );
}

// Trade Log Tab Component
function TradeLogTab({ trades }: { trades: Trade[] }) {
    const formatMoney = (val: number) => {
        return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' }).format(val);
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleString('en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false
        });
    };

    return (
        <div className="overflow-auto">
            <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-[#191a1e] text-zinc-400 z-10 font-bold text-[10px] uppercase tracking-wider border-b border-zinc-600">
                    <tr>
                        <th className="p-2 border-r border-zinc-700">#</th>
                        <th className="p-2 border-r border-zinc-700">Time</th>
                        <th className="p-2 border-r border-zinc-700">Type</th>
                        <th className="p-2 border-r border-zinc-700">Symbol</th>
                        <th className="p-2 border-r border-zinc-700 text-right">Volume</th>
                        <th className="p-2 border-r border-zinc-700 text-right">Price</th>
                        <th className="p-2 border-r border-zinc-700 text-right">S/L</th>
                        <th className="p-2 border-r border-zinc-700 text-right">T/P</th>
                        <th className="p-2 border-r border-zinc-700 text-right">Profit</th>
                        <th className="p-2 text-right">Balance</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 text-zinc-300 font-mono text-[11px]">
                    {trades.map((trade, i) => (
                        <tr key={trade.id} className={`${i % 2 === 0 ? 'bg-[#131316]' : 'bg-[#0f0f12]'} hover:bg-[#191a1e] transition-colors`}>
                            <td className="p-2 border-r border-zinc-800 text-zinc-500">{trade.id}</td>
                            <td className="p-2 border-r border-zinc-800 text-zinc-400 text-[10px]">{formatDate(trade.time)}</td>
                            <td className={`p-2 border-r border-zinc-800 font-bold text-[10px] ${trade.type === 'BUY' ? 'text-blue-400' : 'text-red-400'}`}>
                                {trade.type}
                            </td>
                            <td className="p-2 border-r border-zinc-800 text-zinc-100">{trade.symbol}</td>
                            <td className="p-2 border-r border-zinc-800 text-right">{trade.volume.toFixed(2)}</td>
                            <td className="p-2 border-r border-zinc-800 text-right">{trade.price.toFixed(5)}</td>
                            <td className="p-2 border-r border-zinc-800 text-right text-red-300">{trade.sl.toFixed(5)}</td>
                            <td className="p-2 border-r border-zinc-800 text-right text-emerald-300">{trade.tp.toFixed(5)}</td>
                            <td className={`p-2 border-r border-zinc-800 text-right font-bold ${trade.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {formatMoney(trade.profit)}
                            </td>
                            <td className="p-2 text-right text-zinc-300">{trade.balance.toFixed(2)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
