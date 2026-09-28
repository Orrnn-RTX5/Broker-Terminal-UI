import type {
  Dispatch,
  MouseEvent as ReactMouseEvent,
  RefObject,
  SetStateAction,
} from 'react';
import { ChartContextMenu } from '../../../components/ChartContextMenu';
import { ChartSymbolTrigger } from '../../../components/ChartSymbolDropdown';
import { ChartTemplateDialog } from '../../../components/ChartTemplateDialog';
import { DrawingContextMenu } from '../../../components/DrawingContextMenu';
import { OneClickTrading } from '../../../components/OneClickTrading';
import { commandBus } from '../../../services/commandBus';
import { drawingManager } from '../../../services/drawingManager';
import type { IndicatorConfig } from '../../../services/indicatorManager';
import { activateActiveChartSource } from '../../../services/activeChartSource';
import type { SymbolMarketStatusState } from '../../../hooks/useSymbolMarketStatus';
import type { ChartProperties } from '../../../store/useChartSettingsStore';
import type { ChartTemplate } from '../../../store/useTemplateStore';
import type {
  ChartType,
  LivePriceOverlayColors,
  Timeframe,
  TradingViewChartTheme,
} from '../../../types/chart';
import type { AddChartIndicatorRequest } from '../model/indicatorRequest';
import { LIVE_PRICE_SCALE_WIDTH_FALLBACK_PX } from '../../../components/TradingChart.helpers';
import { CHART_AXIS_FONT_FAMILY } from './chartTheme';

type LoadingPhase = 'connecting' | 'receiving' | 'ready' | 'hidden';

interface TextInputOverlay {
  x: number;
  y: number;
  time: number;
  price: number;
}

interface ChartContextMenuState {
  visible: boolean;
  x: number;
  y: number;
}

interface TradingChartViewProps {
  activeChartSourceId: string;
  activeTimeframe: Timeframe;
  addLocalIndicator: (request: AddChartIndicatorRequest) => boolean;
  bindDrawingManagerToChart: () => boolean;
  centerRef: RefObject<HTMLDivElement | null>;
  chartSettings: ChartProperties;
  chartTheme: TradingViewChartTheme;
  closeCtxMenu: () => void;
  containerRef: RefObject<HTMLDivElement | null>;
  ctxAutoScroll: boolean;
  ctxChartShift: boolean;
  ctxMenu: ChartContextMenuState;
  ctxShowTradeHistory: boolean;
  ctxShowTradeHistoryLine: boolean;
  ctxShowTradeLevels: boolean;
  currentIndicators: IndicatorConfig[];
  drawingRuntimeContextRef: RefObject<{ contextId: string; accountScope?: string; symbol: string; timeframe: Timeframe }>;
  handleContextMenu: (event: ReactMouseEvent) => void;
  handleCtxChartTypeChange: (type: ChartType) => void;
  handleCtxDeleteIndicators: () => void;
  handleCtxOpenDOM: () => void;
  handleCtxOpenNewOrder: () => void;
  handleCtxOpenProperties: () => void;
  handleCtxRefresh: () => void;
  handleCtxSaveAsPicture: () => void;
  handleCtxTimeframeChange: (timeframe: Timeframe) => void;
  handleCtxToggleAutoScroll: () => void;
  handleCtxToggleChartShift: () => void;
  handleCtxToggleGrid: () => void;
  handleCtxToggleOHLC: () => void;
  handleCtxToggleTradeHistory: () => void;
  handleCtxToggleTradeHistoryLine: () => void;
  handleCtxToggleTradeLevels: () => void;
  handleCtxToggleVolumes: () => void;
  handleCtxZoomIn: () => void;
  handleCtxZoomOut: () => void;
  handleLoadTemplate: (template: ChartTemplate) => void;
  handleOpenTemplateDialog: (mode: 'save' | 'load') => void;
  horizLineRef: RefObject<HTMLDivElement | null>;
  initialLivePriceOverlayColors: LivePriceOverlayColors;
  isAdvancedUntitledLight: boolean;
  livePriceBadgeRef: RefObject<HTMLDivElement | null>;
  livePriceCountdownRef: RefObject<HTMLSpanElement | null>;
  livePriceLineRef: RefObject<HTMLDivElement | null>;
  livePriceValueRef: RefObject<HTMLSpanElement | null>;
  loadingMessageIdx: number;
  loadingMessages: string[];
  loadingPhase: LoadingPhase;
  localChartType: ChartType;
  marketStatus: SymbolMarketStatusState;
  maxVolume?: number;
  minVolume?: number;
  ohlcCloseRef: RefObject<HTMLSpanElement | null>;
  ohlcHighRef: RefObject<HTMLSpanElement | null>;
  ohlcLowRef: RefObject<HTMLSpanElement | null>;
  ohlcOpenRef: RefObject<HTMLSpanElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  panelId?: string;
  priceLabelRef: RefObject<HTMLDivElement | null>;
  setTemplateDialogOpen: Dispatch<SetStateAction<boolean>>;
  setTextInputOverlay: Dispatch<SetStateAction<TextInputOverlay | null>>;
  setTextInputValue: Dispatch<SetStateAction<string>>;
  showOneClick: boolean;
  symbol: string;
  templateDialogMode: 'save' | 'load';
  templateDialogOpen: boolean;
  textInputOverlay: TextInputOverlay | null;
  textInputValue: string;
  timeframe: Timeframe;
  timeLabelRef: RefObject<HTMLDivElement | null>;
  toggleOneClickTrading: () => void;
  tradeAllowed: boolean;
  tr: <T>(source: T, values?: Record<string, unknown>) => T;
  useEnterpriseLightChartPalette: boolean;
  vertLineRef: RefObject<HTMLDivElement | null>;
  volumeStep?: number;
}

