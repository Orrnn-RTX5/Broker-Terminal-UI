import { runAfterTerminalReady } from './runAfterTerminalReady';

/** Wait for the revealed workspace's paint, or return false when its owner ends. */
export function waitForTerminalReady(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve(true);

  return new Promise(resolve => {
    let settled = false;
    let cancelWaiting: (() => void) | undefined;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      cancelWaiting?.();
      resolve(ready);
    };
    const abort = () => finish(false);
    signal.addEventListener('abort', abort, { once: true });
    cancelWaiting = runAfterTerminalReady(() => finish(!signal.aborted));
    // Keep cleanup correct even if a scheduler implementation completes inline.
    if (settled) cancelWaiting();
  });
}
