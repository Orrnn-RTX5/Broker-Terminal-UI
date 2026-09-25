/** Keep optional requests behind the terminal's existing first-data gate. */
export function runAfterTerminalReady(task: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;

  let cancelled = false;
  let scheduled = false;
  let frame: number | null = null;
  let timer: number | null = null;
  let observer: MutationObserver | null = null;
  const startupPending = () => Boolean(document.querySelector(
    '[data-terminal-startup="pending"], [data-terminal-module-loading="true"]',
  ));

  const schedule = () => {
    if (cancelled || scheduled || startupPending()) return;
    scheduled = true;
    // The callback runs after the revealed workspace has had a paint turn.
    // Login surfaces have no startup boundary and take this path immediately.
    const afterFrame = () => {
      frame = null;
      timer = window.setTimeout(() => {
        timer = null;
        if (cancelled) return;
        // A restore loader can appear between scheduling and this paint turn.
        if (startupPending()) {
          scheduled = false;
          return;
        }
        observer?.disconnect();
        task();
      }, 0);
    };
    if (typeof window.requestAnimationFrame === 'function') {
      frame = window.requestAnimationFrame(afterFrame);
    } else {
      afterFrame();
    }
  };

  observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-terminal-startup', 'data-terminal-module-loading'],
  });
  schedule();

  return () => {
    cancelled = true;
    observer?.disconnect();
    if (frame !== null) window.cancelAnimationFrame(frame);
    if (timer !== null) window.clearTimeout(timer);
  };
}
