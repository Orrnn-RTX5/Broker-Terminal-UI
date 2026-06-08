import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui/Icon';
import { ChartExporter, type ChartExportOptions } from '../../services/chartExporter';

export interface SavePictureDialogProps {
  isOpen: boolean;
  onClose: () => void;
  chartCanvas?: HTMLCanvasElement | null;
  chartContainer?: HTMLElement | null;
  symbol: string;
  timeframe: string;
}

type ImageFormat = ChartExportOptions['format'];

export const SavePictureDialog: React.FC<SavePictureDialogProps> = ({
  isOpen,
  onClose,
  chartCanvas,
  chartContainer,
  symbol,
  timeframe,
}) => {
  const [format, setFormat] = useState<ImageFormat>('png');
  const [quality, setQuality] = useState(0.92);
  const [scale, setScale] = useState(1);
  const [includeSymbolInfo, setIncludeSymbolInfo] = useState(true);
  const [includeTimestamp, setIncludeTimestamp] = useState(true);
  const [includeWatermark, setIncludeWatermark] = useState(false);
  const [watermarkText, setWatermarkText] = useState('Trading Engine');
  const [preview, setPreview] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    setError(null);
    setIsExporting(false);
    setPreview(chartCanvas ? ChartExporter.getPreview(chartCanvas, 300, 200) : '');
  }, [chartCanvas, isOpen]);

  if (!isOpen) return null;

  const exportOptions: Partial<ChartExportOptions> = {
    format,
    quality,
    scale,
    exportArea: 'visible',
    includeWatermark,
    watermarkText: includeWatermark ? watermarkText : undefined,
    includeTimestamp,
    includeSymbolInfo,
  };

  const handleSave = async () => {
    setError(null);

    if (!chartCanvas && !chartContainer) {
      setError('No chart available to export');
      return;
    }

    setIsExporting(true);
    try {
      const metadata = { symbol, timeframe, timestamp: new Date() };
      const blob = chartCanvas
        ? await ChartExporter.exportCanvas(chartCanvas, metadata, exportOptions)
        : await ChartExporter.exportElement(chartContainer as HTMLElement, metadata, exportOptions);
      const filename = ChartExporter.generateFilename(metadata, format);
      ChartExporter.downloadBlob(blob, filename);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget && !isExporting) onClose();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="bg-[#131316] [.rtx-advanced-view_&]:bg-white border border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 rounded-lg shadow-2xl w-[440px] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 bg-[#131316] [.rtx-advanced-view_&]:bg-gray-50 rounded-t-lg">
          <h3 className="text-sm font-semibold text-zinc-200 [.rtx-advanced-view_&]:text-gray-900">Save Chart As Picture</h3>
          <button
            onClick={onClose}
            disabled={isExporting}
            className="text-zinc-400 hover:text-white [.rtx-advanced-view_&]:hover:text-gray-900 transition-colors disabled:opacity-50"
          >
            <Icon name="x-close" size="md" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-sm text-zinc-400 [.rtx-advanced-view_&]:text-gray-600">
          <div className="h-[150px] rounded border border-zinc-700 bg-zinc-950 flex items-center justify-center overflow-hidden">
            {preview ? (
              <img src={preview} alt="Chart preview" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-xs text-zinc-500">No preview available</span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="chart-export-format"
                checked={format === 'png'}
                onChange={() => setFormat('png')}
              />
              PNG
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="chart-export-format"
                checked={format === 'jpg'}
                onChange={() => setFormat('jpg')}
              />
              JPG
            </label>
          </div>

          {format === 'jpg' && (
            <label className="block">
              <span className="mb-1 block">Quality: {Math.round(quality * 100)}%</span>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.01"
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="w-full"
              />
            </label>
          )}

          <label className="block">
            <span className="mb-1 block">Scale</span>
            <select
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-200"
            >
              <option value={1}>1x - Standard</option>
              <option value={2}>2x - Retina</option>
              <option value={3}>3x - High resolution</option>
            </select>
          </label>

          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeSymbolInfo}
                onChange={(e) => setIncludeSymbolInfo(e.target.checked)}
              />
              Include Symbol & Timeframe
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeTimestamp}
                onChange={(e) => setIncludeTimestamp(e.target.checked)}
              />
              Include Timestamp
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeWatermark}
                onChange={(e) => setIncludeWatermark(e.target.checked)}
              />
              Include Watermark
            </label>
          </div>

          {includeWatermark && (
            <input
              value={watermarkText}
              onChange={(e) => setWatermarkText(e.target.value)}
              placeholder="Watermark text"
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-200"
            />
          )}

          {error && (
            <div className="rounded border border-red-700 bg-red-900/30 px-3 py-2 text-red-300">
              {error}
            </div>
          )}

          <div className="text-xs text-zinc-500">{symbol} - {timeframe}</div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-700 [.rtx-advanced-view_&]:border-gray-200 bg-[#131316] [.rtx-advanced-view_&]:bg-gray-50 rounded-b-lg">
          <button
            onClick={onClose}
            disabled={isExporting}
            className="px-3 py-1 bg-zinc-700 [.rtx-advanced-view_&]:bg-gray-200 hover:bg-zinc-600 [.rtx-advanced-view_&]:hover:bg-gray-300 text-white [.rtx-advanced-view_&]:text-gray-800 rounded disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isExporting}
            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded disabled:opacity-50"
          >
            Save Picture
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
