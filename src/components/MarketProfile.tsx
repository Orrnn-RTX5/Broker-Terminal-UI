/**
 * Market Profile / Volume Profile Panel
 * TPO Chart, Volume Profile, POC, Value Area, Initial Balance
 */

import { Icon } from './ui/Icon';
import { useMemo } from 'react';
import { formatPrice as formatPriceUtil } from '../utils/symbolUtils';
import { useMarketProfileStore } from '../store/useMarketProfileStore';

interface PriceLevel {
    price: number;
    volume: number;
    tpoLetters: string[];
    isPOC: boolean;
    isInValueArea: boolean;
}

interface ProfileData {
    levels: PriceLevel[];
    poc: number;
    valueAreaHigh: number;
    valueAreaLow: number;
    initialBalanceHigh: number;
    initialBalanceLow: number;
}

export function MarketProfile() {
    const {
        selectedSymbol,
        profileType,
        session,
        profileMode,
        showPOC,
        showValueArea,
        showInitialBalance,
        showTPOLetters,
        priceLevels,
        setSelectedSymbol,
        setProfileType,
        setSession,
        setProfileMode,
        togglePOC,
        toggleValueArea,
        toggleInitialBalance,
        toggleTPOLetters,
        setPriceLevels
    } = useMarketProfileStore();

    // Generate realistic mock profile data
    const profileData: ProfileData = useMemo(() => {
        const basePrice = selectedSymbol.includes('JPY') ? 150.000 : 1.10000;
        const tickSize = selectedSymbol.includes('JPY') ? 0.010 : 0.00010;

        // Generate price levels
        const levels: PriceLevel[] = [];
        const totalPeriods = session === 'asian' ? 16 : session === 'london' ? 18 : session === 'newyork' ? 20 : 48; // 30-min periods
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

        // Bell curve distribution for volume
        const centerIndex = Math.floor(priceLevels / 2);
        let totalVolume = 0;

        for (let i = 0; i < priceLevels; i++) {
            const price = basePrice + (i - centerIndex) * tickSize * 10;

            // Bell curve: more volume near center
            const distanceFromCenter = Math.abs(i - centerIndex);
            const volumeMultiplier = Math.exp(-Math.pow(distanceFromCenter / (priceLevels / 4), 2));
            const baseVolume = 50000 + Math.random() * 100000;
            const volume = baseVolume * volumeMultiplier;

            totalVolume += volume;

            // Generate TPO letters based on time spent at this price
            const tpoCount = Math.floor(volumeMultiplier * totalPeriods * 0.8) + Math.floor(Math.random() * 4);
            const tpoLetters: string[] = [];
            for (let j = 0; j < tpoCount && j < letters.length; j++) {
                tpoLetters.push(letters[j]);
            }

            levels.push({
                price,
                volume,
                tpoLetters,
                isPOC: false,
                isInValueArea: false
            });
        }

        // Find POC (Point of Control) - highest volume
        const pocIndex = levels.reduce((maxIdx, level, idx, arr) =>
            level.volume > arr[maxIdx].volume ? idx : maxIdx, 0
        );
        levels[pocIndex].isPOC = true;
        const poc = levels[pocIndex].price;

        // Calculate Value Area (70% of volume)
        const targetVolume = totalVolume * 0.70;
        let accumulatedVolume = levels[pocIndex].volume;
        let upperIdx = pocIndex;
        let lowerIdx = pocIndex;

        levels[pocIndex].isInValueArea = true;

        while (accumulatedVolume < targetVolume && (upperIdx < levels.length - 1 || lowerIdx > 0)) {
            const upperVolume = upperIdx < levels.length - 1 ? levels[upperIdx + 1].volume : 0;
            const lowerVolume = lowerIdx > 0 ? levels[lowerIdx - 1].volume : 0;

            if (upperVolume > lowerVolume && upperIdx < levels.length - 1) {
                upperIdx++;
                levels[upperIdx].isInValueArea = true;
                accumulatedVolume += levels[upperIdx].volume;
            } else if (lowerIdx > 0) {
                lowerIdx--;
                levels[lowerIdx].isInValueArea = true;
                accumulatedVolume += levels[lowerIdx].volume;
            } else {
                break;
            }
        }

        const valueAreaHigh = levels[upperIdx].price;
        const valueAreaLow = levels[lowerIdx].price;

        // Initial Balance (first hour = first 2 periods)
        const ibLevels = levels.filter(l => l.tpoLetters.includes('A') || l.tpoLetters.includes('B'));
        const initialBalanceHigh = Math.max(...ibLevels.map(l => l.price));
        const initialBalanceLow = Math.min(...ibLevels.map(l => l.price));

        return {
            levels,
            poc,
            valueAreaHigh,
            valueAreaLow,
            initialBalanceHigh,
            initialBalanceLow
        };
    }, [selectedSymbol, session, priceLevels]);

    const maxVolume = Math.max(...profileData.levels.map(l => l.volume));
    const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCHF', 'NZDUSD', 'USDCAD'];

    const formatPrice = (price: number) => formatPriceUtil(price, selectedSymbol);

    return (
        <div className="h-full flex flex-col bg-[#131316] text-zinc-300 font-sans select-none">
            {/* Header Controls */}
            <div className="flex-shrink-0 bg-[#191a1e] border-b border-zinc-700 p-2 flex items-center gap-3 flex-wrap">
                {/* Symbol Selector */}
                <div className="flex items-center gap-2">
                    <Icon name="activity" size="sm" className="text-emerald-500" />
                    <select
                        value={selectedSymbol}
                        onChange={(e) => setSelectedSymbol(e.target.value)}
                        className="bg-[#131316] border border-zinc-700 rounded px-2 py-1 text-[11px] font-medium text-zinc-200 focus:outline-none focus:border-emerald-500"
                    >
                        {symbols.map(sym => (
                            <option key={sym} value={sym}>{sym}</option>
                        ))}
                    </select>
                </div>

                {/* Profile Type Tabs */}
                <div className="flex items-center border border-zinc-700 rounded overflow-hidden">
                    {(['volume', 'tpo', 'market'] as const).map((type) => (
                        <button
                            key={type}
                            onClick={() => setProfileType(type)}
                            className={`px-3 py-1 text-[10px] font-medium uppercase transition-colors border-r border-zinc-700 last:border-r-0 ${
                                profileType === type
                                    ? 'bg-emerald-500 text-white'
                                    : 'bg-[#131316] text-zinc-500 hover:text-zinc-300 hover:bg-[#191a1e]'
                            }`}
                        >
                            {type}
                        </button>
                    ))}
                </div>

                {/* Session Selector */}
                <div className="flex items-center gap-2">
                    <Icon name="clock" size="sm" className="text-blue-400" />
                    <select
                        value={session}
                        onChange={(e) => setSession(e.target.value as any)}
                        className="bg-[#131316] border border-zinc-700 rounded px-2 py-1 text-[11px] font-medium text-zinc-200 focus:outline-none focus:border-zinc-600"
                    >
                        <option value="asian">Asian Session</option>
                        <option value="london">London Session</option>
                        <option value="newyork">New York Session</option>
                        <option value="fullday">Full Day</option>
                    </select>
                </div>

                {/* Profile Mode Toggle */}
                <div className="flex items-center border border-zinc-700 rounded overflow-hidden">
                    {(['developing', 'settled'] as const).map((mode) => (
                        <button
                            key={mode}
                            onClick={() => setProfileMode(mode)}
                            className={`px-3 py-1 text-[10px] font-medium capitalize transition-colors border-r border-zinc-700 last:border-r-0 ${
                                profileMode === mode
                                    ? 'bg-zinc-8000 text-white'
                                    : 'bg-[#131316] text-zinc-500 hover:text-zinc-300 hover:bg-[#191a1e]'
                            }`}
                        >
                            {mode}
                        </button>
                    ))}
                </div>

                <div className="flex-1"></div>

                {/* Display Toggles */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={togglePOC}
                        className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                            showPOC
                                ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/50'
                                : 'bg-[#131316] text-zinc-500 border border-zinc-700 hover:text-zinc-300'
                        }`}
                    >
                        POC
                    </button>
                    <button
                        onClick={toggleValueArea}
                        className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                            showValueArea
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                                : 'bg-[#131316] text-zinc-500 border border-zinc-700 hover:text-zinc-300'
                        }`}
                    >
                        Value Area
                    </button>
                    <button
                        onClick={toggleInitialBalance}
                        className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                            showInitialBalance
                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/50'
                                : 'bg-[#131316] text-zinc-500 border border-zinc-700 hover:text-zinc-300'
                        }`}
                    >
                        IB
                    </button>
                    {profileType === 'tpo' && (
                        <button
                            onClick={toggleTPOLetters}
                            className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                                showTPOLetters
                                    ? 'bg-zinc-700/30 text-zinc-300 border border-zinc-600/50'
                                    : 'bg-[#131316] text-zinc-500 border border-zinc-700 hover:text-zinc-300'
                            }`}
                        >
                            TPO Letters
                        </button>
                    )}
                </div>
            </div>

            {/* Profile Chart Area */}
            <div className="flex-1 flex overflow-hidden">
                {/* Price Scale (Left) */}
                <div className="flex-shrink-0 w-20 bg-[#191a1e] border-r border-zinc-700 flex flex-col justify-between py-2">
                    {[...profileData.levels].reverse().map((level, idx) => {
                        if (idx % 3 !== 0 && !level.isPOC) return null;
                        return (
                            <div
                                key={level.price}
                                className={`text-right pr-2 text-[10px] font-mono ${
                                    level.isPOC
                                        ? 'text-yellow-300 font-bold'
                                        : level.isInValueArea
                                        ? 'text-emerald-300'
                                        : 'text-zinc-500'
                                }`}
                            >
                                {formatPrice(level.price)}
                            </div>
                        );
                    })}
                </div>

                {/* Profile Visualization */}
                <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700 p-4">
                    <div className="space-y-0.5">
                        {[...profileData.levels].reverse().map((level) => {
                            const volumePercent = (level.volume / maxVolume) * 100;
                            const isIBHigh = showInitialBalance && Math.abs(level.price - profileData.initialBalanceHigh) < 0.00001;
                            const isIBLow = showInitialBalance && Math.abs(level.price - profileData.initialBalanceLow) < 0.00001;
                            const isVAH = showValueArea && Math.abs(level.price - profileData.valueAreaHigh) < 0.00001;
                            const isVAL = showValueArea && Math.abs(level.price - profileData.valueAreaLow) < 0.00001;

                            return (
                                <div
                                    key={level.price}
                                    className="flex items-center gap-2 group hover:bg-zinc-800/30 transition-colors relative"
                                >
                                    {/* Price Level Indicator */}
                                    <div className="w-16 text-[9px] font-mono text-zinc-600">
                                        {formatPrice(level.price)}
                                    </div>

                                    {/* Volume Bar or TPO Letters */}
                                    <div className="flex-1 relative h-5 flex items-center">
                                        {profileType === 'volume' || profileType === 'market' ? (
                                            <div
                                                className={`h-full rounded-r transition-all ${
                                                    level.isPOC && showPOC
                                                        ? 'bg-yellow-500/60'
                                                        : level.isInValueArea && showValueArea
                                                        ? 'bg-emerald-500/40'
                                                        : 'bg-zinc-700/40'
                                                }`}
                                                style={{ width: `${volumePercent}%` }}
                                            />
                                        ) : (
                                            <div className="flex items-center gap-0.5 font-mono text-[9px]">
                                                {showTPOLetters ? (
                                                    level.tpoLetters.map((letter, idx) => (
                                                        <span
                                                            key={idx}
                                                            className={`${
                                                                level.isPOC && showPOC
                                                                    ? 'text-yellow-300 font-bold'
                                                                    : level.isInValueArea && showValueArea
                                                                    ? 'text-emerald-300'
                                                                    : 'text-zinc-300'
                                                            }`}
                                                        >
                                                            {letter}
                                                        </span>
                                                    ))
                                                ) : (
                                                    <div
                                                        className={`h-4 rounded ${
                                                            level.isPOC && showPOC
                                                                ? 'bg-yellow-500/60'
                                                                : level.isInValueArea && showValueArea
                                                                ? 'bg-emerald-500/40'
                                                                : 'bg-zinc-700/40'
                                                        }`}
                                                        style={{ width: `${level.tpoLetters.length * 8}px` }}
                                                    />
                                                )}
                                            </div>
                                        )}

                                        {/* Volume Label */}
                                        <div className="absolute right-2 text-[9px] font-mono text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {(level.volume / 1000).toFixed(0)}K
                                        </div>
                                    </div>

                                    {/* Level Annotations */}
                                    <div className="w-16 text-[9px] font-bold">
                                        {level.isPOC && showPOC && (
                                            <span className="text-yellow-300">POC</span>
                                        )}
                                        {isVAH && (
                                            <span className="text-emerald-300">VAH</span>
                                        )}
                                        {isVAL && (
                                            <span className="text-emerald-300">VAL</span>
                                        )}
                                        {isIBHigh && (
                                            <span className="text-purple-300">IB↑</span>
                                        )}
                                        {isIBLow && (
                                            <span className="text-purple-300">IB↓</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Key Levels Panel (Right) */}
                <div className="flex-shrink-0 w-48 bg-[#191a1e] border-l border-zinc-700 p-3 space-y-3 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-zinc-400 text-[10px] font-bold uppercase">
                            <Icon name="crosshair" size="xs" />
                            <span>Key Levels</span>
                        </div>

                        {showPOC && (
                            <div className="bg-[#131316] rounded p-2 space-y-1">
                                <div className="text-[9px] text-zinc-500 uppercase">Point of Control</div>
                                <div className="text-[13px] font-mono font-bold text-yellow-300">
                                    {formatPrice(profileData.poc)}
                                </div>
                            </div>
                        )}

                        {showValueArea && (
                            <>
                                <div className="bg-[#131316] rounded p-2 space-y-1">
                                    <div className="text-[9px] text-zinc-500 uppercase">Value Area High</div>
                                    <div className="text-[13px] font-mono font-bold text-emerald-300">
                                        {formatPrice(profileData.valueAreaHigh)}
                                    </div>
                                </div>
                                <div className="bg-[#131316] rounded p-2 space-y-1">
                                    <div className="text-[9px] text-zinc-500 uppercase">Value Area Low</div>
                                    <div className="text-[13px] font-mono font-bold text-emerald-300">
                                        {formatPrice(profileData.valueAreaLow)}
                                    </div>
                                </div>
                            </>
                        )}

                        {showInitialBalance && (
                            <>
                                <div className="bg-[#131316] rounded p-2 space-y-1">
                                    <div className="text-[9px] text-zinc-500 uppercase">Initial Balance High</div>
                                    <div className="text-[13px] font-mono font-bold text-purple-300">
                                        {formatPrice(profileData.initialBalanceHigh)}
                                    </div>
                                </div>
                                <div className="bg-[#131316] rounded p-2 space-y-1">
                                    <div className="text-[9px] text-zinc-500 uppercase">Initial Balance Low</div>
                                    <div className="text-[13px] font-mono font-bold text-purple-300">
                                        {formatPrice(profileData.initialBalanceLow)}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="space-y-2 pt-3 border-t border-zinc-700">
                        <div className="flex items-center gap-2 text-zinc-400 text-[10px] font-bold uppercase">
                            <Icon name="bar-chart-3" size="xs" />
                            <span>Statistics</span>
                        </div>

                        <div className="bg-[#131316] rounded p-2 space-y-1.5 text-[10px]">
                            <div className="flex justify-between">
                                <span className="text-zinc-500">Profile Type:</span>
                                <span className="text-zinc-300 font-medium capitalize">{profileType}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-zinc-500">Session:</span>
                                <span className="text-zinc-300 font-medium capitalize">{session}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-zinc-500">Mode:</span>
                                <span className="text-zinc-300 font-medium capitalize">{profileMode}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-zinc-500">Price Levels:</span>
                                <span className="text-zinc-300 font-medium">{priceLevels}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-zinc-500">VA Range:</span>
                                <span className="text-emerald-300 font-mono">
                                    {(Math.abs(profileData.valueAreaHigh - profileData.valueAreaLow) * 10000).toFixed(0)} pips
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-zinc-500">IB Range:</span>
                                <span className="text-purple-300 font-mono">
                                    {(Math.abs(profileData.initialBalanceHigh - profileData.initialBalanceLow) * 10000).toFixed(0)} pips
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
