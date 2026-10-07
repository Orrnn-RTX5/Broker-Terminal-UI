import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearAdvancedViewRootClasses,
  syncAdvancedViewRootClasses,
  runOutsideChartFocus,
  RTX_EXIT_CHART_FOCUS_EVENT,
  initRootTheme,
  isSavedThemeLight,
  readChartFocusPreference,
  persistChartFocusPreference,
  type AdvancedViewRootOptions,
} from './advancedViewRootClasses';

const baseOptions: AdvancedViewRootOptions = {
  fontSize: 'normal',
  density: 'comfortable',
  accent: 'purple',
  chartSurface: 'white',
  focusChart: false,
};

describe('advanced view root classes', () => {
  afterEach(() => {
    document.documentElement.className = '';
    sessionStorage.removeItem('rtx5-focus-chart');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reveals the workspace before measuring an explicit window arrangement and keeps the theme', () => {
    syncAdvancedViewRootClasses(document.documentElement, true, { ...baseOptions, focusChart: true });
    let nextFrame: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { nextFrame = callback; return 1; });
    const persistPreference = vi.fn();
    window.addEventListener(RTX_EXIT_CHART_FOCUS_EVENT, persistPreference);
    const arrange = vi.fn();
    runOutsideChartFocus(arrange);
    expect(document.documentElement).not.toHaveClass('rtx-advanced-focus-chart');
    expect(document.documentElement).toHaveClass('rtx-advanced-view', 'rtx-skin-untitled-light');
    expect(persistPreference).toHaveBeenCalledOnce();
    expect(arrange).not.toHaveBeenCalled();
    nextFrame?.(0);
    expect(arrange).toHaveBeenCalledOnce();
    window.removeEventListener(RTX_EXIT_CHART_FOCUS_EVENT, persistPreference);
  });

  it('applies one coherent Light-theme class set', () => {
    const root = document.documentElement;
    syncAdvancedViewRootClasses(root, true, { ...baseOptions, focusChart: true });

    expect(root).toHaveClass(
      'rtx-advanced-view',
      'rtx-skin-untitled-light',
      'rtx-advanced-font-normal',
      'rtx-advanced-density-comfortable',
      'rtx-advanced-accent-purple',
      'rtx-advanced-surface-white',
      'rtx-advanced-focus-chart',
    );
    expect(root).not.toHaveClass(
      'rtx-advanced-font-small',
      'rtx-advanced-font-large',
      'rtx-advanced-density-compact',
      'rtx-advanced-accent-blue',
      'rtx-advanced-surface-soft',
    );
  });

  it('keeps font sizing and chart focus while removing Light-only classes', () => {
    const root = document.documentElement;
    root.classList.add('theme-dark', 'sentinel');
    syncAdvancedViewRootClasses(root, true, { ...baseOptions, focusChart: true });
    syncAdvancedViewRootClasses(root, false, { ...baseOptions, fontSize: 'large', focusChart: true });

    expect(root).toHaveClass('theme-dark', 'sentinel', 'rtx-advanced-font-large', 'rtx-advanced-focus-chart');
    expect(root).not.toHaveClass(
      'rtx-advanced-view',
      'rtx-skin-untitled-light',
      'rtx-advanced-density-comfortable',
      'rtx-advanced-accent-purple',
      'rtx-advanced-surface-white',
    );
  });

  it.each([false, true])('toggles focus without changing the theme when Light is %s', (isLight) => {
    const root = document.documentElement;
    syncAdvancedViewRootClasses(root, isLight, { ...baseOptions, focusChart: true });
    expect(root).toHaveClass('rtx-advanced-focus-chart');
    expect(root.classList.contains('rtx-advanced-view')).toBe(isLight);
    syncAdvancedViewRootClasses(root, isLight, baseOptions);
    expect(root).not.toHaveClass('rtx-advanced-focus-chart');
    expect(root.classList.contains('rtx-advanced-view')).toBe(isLight);
  });

  it('keeps focus separate for tabs sharing the same saved appearance options', () => {
    const sharedOptions = JSON.stringify({ ...baseOptions, focusChart: true });
    localStorage.setItem('rtx5-advanced-view-options', sharedOptions);
    const tabOne = new Map<string, string>();
    const tabTwo = new Map<string, string>();
    const useTab = (values: Map<string, string>) => vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    useTab(tabOne);
    expect(readChartFocusPreference()).toBe(false);
    persistChartFocusPreference(true);
    expect(readChartFocusPreference()).toBe(true);
    useTab(tabTwo);
    expect(readChartFocusPreference()).toBe(false);
    useTab(tabOne);
    expect(readChartFocusPreference()).toBe(true);
    expect(localStorage.getItem('rtx5-advanced-view-options')).toBe(sharedOptions);
    localStorage.removeItem('rtx5-advanced-view-options');
  });

  it('restores this tab focus at startup in Dark theme without using a shared saved focus flag', () => {
    localStorage.setItem('rtx5-advanced-view-enabled', 'false');
    localStorage.removeItem('rtx5-theme');
    persistChartFocusPreference(true);
    initRootTheme();
    expect(document.documentElement).toHaveClass('theme-dark', 'rtx-advanced-focus-chart');
    persistChartFocusPreference(false);
    initRootTheme();
    expect(document.documentElement).not.toHaveClass('rtx-advanced-focus-chart');
  });

  it('never tears down the active theme while changing another option', async () => {
    const root = document.documentElement;
    syncAdvancedViewRootClasses(root, true, baseOptions);

    const oldClassValues: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) oldClassValues.push(record.oldValue ?? '');
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });

    syncAdvancedViewRootClasses(root, true, { ...baseOptions, fontSize: 'large' });
    await Promise.resolve();
    observer.disconnect();

    expect(oldClassValues.length).toBeGreaterThan(0);
    expect(oldClassValues.every((value) => value.includes('rtx-advanced-view'))).toBe(true);
    expect(oldClassValues.every((value) => value.includes('rtx-skin-untitled-light'))).toBe(true);
    expect(root).toHaveClass('rtx-advanced-font-large');
    expect(root).not.toHaveClass('rtx-advanced-font-normal');
  });

  it('cleans only classes owned by the Theme control', () => {
    const root = document.documentElement;
    root.classList.add('theme-dark', 'sentinel');
    syncAdvancedViewRootClasses(root, true, { ...baseOptions, focusChart: true });
    clearAdvancedViewRootClasses(root);

    expect(root.className).toBe('theme-dark sentinel');
  });

  it('initializes root theme based on saved preferences', () => {
    const root = document.documentElement;
    localStorage.setItem('rtx5-advanced-view-enabled', 'true');
    initRootTheme(root);

    expect(isSavedThemeLight()).toBe(true);
    expect(root).toHaveClass('rtx-advanced-view', 'rtx-skin-untitled-light', 'theme-light');
    expect(root).not.toHaveClass('theme-dark');
    expect(root.getAttribute('data-theme')).toBe('light');

    localStorage.setItem('rtx5-advanced-view-enabled', 'false');
    localStorage.removeItem('rtx5-theme');
    initRootTheme(root);

    expect(isSavedThemeLight()).toBe(false);
    expect(root).toHaveClass('theme-dark');
    expect(root).not.toHaveClass('rtx-advanced-view', 'rtx-skin-untitled-light', 'theme-light');
    expect(root.getAttribute('data-theme')).toBe('dark');
  });
});
