import { API_V2_BASE_URL } from '../config/api';
import { getAuthToken, getDynamicUrl } from '../api/client';
import { assertBrokerRequestAllowed } from '../api/brokerRequestGuard';

// Bug reporting from the web terminal.
//
// The report goes to the broker gateway, which forwards it to the RTX5 control
// plane. Nothing about a bug report is stored in the broker database, and the
// browser never talks to object storage.
//
// The gateway attaches the account's recent terminal_journal lines server-side.
// That is deliberately not done here: journal lines read from the client could
// be edited or simply wrong, whereas the gateway's copy is what the platform
// itself logged around the incident.

export const MAX_ATTACHMENTS = 5;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'text/plain'];

export const CATEGORY_LABELS: Record<string, string> = {
  trading: 'Trading',
  order: 'Orders',
  position: 'Positions',
  market_data: 'Market data',
  authentication: 'Login',
  ui_ux: 'Display',
  performance: 'Performance',
  connection: 'Connection',
  account: 'Account',
  configuration: 'Settings',
  other: 'Other',
};

export const SEVERITY_LABELS: Record<string, string> = {
  low: 'Low — cosmetic or minor',
  medium: 'Medium — works, but wrongly',
  high: 'High — important function broken',
  critical: 'Critical — I cannot trade',
};

export interface BugReportForm {
  title: string;
  description: string;
  category: string;
  severity: string;
  steps?: string;
  expected?: string;
  actual?: string;
}

export interface BugReportTradingContext {
  symbol?: string;
  timeframe?: string;
  connectionState?: string;
  quoteAgeMs?: number;
}

export interface BugReportReceipt {
  report_id: string;
  status: string;
  failed_attachments?: number[];
}

const endpointUrl = (path: string): string => {
  const url = getDynamicUrl(`${API_V2_BASE_URL}${path}`);
  assertBrokerRequestAllowed(url);
  return url;
};

export const fetchBugReportOptions = async (): Promise<{ enabled: boolean }> => {
  try {
    const response = await fetch(endpointUrl('/bug-reports/options'), {
      headers: { Accept: 'application/json', Authorization: `Bearer ${getAuthToken()}` },
      redirect: 'error',
    });
    if (!response.ok) return { enabled: true };
    const data = await response.json();
    return { enabled: data?.enabled !== false };
  } catch {
    // The form still works; only the "not configured" hint is lost, and a
    // failed submission reports the reason explicitly.
    return { enabled: true };
  }
};

// Collected automatically so a trader does not describe their own browser.
// This is everything sent: no storage, no tokens, no cookies. The terminal
// keeps its session token in local storage, so anything that enumerated
// storage would ship a live trading credential into a bug report.
const collectEnvironment = () => {
  let timezone = '';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    timezone = '';
  }
  return {
    app_version: (import.meta.env?.VITE_APP_VERSION as string) || '',
    route: typeof window !== 'undefined' ? window.location?.hash || window.location?.pathname || '' : '',
    os: typeof navigator !== 'undefined' ? navigator.platform || '' : '',
    browser: typeof navigator !== 'undefined' ? navigator.userAgent || '' : '',
    screen_resolution:
      typeof window !== 'undefined' && window.screen ? `${window.screen.width}x${window.screen.height}` : '',
    locale: typeof navigator !== 'undefined' ? navigator.language || '' : '',
    timezone,
  };
};

export const validateAttachment = (file: File): string | null => {
  if (!file) return 'No file selected';
  if (file.size > MAX_FILE_BYTES) {
    return `${file.name || 'That file'} is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB`;
  }
  if (file.type && !ACCEPTED_TYPES.includes(file.type)) {
    return `${file.name || 'That file'} is not an accepted type`;
  }
  return null;
};

// Encode raster screenshots before upload. Keep the original if WebP is not
// supported or does not save space, so a report never grows because of this.
const compressScreenshot = async (file: File): Promise<File> => {
  if (!['image/png', 'image/jpeg'].includes(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) return file;
      context.drawImage(bitmap, 0, 0);
      for (const quality of [0.82, 0.68]) {
        const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
        if (blob?.type === 'image/webp' && blob.size < file.size) {
          return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, {
            type: 'image/webp',
            lastModified: file.lastModified,
          });
        }
      }
    } finally {
      bitmap.close();
    }
  } catch {
    // A corrupt or unsupported image can still be submitted in its original form.
  }
  return file;
};

/**
 * Capture the terminal window as compressed WebP when the browser supports it.
 *
 * Reuses html2canvas-pro, which the chart printer already loads, so this costs
 * no new dependency and no bundle weight until somebody opens the dialog.
 * Capture can fail on a tainted canvas or a very large layout; a failure means
 * the reporter attaches a file by hand, never that the report is lost.
 */
export const captureScreenshot = async (): Promise<File | null> => {
  try {
    const target = document.body;
    if (!target) return null;
    const { default: render } = await import('html2canvas-pro');
    const canvas = await render(target, {
      backgroundColor: null,
      logging: false,
      scale: Math.min(window.devicePixelRatio || 1, 2),
      ignoreElements: (element) => element.hasAttribute('data-html2canvas-ignore'),
    });
    const webp: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
    if (webp?.type === 'image/webp' && webp.size <= MAX_FILE_BYTES) {
      return new File([webp], `terminal-${Date.now()}.webp`, { type: 'image/webp' });
    }
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return null;
    return new File([blob], `terminal-${Date.now()}.png`, { type: 'image/png' });
  } catch {
    return null;
  }
};

export const submitBugReport = async ({
  form,
  attachments = [],
  context = {},
}: {
  form: BugReportForm;
  attachments?: File[];
  context?: BugReportTradingContext;
}): Promise<BugReportReceipt> => {
  const payload = {
    title: form.title,
    description: form.description,
    category: form.category,
    severity: form.severity,
    steps_to_reproduce: (form.steps || '')
      .split('\n')
      .map((line) => line.replace(/^\s*\d+[).]?\s*/, '').trim())
      .filter(Boolean),
    expected_behavior: form.expected || '',
    actual_behavior: form.actual || '',
    occurred_at: Math.floor(Date.now() / 1000),
    symbol: context.symbol || '',
    timeframe: context.timeframe || '',
    connection_state: context.connectionState || '',
    quote_age_ms: context.quoteAgeMs || 0,
    ...collectEnvironment(),
  };

  const body = new FormData();
  body.append('payload', JSON.stringify(payload));
  const uploadFiles = await Promise.all(attachments.map(compressScreenshot));
  uploadFiles.forEach((file) => body.append('attachments', file, file.name));

  // No Content-Type header: the browser must set the multipart boundary.
  const response = await fetch(endpointUrl('/bug-reports'), {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${getAuthToken()}` },
    body,
    redirect: 'error',
  });

  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    if (response.status === 503) {
      throw new Error('Bug reporting is not enabled on this server yet.');
    }
    if (response.status === 502) {
      throw new Error('The support service could not be reached. Please try again in a moment.');
    }
    throw new Error((data.message as string) || (data.error as string) || 'The report could not be sent');
  }
  if (typeof data?.report_id !== 'string' || !data.report_id.trim()) {
    throw new Error('The server did not confirm the report. Please try again.');
  }
  return data as unknown as BugReportReceipt;
};
