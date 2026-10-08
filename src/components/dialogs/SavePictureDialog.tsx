import { useUiTranslation } from '../../hooks/useUiTranslation';
import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui/Icon';
import { ChartExporter, type ChartExportOptions } from '../../services/chartExporter';
import { isShortcutOwnedBy, shouldIgnoreShortcutEvent } from '../../services/keyboardShortcutManager';
import './save-picture-dialog.css';

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
  const tr = useUiTranslation();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
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
    try {
      setPreview(chartCanvas ? ChartExporter.getPreview(chartCanvas, 300, 200) : '');
    } catch {
      setPreview('');
    }
  }, [chartCanvas, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();
    return () => {
      if (previousFocus?.isConnected && (document.activeElement === document.body || dialog?.contains(document.activeElement))) previousFocus.focus();
    };
  }, [isOpen]);

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
      className="rtx-save-picture-backdrop fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget && !isExporting) onClose();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={isExporting}
        tabIndex={-1}
        className="rtx-action-sheet rtx-save-picture-dialog animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(event) => {
          if (shouldIgnoreShortcutEvent(event.nativeEvent) || !isShortcutOwnedBy(event.nativeEvent, dialogRef.current)) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (!isExporting) onClose();
          }
          if (event.key === 'Tab') {
            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('*'))
              .filter(control => control.tabIndex >= 0 && !control.matches(':disabled'));
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="rtx-save-picture-header">
          <h3 id={titleId}>{tr("Save Chart As Picture")}</h3>
          <button
            type="button"
            aria-label={tr('Close Save Picture')}
            onClick={onClose}
            disabled={isExporting}
            className="rtx-save-picture-close"
          >
            <Icon name="x-close" size="md" />
          </button>
        </div>

        <div className="rtx-save-picture-body space-y-4">
          <div className="rtx-save-picture-preview">
            {preview ? (
              <img src={preview} alt={tr("Chart preview")} className="max-h-full max-w-full object-contain" />
            ) : (
              <span>{tr("No preview available")}</span>
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
              {tr("PNG")}</label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="chart-export-format"
                checked={format === 'jpg'}
                onChange={() => setFormat('jpg')}
              />
              {tr("JPG")}</label>
          </div>

          {format === 'jpg' && (
            <label className="block">
              <span className="mb-1 block">{tr("Quality: ")}{Math.round(quality * 100)}%</span>
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
            <span className="mb-1 block">{tr("Scale")}</span>
            <select
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              className="rtx-save-picture-input w-full"
            >
              <option value={1}>{tr("1x - Standard")}</option>
              <option value={2}>{tr("2x - Retina")}</option>
              <option value={3}>{tr("3x - High resolution")}</option>
            </select>
          </label>

          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeSymbolInfo}
                onChange={(e) => setIncludeSymbolInfo(e.target.checked)}
              />
              {tr("Include Symbol & Timeframe")}</label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeTimestamp}
                onChange={(e) => setIncludeTimestamp(e.target.checked)}
              />
              {tr("Include Timestamp")}</label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeWatermark}
                onChange={(e) => setIncludeWatermark(e.target.checked)}
              />
              {tr("Include Watermark")}</label>
          </div>

          {includeWatermark && (
            <input
              value={watermarkText}
              onChange={(e) => setWatermarkText(e.target.value)}
              placeholder={tr("Watermark text")}
              aria-label={tr('Watermark text')}
              className="rtx-save-picture-input w-full"
            />
          )}

          {error && (
            <div role="alert" className="rtx-save-picture-error">
              {tr(error)}
            </div>
          )}

          <div className="rtx-save-picture-caption">{symbol} - {timeframe}</div>
        </div>

        <div className="rtx-save-picture-footer">
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="rtx-save-picture-button"
          >
            {tr("Cancel")}</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isExporting}
            className="rtx-save-picture-button rtx-save-picture-button-primary"
          >
            {tr("Save Picture")}</button>
        </div>
      </div>
    </div>,
    document.body
  );
};
