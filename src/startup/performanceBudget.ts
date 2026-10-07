export const INSTANT_RESPONSE_BUDGET_MS = 100;

export type StartupMetricName =
  | 'login-feedback'
  | 'login-interaction'
  | 'login-auth'
  | 'auth-network'
  | 'auth-session-persist'
  | 'auth-store-runtime'
  | 'auth-store-commit'
  | 'auth-terminal-ready'
  | 'auth-handoff'
  | 'auth-shell'
  | 'auth-data-ready';

export type PostAuthenticationPhase = Extract<
  StartupMetricName,
  | 'auth-session-persist'
  | 'auth-store-runtime'
  | 'auth-store-commit'
  | 'auth-terminal-ready'
  | 'auth-handoff'
>;

type StartupPerformanceBridge = {
  beginInteraction?: (label: string) => number | void;
  publish?: (name: string, durationMs: number) => void;
};

declare global {
  interface Window {
    __RTX_STARTUP_PERFORMANCE__?: StartupPerformanceBridge;
  }
}

let loginStartedAt = 0;
let authRequestStartedAt = 0;
let authAcceptedAt = 0;
let cancelShellMeasurement: (() => void) | null = null;

const metricAttribute = (name: string): string => (
  `data-rtx-perf-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-ms`
);

export const publishStartupMetric = (name: StartupMetricName, durationMs: number): void => {
  if (typeof document === 'undefined' || !Number.isFinite(durationMs)) return;
  const rounded = Math.max(0, Math.round(durationMs * 10) / 10);
  document.documentElement.setAttribute(metricAttribute(name), rounded.toFixed(1));
  window.__RTX_STARTUP_PERFORMANCE__?.publish?.(name, rounded);
};

export const beginLoginPerformanceMeasurement = (): void => {
  if (typeof performance === 'undefined') return;
  cancelShellMeasurement?.();
  const now = performance.now();
  const capturedInteractionStart = window.__RTX_STARTUP_PERFORMANCE__?.beginInteraction?.('login');
  loginStartedAt = (
    typeof capturedInteractionStart === 'number'
    && Number.isFinite(capturedInteractionStart)
    && capturedInteractionStart >= 0
    && capturedInteractionStart <= now
    && now - capturedInteractionStart <= 5_000
  ) ? capturedInteractionStart : now;
  authRequestStartedAt = 0;
  authAcceptedAt = 0;
  for (const name of ['login-feedback', 'login-auth', 'auth-network', 'auth-session-persist',
    'auth-store-runtime', 'auth-store-commit', 'auth-terminal-ready', 'auth-handoff',
    'auth-shell', 'auth-data-ready'] as const) {
    document.documentElement.removeAttribute(metricAttribute(name));
  }
};

export const markAuthenticationRequestStarted = (): void => {
  if (typeof performance === 'undefined') return;
  authRequestStartedAt = performance.now();
};

/**
 * Resolve from the first task after the browser receives a rendering
 * opportunity. Authentication can run concurrently while the disabled button
 * and progress indicator are guaranteed a chance to paint.
 */
export const waitForLoginFeedbackPaint = (): Promise<void> => {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }
  if (document.visibilityState !== 'visible') return Promise.resolve();

  return new Promise((resolve) => {
    const selector = 'form[data-rtx-login-form][data-login-submit-pending="true"]';
    let frameId: number | undefined;
    let paintTaskId: number | undefined;
    let paintScheduled = false;

    const hasRenderedFeedback = (): boolean => {
      const form = document.querySelector<HTMLFormElement>(selector);
      const submit = form?.querySelector<HTMLButtonElement>('[data-rtx-login-submit]');
      const feedback = form?.querySelector<HTMLElement>('[data-rtx-login-feedback="true"]');
      return Boolean(form && submit?.disabled && feedback);
    };

    const cleanup = () => {
      observer.disconnect();
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };

    const schedulePaintConfirmation = () => {
      if (paintScheduled || !hasRenderedFeedback()) return;
      paintScheduled = true;
      frameId = window.requestAnimationFrame(() => {
        paintTaskId = window.setTimeout(() => {
          if (hasRenderedFeedback() && loginStartedAt > 0) {
            publishStartupMetric('login-feedback', performance.now() - loginStartedAt);
          }
          cleanup();
          resolve();
        }, 0);
      });
    };

    const observer = new MutationObserver(schedulePaintConfirmation);
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['aria-busy', 'data-login-submit-pending', 'disabled'],
    });
    const timeoutId = window.setTimeout(() => {
      observer.disconnect();
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
      if (paintTaskId !== undefined) window.clearTimeout(paintTaskId);
      resolve();
    }, 2_000);
    schedulePaintConfirmation();
  });
};

