import { describe, expect, it, vi } from 'vitest';
import {
  suppressThemeTransitions,
  THEME_TRANSITION_SUPPRESS_CLASS,
} from './themeTransitionSuppression';

const makeScheduler = () => {
  const timers = new Map<number, () => void>();
  let nextId = 1;
  return {
    timers,
    scheduler: {
      setTimeout: vi.fn((callback: () => void) => {
        const id = nextId++;
        timers.set(id, callback);
        return id;
      }),
      clearTimeout: vi.fn((id: number) => timers.delete(id)),
    },
  };
};

describe('suppressThemeTransitions', () => {
  it('adds the suppress class synchronously and removes it after the settle window', () => {
    const root = document.createElement('html');
    const { timers, scheduler } = makeScheduler();

    suppressThemeTransitions(root, 500, scheduler);
    expect(root.classList.contains(THEME_TRANSITION_SUPPRESS_CLASS)).toBe(true);
    expect(scheduler.setTimeout).toHaveBeenCalledWith(expect.any(Function), 500);

    timers.get(1)?.();
    expect(root.classList.contains(THEME_TRANSITION_SUPPRESS_CLASS)).toBe(false);
  });

  it('cancel clears the pending removal and removes the class immediately', () => {
    const root = document.createElement('html');
    const { timers, scheduler } = makeScheduler();

    const cancel = suppressThemeTransitions(root, 500, scheduler);
    cancel();

    expect(root.classList.contains(THEME_TRANSITION_SUPPRESS_CLASS)).toBe(false);
    expect(scheduler.clearTimeout).toHaveBeenCalledWith(1);
    expect(timers.size).toBe(0);
  });

  it('re-suppressing after cancel keeps the class through the new window', () => {
    const root = document.createElement('html');
    const { timers, scheduler } = makeScheduler();

    const cancelFirst = suppressThemeTransitions(root, 500, scheduler);
    cancelFirst();
    suppressThemeTransitions(root, 500, scheduler);

    expect(root.classList.contains(THEME_TRANSITION_SUPPRESS_CLASS)).toBe(true);
    timers.get(2)?.();
    expect(root.classList.contains(THEME_TRANSITION_SUPPRESS_CLASS)).toBe(false);
  });
});
