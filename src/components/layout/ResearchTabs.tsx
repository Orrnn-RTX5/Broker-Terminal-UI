import { Icon } from '../ui/Icon';
import React, { useState, useMemo, useEffect } from 'react';
// --- TYPES ---

interface CodeBaseItem {
    id: string;
    name: string;
    category: string;
    date: string;
    author: string;
    description: string;
}

interface ArticleItem {
    id: string;
    name: string;
    description: string;
    rating: number; // 1-5
    date: string;
    author: string;
}

interface ExpertItem {
    id: string;
    name: string;
    description: string;
    type: 'Advisor' | 'Indicator' | 'Script' | 'Service';
    rating: number;
    date: string;
    price: string;
}

// --- MOCK DATA ---

const CODE_BASE_DATA: CodeBaseItem[] = [
    { id: '1', name: 'RTX5 Trend Master', category: 'Trend Indicators', date: '2025.12.10', author: 'RTX Systems', description: 'Advanced trend following indicator for major pairs.' },
    { id: '2', name: 'Institutional Volume', category: 'Oscillators', date: '2025.11.28', author: 'PropDev', description: 'Volume analysis tool for detecting institutional flow.' },
    { id: '3', name: 'Grid Manager Pro', category: 'Expert Advisors', date: '2025.11.15', author: 'AlgoTrader', description: 'Robust grid management system with risk controls.' },
    { id: '4', name: 'News Filter API', category: 'Libraries', date: '2025.10.30', author: 'RTX Core', description: 'Integration library for economic calendar events.' },
    { id: '5', name: 'Fibonacci Auto-Plot', category: 'Scripts', date: '2025.10.12', author: 'ChartWizard', description: 'Automatically plots fib levels on current timeframe.' },
];

const ARTICLES_DATA: ArticleItem[] = [
    { id: '1', name: 'Strategies for XAUUSD Scalping', description: 'Deep dive into 1-minute timeframe scalping using RTX5 tools.', rating: 5, date: '2026.01.18 14:30', author: 'GoldMike' },
    { id: '2', name: 'Understanding Order Flow', description: 'How to read the tape and DOM for better entry precision.', rating: 4, date: '2026.01.15 09:15', author: 'QuantDesk' },
    { id: '3', name: 'Risk Management 101 for Prop Firms', description: 'Essential guide to passing evaluations and keeping funded accounts.', rating: 5, date: '2026.01.10 11:00', author: 'RiskManager' },
    { id: '4', name: 'Automating your Strategy with RTX Scripts', description: 'Introduction to the RTX5 scripting language basics.', rating: 3, date: '2025.12.28 16:45', author: 'DevTeam' },
];

const EXPERTS_DATA: ExpertItem[] = [
    { id: '1', name: 'RTX Scalper Pro', description: 'High frequency scalping EA for EURUSD.', type: 'Advisor', rating: 4, date: '2026.01.05', price: '$199' },
    { id: '2', name: 'Golden Zone Indicator', description: 'Highlights premium and discount zones automatically.', type: 'Indicator', rating: 5, date: '2026.01.12', price: 'Free' },
    { id: '3', name: 'Trade Copier Local', description: 'Fast trade copying between RTX5 instances.', type: 'Service', rating: 5, date: '2025.12.20', price: '$49/mo' },
    { id: '4', name: 'Close All Orders', description: 'Utility script to close all open positions instantly.', type: 'Script', rating: 3, date: '2025.11.10', price: 'Free' },
    { id: '5', name: 'Breakout Hunter', description: 'Detects and trades London session breakouts.', type: 'Advisor', rating: 4, date: '2026.01.02', price: '$99' },
];

// --- COMPONENTS ---

