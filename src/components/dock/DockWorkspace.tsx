import React, { useEffect, useCallback, useMemo } from 'react';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { DockContainer, FloatingPanelsLayer, GlobalEdgeIndicators } from './DockContainer';
import { ErrorBoundary } from '../ErrorBoundary';
import { TradingChart, type Timeframe, type ChartType } from '../TradingChart';
import type { DockPanelConfig } from '../../services/dockManager';
import { useCommandBus } from '../../hooks/useCommandBus';
import type { DockContainer as IDockContainer } from '../../services/dockManager';
import { MarketWatchPanel, type ActiveMarketSymbolsSnapshot } from '../layout/MarketWatchPanel';
import { NavigatorPanel } from '../layout/NavigatorPanel';
import { BottomDock } from '../BottomDock';
import { getInstrumentSymbolName, getUniqueSymbolNames, resolveAuthorizedChartSymbol } from '../../utils/symbolEligibility';
import { getInstrumentPriceDigits } from '../../utils/chartPriceScale';
import {
    getAuthorizedChartDiagnosticSymbol,
    getChartPanelDiagnosticId,
    resolveRenderedChartSymbol,
} from '../../utils/chartSelectionReadiness';

/**
 * Importing this module now evaluates every first-viewport component. AppShell
 * calls this through its authenticated dynamic boundary during the broker
 * request, so React's first authenticated commit has no nested lazy fallback.
 */
export const preloadDockWorkspaceViewport = async (): Promise<void> => undefined;

interface DockWorkspaceProps {
    globalChartType: ChartType;
    globalTimeframe: Timeframe;
    allSymbols: unknown[];
    chartSymbols?: unknown[];
    tradeSymbols?: unknown[];
    activeMarketSnapshot: ActiveMarketSymbolsSnapshot;
    selectedSymbol: string;
    chartRuntimeEnabled?: boolean;
    onSymbolSelect: (symbol: string) => void;
    onClosePosition: (id: string | number) => void;
    onModifyPosition: (id: number, sl: number, tp: number) => void;
    onCancelOrder: (id: string | number) => void;
    onCloseBulk: (type: 'ALL' | 'WINNERS' | 'LOSERS', symbol?: string) => void;
}

export const DockWorkspace: React.FC<DockWorkspaceProps> = ({
    globalChartType,
    globalTimeframe,
    allSymbols,
    chartSymbols,
    tradeSymbols,
    activeMarketSnapshot,
    selectedSymbol,
    chartRuntimeEnabled = true,
    onSymbolSelect,
    onClosePosition,
    onModifyPosition,
    onCancelOrder,
    onCloseBulk
}) => {
    const tradeSymbolSet = useMemo(() => {
        return new Set(getUniqueSymbolNames(tradeSymbols ?? allSymbols));
    }, [allSymbols, tradeSymbols]);
    const authorizedChartSymbols = useMemo(() => {
        return getUniqueSymbolNames(chartSymbols ?? allSymbols);
    }, [allSymbols, chartSymbols]);
    const priceDigitsBySymbol = useMemo(() => {
        const digitsBySymbol = new Map<string, number>();
        allSymbols.forEach((instrument) => {
            const instrumentSymbol = getInstrumentSymbolName(instrument);
            const digits = getInstrumentPriceDigits(instrument);
            if (instrumentSymbol && digits !== undefined) digitsBySymbol.set(instrumentSymbol, digits);
        });
        return digitsBySymbol;
    }, [allSymbols]);

    const resolveChartSymbol = useCallback((value: unknown): string => {
        return resolveAuthorizedChartSymbol(value, authorizedChartSymbols);
    }, [authorizedChartSymbols]);

    const renderPanel = useCallback((panel: DockPanelConfig, isActive: boolean) => {
        if (panel.component === 'Chart') {
            const panelSymbol = panel.props?.symbol ?? panel.title?.split(',')[0];
            const chartSymbol = resolveRenderedChartSymbol(
                panelSymbol,
                selectedSymbol,
                authorizedChartSymbols,
            );
            const diagnosticPanelSymbol = getAuthorizedChartDiagnosticSymbol(
                panelSymbol,
                authorizedChartSymbols,
            );
            const diagnosticPanelId = getChartPanelDiagnosticId(panel.id);
            const tradeAllowed = chartSymbol ? tradeSymbolSet.has(chartSymbol) : false;
            return (
                <div className="rtx-chart-panel flex-1 w-full h-full min-h-0 min-w-0 relative flex flex-col group/chartpanel"
                    data-chart-panel-id={diagnosticPanelId}
                    data-chart-panel-active={isActive ? 'true' : 'false'}
                    data-chart-panel-symbol={diagnosticPanelSymbol}
                    data-chart-rendered-symbol={chartSymbol}
                    style={{ background: '#0e0e12', border: '1px solid #28282e', borderRadius: 0, overflow: 'hidden', transition: 'border-color 0.15s, background 0.15s' }}
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
                        const draggedSymbol = resolveChartSymbol(e.dataTransfer.getData('text/plain'));
                        if (draggedSymbol && draggedSymbol !== chartSymbol) {
                            useDockLayoutStore.getState().updatePanelProps(panel.id, {
                                props: { ...panel.props, symbol: draggedSymbol },
                                title: `${draggedSymbol}, ${panel.props?.timeframe || globalTimeframe}`
                            });
                        }
                    }}
                >
                    {chartSymbol && chartRuntimeEnabled ? (
                        <div className="rtx-chart-panel__canvas flex-1 w-full h-full relative" style={{ pointerEvents: 'auto' }}>
                            <ErrorBoundary>
                                <TradingChart
                                    key={`chart-${panel.id}`}
                                    symbol={chartSymbol}
                                    timeframe={panel.props?.timeframe || globalTimeframe}
                                    chartType={globalChartType}
                                    panelId={panel.id}
                                    tradeAllowed={tradeAllowed}
                                    isActive={isActive}
                                    priceDigits={priceDigitsBySymbol.get(chartSymbol)}
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
                            activeMarketSnapshot={activeMarketSnapshot}
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
                        const draggedSymbol = resolveChartSymbol(e.dataTransfer.getData('text/plain'));
                        if (draggedSymbol) {
                            window.dispatchEvent(new CustomEvent('openChart', { detail: { symbol: draggedSymbol } }));
                        }
                    }}
                />
            );
        }
        return <div className="p-4 text-muted-foreground whitespace-nowrap overflow-hidden">Unknown Panel type: {panel.component}</div>;

    }, [
        authorizedChartSymbols,
        globalChartType, globalTimeframe,
        activeMarketSnapshot, allSymbols, selectedSymbol, chartRuntimeEnabled, onSymbolSelect, priceDigitsBySymbol, resolveChartSymbol, tradeSymbolSet,
        onClosePosition, onModifyPosition, onCancelOrder, onCloseBulk
    ]);

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
        <div
            className="rtx-dock-workspace flex-1 w-full h-full relative overflow-hidden flex flex-col"
            data-rtx-authenticated-viewport="true"
            style={{ background: '#0d0d11', padding: '0 6px', gap: '6px' }}
        >
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
