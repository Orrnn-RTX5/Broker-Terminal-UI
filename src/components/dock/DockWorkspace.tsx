import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { DockContainer, FloatingPanelsLayer, GlobalEdgeIndicators } from './DockContainer';
import { TradingChart } from '../TradingChart';
import { ErrorBoundary } from '../ErrorBoundary';
import type { Timeframe, ChartType } from '../TradingChart';
import type { DockPanelConfig } from '../../services/dockManager';
import { useAppStore } from '../../store/useAppStore';
import { ChartLoginPlaceholder } from '../ChartLoginPlaceholder';

import { MarketWatchPanel } from '../layout/MarketWatchPanel';
import { NavigatorPanel } from '../layout/NavigatorPanel';
import { BottomDock } from '../BottomDock';
import { useCommandBus } from '../../hooks/useCommandBus';
import type { DockContainer as IDockContainer } from '../../services/dockManager';

interface DockWorkspaceProps {
    globalChartType: ChartType;
    globalTimeframe: Timeframe;
    allSymbols: unknown[];
    selectedSymbol: string;
    onSymbolSelect: (symbol: string) => void;
    onClosePosition: (id: string | number) => void;
    onModifyPosition: (id: number, sl: number, tp: number) => void;
    onCancelOrder: (id: string | number) => void;
    onCloseBulk: (type: 'ALL' | 'WINNERS' | 'LOSERS', symbol?: string) => void;
}

const normalizeSymbolName = (value: unknown): string => String(value ?? '').trim().toUpperCase();

const getInstrumentSymbolName = (instrument: unknown): string => {
    if (instrument && typeof instrument === 'object') {
        const record = instrument as Record<string, unknown>;
        return normalizeSymbolName(record.symbol ?? record.name ?? record.id);
    }
    return normalizeSymbolName(instrument);
};

export const DockWorkspace: React.FC<DockWorkspaceProps> = ({
    globalChartType,
    globalTimeframe,
    allSymbols,
    selectedSymbol,
    onSymbolSelect,
    onClosePosition,
    onModifyPosition,
    onCancelOrder,
    onCloseBulk
}) => {
    const [isInitialized, setIsInitialized] = useState(false);
    const allowedSymbolSet = useMemo(() => {
        return new Set((Array.isArray(allSymbols) ? allSymbols : []).map(getInstrumentSymbolName).filter(Boolean));
    }, [allSymbols]);

    const resolveAllowedSymbol = useCallback((value: unknown): string => {
        const symbol = normalizeSymbolName(value);
        if (!symbol || allowedSymbolSet.size === 0) return '';
        return allowedSymbolSet.has(symbol) ? symbol : '';
    }, [allowedSymbolSet]);

    useEffect(() => {
        setIsInitialized(true);
    }, []);

    const isAuthenticated = useAppStore(s => s.isAuthenticated);

    const renderPanel = useCallback((panel: DockPanelConfig, isActive: boolean) => {
        if (panel.component === 'Chart') {
            const chartSymbol = resolveAllowedSymbol(panel.props?.symbol) || resolveAllowedSymbol(selectedSymbol);
            // Show placeholder when not authenticated
            if (!isAuthenticated) {
                return (
                    <div className="flex-1 w-full h-full min-h-0 min-w-0 relative flex flex-col">
                        <ChartLoginPlaceholder symbol={chartSymbol} />
                    </div>
                );
            }
            return (
                <div className="rtx-chart-panel flex-1 w-full h-full min-h-0 min-w-0 relative flex flex-col group/chartpanel"
                    style={{ background: '#0e0e12', border: '1px solid #28282e', borderRadius: 6, overflow: 'hidden', transition: 'border-color 0.15s, background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = '#5a5a65')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = '#28282e')}
                    onDragOver={e => {
                        e.preventDefault();
                        e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                    }}
                    onDragLeave={e => {
                        e.currentTarget.style.background = '#0e0e12';
                    }}
                    onDrop={e => {
                        e.preventDefault();
                        e.currentTarget.style.background = '#0e0e12';
                        const draggedSymbol = resolveAllowedSymbol(e.dataTransfer.getData('text/plain'));
                        if (draggedSymbol && draggedSymbol !== chartSymbol) {
                            useDockLayoutStore.getState().updatePanelProps(panel.id, {
                                props: { ...panel.props, symbol: draggedSymbol },
                                title: `${draggedSymbol}, ${panel.props?.timeframe || globalTimeframe}`
                            });
                        }
                    }}
                >
                    {chartSymbol ? (
                        <div className="rtx-chart-panel__canvas flex-1 w-full h-full relative" style={{ pointerEvents: 'auto' }}>
                            <ErrorBoundary>
                                <TradingChart
                                    key={`chart-${panel.id}-${chartSymbol}`}
                                    symbol={chartSymbol}
                                    timeframe={panel.props?.timeframe || globalTimeframe}
                                    chartType={globalChartType}
                                    panelId={panel.id}
                                />
                            </ErrorBoundary>
                        </div>
                    ) : (
                        <div className="flex-1 w-full h-full min-h-0 min-w-0 bg-[#0e0e12]" />
                    )}
                </div>
            );
        }
        if (panel.component === 'MarketWatch') {
            return (
                <div className="rtx-panel-shell flex-1 w-full h-full min-h-0 min-w-0 relative bg-[#131316] flex flex-col">
                    <ErrorBoundary>
                        <MarketWatchPanel
                            className="flex-1 min-h-0 min-w-0 w-full h-full"
                            allSymbols={allSymbols}
                            selectedSymbol={selectedSymbol}
                            onSymbolSelect={onSymbolSelect}
                        />
                    </ErrorBoundary>
                </div>
            );
        }
        if (panel.component === 'Navigator') {
            return (
                <div className="rtx-panel-shell flex-1 w-full h-full min-h-0 min-w-0 relative bg-[#131316] flex flex-col">
                    <ErrorBoundary>
                        <NavigatorPanel />
                    </ErrorBoundary>
                </div>
            );
        }
        if (panel.component === 'Terminal') {
            return (
                <div className="rtx-panel-shell flex-1 w-full h-full min-h-0 min-w-0 relative bg-[#131316] flex flex-col overflow-hidden">
                    <ErrorBoundary>
                        <BottomDock
                            height="100%"
                            onClosePosition={onClosePosition as any}
                            onModifyPosition={onModifyPosition}
                            onCancelOrder={onCancelOrder as any}
                            onCloseBulk={onCloseBulk as any}
                        />
                    </ErrorBoundary>
                </div>
            );
        }
        if (panel.component === 'EmptyChartArea') {
            return (
                <div
                    className="rtx-empty-chart-area flex-1 w-full h-full min-h-0 min-w-0 relative bg-[#0e0e12] flex items-center justify-center"
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                        e.preventDefault();
                        const draggedSymbol = resolveAllowedSymbol(e.dataTransfer.getData('text/plain'));
                        if (draggedSymbol) {
                            window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol: draggedSymbol } }));
                        }
                    }}
                />
            );
        }
        return <div className="p-4 text-muted-foreground whitespace-nowrap overflow-hidden">Unknown Panel type: {panel.component}</div>;

    }, [
        isAuthenticated,
        globalChartType, globalTimeframe,
        allSymbols, selectedSymbol, onSymbolSelect, resolveAllowedSymbol,
        onClosePosition, onModifyPosition, onCancelOrder, onCloseBulk
    ]);

    if (!isInitialized) return null;

    return (
        <DockWorkspaceClean renderPanel={renderPanel} />
    );
};

