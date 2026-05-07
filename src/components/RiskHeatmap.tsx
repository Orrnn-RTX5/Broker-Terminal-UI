/**
 * Risk Heatmap / Exposure Map
 * Comprehensive risk visualization with exposure analysis and concentration warnings
 */

import { Icon } from './ui/Icon';
import { useState, useMemo, useEffect } from 'react';
import { api } from '../services/api';

interface Position {
    id: number;
    symbol: string;
    side: 'BUY' | 'SELL';
    volume: number;
    openPrice: number;
    currentPrice: number;
    unrealizedPnL: number;
    margin: number;
}

// Positions come from the centralized API now

// Extract currency from symbol
function getCurrencies(symbol: string): { base: string; quote: string } {
    return {
        base: symbol.substring(0, 3),
        quote: symbol.substring(3, 6)
    };
}

// Get color based on intensity (0-1 scale)
function getIntensityColor(value: number, maxValue: number, type: 'profit' | 'loss' | 'neutral'): string {
    const intensity = Math.min(value / maxValue, 1);

    if (type === 'profit') {
        // Green gradient
        const g = Math.round(185 * intensity + 40 * (1 - intensity));
        return `rgb(40, ${g}, 100)`;
    } else if (type === 'loss') {
        // Red gradient
        const r = Math.round(239 * intensity + 40 * (1 - intensity));
        return `rgb(${r}, 68, 68)`;
    } else {
        // Blue gradient for neutral
        const b = Math.round(130 * intensity + 60 * (1 - intensity));
        return `rgb(60, 80, ${b})`;
    }
}

