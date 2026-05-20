import { Icon } from './ui/Icon';
import React from 'react';
interface MarketWatchContextMenuProps {
    visible: boolean;
    x: number;
    y: number;
    symbol: string;
    onNewOrder: (symbol: string) => void;
    onChartWindow: (symbol: string) => void;
    onTickChart: (symbol: string) => void;
    onDepthOfMarket: (symbol: string) => void;
    onSymbolSpecification: (symbol: string) => void;
    onHideSymbol: (symbol: string) => void;
    onShowAllSymbols: () => void;
    onToggleColumn: (column: string) => void;
    onClose: () => void;
    columnVisibility?: {
        spread: boolean;
        highLow: boolean;
        time: boolean;
    };
}

export const MarketWatchContextMenu: React.FC<MarketWatchContextMenuProps> = ({
    visible,
    x,
    y,
    symbol,
    onNewOrder,
    onChartWindow,
    onTickChart,
    onDepthOfMarket,
    onSymbolSpecification,
    onHideSymbol,
    onShowAllSymbols,
    onToggleColumn,
    onClose,
    columnVisibility = { spread: true, highLow: true, time: true }
}) => {
    if (!visible) return null;

    const columns = [
        { key: 'spread', label: 'Spread', visible: columnVisibility.spread },
        { key: 'highLow', label: 'High/Low', visible: columnVisibility.highLow },
        { key: 'time', label: 'Time', visible: columnVisibility.time }
    ];

    return (
        <div
            className="fixed z-[1000] bg-[#131316] border border-zinc-800 rounded shadow-2xl py-1 w-56 animate-in fade-in zoom-in-95 duration-100"
            style={{ left: x, top: y }}
            onMouseLeave={onClose}
            onClick={(e) => e.stopPropagation()}
        >
            {/* New Order */}
            <ContextMenuItem
                icon={<Icon name="trending-up" size="sm" />}
                label="New Order"
                onClick={() => {
                    onNewOrder(symbol);
                    onClose();
                }}
            />

            {/* Chart Window */}
            <ContextMenuItem
                icon={<Icon name="bar-chart-2" size="sm" />}
                label="Chart Window"
                onClick={() => {
                    onChartWindow(symbol);
                    onClose();
                }}
            />

            {/* Tick Chart */}
            <ContextMenuItem
                icon={<Icon name="layers" size="sm" />}
                label="Tick Chart"
                onClick={() => {
                    onTickChart(symbol);
                    onClose();
                }}
            />

            {/* Depth of Market */}
            <ContextMenuItem
                icon={<Icon name="grid-3x3" size="sm" />}
                label="Depth of Market"
                onClick={() => {
                    onDepthOfMarket(symbol);
                    onClose();
                }}
            />

            <div className="h-[1px] bg-zinc-800 my-1 mx-2" />

            {/* Symbol Specification */}
            <ContextMenuItem
                icon={<Icon name="file-text" size="sm" />}
                label="Symbol Specification"
                onClick={() => {
                    onSymbolSpecification(symbol);
                    onClose();
                }}
            />

            {/* Hide Symbol */}
            <ContextMenuItem
                icon={<Icon name="eye-off" size="sm" />}
                label={`Hide ${symbol}`}
                onClick={() => {
                    onHideSymbol(symbol);
                    onClose();
                }}
            />

            {/* Show All Symbols */}
            <ContextMenuItem
                icon={<Icon name="eye" size="sm" />}
                label="Show All Symbols"
                onClick={() => {
                    onShowAllSymbols();
                    onClose();
                }}
            />

            <div className="h-[1px] bg-zinc-800 my-1 mx-2" />

            {/* Columns Submenu */}
            <div className="group/submenu relative">
                <ContextMenuItem
                    icon={<Icon name="grid-3x3" size="sm" />}
                    label="Columns"
                    hasSubmenu
                />
                <div className="absolute left-full top-0 ml-1 hidden group-hover/submenu:block bg-[#131316] border border-zinc-800 rounded shadow-2xl py-1 w-40 animate-in fade-in slide-in-from-left-2 duration-100">
                    {columns.map((col) => (
                        <ContextMenuItem
                            key={col.key}
                            label={col.label}
                            onClick={() => {
                                onToggleColumn(col.key);
                            }}
                            active={col.visible}
                            icon={null}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};

interface ContextMenuItemProps {
    icon: React.ReactNode;
    label: string;
    onClick?: () => void;
    hasSubmenu?: boolean;
    active?: boolean;
}

const ContextMenuItem: React.FC<ContextMenuItemProps> = ({
    icon,
    label,
    onClick,
    hasSubmenu,
    active
}) => (
    <div
        className={`flex items-center justify-between px-3 py-2 text-[12px] text-zinc-300 hover:bg-[#2d2d2d] hover:text-white cursor-pointer transition-colors ${active ? 'bg-[#2d2d2d] text-white' : ''
            }`}
        onClick={(e) => {
            e.stopPropagation();
            if (onClick) onClick();
        }}
    >
        <div className="flex items-center gap-3">
            {icon && <span className="text-zinc-500">{icon}</span>}
            <span className={!icon ? 'ml-7' : ''}>{label}</span>
        </div>
        {hasSubmenu && (
            <Icon name="chevron-right" size="sm" className="text-zinc-500" />
        )}
        {active && !hasSubmenu && (
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        )}
    </div>
);
