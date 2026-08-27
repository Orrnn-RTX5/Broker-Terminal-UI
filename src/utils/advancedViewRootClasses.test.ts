import { afterEach, describe, expect, it } from 'vitest';
import {
  clearAdvancedViewRootClasses,
  syncAdvancedViewRootClasses,
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

  it('keeps font sizing global while removing Light-only and Focus Chart classes', () => {
    const root = document.documentElement;
    root.classList.add('theme-dark', 'sentinel');
    syncAdvancedViewRootClasses(root, true, { ...baseOptions, focusChart: true });
    syncAdvancedViewRootClasses(root, false, { ...baseOptions, fontSize: 'large', focusChart: true });

    expect(root).toHaveClass('theme-dark', 'sentinel', 'rtx-advanced-font-large');
    expect(root).not.toHaveClass(
      'rtx-advanced-view',
      'rtx-skin-untitled-light',
      'rtx-advanced-focus-chart',
      'rtx-advanced-density-comfortable',
      'rtx-advanced-accent-purple',
      'rtx-advanced-surface-white',
    );
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
});
