import { useUiTranslation } from '../../hooks/useUiTranslation';
import React, { useState } from 'react';
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

function ResearchRating({ value }: { value: number }) {
    const tr = useUiTranslation();
    return (
        <span className="rtx-research-rating rtx-articles-rating" data-rating={value} aria-label={tr("{{value0}} of 5", { value0: value })}>
            {[1, 2, 3, 4, 5].map((star) => (
                <span key={star} data-on={star <= value || undefined} />
            ))}
        </span>
    );
}

export function CodeBaseTab() {
    const tr = useUiTranslation();
    const [selectedId, setSelectedId] = useState<string | null>(null);

    return (
        <div className="rtx-research-tab rtx-codebase-tab h-full flex flex-col font-sans text-[14px] font-normal">
            <div className="rtx-codebase-tab__scroll">
                <table className="rtx-codebase-tab__table">
                    <thead className="rtx-codebase-tab__head font-normal text-[12px] leading-[18px]">
                        <tr>
                            <th className="rtx-codebase-tab__col--name">{tr("Name")}</th>
                            <th className="rtx-codebase-tab__col--description">{tr("Description")}</th>
                            <th className="rtx-codebase-tab__col--category">{tr("Category")}</th>
                            <th className="rtx-codebase-tab__col--author">{tr("Author")}</th>
                            <th className="rtx-codebase-tab__col--date">{tr("Date")}</th>
                        </tr>
                    </thead>
                    <tbody className="rtx-codebase-tab__body text-[13px] font-normal leading-[19.5px]">
                        {CODE_BASE_DATA.map((item) => (
                            <tr
                                key={item.id}
                                className="rtx-codebase-row"
                                data-selected={selectedId === item.id || undefined}
                                onClick={() => setSelectedId(item.id)}
                            >
                                <td className="rtx-codebase-tab__col--name">{tr(item.name)}</td>
                                <td className="rtx-codebase-tab__col--description">{tr(item.description)}</td>
                                <td className="rtx-codebase-tab__col--category">{tr(item.category)}</td>
                                <td className="rtx-codebase-tab__col--author">{item.author}</td>
                                <td className="rtx-codebase-tab__col--date">{item.date}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export function ArticlesTab() {
    const tr = useUiTranslation();
    const [selectedId, setSelectedId] = useState<string | null>(null);

    return (
        <div className="rtx-research-tab rtx-articles-tab h-full flex flex-col font-sans text-[14px] font-normal">
            <div className="rtx-articles-tab__scroll">
                <table className="rtx-articles-tab__table">
                    <thead className="rtx-articles-tab__head font-normal text-[12px] leading-[18px]">
                        <tr>
                            <th className="rtx-articles-tab__col--name">{tr("Name")}</th>
                            <th className="rtx-articles-tab__col--description">{tr("Description")}</th>
                            <th className="rtx-articles-tab__col--author">{tr("Author")}</th>
                            <th className="rtx-articles-tab__col--rating">{tr("Rating")}</th>
                            <th className="rtx-articles-tab__col--date">{tr("Date")}</th>
                        </tr>
                    </thead>
                    <tbody className="rtx-articles-tab__body text-[13px] font-normal leading-[19.5px]">
                        {ARTICLES_DATA.map((item) => (
                            <tr
                                key={item.id}
                                className="rtx-articles-row"
                                data-selected={selectedId === item.id || undefined}
                                onClick={() => setSelectedId(item.id)}
                            >
                                <td className="rtx-articles-tab__col--name">{tr(item.name)}</td>
                                <td className="rtx-articles-tab__col--description">{tr(item.description)}</td>
                                <td className="rtx-articles-tab__col--author">{item.author}</td>
                                <td className="rtx-articles-tab__col--rating">
                                    <ResearchRating value={item.rating} />
                                </td>
                                <td className="rtx-articles-tab__col--date">{item.date}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export function ExpertsTab() {
    const tr = useUiTranslation();
    const [selectedId, setSelectedId] = useState<string | null>(null);

    return (
        <div className="rtx-research-tab rtx-experts-tab h-full flex flex-col font-sans text-[14px] font-normal">
            <div className="rtx-experts-tab__scroll">
                <table className="rtx-experts-tab__table">
                    <thead className="rtx-experts-tab__head font-normal text-[12px] leading-[18px]">
                        <tr>
                            <th className="rtx-experts-tab__col--name">{tr("Name")}</th>
                            <th className="rtx-experts-tab__col--description">{tr("Description")}</th>
                            <th className="rtx-experts-tab__col--type">{tr("Type")}</th>
                            <th className="rtx-experts-tab__col--rating">{tr("Rating")}</th>
                            <th className="rtx-experts-tab__col--date">{tr("Date")}</th>
                            <th className="rtx-experts-tab__col--price">{tr("Price")}</th>
                        </tr>
                    </thead>
                    <tbody className="rtx-experts-tab__body text-[13px] font-normal leading-[19.5px]">
                        {EXPERTS_DATA.map((item) => (
                            <tr
                                key={item.id}
                                className="rtx-experts-row"
                                data-selected={selectedId === item.id || undefined}
                                onClick={() => setSelectedId(item.id)}
                            >
                                <td className="rtx-experts-tab__col--name">{tr(item.name)}</td>
                                <td className="rtx-experts-tab__col--description">{tr(item.description)}</td>
                                <td className="rtx-experts-tab__col--type">{tr(item.type)}</td>
                                <td className="rtx-experts-tab__col--rating">
                                    <ResearchRating value={item.rating} />
                                </td>
                                <td className="rtx-experts-tab__col--date">{item.date}</td>
                                <td className={`rtx-experts-tab__col--price ${item.price === 'Free' ? 'rtx-experts-price--free' : 'rtx-experts-price--paid'}`}>
                                    {item.price === 'Free' ? tr('Free') : item.price}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
