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
  'rtx-advanced-focus-chart',
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
  root.classList.toggle('rtx-advanced-focus-chart', enabled && options.focusChart);
};

export const clearAdvancedViewRootClasses = (root: HTMLElement) => {
  root.classList.remove(
    'rtx-advanced-view',
    'rtx-skin-untitled-light',
    ...ADVANCED_VIEW_FONT_CLASSES,
    ...ADVANCED_VIEW_ONLY_CLASSES,
  );
};