export function CodeBaseTab() {
    return (
        <div className="h-full flex flex-col bg-[#131316] text-[12px]">
            <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700">
                <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-[#191a1e] text-zinc-400 z-10 font-bold text-[10px] uppercase tracking-wider border-b border-zinc-600">
                        <tr>
                            <th className="p-1 pl-3 border-r border-zinc-700 w-1/3">Name</th>
                            <th className="p-1 border-r border-zinc-700 w-1/3">Category</th>
                            <th className="p-1 border-r border-zinc-700 w-24">Date</th>
                            <th className="p-1 w-1/4">Author</th>
                        </tr>
                    </thead>
                    <tbody className="text-zinc-300">
                        {CODE_BASE_DATA.map((item, i) => (
                            <tr key={item.id} className={`${i % 2 === 0 ? 'bg-[#131316]' : 'bg-[#0f0f12]'} hover:bg-[#191a1e] transition-colors group cursor-default`}>
                                <td className="p-1 pl-3 border-r border-zinc-800/50 flex items-center gap-2">
                                    <Icon name="code" size="xs" className="text-blue-400 opacity-70" />
                                    <span className="font-medium text-zinc-200">{item.name}</span>
                                </td>
                                <td className="p-1 border-r border-zinc-800/50 text-zinc-500 italic">{item.category}</td>
                                <td className="p-1 border-r border-zinc-800/50 text-zinc-500 font-mono text-[11px]">{item.date}</td>
                                <td className="p-1 text-zinc-400">{item.author}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export function ArticlesTab() {
    return (
        <div className="h-full flex flex-col bg-[#131316] text-[12px]">
            <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700">
                <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-[#191a1e] text-zinc-400 z-10 font-bold text-[10px] uppercase tracking-wider border-b border-zinc-600">
                        <tr>
                            <th className="p-1 pl-3 border-r border-zinc-700 w-1/4">Name</th>
                            <th className="p-1 border-r border-zinc-700 w-2/4">Description</th>
                            <th className="p-1 border-r border-zinc-700 w-24 text-center">Rating</th>
                            <th className="p-1 w-32 text-right pr-3">Date</th>
                        </tr>
                    </thead>
                    <tbody className="text-zinc-300">
                        {ARTICLES_DATA.map((item, i) => (
                            <tr key={item.id} className={`${i % 2 === 0 ? 'bg-[#131316]' : 'bg-[#0f0f12]'} hover:bg-[#191a1e] transition-colors group cursor-default`}>
                                <td className="p-1 pl-3 border-r border-zinc-800/50 font-medium text-blue-400/90">{item.name}</td>
                                <td className="p-1 border-r border-zinc-800/50 text-zinc-400 truncate max-w-xs">{item.description}</td>
                                <td className="p-1 border-r border-zinc-800/50 text-center">
                                    <div className="flex items-center justify-center gap-0.5">
                                        {[1, 2, 3, 4, 5].map((star) => (
                                            <Icon name="check-circle" size="sm"
                                                key={star}
                                                
                                                className={star <= item.rating ? "fill-amber-500 text-amber-500" : "text-zinc-600"}
                                            />
                                        ))}
                                    </div>
                                </td>
                                <td className="p-1 pr-3 text-right text-zinc-500 font-mono text-[11px]">{item.date}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export function ExpertsTab() {
    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'Advisor': return <Icon name="cpu" size="xs" className="text-blue-400" />;
            case 'Indicator': return <Icon name="sort" size="xs" className="text-emerald-400" />;
            case 'Script': return <Icon name="code" size="xs" className="text-amber-400" />;
            case 'Service': return <Icon name="cpu" size="xs" className="text-purple-400" />;
            default: return <Icon name="cpu" size="xs" className="text-zinc-400" />;
        }
    };

    return (
        <div className="h-full flex flex-col bg-[#131316] text-[12px]">
            <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-zinc-700">
                <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-[#191a1e] text-zinc-400 z-10 font-bold text-[10px] uppercase tracking-wider border-b border-zinc-600">
                        <tr>
                            <th className="p-1 pl-3 border-r border-zinc-700 w-1/4">Name</th>
                            <th className="p-1 border-r border-zinc-700 w-1/2">Description</th>
                            <th className="p-1 border-r border-zinc-700 w-24 text-center">Rating</th>
                            <th className="p-1 border-r border-zinc-700 w-24 text-right">Date</th>
                            <th className="p-1 w-20 text-right pr-3">Price</th>
                        </tr>
                    </thead>
                    <tbody className="text-zinc-300">
                        {EXPERTS_DATA.map((item, i) => (
                            <tr key={item.id} className={`${i % 2 === 0 ? 'bg-[#131316]' : 'bg-[#0f0f12]'} hover:bg-[#191a1e] transition-colors group cursor-default`}>
                                <td className="p-1 pl-3 border-r border-zinc-800/50 flex items-center gap-2">
                                    {getTypeIcon(item.type)}
                                    <span className="font-medium text-zinc-200">{item.name}</span>
                                </td>
                                <td className="p-1 border-r border-zinc-800/50 text-zinc-400 truncate max-w-xs">{item.description}</td>
                                <td className="p-1 border-r border-zinc-800/50 text-center">
                                    <div className="flex items-center justify-center gap-0.5">
                                        {[1, 2, 3, 4, 5].map((star) => (
                                            <Icon name="check-circle" size="sm"
                                                key={star}
                                                
                                                className={star <= item.rating ? "fill-amber-500 text-amber-500" : "text-zinc-600"}
                                            />
                                        ))}
                                    </div>
                                </td>
                                <td className="p-1 border-r border-zinc-800/50 text-right text-zinc-500 font-mono text-[11px]">{item.date}</td>
                                <td className="p-1 pr-3 text-right font-bold text-emerald-400">{item.price}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