export const TradingChartView = (props: TradingChartViewProps) => {
  const {
    activeChartSourceId, activeTimeframe, addLocalIndicator, bindDrawingManagerToChart, centerRef,
    chartSettings, chartTheme, closeCtxMenu, containerRef, ctxAutoScroll, ctxChartShift,
    ctxMenu, ctxShowTradeHistory, ctxShowTradeHistoryLine, ctxShowTradeLevels,
    currentIndicators, drawingRuntimeContextRef, handleContextMenu, handleCtxChartTypeChange,
    handleCtxDeleteIndicators, handleCtxOpenDOM, handleCtxOpenNewOrder, handleCtxOpenProperties,
    handleCtxRefresh, handleCtxSaveAsPicture, handleCtxTimeframeChange,
    handleCtxToggleAutoScroll, handleCtxToggleChartShift, handleCtxToggleGrid,
    handleCtxToggleOHLC, handleCtxToggleTradeHistory, handleCtxToggleTradeHistoryLine,
    handleCtxToggleTradeLevels, handleCtxToggleVolumes, handleCtxZoomIn, handleCtxZoomOut,
    handleLoadTemplate, handleOpenTemplateDialog, horizLineRef, initialLivePriceOverlayColors,
    isAdvancedUntitledLight, livePriceBadgeRef, livePriceCountdownRef, livePriceLineRef,
    livePriceValueRef, loadingMessageIdx, loadingMessages, loadingPhase, localChartType,
    marketStatus, maxVolume, minVolume, ohlcCloseRef, ohlcHighRef, ohlcLowRef, ohlcOpenRef,
    overlayRef, panelId, priceLabelRef, setTemplateDialogOpen,
    setTextInputOverlay, setTextInputValue, showOneClick, symbol, templateDialogMode,
    templateDialogOpen, textInputOverlay, textInputValue, timeframe, timeLabelRef,
    toggleOneClickTrading, tradeAllowed, tr, useEnterpriseLightChartPalette, vertLineRef,
    volumeStep,
  } = props;

return (
    <div
      className="rtx-chart-wrapper relative w-full h-full bg-[#0d0d0d]"
      data-chart-context-id={activeChartSourceId}
      dir="ltr"
      data-cursor="select"
      onContextMenu={handleContextMenu}
    >

      {/* ── Inline Text Input Overlay (for text drawing tool) ── */}
      {textInputOverlay && (
        <div
          className="rtx-chart-text-input-popover fixed z-[9999] flex flex-col gap-1 p-2 rounded shadow-2xl"
          style={{
            left: textInputOverlay.x,
            top: textInputOverlay.y,
            background: 'var(--rtx-chart-text-input-bg, #18181b)',
            border: '1px solid var(--rtx-chart-text-input-border, #3f3f46)',
            transform: 'translate(-50%, -120%)',
            minWidth: 180,
          }}
        >
          <div className="text-xs text-zinc-400 mb-1">{tr("Enter text label")}</div>
          <input
            autoFocus
            type="text"
            value={textInputValue}
            onChange={e => setTextInputValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && textInputValue.trim()) {
                const contextId = drawingRuntimeContextRef.current.contextId;
                if (!bindDrawingManagerToChart() || !drawingManager.ownsActiveDrawing(contextId)) return;
                // Place text drawing
                drawingManager.updateActiveDrawing({ text: textInputValue.trim() });
                const activeDrawing = drawingManager.getActiveDrawing(contextId);
                if (activeDrawing?.type === 'callout') {
                  drawingManager.finishDrawing();
                } else {
                  drawingManager.addPoint(
                    textInputOverlay.time,
                    textInputOverlay.price,
                    undefined,
                    contextId,
                  );
                }
                setTextInputOverlay(null);
                setTextInputValue('');
                // Auto-reset to cursor
                commandBus.dispatch({
                  type: 'SELECT_TOOL',
                  payload: { tool: 'cursor', targetContextId: contextId },
                });
              } else if (e.key === 'Escape') {
                const contextId = drawingRuntimeContextRef.current.contextId;
                drawingManager.cancelDrawing(contextId);
                setTextInputOverlay(null);
                setTextInputValue('');
                commandBus.dispatch({
                  type: 'SELECT_TOOL',
                  payload: { tool: 'cursor', targetContextId: contextId },
                });
              }
            }}
            className="px-2 py-1 rounded text-sm text-white bg-zinc-800 border border-zinc-600 outline-none focus:border-blue-500"
            placeholder={tr("Type and press Enter")}
          />
          <div className="flex gap-1">
            <button
              onClick={() => {
                if (textInputValue.trim()) {
                  const contextId = drawingRuntimeContextRef.current.contextId;
                  if (!bindDrawingManagerToChart() || !drawingManager.ownsActiveDrawing(contextId)) return;
                  drawingManager.updateActiveDrawing({ text: textInputValue.trim() });
                  const activeDrawing = drawingManager.getActiveDrawing(contextId);
                  if (activeDrawing?.type === 'callout') {
                    drawingManager.finishDrawing();
                  } else {
                    drawingManager.addPoint(
                      textInputOverlay.time,
                      textInputOverlay.price,
                      undefined,
                      contextId,
                    );
                  }
                }
                setTextInputOverlay(null);
                setTextInputValue('');
                commandBus.dispatch({
                  type: 'SELECT_TOOL',
                  payload: {
                    tool: 'cursor',
                    targetContextId: drawingRuntimeContextRef.current.contextId,
                  },
                });
              }}
              className="flex-1 px-2 py-1 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white"
            >
              {tr("OK")}</button>
            <button
              onClick={() => {
                const contextId = drawingRuntimeContextRef.current.contextId;
                drawingManager.cancelDrawing(contextId);
                setTextInputOverlay(null);
                setTextInputValue('');
                commandBus.dispatch({
                  type: 'SELECT_TOOL',
                  payload: { tool: 'cursor', targetContextId: contextId },
                });
              }}
              className="flex-1 px-2 py-1 rounded text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
            >
              {tr("Cancel")}</button>
          </div>
        </div>
      )}

      {/* API Error banner — suppressed, errors only logged to console */}

      {/* Loading — phased status: connecting → receiving → fades out on ready */}
      {loadingPhase !== 'hidden' && (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a0f]/95 z-20 pointer-events-none transition-opacity duration-150 ${loadingPhase === 'ready' ? 'opacity-0' : 'opacity-100'}`}
        >
          <div className="flex items-end gap-1 mb-5 opacity-30" aria-hidden="true">
            {Array.from({ length: 14 }).map((_, i) => (
              <div
                key={i}
                className="w-2 bg-white/40 rounded-sm animate-pulse"
                style={{
                  height: `${22 + ((i * 17) % 56)}px`,
                  animationDelay: `${i * 80}ms`,
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-3 text-white/90">
            <div className="w-4 h-4 border-2 border-white/25 border-t-white rounded-full animate-spin" />
            <div
              key={loadingMessageIdx}
              className="text-sm tracking-wide transition-opacity duration-300"
            >
              {loadingPhase === 'ready' ? tr("Ready") : (loadingMessages[loadingMessageIdx] ?? loadingMessages[0])}
            </div>
          </div>
        </div>
      )}


      {/* Chart HUD uses shared size and weight roles with theme-specific families and colors. */}
      {(chartSettings.showTicker || chartSettings.showOHLC) && (isAdvancedUntitledLight ? (
        <div className="rtx-chart-hud" style={{
          position: 'absolute', top: 8, left: 12, zIndex: 15, pointerEvents: 'none',
          fontFamily: 'var(--font-sans)', fontSize: 'var(--rtx-ui-font-size, 14px)', fontWeight: 'var(--rtx-font-weight-body, 400)', lineHeight: '16px', letterSpacing: 'normal',
          display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap'
        }}>
          {chartSettings.showTicker && (
            <span className="rtx-chart-hud__symbol" style={{
              fontWeight: 'var(--rtx-font-weight-control, 400)', color: '#7f56d9',
              background: 'rgba(127, 86, 217, 0.10)',
              padding: '2px 8px', borderRadius: '4px',
            }}><ChartSymbolTrigger symbol={symbol} panelId={panelId} />, {timeframe}</span>
          )}
          {chartSettings.showOHLC && (
            <>
              <span style={{ fontWeight: 'var(--rtx-font-weight-body, 400)', color: '#475467' }}>
                O: <span ref={ohlcOpenRef} style={{
                  fontWeight: 'var(--rtx-font-weight-body, 400)', color: '#1d2939',
                  background: 'rgba(29, 41, 57, 0.06)', padding: '1px 6px', borderRadius: '3px'
                }}>0.00000</span>
              </span>
              <span style={{ fontWeight: 'var(--rtx-font-weight-body, 400)', color: '#475467' }}>
                H: <span ref={ohlcHighRef} style={{
                  fontWeight: 'var(--rtx-font-weight-body, 400)', color: '#16a34a',
                  background: 'rgba(22, 163, 74, 0.10)', padding: '1px 6px', borderRadius: '3px'
                }}>0.00000</span>
              </span>
              <span style={{ fontWeight: 'var(--rtx-font-weight-body, 400)', color: '#475467' }}>
                L: <span ref={ohlcLowRef} style={{
                  fontWeight: 'var(--rtx-font-weight-body, 400)', color: '#dc2626',
                  background: 'rgba(220, 38, 38, 0.10)', padding: '1px 6px', borderRadius: '3px'
                }}>0.00000</span>
              </span>
              <span style={{ fontWeight: 'var(--rtx-font-weight-body, 400)', color: '#475467' }}>
                C: <span ref={ohlcCloseRef} style={{
                  fontWeight: 'var(--rtx-font-weight-body, 400)', color: '#1d2939',
                  background: 'rgba(29, 41, 57, 0.06)', padding: '1px 6px', borderRadius: '3px'
                }}>0.00000</span>
              </span>
            </>
          )}
        </div>
      ) : (
        <div className="rtx-chart-hud" style={{
          position: 'absolute', top: 8, left: 12, zIndex: 15, pointerEvents: 'none',
          fontFamily: 'var(--font-mono)', fontSize: 'var(--rtx-ui-font-size, 14px)', fontWeight: 'var(--rtx-font-weight-body, 400)', lineHeight: '16px', color: chartTheme.axisText,
          textShadow: '1px 1px 1px rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap'
        }}>
          {chartSettings.showTicker && (
            <span className="rtx-chart-hud__symbol" style={{ fontWeight: 'var(--rtx-font-weight-control, 400)', color: chartTheme.text }}><ChartSymbolTrigger symbol={symbol} panelId={panelId} />, {timeframe}</span>
          )}
          {chartSettings.showOHLC && (
            <>
              <span>O: <span ref={ohlcOpenRef} style={{ color: chartTheme.text }}>0.00000</span></span>
              <span>H: <span ref={ohlcHighRef} style={{ color: chartTheme.candleUp }}>0.00000</span></span>
              <span>L: <span ref={ohlcLowRef} style={{ color: chartTheme.candleDown }}>0.00000</span></span>
              <span>C: <span ref={ohlcCloseRef} style={{ color: chartTheme.text }}>0.00000</span></span>
            </>
          )}
        </div>
      ))}

      {/*
        Chart Container - must have explicit dimensions for lightweight-charts.
        Its native grid is painted below candles/series; never add a DOM grid
        layer beside this container because that would cover chart data.
      */}
      <div
        ref={containerRef}
        className="absolute inset-0 w-full h-full"
        style={{ zIndex: chartSettings.chartOnForeground ? 11 : 0 }}
      />

      {/* Drawing Overlay — always pointer-events:none so chart canvas receives all mouse events */}
      <div
        ref={overlayRef}
        className="chart-drawing-overlay absolute inset-0"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: chartSettings.chartOnForeground ? 5 : 10,
        }}
      />

      {/* ── Custom crosshair — 5 GPU-composited divs, all pointer-events:none ── */}
      {/* Vertical line: 1px wide, full height, snapped to nearest candle X */}
      <div ref={vertLineRef} style={{
        position: 'absolute', left: 0, top: 0,
        width: 1, height: '100%',
        background: useEnterpriseLightChartPalette ? '#64748b' : 'rgba(148,163,184,0.75)',
        pointerEvents: 'none', zIndex: 14, opacity: 0,
        willChange: 'transform',
      }} />
      {/* Horizontal line: 1px tall, full width, exact cursor Y */}
      <div ref={horizLineRef} style={{
        position: 'absolute', left: 0, top: 0,
        width: '100%', height: 1,
        background: useEnterpriseLightChartPalette ? '#64748b' : 'rgba(148,163,184,0.75)',
        pointerEvents: 'none', zIndex: 14, opacity: 0,
        willChange: 'transform',
      }} />
      {/* Centre "+" marker: 12×12, two thin crossed lines */}
      <div ref={centerRef} style={{
        position: 'absolute', left: 0, top: 0,
        width: 12, height: 12,
        pointerEvents: 'none', zIndex: 15, opacity: 0,
        willChange: 'transform',
      }}>
        <div style={{ position: 'absolute', left: 0, top: 5, width: 12, height: 1, background: useEnterpriseLightChartPalette ? '#64748b' : 'rgba(148,163,184,0.95)' }} />
        <div style={{ position: 'absolute', left: 5, top: 0, width: 1, height: 12, background: useEnterpriseLightChartPalette ? '#64748b' : 'rgba(148,163,184,0.95)' }} />
      </div>
      {/* Time label: bottom of chart at snappedX */}
      <div ref={timeLabelRef} className="rtx-chart-crosshair-label" style={{
        position: 'absolute', left: 0, top: 0,
        background: '#334155', color: useEnterpriseLightChartPalette ? '#ffffff' : '#e2e8f0',
        fontSize: 'var(--rtx-ui-font-size, 14px)', fontWeight: 'var(--rtx-font-weight-body, 400)', fontFamily: "Consolas,'Courier New',monospace",
        padding: '1px 5px', borderRadius: 2,
        whiteSpace: 'nowrap',
        pointerEvents: 'none', zIndex: 15, opacity: 0,
        willChange: 'transform',
      }} />
      {/* Price label: right edge at cursor Y */}
      <div ref={priceLabelRef} className="rtx-chart-crosshair-label" style={{
        position: 'absolute', left: 0, top: 0,
        width: 54, textAlign: 'center',
        background: '#334155', color: useEnterpriseLightChartPalette ? '#ffffff' : '#e2e8f0',
        fontSize: 'var(--rtx-ui-font-size, 14px)', fontWeight: 'var(--rtx-font-weight-body, 400)', fontFamily: "Consolas,'Courier New',monospace",
        padding: '1px 4px', borderRadius: 2,
        whiteSpace: 'nowrap',
        pointerEvents: 'none', zIndex: 15, opacity: 0,
        willChange: 'transform',
      }} />

      {/* ── Live current-price line + badge (TradingView-style last-price indicator) ── */}
      <div
        ref={livePriceLineRef}
        style={{
          position: 'absolute',
          top: -9999,
          left: 0,
          right: LIVE_PRICE_SCALE_WIDTH_FALLBACK_PX,
          height: 0,
          borderTop: `0.5px solid ${initialLivePriceOverlayColors.lineColor}`,
          pointerEvents: 'none',
          zIndex: 7,
          transform: 'translateY(-0.25px)',
        }}
      />
      <div
        ref={livePriceBadgeRef}
        className="rtx-chart-price-badge"
        style={{
          position: 'absolute',
          top: -9999,
          right: 0,
          padding: '2px 5px',
          background: initialLivePriceOverlayColors.badgeBackground,
          color: initialLivePriceOverlayColors.badgeTextColor,
          fontFamily: CHART_AXIS_FONT_FAMILY,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 9,
          borderRadius: 0,
          transform: 'translateY(-50%)',
          letterSpacing: 0,
          textAlign: 'center',
          boxSizing: 'border-box',
        }}
      >
        <span
          ref={livePriceValueRef}
          style={{
            display: 'block',
            fontSize: 'var(--rtx-ui-font-size, 14px)',
            fontWeight: 'var(--rtx-font-weight-control, 400)',
            lineHeight: '16px',
            fontVariantNumeric: 'tabular-nums',
          }}
        />
        <span
          ref={livePriceCountdownRef}
          data-live-price-countdown
          aria-hidden="true"
          style={{
            display: 'none',
            fontSize: 'var(--rtx-ui-font-size, 14px)',
            fontWeight: 'var(--rtx-font-weight-control, 400)',
            lineHeight: '14px',
            letterSpacing: 0,
            fontVariantNumeric: 'tabular-nums',
            opacity: 1,
          }}
        />
      </div>

      {/* Drawing Context Menu (Right-click on drawings) */}
      <DrawingContextMenu onClose={() => { }} />

      {/* One-Click Trading Panel (Alt+T to toggle) */}
      <OneClickTrading
        symbol={symbol}
        timeframe={timeframe}
        visible={showOneClick}
        tradeAllowed={tradeAllowed}
        marketStatus={marketStatus}
        minVolume={minVolume}
        maxVolume={maxVolume}
        volumeStep={volumeStep}
      />



      {/* ── MT5-Style Chart Right-Click Context Menu ── */}
      <ChartContextMenu
        visible={ctxMenu.visible}
        x={ctxMenu.x}
        y={ctxMenu.y}
        symbol={symbol}
        targetContextId={activeChartSourceId}
        currentChartType={localChartType}
        currentTimeframe={activeTimeframe}
        oneClickTrading={showOneClick}
        showGrid={chartSettings.showGrid}
        showVolumes={chartSettings.showTickVolumes || chartSettings.showRealVolumes}
        autoScroll={ctxAutoScroll}
        chartShift={ctxChartShift}
        showTradeLevels={ctxShowTradeLevels}
        showTradeHistory={ctxShowTradeHistory}
        showTradeHistoryLine={ctxShowTradeHistoryLine}
        showOHLC={chartSettings.showOHLC}
        onChangeChartType={handleCtxChartTypeChange}
        onChangeTimeframe={handleCtxTimeframeChange}
        onToggleOneClickTrading={toggleOneClickTrading}
        onToggleGrid={handleCtxToggleGrid}
        onToggleVolumes={handleCtxToggleVolumes}
        onToggleAutoScroll={handleCtxToggleAutoScroll}
        onToggleChartShift={handleCtxToggleChartShift}
        onToggleTradeLevels={handleCtxToggleTradeLevels}
        onToggleTradeHistory={handleCtxToggleTradeHistory}
        onToggleTradeHistoryLine={handleCtxToggleTradeHistoryLine}
        onToggleOHLC={handleCtxToggleOHLC}
        onOpenProperties={handleCtxOpenProperties}
        onSaveAsPicture={handleCtxSaveAsPicture}
        onPrintChart={() => {
          activateActiveChartSource(activeChartSourceId);
          window.dispatchEvent(new CustomEvent('printChart'));
        }}
        onRefresh={handleCtxRefresh}
        onZoomIn={handleCtxZoomIn}
        onZoomOut={handleCtxZoomOut}
        onAddIndicator={addLocalIndicator}
        onDeleteIndicators={handleCtxDeleteIndicators}
        onOpenNewOrder={handleCtxOpenNewOrder}
        onOpenDOM={handleCtxOpenDOM}
        onOpenTemplateDialog={handleOpenTemplateDialog}
        onClose={closeCtxMenu}
        currentIndicators={currentIndicators}
        currentDrawingTools={[]}
      />

      {/* Chart Template Dialog hosted here so it stays open when context menu closes */}
      <ChartTemplateDialog
        isOpen={templateDialogOpen}
        onClose={() => setTemplateDialogOpen(false)}
        mode={templateDialogMode}
        currentConfig={{
          chartType: localChartType,
          timeframe: timeframe,
          showGrid: chartSettings.showGrid,
          showVolumes: chartSettings.showTickVolumes || chartSettings.showRealVolumes,
          indicators: currentIndicators,
          drawingTools: [],
          colors: { background: '#0e0e12', grid: '#222226', candle: { up: '#00c896', down: '#ff4d4f', border: '#378658' }, volume: { up: '#00c896', down: '#ff4d4f' } }
        }}
        onLoadTemplate={handleLoadTemplate}
      />
    </div>
  );
};