// Clean workspace - just renders the dock layout
const DockWorkspaceClean: React.FC<{
    renderPanel: (panel: DockPanelConfig, isActive: boolean) => React.ReactNode;
}> = ({ renderPanel }) => {
    const { layout, resetToDefaultLayout, tileWindows } = useDockLayoutStore();
    const { subscribe } = useCommandBus();

    // Listen for events
    useEffect(() => {
        const handleResetLayout = () => resetToDefaultLayout();
        window.addEventListener('resetLayout', handleResetLayout);

        const unsubCommandBus = subscribe((cmd) => {
            if (cmd.type === 'TILE_WINDOWS') {
                tileWindows();
            }
        });

        return () => {
            window.removeEventListener('resetLayout', handleResetLayout);
            unsubCommandBus();
        };
    }, [resetToDefaultLayout, subscribe, tileWindows]);

    const isLayoutEmpty = !layout.root.children || layout.root.children.length === 0;

    // Collect all open chart panels
    const chartPanels: DockPanelConfig[] = [];
    const collectCharts = (container: IDockContainer) => {
        if (!container.children) return;
        container.children.forEach(child => {
            if ('children' in child) {
                collectCharts(child as IDockContainer);
            } else if ((child as DockPanelConfig).component === 'Chart') {
                chartPanels.push(child as DockPanelConfig);
            }
        });
    };
    collectCharts(layout.root);
    layout.floatingPanels.forEach(collectCharts);

    return (
        <div className="rtx-dock-workspace flex-1 w-full h-full relative overflow-hidden flex flex-col" style={{ background: '#0d0d11', padding: '6px', gap: '6px' }}>
            {/* Reset Layout Button */}
            {isLayoutEmpty && (
                <button
                    onClick={() => resetToDefaultLayout()}
                    className="absolute top-4 right-4 z-50 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg transition-colors"
                >
                    Reset Layout
                </button>
            )}

            <div className="flex-1 relative min-h-0 min-w-0">
                <DockContainer
                    container={layout.root}
                    isRoot={true}
                    renderPanel={renderPanel}
                />
                <FloatingPanelsLayer renderPanel={renderPanel} />
                <GlobalEdgeIndicators />
            </div>
        </div>
    );
};
