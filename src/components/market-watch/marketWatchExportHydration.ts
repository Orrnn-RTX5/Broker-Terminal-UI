export const MARKET_WATCH_EXPORT_HYDRATION_TIMEOUT_MS = 15_000;

type ExportHydrationOutcome<T> =
  | { status: 'complete'; value: T }
  | { status: 'failed' | 'aborted' | 'timeout' };

export const waitForMarketWatchExportHydration = async <T,>(
  task: Promise<T>,
  controller: AbortController,
): Promise<ExportHydrationOutcome<T>> => {
  let timedOut = false;
  let onAbort: (() => void) | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const interrupted = new Promise<ExportHydrationOutcome<T>>((resolve) => {
    onAbort = () => resolve({ status: timedOut ? 'timeout' : 'aborted' });
    if (controller.signal.aborted) {
      onAbort();
      return;
    }
    controller.signal.addEventListener('abort', onAbort, { once: true });
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, MARKET_WATCH_EXPORT_HYDRATION_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      task.then<ExportHydrationOutcome<T>, ExportHydrationOutcome<T>>(
        (value) => ({ status: 'complete', value }),
        () => ({ status: 'failed' }),
      ),
      interrupted,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
  }
};
