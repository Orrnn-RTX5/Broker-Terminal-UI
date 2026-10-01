import { runAfterTerminalReady } from './runAfterTerminalReady';

/** Warm one module per idle turn, after the terminal has been revealed. */
export function scheduleFeatureWarmup(loaders: readonly (() => Promise<unknown>)[]): () => void {
  let cancelled = false;
  let index = 0;
  let idle: number | undefined;
  let timer: number | undefined;
  const scheduleNext = () => {
    if (cancelled || index >= loaders.length) return;
    const loadNext = () => {
      idle = undefined;
      timer = undefined;
      if (cancelled) return;
      // A failed speculative download must not prevent later tools from warming.
      void loaders[index++]().catch(() => undefined).then(scheduleNext);
    };
    if (typeof window.requestIdleCallback === 'function') {
      idle = window.requestIdleCallback(loadNext);
    } else {
      timer = window.setTimeout(loadNext, 100);
    }
  };
  const cancelReady = runAfterTerminalReady(scheduleNext);
  return () => {
    cancelled = true;
    cancelReady();
    if (idle !== undefined) window.cancelIdleCallback(idle);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
