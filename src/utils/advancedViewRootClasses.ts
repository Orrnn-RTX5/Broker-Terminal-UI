import {
  applyThemeAppearanceToRoot,
  clearThemeAppearanceFromRoot,
  loadStoredThemeAppearance,
  RTX_THEME_APPEARANCE_STORAGE_KEY,
} from './themePresets';

export type AdvancedViewFontSize = 'small' | 'normal' | 'large';
export type AdvancedViewDensity = 'comfortable' | 'compact';
export type AdvancedViewAccent = 'purple' | 'blue' | 'green' | 'amber';
export type AdvancedViewChartSurface = 'white' | 'soft' | 'paper';

export interface AdvancedViewRootOptions {
  fontSize: AdvancedViewFontSize;
  density: AdvancedViewDensity;
  accent: AdvancedViewAccent;
  chartSurface: AdvancedViewChartSurface;
  focusChart: boolean;
}

export const RTX_ADVANCED_VIEW_CHANGE_EVENT = 'rtx:advanced-view-change';
export const RTX_EXIT_CHART_FOCUS_EVENT = 'rtx:exit-chart-focus';

const CHART_FOCUS_STORAGE_KEY = 'rtx5-focus-chart';

// Focus belongs to this browser tab, so inspecting another terminal tab does
// not change the workspace shown by an existing one.
export const readChartFocusPreference = (): boolean => {
  try { return sessionStorage.getItem(CHART_FOCUS_STORAGE_KEY) === 'true'; }
  catch { return false; }
};

export const persistChartFocusPreference = (enabled: boolean): void => {
  try { sessionStorage.setItem(CHART_FOCUS_STORAGE_KEY, String(enabled)); }
  catch { /* The toggle still works when browser storage is unavailable. */ }
};

/** Explicit window arrangements take precedence over the single-chart view. */
export const runOutsideChartFocus = (action: () => void): void => {
  if (typeof document === 'undefined' || typeof window === 'undefined') { action(); return; }
  const wasFocused = document.documentElement.classList.contains('rtx-advanced-focus-chart');
  document.documentElement.classList.remove('rtx-advanced-focus-chart');
  window.dispatchEvent(new Event(RTX_EXIT_CHART_FOCUS_EVENT));
  // DockContainer observes this class to reveal hidden tabs/panels. Let that
  // render finish before cascade reads the available chart workspace bounds.
  if (wasFocused) window.requestAnimationFrame(() => action());
  else action();
};

const ADVANCED_VIEW_FONT_CLASSES = [
  'rtx-advanced-font-small',
  'rtx-advanced-font-normal',
  'rtx-advanced-font-large',
] as const;

const ADVANCED_VIEW_ONLY_CLASSES = [
  'rtx-advanced-density-compact',
  'rtx-advanced-density-comfortable',
  'rtx-advanced-accent-purple',
  'rtx-advanced-accent-blue',
  'rtx-advanced-accent-green',
  'rtx-advanced-accent-amber',
  'rtx-advanced-surface-white',
  'rtx-advanced-surface-soft',
  'rtx-advanced-surface-paper',
] as const;

const setExclusiveClass = (
  root: HTMLElement,
  classes: readonly string[],
  activeClass: string | null,
) => {
  for (const className of classes) {
    root.classList.toggle(className, className === activeClass);
  }
};

export const syncAdvancedViewRootClasses = (
  root: HTMLElement,
  enabled: boolean,
  options: AdvancedViewRootOptions,
) => {
  root.classList.toggle('rtx-advanced-view', enabled);
  root.classList.toggle('rtx-skin-untitled-light', enabled);

  // Font size is a terminal-wide preference and must keep working in both themes.
  setExclusiveClass(root, ADVANCED_VIEW_FONT_CLASSES, `rtx-advanced-font-${options.fontSize}`);

  setExclusiveClass(
    root,
    ADVANCED_VIEW_ONLY_CLASSES.filter((className) => className.startsWith('rtx-advanced-density-')),
    enabled ? `rtx-advanced-density-${options.density}` : null,
  );
  setExclusiveClass(
    root,
    ADVANCED_VIEW_ONLY_CLASSES.filter((className) => className.startsWith('rtx-advanced-accent-')),
    enabled ? `rtx-advanced-accent-${options.accent}` : null,
  );
  setExclusiveClass(
    root,
    ADVANCED_VIEW_ONLY_CLASSES.filter((className) => className.startsWith('rtx-advanced-surface-')),
    enabled ? `rtx-advanced-surface-${options.chartSurface}` : null,
  );
  root.classList.toggle('rtx-advanced-focus-chart', options.focusChart);
};

export const clearAdvancedViewRootClasses = (root: HTMLElement) => {
  root.classList.remove(
    'rtx-advanced-view',
    'rtx-skin-untitled-light',
    ...ADVANCED_VIEW_FONT_CLASSES,
    ...ADVANCED_VIEW_ONLY_CLASSES,
    'rtx-advanced-focus-chart',
  );
  clearThemeAppearanceFromRoot(root);
};

export const isSavedThemeLight = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem('rtx5-advanced-view-enabled') === 'true' ||
           localStorage.getItem('rtx5-theme') === 'light';
  } catch {
    return false;
  }
};

export const initRootTheme = (root: HTMLElement = document.documentElement) => {
  if (typeof document === 'undefined') return;
  const isLight = isSavedThemeLight();

  root.classList.toggle('rtx-advanced-view', isLight);
  root.classList.toggle('rtx-skin-untitled-light', isLight);
  root.classList.toggle('theme-light', isLight);
  root.classList.toggle('theme-dark', !isLight);
  root.setAttribute('data-theme', isLight ? 'light' : 'dark');
  root.classList.toggle('rtx-advanced-focus-chart', readChartFocusPreference());

  try {
    if (localStorage.getItem(RTX_THEME_APPEARANCE_STORAGE_KEY)) {
      const appearance = loadStoredThemeAppearance();
      applyThemeAppearanceToRoot(root, {
        ...appearance,
        themeMode: isLight ? 'light' : 'dark',
      });
    }
    const rawOptions = localStorage.getItem('rtx5-advanced-view-options');
    if (rawOptions) {
      const opts = JSON.parse(rawOptions);
      if (opts.fontSize) setExclusiveClass(root, ADVANCED_VIEW_FONT_CLASSES, `rtx-advanced-font-${opts.fontSize}`);
      if (isLight) {
        if (opts.density) setExclusiveClass(root, ADVANCED_VIEW_ONLY_CLASSES.filter((c) => c.startsWith('rtx-advanced-density-')), `rtx-advanced-density-${opts.density}`);
        if (opts.accent) setExclusiveClass(root, ADVANCED_VIEW_ONLY_CLASSES.filter((c) => c.startsWith('rtx-advanced-accent-')), `rtx-advanced-accent-${opts.accent}`);
        if (opts.chartSurface) setExclusiveClass(root, ADVANCED_VIEW_ONLY_CLASSES.filter((c) => c.startsWith('rtx-advanced-surface-')), `rtx-advanced-surface-${opts.chartSurface}`);
      }
    }
  } catch {
    // Storage read errors shouldn't crash app startup
  }
};