export const markAuthenticationAccepted = (): void => {
  if (typeof performance === 'undefined') return;
  authAcceptedAt = performance.now();
  if (authRequestStartedAt > 0) {
    publishStartupMetric('auth-network', authAcceptedAt - authRequestStartedAt);
  }
  if (loginStartedAt > 0) {
    publishStartupMetric('login-auth', authAcceptedAt - loginStartedAt);
  }
};

/** Publish cumulative post-authentication phases to expose the shell critical path. */
export const markPostAuthenticationPhase = (name: PostAuthenticationPhase): void => {
  if (typeof performance === 'undefined' || authAcceptedAt <= 0) return;
  publishStartupMetric(name, performance.now() - authAcceptedAt);
};

export const scheduleAuthenticatedShellPaintMeasurement = (): (() => void) => {
  if (
    typeof window === 'undefined'
    || typeof window.requestAnimationFrame !== 'function'
    || authAcceptedAt <= 0
  ) {
    return () => undefined;
  }

  const selector = '[data-rtx-authenticated-shell="true"] [data-rtx-authenticated-viewport="true"]';
  const acceptedAt = authAcceptedAt;
  let cancelled = false;
  let shellMeasured = false;
  let dataMeasured = false;
  let observer: MutationObserver | undefined;
  let frameId: number | undefined;
  let paintTaskId: number | undefined;

  const hasVisibleTerminal = (): boolean => Array.from(document.querySelectorAll(selector)).some(
    (viewport) => !viewport.closest('[data-terminal-startup="pending"]'),
  );
  const hasReadyData = (): boolean => Array.from(document.querySelectorAll(selector)).some(
    (viewport) => !viewport.closest('[data-terminal-startup="pending"]')
      && Boolean(viewport.closest('[data-terminal-startup-data-ready="true"]')),
  );

  const cleanup = () => {
    observer?.disconnect();
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  };

  const schedulePaintConfirmation = () => {
    if (cancelled || frameId !== undefined || !hasVisibleTerminal()
      || (shellMeasured && (dataMeasured || !hasReadyData()))) return;
    frameId = window.requestAnimationFrame(() => {
      paintTaskId = window.setTimeout(() => {
        frameId = undefined;
        paintTaskId = undefined;
        if (!cancelled && hasVisibleTerminal()) {
          if (!shellMeasured) {
            shellMeasured = true;
            publishStartupMetric('auth-shell', performance.now() - acceptedAt);
          }
          if (!dataMeasured && hasReadyData()) {
            dataMeasured = true;
            publishStartupMetric('auth-data-ready', performance.now() - acceptedAt);
          }
          if (dataMeasured) cleanup();
        }
      }, 0);
    });
  };

  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(schedulePaintConfirmation);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-terminal-startup', 'data-terminal-startup-data-ready', 'data-rtx-authenticated-shell'],
    });
  }
  const timeoutId = window.setTimeout(cleanup, 30_000);
  schedulePaintConfirmation();

  const cancel = () => {
    cancelled = true;
    cleanup();
    if (frameId !== undefined) window.cancelAnimationFrame(frameId);
    if (paintTaskId !== undefined) window.clearTimeout(paintTaskId);
    if (cancelShellMeasurement === cancel) cancelShellMeasurement = null;
  };
  cancelShellMeasurement = cancel;
  return cancel;
};

export const nearestRankPercentile = (samples: readonly number[], percentile: number): number => {
  if (samples.length === 0) return Number.NaN;
  const sorted = samples.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const bounded = Math.min(1, Math.max(0, percentile));
  const index = Math.max(0, Math.ceil(bounded * sorted.length) - 1);
  return sorted[index];
};

export const isWithinInstantResponseBudget = (durationMs: number): boolean => (
  Number.isFinite(durationMs) && durationMs <= INSTANT_RESPONSE_BUDGET_MS
);
