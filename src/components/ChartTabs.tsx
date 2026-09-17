import { Icon } from './ui/Icon';
import { X } from 'lucide-react';
import React from 'react';
import { type Timeframe } from './TradingChart';

export interface ChartTab {
    id: string;
    symbol: string;
    timeframe: Timeframe;
}

interface ChartTabsProps {
    tabs: ChartTab[];
    activeTabId: string;
    onTabClick: (id: string) => void;
    onTabClose: (id: string) => void;
}

export const ChartTabs: React.FC<ChartTabsProps> = ({ tabs, activeTabId, onTabClick, onTabClose }) => {
    return (
        <div className="h-7 flex items-center border-b px-1 select-none overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-700"
            style={{ background: '#191a1e', borderColor: '#28282e' }}>
            {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                return (
                    <div
                        key={tab.id}
                        onClick={() => onTabClick(tab.id)}
                        className={`
                            group flex items-center min-w-[120px] max-w-[160px] h-[24px] px-2 mr-1 cursor-pointer text-[14px] font-normal rounded-sm
                            border transition-all
                            ${isActive
                                ? 'border-[#5a5a65] bg-[#0e0e12] text-[#e2e2e8] shadow-[inset_0_-2px_0_0_#5a5a65]'
                                : 'border-transparent bg-transparent text-[#808088] hover:bg-[#222226] hover:text-[#c8c8d0]'}
                        `}
                    >
                        <span className="flex-1 truncate">
                            {tab.symbol}, {tab.timeframe}
                        </span>

                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onTabClose(tab.id);
                            }}
                            className="p-0.5 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 hover:bg-red-500/80 hover:text-white"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                );
            })}
        </div>
    );
};
