export interface ChartThemeTransitionCallbacks {
  refreshSurface: () => void;
}

export interface ChartThemeTransitionScheduler {
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (handle: number) => void;
}

const getWindowScheduler = (): ChartThemeTransitionScheduler => ({
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (handle) => window.clearTimeout(handle),
});

export const scheduleChartThemeTransition = (
  callbacks: ChartThemeTransitionCallbacks,
  scheduler: ChartThemeTransitionScheduler = getWindowScheduler(),
): (() => void) => {
  callbacks.refreshSurface();

  const frameId = scheduler.requestAnimationFrame(callbacks.refreshSurface);
  const timeoutId = scheduler.setTimeout(callbacks.refreshSurface, 120);

  return () => {
    scheduler.cancelAnimationFrame(frameId);
    scheduler.clearTimeout(timeoutId);
  };
};
