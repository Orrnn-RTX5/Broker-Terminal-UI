import { useUiTranslation } from '../../hooks/useUiTranslation';
import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { useChartSettingsStore } from '../../store/useChartSettingsStore';
import { changeChartPanelSymbol, getChartPanels } from '../../services/chartPanelNavigation';
import { resetWorkspaceLayout } from '../../services/resetLayout';
import { DockContainer, FloatingPanelsLayer, GlobalEdgeIndicators } from './DockContainer';
import { StableChartHosts } from './StableChartHosts';
import { ErrorBoundary } from '../ErrorBoundary';
import type { Timeframe, ChartType } from '../../types/chart';
import type { DockPanelConfig } from '../../services/dockManager';
import { useCommandBus } from '../../hooks/useCommandBus';
import { MarketWatchPanel, type ActiveMarketSymbolsSnapshot } from '../layout/MarketWatchPanel';
import type { MarketInstrumentsSnapshot } from '../../hooks/useLiveMarketData';
import { NavigatorPanel } from '../layout/NavigatorPanel';
import { BottomDock } from '../BottomDock';
import { getInstrumentSymbolName, getUniqueSymbolNames, resolveAuthorizedChartSymbol } from '../../utils/symbolEligibility';
import { getInstrumentPriceDigits } from '../../utils/chartPriceScale';
import {
    getAuthorizedChartDiagnosticSymbol,
    getChartPanelDiagnosticId,
    resolveRenderedChartSymbol,
} from '../../utils/chartSelectionReadiness';
import {
    getResolvedTradingChartRuntime,
    preloadTradingChartRuntime,
} from '../../startup/tradingChartRuntime';
import type { TradeVolumeMetadata } from '../../utils/tradeVolume';
import type { RetainedGuestChart } from '../../hooks/useGuestChartLoginContinuity';

/**
 * Warm the chart beside the authenticated shell without making the complete
 * chart graph part of the shell's critical rendering gate.
 */
export const preloadDockWorkspaceViewport = async (): Promise<void> => {
    await preloadTradingChartRuntime();
};

type TradingChartModule = typeof import('../TradingChart');
type DeferredTradingChartProps = React.ComponentProps<TradingChartModule['TradingChart']>;

const readVolumeMetadata = (instrument: unknown): TradeVolumeMetadata => {
    if (!instrument || typeof instrument !== 'object') return {};
    const record = instrument as Record<string, unknown>;
    const readPositive = (key: keyof TradeVolumeMetadata): number | undefined => {
        const value = Number(record[key]);
        return Number.isFinite(value) && value > 0 ? value : undefined;
    };
    return {
        minVolume: readPositive('minVolume'),
        maxVolume: readPositive('maxVolume'),
        volumeStep: readPositive('volumeStep'),
    };
};

const DeferredTradingChart: React.FC<DeferredTradingChartProps> = (props) => {
    const [ChartComponent, setChartComponent] = useState<TradingChartModule['TradingChart'] | null>(() => (
        getResolvedTradingChartRuntime()?.TradingChart ?? null
    ));
    const [loadAttempt, setLoadAttempt] = useState(0);

    useEffect(() => {
        if (ChartComponent) return undefined;

        let active = true;
        let retryTimer: number | undefined;
        void preloadTradingChartRuntime().then(
            (module) => {
                if (active) setChartComponent(() => module.TradingChart);
            },
            () => {
                if (active && loadAttempt < 2) {
                    retryTimer = window.setTimeout(() => setLoadAttempt((attempt) => attempt + 1), 500);
                }
            },
        );

        return () => {
            active = false;
            if (retryTimer !== undefined) window.clearTimeout(retryTimer);
        };
    }, [ChartComponent, loadAttempt]);

    if (!ChartComponent) {
        return <div className="h-full w-full bg-[#0e0e12]" data-rtx-chart-runtime-loading="true" />;
    }

    return <ChartComponent {...props} />;
};