export const RiskHeatmap: React.FC<{ accountId?: string }> = ({ accountId }) => {
    const [positions, setPositions] = useState<Position[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchPositions = async () => {
            try {
                setLoading(true);
                const data = await api.positions.getPositions();
                // Map the Position[] response to the component's internal Position interface
                const mappedPositions: Position[] = data.map(p => ({
                    id: Number(p.id) || Math.random(),
                    symbol: p.symbol,
                    side: p.side.toUpperCase() as 'BUY' | 'SELL',
                    volume: p.quantity,
                    openPrice: p.open_price,
                    currentPrice: p.current_price,
                    unrealizedPnL: p.unrealized_pl,
                    margin: 0 // Margin might not be available per-position in current endpoint
                }));
                setPositions(mappedPositions);
            } catch (err) {
                console.error('[RiskHeatmap] Failed to fetch positions:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchPositions();
        const interval = setInterval(fetchPositions, 5000); // Polling every 5 seconds
        return () => clearInterval(interval);
    }, [accountId]);

    // Calculate exposures
    const { totalExposure, netLongExposure, netShortExposure, largestExposure, currencyExposure, totalMargin, totalPnL } = useMemo(() => {
        if (positions.length === 0) {
            return {
                totalExposure: 0,
                netLongExposure: 0,
                netShortExposure: 0,
                largestExposure: { symbol: 'N/A', percent: 0 },
                currencyExposure: {} as { [key: string]: { long: number; short: number } },
                totalMargin: 0,
                totalPnL: 0
            };
        }

        const totalExp = positions.reduce((sum, p) => sum + (p.volume * 100000), 0); // Notional value
        const longExp = positions.filter(p => p.side === 'BUY').reduce((sum, p) => sum + (p.volume * 100000), 0);
        const shortExp = positions.filter(p => p.side === 'SELL').reduce((sum, p) => sum + (p.volume * 100000), 0);

        // Find largest single exposure
        const sorted = [...positions].sort((a, b) => (b.volume * 100000) - (a.volume * 100000));
        const largest = sorted[0];
        const largestPct = totalExp > 0 ? ((largest.volume * 100000) / totalExp) * 100 : 0;

        // Currency exposure
        const currExp: { [key: string]: { long: number; short: number } } = {};
        positions.forEach(p => {
            const { base, quote } = getCurrencies(p.symbol);

            if (!currExp[base]) currExp[base] = { long: 0, short: 0 };
            if (!currExp[quote]) currExp[quote] = { long: 0, short: 0 };

            if (p.side === 'BUY') {
                currExp[base].long += p.volume;
                currExp[quote].short += p.volume;
            } else {
                currExp[base].short += p.volume;
                currExp[quote].long += p.volume;
            }
        });

        const margin = positions.reduce((sum, p) => sum + p.margin, 0);
        const pnl = positions.reduce((sum, p) => sum + p.unrealizedPnL, 0);

        return {
            totalExposure: totalExp,
            netLongExposure: longExp,
            netShortExposure: shortExp,
            largestExposure: { symbol: largest.symbol, percent: largestPct },
            currencyExposure: currExp,
            totalMargin: margin,
            totalPnL: pnl
        };
    }, [positions]);

    // Calculate concentration risk
    const concentration = useMemo(() => {
        const totalNotional = positions.reduce((sum, p) => sum + (p.volume * 100000), 0);
        return positions.map(p => ({
            symbol: p.symbol,
            percent: totalNotional > 0 ? ((p.volume * 100000) / totalNotional) * 100 : 0
        }));
    }, [positions]);

    const hasSingleConcentrationWarning = concentration.some(c => c.percent > 25);

    // Calculate risk metrics
    const riskMetrics = useMemo(() => {
        const balance = 100000; // Mock balance
        const equity = balance + totalPnL;
        const marginLevel = totalMargin > 0 ? (equity / totalMargin) * 100 : 0;
        const freeMargin = equity - totalMargin;

        // Simplified VaR (95% confidence, 1-day)
        const portfolioStdDev = positions.length > 0
            ? Math.sqrt(positions.reduce((sum, p) => sum + Math.pow(p.unrealizedPnL, 2), 0) / positions.length)
            : 0;
        const var95 = 1.65 * portfolioStdDev; // 95% confidence

        // Max drawdown potential (worst case all positions at SL)
        const maxDrawdown = positions.reduce((sum, p) => sum + Math.abs(p.unrealizedPnL) * 1.5, 0); // 1.5x current loss

        // Diversification score (1-10): more unique currencies = higher score
        const uniqueCurrencies = new Set(positions.flatMap(p => [getCurrencies(p.symbol).base, getCurrencies(p.symbol).quote]));
        const diversificationScore = Math.min(10, uniqueCurrencies.size);

        return {
            marginLevel,
            freeMargin,
            var95,
            maxDrawdown,
            diversificationScore
        };
    }, [positions, totalPnL, totalMargin]);

    // Format currency
    const formatMoney = (val: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
    const formatPnL = (val: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' }).format(val);

    // Get max values for heatmap scaling
    const maxVolume = Math.max(1, ...positions.map(p => p.volume));
    const maxNotional = Math.max(1, ...positions.map(p => p.volume * 100000));
    const maxPnL = Math.max(1, ...positions.map(p => Math.abs(p.unrealizedPnL)));
    const maxMargin = Math.max(1, ...positions.map(p => p.margin));

    return (
        <div className="h-full flex flex-col bg-[#131316] text-zinc-300 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700">
            {/* Exposure Summary Bar */}
            <div className="bg-[#191a1e] border-b border-zinc-700 p-4 flex-shrink-0">
                <div className="grid grid-cols-4 gap-4">
                    <div>
                        <div className="text-xs text-zinc-500 mb-1">Total Exposure</div>
                        <div className="text-lg font-bold text-zinc-100">${formatMoney(totalExposure)}</div>
                    </div>
                    <div>
                        <div className="text-xs text-zinc-500 mb-1">Net Long / Short</div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-green-400">${formatMoney(netLongExposure)}</span>
                            <span className="text-zinc-600">/</span>
                            <span className="text-sm text-red-400">${formatMoney(netShortExposure)}</span>
                        </div>
                    </div>
                    <div>
                        <div className="text-xs text-zinc-500 mb-1">Largest Single Exposure</div>
                        <div className="text-sm font-medium text-zinc-100">
                            {largestExposure.symbol} ({largestExposure.percent.toFixed(1)}%)
                            {largestExposure.percent > 25 && (
                                <Icon name="alert-triangle" size="sm" className="inline w-4 h-4 ml-1 text-yellow-400" />
                            )}
                        </div>
                    </div>
                    <div>
                        <div className="text-xs text-zinc-500 mb-1">Total P&L</div>
                        <div className={`text-lg font-bold ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {formatPnL(totalPnL)}
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex-1 p-4 space-y-6 overflow-y-auto">
                {/* Heatmap Grid */}
                <div>
                    <h3 className="text-sm font-semibold text-zinc-400 mb-3 flex items-center gap-2">
                        <Icon name="shield" size="sm" className="w-4 h-4" />
                        Position Exposure Heatmap
                    </h3>
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                            <thead className="bg-[#191a1e] text-zinc-400 text-[10px] uppercase">
                                <tr>
                                    <th className="p-2 text-left border border-zinc-700">Symbol</th>
                                    <th className="p-2 text-left border border-zinc-700">Side</th>
                                    <th className="p-2 text-right border border-zinc-700">Volume</th>
                                    <th className="p-2 text-right border border-zinc-700">Notional Value</th>
                                    <th className="p-2 text-right border border-zinc-700">Unrealized P&L</th>
                                    <th className="p-2 text-right border border-zinc-700">% of Portfolio</th>
                                    <th className="p-2 text-right border border-zinc-700">Margin Used</th>
                                </tr>
                            </thead>
                            <tbody className="text-xs font-mono">
                                {positions.map((pos, i) => {
                                    const notional = pos.volume * 100000;
                                    const pctPortfolio = (notional / totalExposure) * 100;

                                    return (
                                        <tr key={pos.id} className={i % 2 === 0 ? 'bg-[#131316]' : 'bg-[#0f0f12]'}>
                                            <td className="p-2 border border-zinc-800 font-bold text-zinc-100">{pos.symbol}</td>
                                            <td className={`p-2 border border-zinc-800 font-bold ${pos.side === 'BUY' ? 'text-blue-400' : 'text-red-400'}`}>
                                                {pos.side}
                                            </td>
                                            <td
                                                className="p-2 border border-zinc-800 text-right"
                                                style={{ backgroundColor: getIntensityColor(pos.volume, maxVolume, 'neutral') }}
                                                title={`${pos.volume.toFixed(2)} lots`}
                                            >
                                                {pos.volume.toFixed(2)}
                                            </td>
                                            <td
                                                className="p-2 border border-zinc-800 text-right"
                                                style={{ backgroundColor: getIntensityColor(notional, maxNotional, 'neutral') }}
                                                title={`$${formatMoney(notional)}`}
                                            >
                                                ${formatMoney(notional)}
                                            </td>
                                            <td
                                                className="p-2 border border-zinc-800 text-right font-bold"
                                                style={{ backgroundColor: getIntensityColor(Math.abs(pos.unrealizedPnL), maxPnL, pos.unrealizedPnL >= 0 ? 'profit' : 'loss') }}
                                                title={formatPnL(pos.unrealizedPnL)}
                                            >
                                                {formatPnL(pos.unrealizedPnL)}
                                            </td>
                                            <td className="p-2 border border-zinc-800 text-right">
                                                {pctPortfolio.toFixed(1)}%
                                                {pctPortfolio > 25 && <Icon name="alert-triangle" size="sm" className="inline w-3 h-3 ml-1 text-yellow-400" />}
                                            </td>
                                            <td
                                                className="p-2 border border-zinc-800 text-right"
                                                style={{ backgroundColor: getIntensityColor(pos.margin, maxMargin, 'neutral') }}
                                                title={`$${formatMoney(pos.margin)}`}
                                            >
                                                ${formatMoney(pos.margin)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Currency Exposure Chart */}
                <div>
                    <h3 className="text-sm font-semibold text-zinc-400 mb-3">Currency Exposure</h3>
                    <div className="space-y-2">
                        {Object.entries(currencyExposure).map(([currency, exposure]) => {
                            const netExposure = exposure.long - exposure.short;
                            const totalCurrExposure = exposure.long + exposure.short;
                            const longPct = totalCurrExposure > 0 ? (exposure.long / totalCurrExposure) * 100 : 50;
                            const shortPct = totalCurrExposure > 0 ? (exposure.short / totalCurrExposure) * 100 : 50;

                            return (
                                <div key={currency} className="bg-zinc-900 rounded p-2">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs font-bold text-zinc-300">{currency}</span>
                                        <span className={`text-xs font-mono ${netExposure >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                            Net: {netExposure >= 0 ? '+' : ''}{netExposure.toFixed(2)} lots
                                        </span>
                                    </div>
                                    <div className="flex h-6 rounded overflow-hidden">
                                        <div
                                            className="bg-green-600 flex items-center justify-center text-[10px] text-white font-bold"
                                            style={{ width: `${longPct}%` }}
                                        >
                                            {exposure.long > 0.1 && `Long ${exposure.long.toFixed(1)}`}
                                        </div>
                                        <div
                                            className="bg-red-600 flex items-center justify-center text-[10px] text-white font-bold"
                                            style={{ width: `${shortPct}%` }}
                                        >
                                            {exposure.short > 0.1 && `Short ${exposure.short.toFixed(1)}`}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Concentration Risk & Risk Metrics Grid */}
                <div className="grid grid-cols-2 gap-6">
                    {/* Concentration Risk */}
                    <div>
                        <h3 className="text-sm font-semibold text-zinc-400 mb-3">Concentration Risk</h3>
                        <div className="bg-zinc-900 rounded p-4">
                            {hasSingleConcentrationWarning && (
                                <div className="flex items-center gap-2 mb-3 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded">
                                    <Icon name="alert-triangle" size="sm" className="w-4 h-4 text-yellow-400" />
                                    <span className="text-xs text-yellow-400">High concentration detected (&gt;25% in single symbol)</span>
                                </div>
                            )}
                            <div className="space-y-1">
                                {concentration.slice(0, 5).map((c, i) => (
                                    <div key={c.symbol} className="flex items-center gap-2">
                                        <div className="w-20 text-xs font-mono text-zinc-400">{c.symbol}</div>
                                        <div className="flex-1 bg-zinc-800 rounded-full h-4 overflow-hidden">
                                            <div
                                                className={`h-full ${c.percent > 25 ? 'bg-yellow-500' : 'bg-zinc-600'}`}
                                                style={{ width: `${c.percent}%` }}
                                            />
                                        </div>
                                        <div className="w-12 text-xs font-mono text-right text-zinc-300">{c.percent.toFixed(1)}%</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Risk Metrics */}
                    <div>
                        <h3 className="text-sm font-semibold text-zinc-400 mb-3">Risk Metrics</h3>
                        <div className="bg-zinc-900 rounded p-4 space-y-3">
                            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                                <span className="text-xs text-zinc-500">Margin Level</span>
                                <span className={`text-sm font-bold ${riskMetrics.marginLevel > 200 ? 'text-green-400' : riskMetrics.marginLevel > 100 ? 'text-yellow-400' : 'text-red-400'}`}>
                                    {riskMetrics.marginLevel.toFixed(2)}%
                                </span>
                            </div>
                            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                                <span className="text-xs text-zinc-500">Free Margin</span>
                                <span className="text-sm font-mono text-zinc-100">${formatMoney(riskMetrics.freeMargin)}</span>
                            </div>
                            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                                <span className="text-xs text-zinc-500">Value at Risk (95%)</span>
                                <span className="text-sm font-mono text-red-400">${formatMoney(riskMetrics.var95)}</span>
                            </div>
                            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                                <span className="text-xs text-zinc-500">Max Drawdown Potential</span>
                                <span className="text-sm font-mono text-red-400">${formatMoney(riskMetrics.maxDrawdown)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-zinc-500">Diversification Score</span>
                                <div className="flex items-center gap-2">
                                    <div className="flex gap-0.5">
                                        {[...Array(10)].map((_, i) => (
                                            <div
                                                key={i}
                                                className={`w-2 h-4 rounded-sm ${i < riskMetrics.diversificationScore ? 'bg-zinc-600' : 'bg-zinc-700'}`}
                                            />
                                        ))}
                                    </div>
                                    <span className="text-sm font-bold text-zinc-100">{riskMetrics.diversificationScore}/10</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
