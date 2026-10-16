import { useUiTranslation } from '../../hooks/useUiTranslation';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getEffectiveChartColors,
  getPresetSchemeColors,
  useChartSettingsStore,
  type ChartProperties,
  type ColorScheme,
} from '../../store/useChartSettingsStore';
import { getChartGridLineColors } from '../../utils/chartGridStyle';
import { FINE_CHART_GRID_CELL_SIZE_PX, SQUARE_CHART_GRID_CELL_SIZE_PX } from '../../utils/squareChartGridPrimitive';
import type { ChartType } from '../../types/chart';
import { commandBus } from '../../services/commandBus';
import { isShortcutOwnedBy, shouldIgnoreShortcutEvent } from '../../services/keyboardShortcutManager';
import './chart-properties-dialog.css';

interface ChartPropertiesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  timeframe: string;
  currentChartType?: ChartType;
  onChartTypeChange?: (chartType: ChartType) => void;
  targetContextId?: string;
}

const showOptions = [
  { key: 'showTicker', label: 'Show ticker' },
  { key: 'showOHLC', label: 'Show OHLC' },
  { key: 'showQuickTradingButtons', label: 'Show quick trading buttons' },
  { key: 'showBidPriceLine', label: 'Show bid price line' },
  { key: 'showAskPriceLine', label: 'Show ask price line' },
  { key: 'showLastPriceLine', label: 'Show last price line' },
  { key: 'showPeriodSeparators', label: 'Show period separators' },
  { key: 'showGrid', label: 'Show grid' },
  { key: 'showTickVolumes', label: 'Show tick volumes' },
  { key: 'showRealVolumes', label: 'Show real volumes' },
  { key: 'showTradeLevels', label: 'Show trade levels' },
  { key: 'showTradeHistory', label: 'Show entry/close line' },
  { key: 'showTradeHistoryArrows', label: 'Show entry/close arrows' },
] as const satisfies ReadonlyArray<{
  key: keyof Pick<
    ChartProperties,
    | 'showTicker'
    | 'showOHLC'
    | 'showQuickTradingButtons'
    | 'showBidPriceLine'
    | 'showAskPriceLine'
    | 'showLastPriceLine'
    | 'showPeriodSeparators'
    | 'showGrid'
    | 'showTickVolumes'
    | 'showRealVolumes'
    | 'showTradeLevels'
    | 'showTradeHistory'
    | 'showTradeHistoryArrows'
  >;
  label: string;
}>;

const colorSchemeOptions = [
  'Green on Black',
  'Green and White',
  'Green and Blue',
  'Blue on Black',
  'Black on White',
  'Yellow on Black',
  'Custom',
] as const satisfies ReadonlyArray<ColorScheme>;

const darkColorSchemeOptionStyle: React.CSSProperties = {
  backgroundColor: '#2b2b2b',
  color: '#cccccc',
};

const getIsAdvancedUntitledLight = (): boolean => {
  if (typeof document === 'undefined') return false;
  const root = document.documentElement;
  return root.classList.contains('rtx-advanced-view') && root.classList.contains('rtx-skin-untitled-light');
};

const getGridPreviewImage = (
  colors: { vertical: string; horizontal: string },
  lineStyle: ChartProperties['gridLineStyle'],
  cellSize: { width: number; height: number },
  gridType: ChartProperties['gridType'],
): string => {
  const escapeAttribute = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const dashed = lineStyle !== 'solid';
  const lineOffset = 0.5;
  const dashedStroke = gridType === 'scale'
    ? ' stroke-width="1" stroke-dasharray="2 2"'
    : gridType === 'mt5'
      ? ' stroke-width="1" stroke-dasharray="3 3"'
      : ' stroke-width="0.75" stroke-dasharray="8 4"';
  const dash = dashed ? dashedStroke : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cellSize.width}" height="${cellSize.height}" fill="none"><path d="M${lineOffset} 0V${cellSize.height}" stroke="${escapeAttribute(colors.vertical)}"${dash}/><path d="M0 ${lineOffset}H${cellSize.width}" stroke="${escapeAttribute(colors.horizontal)}"${dash}/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};

