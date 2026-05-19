import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useChartSettingsStore, ColorScheme } from '../../store/useChartSettingsStore';

interface ChartPropertiesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  timeframe: string;
}

export const ChartPropertiesDialog: React.FC<ChartPropertiesDialogProps> = ({ isOpen, onClose, symbol, timeframe }) => {
  const [activeTab, setActiveTab] = useState<'Common' | 'Show' | 'Colors'>('Common');
  
  const { globalProperties, updateGlobalProperty, updateGlobalColor, applyPresetScheme } = useChartSettingsStore();
  const state = globalProperties;

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
        className="rtx-cp-shell relative bg-[#1e1e1e] border border-[#333] rounded shadow-2xl flex flex-col pointer-events-auto select-none animate-in fade-in zoom-in-95 duration-150"
        style={{ width: 680, height: 420 }}
      >
        {/* Header */}
        <div className="rtx-cp-header flex items-center justify-between px-3 py-2 border-b border-[#333]">
          <span className="rtx-cp-title text-xs font-medium text-[#ccc]">Properties of {symbol},{timeframe}</span>
          <div className="flex items-center gap-1">
            <button className="rtx-cp-btn-icon w-6 h-6 flex items-center justify-center hover:bg-white/10 rounded text-[#999] hover:text-white transition-colors">
              <span className="text-xs font-serif">?</span>
            </button>
            <button 
              onClick={onClose}
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
            <div className="rtx-cp-preview-inner flex-1 border border-[#333] relative m-1 rounded-sm overflow-hidden bg-black">
              <span className="rtx-cp-preview-text absolute top-1 left-1 text-[10px] text-zinc-400 font-mono z-10 bg-black/60 px-1">
                {symbol},{timeframe}: Demo Asset
              </span>
              <div className="absolute inset-0 flex items-end opacity-40 mix-blend-screen pointer-events-none">
                {/* Mock chart grid and candles to make it look like the preview in the screenshot */}
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="rtx-cp-preview-grid flex-1 h-full border-r border-[#333] border-dashed"></div>
                ))}
              </div>
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
                  {tab}
                </button>
              ))}
            </div>

            <div className="rtx-cp-tab-content flex-1 overflow-y-auto pl-1 pr-2 custom-scrollbar">
              {activeTab === 'Show' && (
                <div className="grid grid-cols-1 gap-1.5 py-2">
                  {[
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
                    { key: 'showObjectDescriptions', label: 'Show object descriptions' },
                    { key: 'showTradeLevels', label: 'Show trade levels' },
                    { key: 'showTradeHistory', label: 'Show trade history' },
                  ].map(({ key, label }) => (
                    <label key={key} className="rtx-cp-checkbox-row flex items-center gap-2 cursor-pointer group hover:bg-white/5 px-2 py-0.5 -mx-2 rounded transition-colors">
                      <input 
                        type="checkbox" 
                        className="rtx-cp-checkbox accent-blue-500 bg-[#2b2b2b] border-[#444] cursor-pointer w-3.5 h-3.5" 
                        checked={state[key as keyof typeof state] as boolean}
                        onChange={(e) => {
                          updateGlobalProperty(key as any, e.target.checked);
                        }}
                      />
                      <span className="rtx-cp-checkbox-label text-[13px] text-[#ccc] group-hover:text-white transition-colors">{label}</span>
                    </label>
                  ))}
                </div>
              )}

              {activeTab === 'Colors' && (
                <div className="grid grid-cols-[100px_1fr] items-center gap-y-[5px] gap-x-2 py-2">
                  <span className="rtx-cp-label text-[12px] text-[#ccc] text-right">Scheme:</span>
                  <select 
                    value={state.colorScheme}
                    onChange={(e) => applyPresetScheme(e.target.value as ColorScheme)}
                    className="rtx-cp-select bg-[#2b2b2b] border border-[#444] text-[12px] px-2 py-0.5 rounded w-full text-[#ccc] outline-none focus:border-blue-500 transition-colors col-span-1"
                  >
                    <option value="Green on Black">Green on Black</option>
                    <option value="Black on White">Black on White</option>
                    <option value="Yellow on Black">Yellow on Black</option>
                    <option value="Custom">Custom</option>
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
                    const colorVal = state.colors[c.key as keyof typeof state.colors];
                    const isRgba = typeof colorVal === 'string' && colorVal.startsWith('rgba');
                    
                    return (
                      <React.Fragment key={c.label}>
                        <span className="rtx-cp-label text-[12px] text-[#ccc] text-right">{c.label}:</span>
                        <label className="rtx-cp-color-picker flex items-center gap-2 bg-[#2b2b2b] border border-[#444] rounded px-1.5 py-[2px] cursor-pointer hover:border-[#666] transition-colors relative">
                          <input 
                            type="color" 
                            value={isRgba ? '#ffffff' : colorVal} 
                            onChange={(e) => updateGlobalColor(c.key as any, e.target.value)}
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
                         <input type="radio" name="chartType" className="rtx-cp-radio accent-blue-500 bg-[#2b2b2b]" checked={state.chartType === 'Bar'} onChange={() => updateGlobalProperty('chartType', 'Bar')} />
                         <span className="rtx-cp-radio-label text-[12px] text-[#ccc]">Bar chart</span>
                      </label>
                      <label className="rtx-cp-radio-row flex items-center gap-2 cursor-pointer">
                         <input type="radio" name="chartType" className="rtx-cp-radio accent-blue-500 bg-[#2b2b2b]" checked={state.chartType === 'Candlesticks'} onChange={() => updateGlobalProperty('chartType', 'Candlesticks')} />
                         <span className="rtx-cp-radio-label text-[12px] text-[#ccc]">Candlesticks</span>
                      </label>
                      <label className="rtx-cp-radio-row flex items-center gap-2 cursor-pointer">
                         <input type="radio" name="chartType" className="rtx-cp-radio accent-blue-500 bg-[#2b2b2b]" checked={state.chartType === 'Line'} onChange={() => updateGlobalProperty('chartType', 'Line')} />
                         <span className="rtx-cp-radio-label text-[12px] text-[#ccc]">Line chart</span>
                      </label>
                    </div>
                    <div className="rtx-cp-fieldset flex flex-col gap-[3px] p-2 py-3 border border-[#444] bg-transparent rounded-sm mt-1">
                       <label className="rtx-cp-checkbox-row flex items-center gap-2 cursor-pointer">
                         <input type="checkbox" className="rtx-cp-checkbox accent-blue-500 bg-[#2b2b2b] border-[#444]" checked={state.chartOnForeground} onChange={(e) => updateGlobalProperty('chartOnForeground', e.target.checked)} />
                         <span className="rtx-cp-checkbox-label text-[12px] text-[#ccc]">Chart on foreground</span>
                      </label>
                      <label className="rtx-cp-checkbox-row flex items-center gap-2 cursor-pointer">
                         <input type="checkbox" className="rtx-cp-checkbox accent-blue-500 bg-[#2b2b2b] border-[#444]" checked={state.chartShift} onChange={(e) => updateGlobalProperty('chartShift', e.target.checked)} />
                         <span className="rtx-cp-checkbox-label text-[12px] text-[#ccc]">Chart shift</span>
                      </label>
                      <label className="rtx-cp-checkbox-row flex items-center gap-2 cursor-pointer">
                         <input type="checkbox" className="rtx-cp-checkbox accent-blue-500 bg-[#2b2b2b] border-[#444]" checked={state.chartAutoScroll} onChange={(e) => updateGlobalProperty('chartAutoScroll', e.target.checked)} />
                         <span className="rtx-cp-checkbox-label text-[12px] text-[#ccc]">Chart auto scroll</span>
                      </label>
                    </div>
                  </div>
                  
                  <div className="rtx-cp-fieldset flex flex-col gap-2 flex-[1.2] border border-[#444] bg-transparent rounded p-3 pt-4 relative mt-2">
                     <span className="rtx-cp-legend absolute -top-[7px] left-3 bg-[#1e1e1e] px-1 text-[11px] font-medium text-[#ccc]">Scale</span>
                     <label className="rtx-cp-checkbox-row flex items-center gap-2 cursor-pointer mt-0">
                       <input type="checkbox" className="rtx-cp-checkbox accent-blue-500 bg-[#2b2b2b] border-[#444]" checked={state.scaleFixOneToOne} onChange={(e) => updateGlobalProperty('scaleFixOneToOne', e.target.checked)} />
                       <span className="rtx-cp-checkbox-label text-[12px] text-[#ccc]">Scale fix one to one</span>
                     </label>
                     <label className="rtx-cp-checkbox-row flex items-center gap-2 cursor-pointer">
                       <input type="checkbox" className="rtx-cp-checkbox accent-blue-500 bg-[#2b2b2b] border-[#444]" checked={state.scaleFix} onChange={(e) => updateGlobalProperty('scaleFix', e.target.checked)} />
                       <span className="rtx-cp-checkbox-label text-[12px] text-[#ccc]">Scale fix</span>
                     </label>
                     
                     <div className={`flex flex-col gap-[6px] pl-[26px] mt-1 transition-opacity ${!state.scaleFix ? 'opacity-30 pointer-events-none' : ''}`}>
                       <div className="flex items-center gap-2">
                         <input type="number" value={state.fixedMaximum} onChange={(e) => updateGlobalProperty('fixedMaximum', Number(e.target.value))} className="rtx-cp-input w-[80px] bg-[#2b2b2b] border border-[#444] rounded-sm px-1.5 py-[1px] text-[12px] text-[#ccc] focus:outline-none focus:border-blue-500 transition-colors" />
                         <span className="rtx-cp-label text-[12px] text-[#ccc]">Fixed maximum</span>
                       </div>
                       <div className="flex items-center gap-2">
                         <input type="number" value={state.fixedMinimum} onChange={(e) => updateGlobalProperty('fixedMinimum', Number(e.target.value))} className="rtx-cp-input w-[80px] bg-[#2b2b2b] border border-[#444] rounded-sm px-1.5 py-[1px] text-[12px] text-[#ccc] focus:outline-none focus:border-blue-500 transition-colors" />
                         <span className="rtx-cp-label text-[12px] text-[#ccc]">Fixed minimum</span>
                       </div>
                     </div>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Footer Buttons */}
        <div className="rtx-cp-footer flex justify-end gap-2 px-3 py-2 border-t border-[#333] rounded-b-lg">
          <button 
            onClick={onClose}
            className="rtx-cp-btn px-6 py-1 text-xs bg-[#2b2b2b] hover:bg-[#333] bg-opacity-80 border border-[#444] hover:border-[#666] text-[#ccc] hover:text-white rounded-sm transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={onClose}
            className="rtx-cp-btn rtx-cp-btn-primary px-7 py-1 text-xs bg-[#2b2b2b] hover:bg-[#333] bg-opacity-80 border border-[#444] hover:border-[#666] text-[#ccc] hover:text-white rounded-sm transition-colors"
          >
            OK
          </button>
          <button 
            className="rtx-cp-btn px-5 py-1 text-xs bg-[#2b2b2b] border border-[#444] text-[#888] rounded-sm ml-1"
            disabled
          >
            Help
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
