import { useUiTranslation } from '../../hooks/useUiTranslation';
import { Icon } from '../ui/Icon';
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { chartPrinter, type PrintPreferences, type ChartPrintData, type PageSize, type PageOrientation } from '../../services/chartPrinter';
import './PrintPreviewDialog.css';

export interface PrintPreviewDialogProps {
  onClose: () => void;
  onPrint: (preferences?: PrintPreferences) => void | Promise<void>;
  chartData?: ChartPrintData;
  preferences?: PrintPreferences;
  isLoading?: boolean;
  error?: string;
}

export const PrintPreviewDialog: React.FC<PrintPreviewDialogProps> = ({
  onClose, onPrint, chartData, preferences: providedPreferences, isLoading = false, error,
}) => {
    const tr = useUiTranslation();
  const [preferences, setPreferences] = useState(() => providedPreferences ?? chartPrinter.getPreferences());
  const [zoom, setZoom] = useState<number | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printError, setPrintError] = useState<string>();
  const [loadedHTML, setLoadedHTML] = useState('');
  const viewportRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const printLock = useRef(false);
  useEffect(() => { if (providedPreferences) setPreferences(providedPreferences); }, [providedPreferences]);
  const dimensions = chartPrinter.getPageDimensions(preferences);
  const documentResult = useMemo(() => {
    if (!chartData?.chartCanvas) return { html: '', error: undefined };
    try { return { html: chartPrinter.generatePrintableHTML(chartData, preferences), error: undefined }; }
    catch (failure) { return { html: '', error: failure instanceof Error ? failure.message : 'The preview could not be generated.' }; }
  }, [chartData, preferences, tr]);
  const html = documentResult.html;
  const ready = Boolean(html && loadedHTML === html && !isLoading);
  const message = error || printError || documentResult.error;
  const scale = zoom === null ? fitScale : zoom / 100;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const resize = () => setFitScale(Math.max(.1, Math.min(1,
      (viewport.clientWidth - 48) / dimensions.width,
      (viewport.clientHeight - 48) / dimensions.height)));
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [dimensions.width, dimensions.height]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  const handlePrint = async () => {
    if (!ready || error || printLock.current) return;
    printLock.current = true;
    setIsPrinting(true);
    setPrintError(undefined);
    try { await onPrint(preferences); }
    catch (failure) { setPrintError(failure instanceof Error ? failure.message : 'Printing failed. Please try again.'); }
    finally { printLock.current = false; setIsPrinting(false); }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      void handlePrint();
      return;
    }
    if (event.key === 'Escape' && !isPrinting) { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled)') ?? []);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  return createPortal(<div className="rtx-print-backdrop" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="rtx-print-title" data-shortcut-scope="local" className="rtx-print-preview" onKeyDown={handleKeyDown}>
      <header className="rtx-print-preview__header">
        <div><h2 id="rtx-print-title">{tr("Print Preview")}</h2><p>{chartData ? `${chartData.symbol} | ${chartData.timeframe}` : tr("Preparing the active chart")}</p></div>
        <button ref={closeRef} onClick={onClose} aria-label={tr("Close print preview")} disabled={isPrinting}><Icon name="x-close" size="sm" /></button>
      </header>
      <div className="rtx-print-preview__toolbar">
        <label>{tr("Paper")}<select aria-label={tr("Paper size")} value={preferences.pageSize} onChange={event => setPreferences(p => ({ ...p, pageSize: event.target.value as PageSize }))}>
          {(['A4', 'Letter', 'Legal', 'A3'] as const).map(size => <option key={size} value={size}>{tr(size)}</option>)}
        </select></label>
        <label>{tr("Orientation")}<select aria-label={tr("Page orientation")} value={preferences.orientation} onChange={event => setPreferences(p => ({ ...p, orientation: event.target.value as PageOrientation }))}>
          <option value="landscape">{tr("Landscape")}</option><option value="portrait">{tr("Portrait")}</option>
        </select></label>
        <label>{tr("Color")}<select aria-label={tr("Print color")} value={preferences.colorMode} onChange={event => setPreferences(p => ({ ...p, colorMode: event.target.value as PrintPreferences['colorMode'] }))}>
          <option value="color">{tr("Color")}</option><option value="grayscale">{tr("Grayscale")}</option>
        </select></label>
        <div className="rtx-print-preview__zoom" role="group" aria-label={tr("Preview zoom")}>
          <button title={tr("Zoom Out")} aria-label={tr("Zoom Out")} disabled={scale <= .25} onClick={() => setZoom(Math.max(25, Math.round(scale * 100) - 25))}><Icon name="zoom-out" size="sm" /></button>
          <button title={tr("Actual size")} onClick={() => setZoom(100)}>{Math.round(scale * 100)}%</button>
          <button title={tr("Zoom In")} aria-label={tr("Zoom In")} disabled={scale >= 2} onClick={() => setZoom(Math.min(200, Math.round(scale * 100) + 25))}><Icon name="zoom-in" size="sm" /></button>
          <button aria-pressed={zoom === null} onClick={() => setZoom(null)}>{tr("Fit page")}</button>
        </div>
      </div>
      {message && <div role="alert" className="rtx-print-preview__error">{tr(message)}</div>}
      <div ref={viewportRef} className="rtx-print-preview__viewport" aria-busy={isLoading || Boolean(html && !ready)}>
        {!html && <p role="status">{isLoading ? tr("Capturing chart, axes and drawings...") : message ? tr("Close this preview and try again.") : tr("No chart image is available. Open a chart and try again.")}</p>}
        {html && <div className="rtx-print-preview__paper" style={{ width: dimensions.width * scale, height: dimensions.height * scale }}>
          <iframe title={tr("Print Preview")} sandbox="allow-same-origin" tabIndex={-1} srcDoc={html} onLoad={() => setLoadedHTML(html)}
            style={{ width: dimensions.width, height: dimensions.height, transform: `scale(${scale})` }} />
        </div>}
      </div>
      <footer className="rtx-print-preview__footer">
        <div><span>{tr("Page 1 of 1 | ")}{tr(preferences.pageSize)} | {tr(preferences.orientation === 'landscape' ? 'Landscape' : 'Portrait')}</span><p>{tr("Use the print dialog to choose a printer or Save as PDF.")}</p></div>
        <button onClick={onClose} disabled={isPrinting}>{tr("Close")}</button>
        <button className="rtx-print-preview__primary" onClick={handlePrint} disabled={!ready || isPrinting || Boolean(error)}><Icon name="print" size="sm" />{isPrinting ? tr("Opening print dialog...") : tr("Print")}</button>
      </footer>
    </div>
  </div>, document.body);
};