interface DockWorkspaceProps {
    globalChartType: ChartType;
    globalTimeframe: Timeframe;
    allSymbols: unknown[];
    chartSymbols?: unknown[];
    tradeSymbols?: unknown[];
    activeMarketSnapshot: ActiveMarketSymbolsSnapshot;
    marketInstrumentsSnapshot: MarketInstrumentsSnapshot;
    selectedSymbol: string;
    chartRuntimeEnabled?: boolean;
    retainedGuestCharts?: Record<string, RetainedGuestChart>;
    onSymbolSelect: (symbol: string) => void;
    onClosePosition: (id: string | number) => void;
    onModifyPosition: (id: number, sl: number, tp: number) => void;
    onCancelOrder: (id: string | number) => void;
    onCloseBulk: (type: 'ALL' | 'WINNERS' | 'LOSERS', symbol?: string) => void;
}

export const DockWorkspace = React.memo(function DockWorkspace({
    globalChartType,
    globalTimeframe,
    allSymbols,
    chartSymbols,
    tradeSymbols,
    activeMarketSnapshot,
    marketInstrumentsSnapshot,
    selectedSymbol,
    chartRuntimeEnabled = true,
    retainedGuestCharts,
    onSymbolSelect,
    onClosePosition,
    onModifyPosition,
    onCancelOrder,
    onCloseBulk
}: DockWorkspaceProps) {
    const tr = useUiTranslation();
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
    const volumeMetadataBySymbol = useMemo(() => {
        const metadataBySymbol = new Map<string, TradeVolumeMetadata>();
        const mergeCatalog = (catalog: unknown[]) => catalog.forEach((instrument) => {
            const instrumentSymbol = getInstrumentSymbolName(instrument);
            if (!instrumentSymbol) return;
            const previous = metadataBySymbol.get(instrumentSymbol) ?? {};
            const next = readVolumeMetadata(instrument);
            metadataBySymbol.set(instrumentSymbol, {
                minVolume: next.minVolume ?? previous.minVolume,
                maxVolume: next.maxVolume ?? previous.maxVolume,
                volumeStep: next.volumeStep ?? previous.volumeStep,
            });
        });

        mergeCatalog(allSymbols);
        // FIX: Authenticated broker specifications override public fallbacks for
        // the exact execution symbol, matching MT-style per-instrument lot grids.
        mergeCatalog(marketInstrumentsSnapshot.authorizedInstruments);
        return metadataBySymbol;
    }, [allSymbols, marketInstrumentsSnapshot.authorizedInstruments]);
    const historyInstrumentCatalog = useMemo(
        () => [...allSymbols, ...marketInstrumentsSnapshot.authorizedInstruments],
        [allSymbols, marketInstrumentsSnapshot.authorizedInstruments],
    );

    const resolveChartSymbol = useCallback((value: unknown): string => {
        return resolveAuthorizedChartSymbol(value, authorizedChartSymbols);
    }, [authorizedChartSymbols]);

    // The rendered symbol is the per-symbol chart-settings key, so it must be
    // resolved identically here and in the settings-carry effect below.
    const resolvePanelChartSymbol = useCallback((panel: DockPanelConfig): string => {
        const panelSymbol = panel.props?.symbol ?? panel.title?.split(',')[0];
        const explicitPanelSymbol = String(panelSymbol ?? '').trim();
        const waitingForPanelSymbol = marketInstrumentsSnapshot.chartCatalogCurrent === false
            && Boolean(explicitPanelSymbol) && explicitPanelSymbol.toUpperCase() !== 'CHART'
            && !getAuthorizedChartDiagnosticSymbol(panelSymbol, authorizedChartSymbols);
        if (waitingForPanelSymbol) {
            const retained = retainedGuestCharts?.[panel.id];
            return marketInstrumentsSnapshot.accountCatalogStatus === 'loading'
                && retained?.timeframe === (panel.props?.timeframe || globalTimeframe)
                ? retained.symbol : '';
        }
        return resolveRenderedChartSymbol(panelSymbol, selectedSymbol, authorizedChartSymbols);
    }, [authorizedChartSymbols, globalTimeframe, marketInstrumentsSnapshot.accountCatalogStatus,
        marketInstrumentsSnapshot.chartCatalogCurrent, retainedGuestCharts, selectedSymbol]);

    // While the broker catalog settles, a panel can render under a fallback
    // symbol (typically the selected one). Per-symbol Show-section choices
    // such as OHLC belong to the chart window, so carry them to the symbol the
    // panel settles on instead of dropping back to global defaults.
    const renderedChartSymbolsRef = useRef(new Map<string, string>());
    const layout = useDockLayoutStore(state => state.layout);
    useEffect(() => {
        const settings = useChartSettingsStore.getState();
        getChartPanels(layout).forEach(panel => {
            const rendered = resolvePanelChartSymbol(panel);
            if (!rendered) return;
            const previous = renderedChartSymbolsRef.current.get(panel.id);
            if (previous && previous !== rendered) settings.inheritSymbolProperties(previous, rendered);
            renderedChartSymbolsRef.current.set(panel.id, rendered);
        });
    }, [layout, resolvePanelChartSymbol]);

    const renderPanel = useCallback((panel: DockPanelConfig, isActive: boolean, isFloating = false) => {
        if (panel.component === 'Chart') {
            const panelSymbol = panel.props?.symbol ?? panel.title?.split(',')[0];
            const diagnosticPanelSymbol = getAuthorizedChartDiagnosticSymbol(
                panelSymbol,
                authorizedChartSymbols,
            );
            // An early feed snapshot must never pair an explicit XAU/BTC
            // header with another instrument's canvas or trading buttons.
            const chartSymbol = resolvePanelChartSymbol(panel);
            const diagnosticPanelId = getChartPanelDiagnosticId(panel.id);
            const retainingGuestChart = marketInstrumentsSnapshot.accountCatalogStatus === 'loading'
                && retainedGuestCharts?.[panel.id]?.symbol === chartSymbol;
            const tradeAllowed = !retainingGuestChart && chartSymbol ? tradeSymbolSet.has(chartSymbol) : false;
            const volumeMetadata = volumeMetadataBySymbol.get(chartSymbol);
            return (
                <div className="rtx-chart-panel flex-1 w-full h-full min-h-0 min-w-0 relative flex flex-col group/chartpanel"
                    data-chart-panel-id={diagnosticPanelId}
                    data-chart-panel-active={isActive ? 'true' : 'false'}
                    data-chart-panel-symbol={diagnosticPanelSymbol}
                    data-chart-rendered-symbol={chartSymbol}
                    style={{ background: 'var(--bg-secondary, #0e0e12)', border: '1px solid var(--border-primary, #28282e)', borderRadius: 0, overflow: 'hidden', transition: 'border-color 0.15s, background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-tertiary, #5a5a65)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-primary, #28282e)')}
                    onDragOver={e => {
                        e.preventDefault();
                        e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                    }}
                    onDragLeave={e => {
                        e.currentTarget.style.background = 'var(--bg-secondary, #0e0e12)';
                    }}
                    onDrop={e => {
                        e.preventDefault();
                        e.currentTarget.style.background = 'var(--bg-secondary, #0e0e12)';
                        const draggedSymbol = resolveChartSymbol(e.dataTransfer.getData('text/plain'));
                        if (draggedSymbol && draggedSymbol !== chartSymbol) {
                            changeChartPanelSymbol(panel.id, draggedSymbol, authorizedChartSymbols, globalTimeframe);
                        }
                    }}
                >
                    {chartSymbol && chartRuntimeEnabled ? (
                        <div className="rtx-chart-panel__canvas flex-1 w-full h-full relative" style={{ pointerEvents: 'auto' }}>
                            <ErrorBoundary>
                                <DeferredTradingChart
                                    key={`chart-${panel.id}`}
                                    symbol={chartSymbol}
                                    timeframe={panel.props?.timeframe || globalTimeframe}
                                    chartType={panel.props?.chartType || globalChartType}
                                    panelId={panel.id}
                                    tradeAllowed={tradeAllowed}
                                    isActive={isActive}
                                    priceDigits={priceDigitsBySymbol.get(chartSymbol)}
                                    minVolume={volumeMetadata?.minVolume}
                                    maxVolume={volumeMetadata?.maxVolume}
                                    volumeStep={volumeMetadata?.volumeStep}
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
                            showHeader={!isFloating}
                            allSymbols={allSymbols}
                            chartSymbols={authorizedChartSymbols}
                            activeMarketSnapshot={activeMarketSnapshot}
                            marketInstrumentsSnapshot={marketInstrumentsSnapshot}
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
                            onClose={isFloating || panel.closable === false ? undefined : () => useDockLayoutStore.getState().removePanel(panel.id)}
                            onFloat={isFloating || panel.floatable === false ? undefined : () => useDockLayoutStore.getState().floatPanel(panel.id)}
                            onClosePosition={onClosePosition as any}
                            onModifyPosition={onModifyPosition}
                            onCancelOrder={onCancelOrder as any}
                            onCloseBulk={onCloseBulk as any}
                            historyInstrumentCatalog={historyInstrumentCatalog}
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
        return <div className="p-4 text-muted-foreground whitespace-nowrap overflow-hidden">{tr("Unknown Panel type: ")}{panel.component}</div>;

    }, [
        authorizedChartSymbols,
        globalChartType, globalTimeframe,
        activeMarketSnapshot, marketInstrumentsSnapshot, allSymbols, selectedSymbol, chartRuntimeEnabled, onSymbolSelect, priceDigitsBySymbol, resolveChartSymbol, resolvePanelChartSymbol, tradeSymbolSet, volumeMetadataBySymbol,
        onClosePosition, onModifyPosition, onCancelOrder, onCloseBulk
    , tr]);

    return (
        <DockWorkspaceClean renderPanel={renderPanel} />
    );
});

// Clean workspace - just renders the dock layout
const DockWorkspaceClean: React.FC<{
    renderPanel: (panel: DockPanelConfig, isActive: boolean, isFloating?: boolean) => React.ReactNode;
}> = ({ renderPanel }) => {
    const tr = useUiTranslation();
    const { layout, arrangeCharts, stepTileWindows } = useDockLayoutStore();
    const { subscribe } = useCommandBus();

    // Listen for events
    useEffect(() => {
        const handleResetLayout = () => resetWorkspaceLayout();
        window.addEventListener('resetLayout', handleResetLayout);

        const unsubCommandBus = subscribe((cmd) => {
            if (cmd.type === 'TILE_WINDOWS') {
                if (cmd.payload.mode === 'grid') stepTileWindows();
                else arrangeCharts(cmd.payload.mode);
            }
        });

        return () => {
            window.removeEventListener('resetLayout', handleResetLayout);
            unsubCommandBus();
        };
    }, [subscribe, arrangeCharts, stepTileWindows]);

    const isLayoutEmpty = !layout.root.children || layout.root.children.length === 0;

    return (
        <div
            className="rtx-dock-workspace flex-1 w-full h-full relative overflow-hidden flex flex-col"
            data-rtx-authenticated-viewport="true"
            style={{ background: '#0d0d11', padding: 0, gap: '6px' }}
        >
            {/* Reset Layout Button */}
            {isLayoutEmpty && (
                <button
                    onClick={() => resetWorkspaceLayout()}
                    className="absolute top-4 right-4 z-50 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg transition-colors"
                >
                    {tr("Reset Layout")}</button>
            )}

            <div className="flex-1 relative min-h-0 min-w-0">
                <StableChartHosts renderPanel={renderPanel}>
                <DockContainer
                    container={layout.root}
                    isRoot={true}
                    renderPanel={renderPanel}
                />
                <FloatingPanelsLayer renderPanel={renderPanel} />
                <GlobalEdgeIndicators />
                </StableChartHosts>
            </div>
        </div>
    );
};
