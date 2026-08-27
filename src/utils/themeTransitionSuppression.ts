export const THEME_TRANSITION_SUPPRESS_CLASS = 'rtx-theme-transition-suppress';

export interface ThemeSuppressionScheduler {
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (handle: number) => void;
}

const getWindowScheduler = (): ThemeSuppressionScheduler => ({
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (handle) => window.clearTimeout(handle),
});

/**
 * Theme switches must repaint atomically. CSS transitions on background/color
 * (row highlights, button hovers) run on the main thread, and the switch itself
 * produces long tasks, so transitioned properties visibly stall at their old
 * theme value while non-transitioned properties flip instantly — leaving
 * unreadable frames (dark rows with dark text, white-on-white values).
 *
 * Call this in the same synchronous block that flips the theme classes, BEFORE
 * the flip. It adds a root class that disables transitions (see index.css) and
 * removes it once the switch has settled.
 *
 * Returns a cancel function that clears the pending removal and removes the
 * class immediately. Call it before re-suppressing so overlapping switches
 * don't remove the class early, and on unmount.
 */
export const suppressThemeTransitions = (
  root: HTMLElement,
  durationMs = 500,
  scheduler: ThemeSuppressionScheduler = getWindowScheduler(),
): (() => void) => {
  root.classList.add(THEME_TRANSITION_SUPPRESS_CLASS);

  const timeoutId = scheduler.setTimeout(() => {
    root.classList.remove(THEME_TRANSITION_SUPPRESS_CLASS);
  }, durationMs);

  return () => {
    scheduler.clearTimeout(timeoutId);
    root.classList.remove(THEME_TRANSITION_SUPPRESS_CLASS);
  };
};
