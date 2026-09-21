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
import { SQUARE_CHART_GRID_CELL_SIZE_PX } from '../../utils/squareChartGridPrimitive';
import type { ChartType } from '../TradingChart';
import { commandBus } from '../../services/commandBus';
import { isShortcutOwnedBy, shouldIgnoreShortcutEvent } from '../../services/keyboardShortcutManager';

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
    | 'showTradeHistoryArrows'
  >;
  label: string;
}>;

const colorSchemeOptions = [
  'Green on Black',
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
    preserveConfiguredColor: isAdvancedUntitledLight && state.colorScheme !== 'Custom',
  });
  const previewLabelBackground = previewBackground.toLowerCase() === '#ffffff'
    ? 'rgba(255, 255, 255, 0.82)'
    : 'rgba(0, 0, 0, 0.72)';
  const previewStyle = {
    backgroundColor: previewBackground,
    backgroundImage: `linear-gradient(to right, ${previewGridColors.vertical} 1px, transparent 1px), linear-gradient(to bottom, ${previewGridColors.horizontal} 1px, transparent 1px)`,
    backgroundSize: `${SQUARE_CHART_GRID_CELL_SIZE_PX}px ${SQUARE_CHART_GRID_CELL_SIZE_PX}px`,
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
        style={{ width: 680, height: 420 }}
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
          
          {/* Left Preview Box */}
          <div className="rtx-cp-preview-box w-[310px] border border-[#444] bg-black rounded flex flex-col p-1 pl-0">
            <div
              className="rtx-cp-preview-inner flex-1 border border-[#333] relative m-1 rounded-sm overflow-hidden bg-black"
              style={previewStyle}
            >
              <span className="rtx-cp-preview-text absolute top-1 left-1 text-[10px] text-zinc-400 font-mono z-10 bg-black/60 px-1">
                {symbol},{timeframe}{tr(": Demo Asset")}</span>
            </div>
          </div>

          {/* Right Tabs Area */}
          <div className="flex-1 flex flex-col pt-1 pr-1">
            <div className="rtx-cp-tabs flex gap-4 border-b border-transparent mb-1 pl-1">
              {(['Common', 'Show', 'Colors'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`rtx-cp-tab px-1 py-0.5 text-xs transition-colors ${activeTab === tab ? 'rtx-cp-tab-active text-blue-400 border-b-2 border-blue-400' : 'text-[#ccc] hover:text-white'}`}
                >
                  {tr(tab)}
                </button>
              ))}
            </div>

            <div className="rtx-cp-tab-content flex-1 overflow-y-auto pl-1 pr-2 custom-scrollbar">
              {activeTab === 'Show' && (
                <div className="grid grid-cols-1 gap-1.5 py-2">
                  {showOptions.map(({ key, label }) => (
                    <label key={key} className="rtx-cp-checkbox-row flex items-center gap-2 cursor-pointer group hover:bg-white/5 px-2 py-0.5 -mx-2 rounded transition-colors">
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
                  ))}
                </div>
              )}

              {activeTab === 'Colors' && (
                <div className="grid grid-cols-[100px_1fr] items-center gap-y-[5px] gap-x-2 py-2">
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
                <div className="flex gap-2 h-full pt-1 pr-1 custom-scrollbar">
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
