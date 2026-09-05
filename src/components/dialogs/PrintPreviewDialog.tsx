/**
 * Print Preview Dialog
 * Shows a preview of the chart before printing with zoom and navigation controls
 */

import { Icon } from '../ui/Icon';
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { chartPrinter, type PrintPreferences, type ChartPrintData } from '../../services/chartPrinter';

export interface PrintPreviewDialogProps {
  onClose: () => void;
  /** Owns the actual print operation. Called exactly once for each confirmed print. */
  onPrint: () => void | Promise<void>;
  chartData?: ChartPrintData;
  preferences?: PrintPreferences;
}

export const PrintPreviewDialog: React.FC<PrintPreviewDialogProps> = ({
  onClose,
  onPrint,
  chartData: providedChartData,
  preferences: providedPreferences,
}) => {
  const [zoom, setZoom] = useState(100);
  const [isPrinting, setIsPrinting] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewHTML, setPreviewHTML] = useState('');
  const [chartData, setChartData] = useState<ChartPrintData | null>(null);
  const [preferences, setPreferences] = useState<PrintPreferences>(chartPrinter.getPreferences());

  // Generate chart data if not provided
  useEffect(() => {
    if (providedChartData) {
      setChartData(providedChartData);
    } else {
      // Generate default chart data
      const defaultData: ChartPrintData = {
        symbol: 'BTCUSD',
        timeframe: '1m',
        dateRange: {
          from: new Date(Date.now() - 24 * 60 * 60 * 1000),
          to: new Date(),
        },
        indicators: [],
        drawings: [],
      };
      setChartData(defaultData);
    }

    if (providedPreferences) {
      setPreferences(providedPreferences);
    }
  }, [providedChartData, providedPreferences]);

  // Generate preview HTML when chart data or preferences change
  useEffect(() => {
    if (chartData) {
      const html = chartPrinter.generatePrintableHTML(chartData, preferences);
      setPreviewHTML(html);
    }
  }, [chartData, preferences]);

  if (!chartData) return null;

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 25, 200));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 25, 50));
  };

  const handleZoomReset = () => {
    setZoom(100);
  };

  const handlePrint = async () => {
    if (!chartData) return;

    setIsPrinting(true);
    try {
      await onPrint();
      onClose();
    } catch (error) {
      console.error('Print failed:', error);
    } finally {
      setIsPrinting(false);
    }
  };

  return createPortal(
        <div 
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]" 
            onClick={(e) => {
                e.stopPropagation();
                if (e.target === e.currentTarget) onClose();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
        >
            <div
                className="bg-[#131316] [.rtx-advanced-view_&]:bg-white border border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 rounded-lg shadow-2xl w-[90vw] h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 bg-[#252528] [.rtx-advanced-view_&]:bg-gray-50">
                    <div className="flex items-center gap-2">
                        <Icon name="print" size="md" className="text-blue-400 [.rtx-advanced-view_&]:text-indigo-600" />
                        <h2 className="text-sm font-semibold text-zinc-100 [.rtx-advanced-view_&]:text-gray-900">Print Preview</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-zinc-400 hover:text-zinc-100 [.rtx-advanced-view_&]:text-gray-500 [.rtx-advanced-view_&]:hover:text-gray-900 transition-colors p-1 hover:bg-zinc-700/50 [.rtx-advanced-view_&]:hover:bg-gray-200 rounded"
                        aria-label="Close"
                    >
                        <Icon name="x-close" size="md" />
                    </button>
                </div>

                {/* Toolbar */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 bg-[#252528] [.rtx-advanced-view_&]:bg-gray-50">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleZoomOut}
                            disabled={zoom <= 50}
                            className="p-1.5 text-zinc-300 [.rtx-advanced-view_&]:text-gray-600 hover:text-zinc-100 [.rtx-advanced-view_&]:hover:text-gray-900 hover:bg-zinc-700/50 [.rtx-advanced-view_&]:hover:bg-gray-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Zoom Out"
                        >
                            <Icon name="zoom-out" size="md" />
                        </button>
                        <button
                            onClick={handleZoomReset}
                            className="text-xs text-zinc-400 [.rtx-advanced-view_&]:text-gray-600 hover:text-zinc-100 [.rtx-advanced-view_&]:hover:text-gray-900 transition-colors min-w-[50px] text-center"
                        >
                            {zoom}%
                        </button>
                        <button
                            onClick={handleZoomIn}
                            disabled={zoom >= 200}
                            className="p-1.5 text-zinc-300 [.rtx-advanced-view_&]:text-gray-600 hover:text-zinc-100 [.rtx-advanced-view_&]:hover:text-gray-900 hover:bg-zinc-700/50 [.rtx-advanced-view_&]:hover:bg-gray-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Zoom In"
                        >
                            <Icon name="zoom-in" size="md" />
                        </button>
                    </div>
                </div>

                {/* Preview Area */}
                <div className="flex-1 p-8 overflow-auto bg-zinc-900 [.rtx-advanced-view_&]:bg-gray-100">
                    <div
                        ref={previewRef}
                        className="mx-auto shadow-2xl"
                        style={{
                            transform: `scale(${zoom / 100})`,
                            transformOrigin: 'top center',
                            transition: 'transform 0.2s ease',
                        }}
                    >
                        {/* Preview iframe */}
                        <div className="bg-white shadow-lg [.rtx-advanced-view_&]:shadow-md border border-transparent [.rtx-advanced-view_&]:border-gray-300">
                            <iframe
                                srcDoc={previewHTML}
                                className="w-full border-0"
                                style={{
                                    width: preferences.orientation === 'landscape' ? '1123px' : '794px',
                                    height: preferences.orientation === 'landscape' ? '794px' : '1123px',
                                }}
                                title="Print Preview"
                            />
                        </div>
                    </div>
                </div>

                {/* Footer Info */}
                <div className="px-6 py-3 bg-[#2a2a2a] [.rtx-advanced-view_&]:bg-gray-100 border-t border-zinc-700 [.rtx-advanced-view_&]:border-gray-200">
                    <div className="flex items-center justify-between text-xs text-zinc-400 [.rtx-advanced-view_&]:text-gray-600">
                        <div className="flex items-center space-x-6">
                            <span>
                                <span className="font-semibold text-zinc-300 [.rtx-advanced-view_&]:text-gray-700">Symbol:</span> {chartData.symbol}
                            </span>
                            <span>
                                <span className="font-semibold text-zinc-300 [.rtx-advanced-view_&]:text-gray-700">Timeframe:</span> {chartData.timeframe}
                            </span>
                            <span>
                                <span className="font-semibold text-zinc-300 [.rtx-advanced-view_&]:text-gray-700">Page:</span> {preferences.pageSize} {preferences.orientation}
                            </span>
                        </div>
                        <div>
                            {chartData.indicators.length > 0 && (
                                <span className="mr-4">
                                    {chartData.indicators.length} indicator{chartData.indicators.length !== 1 ? 's' : ''}
                                </span>
                            )}
                            {chartData.drawings.length > 0 && (
                                <span>
                                    {chartData.drawings.length} drawing{chartData.drawings.length !== 1 ? 's' : ''}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 bg-[#252528] [.rtx-advanced-view_&]:bg-gray-50">
                    <div className="text-xs text-zinc-400 [.rtx-advanced-view_&]:text-gray-500">
                        <p>Review your chart before printing.</p>
                        <p className="mt-1">The preview may differ slightly from the actual print output.</p>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-1.5 text-xs text-zinc-300 [.rtx-advanced-view_&]:text-gray-600 hover:text-zinc-100 [.rtx-advanced-view_&]:hover:text-gray-900 hover:bg-zinc-700/50 [.rtx-advanced-view_&]:hover:bg-gray-200 rounded transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handlePrint}
                            disabled={isPrinting}
                            className="px-4 py-1.5 text-xs bg-zinc-700 [.rtx-advanced-view_&]:bg-indigo-600 hover:bg-zinc-600 [.rtx-advanced-view_&]:hover:bg-indigo-700 text-white rounded transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isPrinting ? (
                                <>
                                    <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    <span>Printing...</span>
                                </>
                            ) : (
                                <>
                                    <Icon name="print" size="xs" />
                                    <span>Print</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

