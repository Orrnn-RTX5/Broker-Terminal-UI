import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import { downloadMarketWatchCsv, type MarketWatchExportResult } from '../../utils/marketWatchExport';
import { Icon } from '../ui/Icon';
import '../../styles/market-watch-export-sheet.css';

interface MarketWatchExportSheetProps {
  result: MarketWatchExportResult;
  onDismiss: () => void;
}

/** Acknowledged export receipt. The native modal owns focus and makes the
 * trading workspace inert while the trader reads or saves the export. */
export function MarketWatchExportSheet({ result, onDismiss }: MarketWatchExportSheetProps) {
  const tr = useUiTranslation();
  const titleId = useId();
  const summaryId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const [destination, setDestination] = useState(result.destination);
  const [downloadError, setDownloadError] = useState(false);
  const copied = destination === 'clipboard';
  const failed = destination === 'failed';
  const title = failed ? tr('Export needs attention') : copied ? tr('Copied to clipboard') : tr('CSV download started');
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    doneRef.current?.focus({ preventScroll: true });
    return () => {
      dialog?.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  const handleDownload = () => {
    try {
      downloadMarketWatchCsv(result.csv, result.fileName);
      setDestination('download');
      setDownloadError(false);
    } catch {
      setDownloadError(true);
    }
  };

  const sheet = (
    <dialog
      ref={dialogRef}
      className="rtx-export-sheet"
      data-testid="market-watch-export-sheet"
      data-shortcut-scope="local"
      data-outcome={failed ? 'error' : 'success'}
      aria-labelledby={titleId}
      aria-describedby={summaryId}
      aria-modal="true"
      onCancel={(event) => { event.preventDefault(); onDismiss(); }}
      onKeyDown={(event) => {
        // The modal owns its keyboard input; do not invoke terminal shortcuts.
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); onDismiss(); }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onDismiss();
      }}
    >
      <header className="rtx-export-sheet__header">
        <span className={`rtx-export-sheet__result-icon${failed ? ' is-error' : ''}`} aria-hidden="true">
          <Icon name={failed ? 'alert-triangle' : 'check-circle'} size={24} />
        </span>
        <div className="rtx-export-sheet__heading">
          <p className="rtx-export-sheet__eyebrow">{tr('Market Watch')}<span aria-hidden="true"> / </span>{tr('Export')}</p>
          <h2 id={titleId} className="rtx-export-sheet__title" aria-live="polite">{title}</h2>
        </div>
        <button type="button" className="rtx-export-sheet__close" aria-label={tr('Dismiss')} onClick={onDismiss}>
          <Icon name="x-close" size={18} />
        </button>
      </header>

      <div className="rtx-export-sheet__body">
        <p className="rtx-export-sheet__summary" id={summaryId}>
          {failed ? tr('Clipboard and download were unavailable. Try downloading a CSV copy.') : tr('Your Market Watch data is ready to use.')}
        </p>

        <dl className="rtx-export-sheet__facts">
          <div><dt>{tr('Symbols')}</dt><dd>{result.symbolCount.toLocaleString()}</dd></div>
          <div><dt>{tr('Columns')}</dt><dd>{result.columnCount.toLocaleString()}</dd></div>
          <div><dt>{tr('Format')}</dt><dd>{copied ? 'TSV' : 'CSV'}</dd></div>
        </dl>

        {!failed && (
          <section className="rtx-export-sheet__destination" aria-label={tr('Destination')}>
            <div className="rtx-export-sheet__destination-main">
              <span className="rtx-export-sheet__destination-icon" aria-hidden="true">
                <Icon name={copied ? 'copy' : 'download'} size={22} />
              </span>
              <div className="rtx-export-sheet__destination-text">
                <p className="rtx-export-sheet__label">{tr('Destination')}</p>
                <h3>{copied ? tr('System clipboard') : tr('Browser downloads')}</h3>
              </div>
            </div>
            {copied ? (
              <p className="rtx-export-sheet__location-note">{tr('No file was saved to your device.')}</p>
            ) : (
              <div className="rtx-export-sheet__file">
                <span className="rtx-export-sheet__label">{tr('File name')}</span>
                <span className="rtx-export-sheet__filename">{result.fileName}</span>
              </div>
            )}
            <div className="rtx-export-sheet__guidance">
              {copied && <span className="rtx-export-sheet__shortcut" aria-hidden="true"><kbd>{isMac ? '⌘' : 'Ctrl'}</kbd><span>+</span><kbd>V</kbd></span>}
              <p>{copied ? tr('Open Excel or another app, then paste your data.') : tr('Check your browser’s downloads or the location you chose.')}</p>
            </div>
          </section>
        )}
        {downloadError && <p role="alert" className="rtx-export-sheet__error">{tr('The download could not be started. Please try again.')}</p>}
      </div>

      <footer className="rtx-export-sheet__footer">
        <button type="button" className="rtx-export-sheet__button rtx-export-sheet__button--secondary" onClick={handleDownload}>
          <Icon name="download" size={16} />
          {destination === 'download' ? tr('Download again') : tr('Download CSV')}
        </button>
        <button type="button" ref={doneRef} className="rtx-export-sheet__button rtx-export-sheet__button--primary" onClick={onDismiss}>
          {tr('Done')}
        </button>
      </footer>
    </dialog>
  );

  return typeof document === 'undefined' ? sheet : createPortal(sheet, document.body);
}
