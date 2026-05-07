import { useState, useEffect, useRef } from 'react';
import { API_ENDPOINTS } from '../config/api';

interface AccountInfo {
    accountId: number;
    accountNumber: string;
    currency: string;
    balance: number;
    equity: number;
    margin: number;
    freeMargin: number;
    marginLevel: number;
    unrealizedPnL: number;
    openPositions: number;
    leverage: number;
    marginMode: string;
}

interface FloatingAccountPanelProps {
    initialPosition?: { x: number; y: number };
}

export function FloatingAccountPanel({ initialPosition = { x: 20, y: 100 } }: FloatingAccountPanelProps) {
    const [account, setAccount] = useState<AccountInfo | null>(null);
    const [position, setPosition] = useState(initialPosition);
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [isCollapsed, setIsCollapsed] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    // Fetch account info every second
    useEffect(() => {
        const fetchAccount = async () => {
            try {
                // Use RTX B-Book API for internal balance (NOT OANDA)
                const res = await fetch(`${API_ENDPOINTS.account}/summary?accountId=1`);
                if (res.ok) {
                    const data = await res.json();
                    setAccount(data);
                }
            } catch (err) {
                console.error('Failed to fetch account info:', err);
            }
        };

        fetchAccount();
        const interval = setInterval(fetchAccount, 1000);
        return () => clearInterval(interval);
    }, []);

    // Handle drag start
    const handleMouseDown = (e: React.MouseEvent) => {
        if (panelRef.current) {
            const rect = panelRef.current.getBoundingClientRect();
            setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            setIsDragging(true);
        }
    };

    // Handle drag move
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                setPosition({
                    x: e.clientX - dragOffset.x,
                    y: e.clientY - dragOffset.y,
                });
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, dragOffset]);

    if (!account) return null;

    const plColor = account.unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400';
    const marginLevelColor = account.marginLevel > 200 ? 'text-emerald-400' :
        account.marginLevel > 100 ? 'text-yellow-400' : 'text-red-400';

    return (
        <div
            ref={panelRef}
            className="fixed z-50 bg-zinc-900/95 backdrop-blur-sm border border-zinc-700 rounded-lg shadow-xl"
            style={{ left: position.x, top: position.y }}
        >
            {/* Header - Draggable */}
            <div
                className="flex items-center justify-between px-3 py-2 bg-zinc-800/50 rounded-t-lg cursor-move select-none"
                onMouseDown={handleMouseDown}
            >
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-xs font-semibold text-zinc-300">
                        {account.accountNumber || `RTX-${account.accountId}`}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${account.marginMode === 'HEDGING'
                        ? 'bg-zinc-700/20 text-zinc-300'
                        : 'bg-purple-500/20 text-purple-400'
                        }`}>
                        {account.marginMode}
                    </span>
                </div>
                <button
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className="text-zinc-500 hover:text-zinc-300"
                >
                    {isCollapsed ? '▼' : '▲'}
                </button>
            </div>

            {/* Content */}
            {!isCollapsed && (
                <div className="p-3 min-w-[200px]">
                    {/* Balance & Equity Row */}
                    <div className="grid grid-cols-2 gap-4 mb-3">
                        <div>
                            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Balance</div>
                            <div className="text-sm font-semibold text-zinc-200">
                                {account.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                        </div>
                        <div>
                            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Equity</div>
                            <div className="text-sm font-semibold text-zinc-200">
                                {account.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                        </div>
                    </div>

                    {/* Margin Row */}
                    <div className="grid grid-cols-2 gap-4 mb-3">
                        <div>
                            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Margin</div>
                            <div className="text-sm text-zinc-300">
                                {account.margin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                        </div>
                        <div>
                            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Free Margin</div>
                            <div className="text-sm text-zinc-300">
                                {account.freeMargin.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                        </div>
                    </div>

                    {/* Margin Level Bar */}
                    <div className="mb-3">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Margin Level</span>
                            <span className={`text-xs font-semibold ${marginLevelColor}`}>
                                {account.marginLevel > 0 ? `${account.marginLevel.toFixed(0)}%` : '∞'}
                            </span>
                        </div>
                        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                                className={`h-full transition-all duration-300 ${account.marginLevel > 200 ? 'bg-emerald-500' :
                                    account.marginLevel > 100 ? 'bg-yellow-500' : 'bg-red-500'
                                    }`}
                                style={{ width: `${Math.min(account.marginLevel / 5, 100)}%` }}
                            />
                        </div>
                    </div>

                    {/* Floating P/L */}
                    <div className="flex items-center justify-between p-2 bg-zinc-800/50 rounded">
                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Floating P/L</div>
                        <div className={`text-sm font-bold ${plColor}`}>
                            {account.unrealizedPnL >= 0 ? '+' : ''}
                            {account.unrealizedPnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            <span className="text-xs ml-1 text-zinc-500">{account.currency}</span>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-zinc-800">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-zinc-500">Leverage</span>
                            <span className="text-xs text-zinc-300">1:{account.leverage}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-zinc-500">Trades</span>
                            <span className="text-xs text-zinc-300">{account.openPositions}</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
