export interface MarketWatchExportResult {
  destination: 'clipboard' | 'download' | 'failed';
  symbolCount: number;
  columnCount: number;
  fileName: string;
  csv: string;
}

/**
 * Starts a browser CSV download and releases its temporary DOM and object-URL
 * resources whether the click succeeds or throws.
 */
export const downloadMarketWatchCsv = (csv: string, fileName: string): void => {
  let anchor: HTMLAnchorElement | null = null;
  let url: string | null = null;
  let clickCompleted = false;

  try {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    url = URL.createObjectURL(blob);
    anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    clickCompleted = true;
  } finally {
    anchor?.remove();
    if (url) {
      const objectUrl = url;
      if (clickCompleted) {
        // Revoke on the next task so the browser can consume the click first.
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      } else {
        URL.revokeObjectURL(objectUrl);
      }
    }
  }
};