export const ChartPropertiesDialog: React.FC<ChartPropertiesDialogProps> = ({
  isOpen,
  onClose,
  symbol,
  timeframe,
  currentChartType,
  onChartTypeChange,
  targetContextId,
}) => {
    const tr = useUiTranslation();
  const [activeTab, setActiveTab] = useState<'Common' | 'Show' | 'Colors'>('Common');
  const [isAdvancedUntitledLight, setIsAdvancedUntitledLight] = useState(getIsAdvancedUntitledLight);
  
  const {
    globalProperties,
    symbolProperties,
    updateSymbolColor,
    updateSymbolProperty,
    applySymbolPresetScheme,
    resetSymbolToDefaults,
  } = useChartSettingsStore();
  const state = symbolProperties[symbol] || globalProperties;
  const selectedChartType: ChartType = currentChartType ?? (
    state.chartType === 'Bar'
      ? 'bar'
      : state.chartType === 'Line'
        ? 'line'
        : state.chartType === 'Area'
          ? 'area'
          : 'candlestick'
  );
  const showState = symbolProperties[symbol] || globalProperties;
  const effectiveColors = getEffectiveChartColors(state, { isAdvancedUntitledLight });
  const previewBackground = effectiveColors.background || '#000000';
  const previewGridColors = getChartGridLineColors({
    background: previewBackground,
    grid: effectiveColors.grid,
    showGrid: showState.showGrid,
    lineStyle: showState.gridLineStyle,
    gridType: showState.gridType,
    colorScheme: state.colorScheme,
    preserveConfiguredColor: isAdvancedUntitledLight && state.colorScheme !== 'Custom',
  });
  const previewLabelBackground = previewBackground.toLowerCase() === '#ffffff'
    ? 'rgba(255, 255, 255, 0.82)'
    : 'rgba(0, 0, 0, 0.72)';
  const previewSquareCellSize = showState.gridType === 'mt5' ? FINE_CHART_GRID_CELL_SIZE_PX : SQUARE_CHART_GRID_CELL_SIZE_PX;
  const previewGridCellSize = showState.gridType === 'scale'
    ? { width: 128, height: 48 }
    : { width: previewSquareCellSize, height: previewSquareCellSize };
  const previewStyle = {
    backgroundColor: previewBackground,
    backgroundImage: getGridPreviewImage(previewGridColors, showState.gridLineStyle, previewGridCellSize, showState.gridType),
    backgroundSize: `${previewGridCellSize.width}px ${previewGridCellSize.height}px`,
    backgroundPosition: showState.gridType === 'mt5' ? 'left bottom' : 'left top',
    '--rtx-cp-preview-bg': previewBackground,
    '--rtx-cp-preview-text': effectiveColors.foreground,
    '--rtx-cp-preview-label-bg': previewLabelBackground,
  } as React.CSSProperties;
  const colorSchemeOptionStyle = isAdvancedUntitledLight ? undefined : darkColorSchemeOptionStyle;
  const initialPropertiesRef = useRef<ChartProperties | null>(null);
  const initialChartTypeRef = useRef<ChartType | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const current = useChartSettingsStore.getState();
    const source = symbol
      ? (current.symbolProperties[symbol] || current.globalProperties)
      : current.globalProperties;
    initialPropertiesRef.current = {
      ...source,
      colors: { ...source.colors },
    };
    initialChartTypeRef.current = currentChartType ?? (
      source.chartType === 'Bar'
        ? 'bar'
        : source.chartType === 'Line'
          ? 'line'
          : source.chartType === 'Area'
            ? 'area'
            : 'candlestick'
    );
  }, [isOpen, symbol]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;
    const syncSkinState = () => setIsAdvancedUntitledLight(getIsAdvancedUntitledLight());
    const observer = new MutationObserver(syncSkinState);

    syncSkinState();
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  }, []);

  const updateActiveChartProperty = <K extends keyof ChartProperties>(key: K, value: ChartProperties[K]) => {
    if (symbol) {
      updateSymbolProperty(symbol, key, value);
    } else {
      useChartSettingsStore.getState().updateGlobalProperty(key, value);
    }
  };

  const updateActiveGridType = (type: ChartProperties['gridType']) => {
    updateActiveChartProperty('gridType', type);
    if (type === 'mt5') updateActiveChartProperty('gridLineStyle', 'dashed');
  };

  const updateActiveChartType = (settingsType: ChartProperties['chartType'], runtimeType: ChartType) => {
    updateActiveChartProperty('chartType', settingsType);
    onChartTypeChange?.(runtimeType);
  };

  const updateChartShift = (enabled: boolean) => {
    updateActiveChartProperty('chartShift', enabled);
    commandBus.dispatch({
      type: 'SET_CHART_SHIFT',
      payload: { enabled, targetContextId },
    });
  };

  const updateChartAutoScroll = (enabled: boolean) => {
    updateActiveChartProperty('chartAutoScroll', enabled);
    commandBus.dispatch({
      type: 'SET_AUTO_SCROLL',
      payload: { enabled, targetContextId },
    });
  };

  const applyActivePresetScheme = (scheme: ColorScheme) => {
    if (symbol) {
      applySymbolPresetScheme(symbol, scheme);
      return;
    }

    const store = useChartSettingsStore.getState();
    store.updateGlobalProperty('colorScheme', scheme);
    store.updateGlobalProperty('colors', getPresetSchemeColors(scheme, store.globalProperties.colors));
  };

  const updateActiveChartColor = (key: keyof ChartProperties['colors'], value: string) => {
    if (symbol) {
      updateSymbolColor(symbol, key, value);
    } else {
      useChartSettingsStore.getState().updateGlobalColor(key, value);
    }
  };

  const resetActiveChartDefaults = () => {
    if (symbol) {
      resetSymbolToDefaults(symbol);
    } else {
      useChartSettingsStore.getState().resetToDefaults();
    }
  };

  const restoreInitialProperties = () => {
    const initialProperties = initialPropertiesRef.current;
    if (!initialProperties) return;

    useChartSettingsStore.setState((current) => symbol
      ? {
          symbolProperties: {
            ...current.symbolProperties,
            [symbol]: {
              ...initialProperties,
              colors: { ...initialProperties.colors },
            },
          },
        }
      : {
          globalProperties: {
            ...initialProperties,
            colors: { ...initialProperties.colors },
          },
        });

    const originalChartType = initialChartTypeRef.current;
    if (originalChartType) onChartTypeChange?.(originalChartType);
    commandBus.dispatch({
      type: 'SET_CHART_SHIFT',
      payload: { enabled: initialProperties.chartShift, targetContextId },
    });
    commandBus.dispatch({
      type: 'SET_AUTO_SCROLL',
      payload: { enabled: initialProperties.chartAutoScroll, targetContextId },
    });
  };

  const handleCancel = () => {
    restoreInitialProperties();
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();
    return () => {
      if (previousFocus?.isConnected && (document.activeElement === document.body || dialog?.contains(document.activeElement))) previousFocus.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || shouldIgnoreShortcutEvent(event) || !isShortcutOwnedBy(event, dialog)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [isOpen, symbol, targetContextId, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-auto rtx-cp-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chart-properties-title"
        className="rtx-cp-shell relative bg-[#1e1e1e] border border-[#333] rounded shadow-2xl flex flex-col pointer-events-auto select-none animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="rtx-cp-header flex items-center justify-between px-3 py-2 border-b border-[#333]">
          <span id="chart-properties-title" className="rtx-cp-title text-xs font-medium text-[#ccc]">{tr("Properties of ")}{symbol},{timeframe}</span>
          <div className="flex items-center gap-1">
            <button className="rtx-cp-btn-icon w-6 h-6 flex items-center justify-center hover:bg-white/10 rounded text-[#999] hover:text-white transition-colors">
              <span className="text-xs font-serif">?</span>
            </button>
            <button 
              onClick={onClose}
              aria-label={tr("Close chart properties")}
              className="rtx-cp-btn-icon rtx-cp-btn-close w-6 h-6 flex items-center justify-center hover:bg-rose-500/80 hover:text-white rounded text-[#999] transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M11 1L1 11M1 1L11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="rtx-cp-content flex flex-1 overflow-hidden p-3 gap-4 bg-[#1e1e1e]">
          
          {/* Settings apply live to the chart behind this dialog. */}
          <div className="rtx-cp-settings flex-1 flex flex-col pt-1 pr-1">
            <div className="rtx-cp-tabs flex gap-4 border-b border-transparent mb-1 pl-1" role="tablist" aria-label={tr('Chart properties')}>
              {(['Common', 'Show', 'Colors'] as const).map(tab => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  id={`chart-properties-tab-${tab}`}
                  aria-selected={activeTab === tab}
                  aria-controls="chart-properties-panel"
                  tabIndex={activeTab === tab ? 0 : -1}
                  onClick={() => setActiveTab(tab)}
                  onKeyDown={(event) => {
                    const tabs = ['Common', 'Show', 'Colors'] as const;
                    const index = tabs.indexOf(tab);
                    const nextIndex = event.key === 'ArrowRight' ? (index + 1) % tabs.length
                      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
                        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
                    if (nextIndex === null) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setActiveTab(tabs[nextIndex]);
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
                  }}
                  className={`rtx-cp-tab px-1 py-0.5 text-xs transition-colors ${activeTab === tab ? 'rtx-cp-tab-active text-blue-400 border-b-2 border-blue-400' : 'text-[#ccc] hover:text-white'}`}
                >
                  {tr(tab)}
                </button>
              ))}
            </div>

            <div className="rtx-cp-tab-content flex-1 overflow-y-auto pl-1 pr-2 custom-scrollbar" role="tabpanel" id="chart-properties-panel" aria-labelledby={`chart-properties-tab-${activeTab}`}>
              <div className="rtx-cp-preview-box" hidden={activeTab !== 'Colors'}>
                <div className="rtx-cp-preview-inner relative rounded-sm overflow-hidden" style={previewStyle}>
                  <span className="rtx-cp-preview-text absolute top-1 left-1 px-1" style={{ color: effectiveColors.foreground, backgroundColor: previewLabelBackground }}>
                    {tr('Background and grid preview')}
                  </span>
                </div>
              </div>
              {activeTab === 'Show' && (
                <div className="rtx-cp-show-grid grid grid-cols-1 gap-1.5 py-2">
                  {showOptions.map(({ key, label }) => (
                    <React.Fragment key={key}>
                      <label className="rtx-cp-checkbox-row flex items-center gap-2 cursor-pointer group hover:bg-white/5 px-2 py-0.5 -mx-2 rounded transition-colors">
                        <input
                          type="checkbox"
                          className="rtx-cp-checkbox accent-blue-500 bg-[#2b2b2b] border-[#444] cursor-pointer w-3.5 h-3.5"
                          checked={showState[key as keyof typeof showState] as boolean}
                          onChange={(e) => {
                            updateActiveChartProperty(key, e.target.checked);
                          }}
                        />
                        <span className="rtx-cp-checkbox-label text-[13px] text-[#ccc] group-hover:text-white transition-colors">{tr(label)}</span>
                      </label>
                      {key === 'showGrid' && (
                        <>
                          <label className="rtx-cp-label flex items-center gap-2 pl-[22px] py-0.5 text-[12px] text-[#ccc]">
                            <span>{tr('Grid type')}</span>
                            <select
                              value={showState.gridType}
                              disabled={!showState.showGrid}
                              onChange={(e) => updateActiveGridType(e.target.value as ChartProperties['gridType'])}
                              className="rtx-cp-select flex-1 min-w-0 bg-[#2b2b2b] border border-[#444] text-[12px] px-2 py-0.5 rounded text-[#ccc] outline-none focus:border-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <option value="square" style={colorSchemeOptionStyle}>{tr('Square')}</option>
                              <option value="scale" style={colorSchemeOptionStyle}>{tr('Price/time aligned')}</option>
                              <option value="mt5" style={colorSchemeOptionStyle}>{tr('Fine grid')}</option>
                            </select>
                          </label>
                          <label className="rtx-cp-label flex items-center gap-2 pl-[22px] py-0.5 text-[12px] text-[#ccc]">
                            <span>{tr('Grid line style')}</span>
                            <select
                              value={showState.gridLineStyle}
                              disabled={!showState.showGrid}
                              onChange={(e) => updateActiveChartProperty('gridLineStyle', e.target.value as ChartProperties['gridLineStyle'])}
                              className="rtx-cp-select flex-1 min-w-0 bg-[#2b2b2b] border border-[#444] text-[12px] px-2 py-0.5 rounded text-[#ccc] outline-none focus:border-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <option value="dashed" style={colorSchemeOptionStyle}>{tr('Dashed')}</option>
                              <option value="solid" style={colorSchemeOptionStyle}>{tr('Solid')}</option>
                            </select>
                          </label>
                        </>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              )}

              {activeTab === 'Colors' && (
                <div className="rtx-cp-colors-grid grid grid-cols-[100px_1fr] items-center gap-y-[5px] gap-x-2 py-2">
                  <span className="rtx-cp-label text-[12px] text-[#ccc] text-right">{tr("Scheme:")}</span>
                  <select 
                    value={state.colorScheme}
                    onChange={(e) => applyActivePresetScheme(e.target.value as ColorScheme)}
                    className="rtx-cp-select bg-[#2b2b2b] border border-[#444] text-[12px] px-2 py-0.5 rounded w-full text-[#ccc] outline-none focus:border-blue-500 transition-colors col-span-1"
                  >
                    {colorSchemeOptions.map((scheme) => (
                      <option key={tr(scheme)} value={tr(scheme)} style={colorSchemeOptionStyle}>
                        {tr(scheme)}
                      </option>
                    ))}
                  </select>

                  <div className="rtx-cp-divider col-span-2 h-[1px] bg-[#333] my-1"></div>

                  {[
                    { label: 'Background', key: 'background' },
                    { label: 'Foreground', key: 'foreground' },
                    { label: 'Grid', key: 'grid' },
                    { label: 'Bar up', key: 'barUp' },
                    { label: 'Bar down', key: 'barDown' },
                    { label: 'Bull candle', key: 'bullCandle' },
                    { label: 'Bear candle', key: 'bearCandle' },
                    { label: 'Line chart', key: 'lineChart' },
                    { label: 'Volumes', key: 'volumes' },
                    { label: 'Bid price line', key: 'bidPriceLine' },
                    { label: 'Ask price line', key: 'askPriceLine' },
                    { label: 'Last price line', key: 'lastPriceLine' },
                    { label: 'Stop levels', key: 'stopLevels' },
                  ].map(c => {
                    const colorVal = effectiveColors[c.key as keyof typeof effectiveColors];
                    const isRgba = typeof colorVal === 'string' && colorVal.startsWith('rgba');
                    
                    return (
                      <React.Fragment key={c.label}>
                        <span className="rtx-cp-label text-[12px] text-[#ccc] text-right">{tr(c.label)}:</span>
                        <label className="rtx-cp-color-picker flex items-center gap-2 bg-[#2b2b2b] border border-[#444] rounded px-1.5 py-[2px] cursor-pointer hover:border-[#666] transition-colors relative">
                          <input 
                            type="color" 
                            aria-label={tr(c.label)}
                            value={isRgba ? '#ffffff' : colorVal} 
                            onChange={(e) => updateActiveChartColor(c.key as keyof ChartProperties['colors'], e.target.value)}
                            className="absolute opacity-0 w-0 h-0" 
                          />
                          <div className="w-3.5 h-3.5 rounded-sm border border-[#222] shadow-sm flex-shrink-0" style={{ backgroundColor: colorVal }}></div>
                          <span className="rtx-cp-color-text text-[12px] text-[#ccc] w-full truncate">{colorVal}</span>
                          <svg width="8" height="5" viewBox="0 0 10 6" fill="none" className="ml-0.5 text-[#666] flex-shrink-0">
                            <path d="M1 1L5 5L9 1" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </label>
                      </React.Fragment>
                    )
                  })}
                </div>
              )}

              {activeTab === 'Common' && (
                <div className="rtx-cp-common-grid flex gap-2 pt-1 pr-1">
                  <div className="flex flex-col gap-2 flex-1">
                    <div className="rtx-cp-fieldset flex flex-col gap-[3px] p-2 border border-[#444] bg-transparent rounded-sm relative mt-2">
                      <label className="rtx-cp-radio-row flex items-center gap-2 cursor-pointer">
                         <input type="radio" name="chartType" className="rtx-cp-radio accent-blue-500 bg-[#2b2b2b]" checked={selectedChartType === 'bar'} onChange={() => updateActiveChartType('Bar', 'bar')} />
                         <span className="rtx-cp-radio-label text-[12px] text-[#ccc]">{tr("Bar chart")}</span>
                      </label>
                      <label className="rtx-cp-radio-row flex items-center gap-2 cursor-pointer">
                         <input type="radio" name="chartType" className="rtx-cp-radio accent-blue-500 bg-[#2b2b2b]" checked={selectedChartType === 'candlestick'} onChange={() => updateActiveChartType('Candlesticks', 'candlestick')} />
                         <span className="rtx-cp-radio-label text-[12px] text-[#ccc]">{tr("Candlesticks")}</span>
                      </label>
                      <label className="rtx-cp-radio-row flex items-center gap-2 cursor-pointer">
                         <input type="radio" name="chartType" className="rtx-cp-radio accent-blue-500 bg-[#2b2b2b]" checked={selectedChartType === 'line'} onChange={() => updateActiveChartType('Line', 'line')} />
                         <span className="rtx-cp-radio-label text-[12px] text-[#ccc]">{tr("Line chart")}</span>
                      </label>
                      <label className="rtx-cp-radio-row flex items-center gap-2 cursor-pointer">
                         <input type="radio" name="chartType" className="rtx-cp-radio accent-blue-500 bg-[#2b2b2b]" checked={selectedChartType === 'area'} onChange={() => updateActiveChartType('Area', 'area')} />
                         <span className="rtx-cp-radio-label text-[12px] text-[#ccc]">{tr("Area chart")}</span>
                      </label>
                    </div>
                    <div className="rtx-cp-fieldset flex flex-col gap-[3px] p-2 py-3 border border-[#444] bg-transparent rounded-sm mt-1">
                       <label className="rtx-cp-checkbox-row flex items-center gap-2 cursor-pointer">
                         <input type="checkbox" className="rtx-cp-checkbox accent-blue-500 bg-[#2b2b2b] border-[#444]" checked={state.chartOnForeground} onChange={(e) => updateActiveChartProperty('chartOnForeground', e.target.checked)} />
                         <span className="rtx-cp-checkbox-label text-[12px] text-[#ccc]">{tr("Chart on foreground")}</span>
                      </label>
                      <label className="rtx-cp-checkbox-row flex items-center gap-2 cursor-pointer">
                         <input type="checkbox" className="rtx-cp-checkbox accent-blue-500 bg-[#2b2b2b] border-[#444]" checked={state.chartShift} onChange={(e) => updateChartShift(e.target.checked)} />
                         <span className="rtx-cp-checkbox-label text-[12px] text-[#ccc]">{tr("Chart shift")}</span>
                      </label>
                      <label className="rtx-cp-checkbox-row flex items-center gap-2 cursor-pointer">
                         <input type="checkbox" className="rtx-cp-checkbox accent-blue-500 bg-[#2b2b2b] border-[#444]" checked={state.chartAutoScroll} onChange={(e) => updateChartAutoScroll(e.target.checked)} />
                         <span className="rtx-cp-checkbox-label text-[12px] text-[#ccc]">{tr("Chart auto scroll")}</span>
                      </label>
                    </div>
                  </div>
                  
                  <div className="rtx-cp-fieldset flex flex-col gap-2 flex-[1.2] border border-[#444] bg-transparent rounded p-3 pt-4 relative mt-2">
                     <span className="rtx-cp-legend absolute -top-[7px] left-3 bg-[#1e1e1e] px-1 text-[11px] font-medium text-[#ccc]">{tr("Scale")}</span>
                     <label className="rtx-cp-checkbox-row flex items-center gap-2 cursor-pointer mt-0">
                        <input type="checkbox" className="rtx-cp-checkbox accent-blue-500 bg-[#2b2b2b] border-[#444]" checked={state.scaleFixOneToOne} onChange={(e) => updateActiveChartProperty('scaleFixOneToOne', e.target.checked)} />
                       <span className="rtx-cp-checkbox-label text-[12px] text-[#ccc]">{tr("Scale fix one to one")}</span>
                     </label>
                     <label className="rtx-cp-checkbox-row flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" className="rtx-cp-checkbox accent-blue-500 bg-[#2b2b2b] border-[#444]" checked={state.scaleFix} onChange={(e) => updateActiveChartProperty('scaleFix', e.target.checked)} />
                       <span className="rtx-cp-checkbox-label text-[12px] text-[#ccc]">{tr("Scale fix")}</span>
                     </label>
                     
                     <div className={`flex flex-col gap-[6px] pl-[26px] mt-1 transition-opacity ${!state.scaleFix ? 'opacity-30 pointer-events-none' : ''}`}>
                       <div className="flex items-center gap-2">
                          <input type="number" value={state.fixedMaximum} onChange={(e) => updateActiveChartProperty('fixedMaximum', Number(e.target.value))} className="rtx-cp-input w-[80px] bg-[#2b2b2b] border border-[#444] rounded-sm px-1.5 py-[1px] text-[12px] text-[#ccc] focus:outline-none focus:border-blue-500 transition-colors" />
                         <span className="rtx-cp-label text-[12px] text-[#ccc]">{tr("Fixed maximum")}</span>
                       </div>
                       <div className="flex items-center gap-2">
                          <input type="number" value={state.fixedMinimum} onChange={(e) => updateActiveChartProperty('fixedMinimum', Number(e.target.value))} className="rtx-cp-input w-[80px] bg-[#2b2b2b] border border-[#444] rounded-sm px-1.5 py-[1px] text-[12px] text-[#ccc] focus:outline-none focus:border-blue-500 transition-colors" />
                         <span className="rtx-cp-label text-[12px] text-[#ccc]">{tr("Fixed minimum")}</span>
                       </div>
                     </div>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Footer Buttons */}
        <div className="rtx-cp-footer flex items-center justify-between px-3 py-2 border-t border-[#333] rounded-b-lg">
          <button 
            onClick={resetActiveChartDefaults}
            className="rtx-cp-btn px-4 py-1 text-xs bg-[#2b2b2b] hover:bg-rose-500/20 border border-[#444] hover:border-rose-500/50 text-[#ccc] hover:text-rose-400 rounded-sm transition-colors"
          >
            {tr("Reset to Defaults")}</button>
          <div className="flex gap-2">
            <button 
              onClick={handleCancel}
              className="rtx-cp-btn px-6 py-1 text-xs bg-[#2b2b2b] hover:bg-[#333] bg-opacity-80 border border-[#444] hover:border-[#666] text-[#ccc] hover:text-white rounded-sm transition-colors"
            >
              {tr("Cancel")}</button>
            <button 
              onClick={onClose}
              className="rtx-cp-btn rtx-cp-btn-primary px-7 py-1 text-xs bg-[#2b2b2b] hover:bg-[#333] bg-opacity-80 border border-[#444] hover:border-[#666] text-[#ccc] hover:text-white rounded-sm transition-colors"
            >
              {tr("OK")}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
