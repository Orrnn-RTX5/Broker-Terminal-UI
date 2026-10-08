import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChartPropertiesDialog } from './ChartPropertiesDialog';
import { defaultChartProperties, getPresetSchemeColors, useChartSettingsStore } from '../../store/useChartSettingsStore';

describe('Chart Properties keyboard ownership', () => {
  it('exposes keyboard-operated tabs and labels the compact color preview', () => {
    render(<ChartPropertiesDialog isOpen symbol="EURUSD" timeframe="M1" onClose={vi.fn()} />);
    const common = screen.getByRole('tab', { name: 'Common', selected: true });
    common.focus();
    fireEvent.keyDown(common, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Show', selected: true })).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: 'Show' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Show' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Colors', selected: true })).toHaveFocus();
    expect(screen.getByText('Background and grid preview')).toBeVisible();
    expect(screen.queryByText(/Demo Asset/)).not.toBeInTheDocument();
    const backgroundColor = screen.getByLabelText('Background');
    backgroundColor.focus();
    expect(backgroundColor).toHaveFocus();
    expect(backgroundColor.closest('.rtx-cp-color-picker')).not.toBeNull();
  });

  it('leaves a newer help dialog focused and closes only for its own Escape', () => {
    const onClose = vi.fn(); const nextClose = vi.fn();
    const { rerender } = render(<ChartPropertiesDialog isOpen symbol="EURUSD" timeframe="M1" onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();
    const help = document.createElement('div'); help.setAttribute('role', 'dialog'); help.dataset.shortcutScope = 'local';
    const button = document.createElement('button'); help.append(button); document.body.append(help); button.focus();
    const local = vi.fn(); help.addEventListener('keydown', local);
    try {
      rerender(<ChartPropertiesDialog isOpen symbol="EURUSD" timeframe="M1" onClose={nextClose} />);
      expect(button).toHaveFocus();
      fireEvent.keyDown(button, { key: 'Escape', cancelable: true });
      expect(local).toHaveBeenCalledOnce();
      expect(onClose).not.toHaveBeenCalled(); expect(nextClose).not.toHaveBeenCalled();
    } finally { help.remove(); }
    dialog.focus(); fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(nextClose).toHaveBeenCalledOnce();
  });
});

describe('Chart Properties grid settings', () => {
  it('previews Green and White on the active symbol and restores the original scheme on Cancel', () => {
    const initial = useChartSettingsStore.getState();
    useChartSettingsStore.setState({ globalProperties: { ...defaultChartProperties }, symbolProperties: {} });
    const { unmount } = render(<ChartPropertiesDialog isOpen symbol="EURUSD" timeframe="M1" onClose={vi.fn()} />);
    try {
      fireEvent.click(screen.getByRole('tab', { name: 'Colors' }));
      const scheme = screen.getByDisplayValue('Blue on Black');
      fireEvent.change(scheme, { target: { value: 'Green and White' } });
      expect(scheme).toHaveValue('Green and White');
      expect(useChartSettingsStore.getState().symbolProperties.EURUSD.colors).toEqual(getPresetSchemeColors('Green and White'));
      const preview = screen.getByRole('dialog').querySelector<HTMLElement>('.rtx-cp-preview-inner')!;
      expect(preview.style.backgroundColor).toBe('rgb(0, 0, 0)');
      expect(decodeURIComponent(preview.style.backgroundImage)).toContain('#778899');
      expect(useChartSettingsStore.getState().globalProperties.colorScheme).toBe('Blue on Black');
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(useChartSettingsStore.getState().symbolProperties.EURUSD.colorScheme).toBe('Blue on Black');
    } finally {
      unmount();
      useChartSettingsStore.setState(initial);
    }
  });
  it('previews independent symbol grid choices while Cancel restores the initial settings', () => {
    const initial = useChartSettingsStore.getState();
    useChartSettingsStore.setState({ globalProperties: { ...defaultChartProperties }, symbolProperties: {} });
    const onClose = vi.fn();
    const { unmount } = render(<ChartPropertiesDialog isOpen symbol="EURUSD" timeframe="M1" onClose={onClose} />);
    try {
      fireEvent.click(screen.getByRole('tab', { name: 'Show' }));
      const selector = screen.getByRole('combobox', { name: 'Grid line style' });
      const typeSelector = screen.getByRole('combobox', { name: 'Grid type' });
      const preview = screen.getByRole('dialog').querySelector<HTMLElement>('.rtx-cp-preview-inner')!;
      expect(selector).toHaveValue('dashed');
      expect(typeSelector).toHaveValue('square');
      expect(preview.style.backgroundSize).toBe('64px 64px');
      expect(screen.getByRole('option', { name: 'Dashed' })).toBeInTheDocument();
      expect(decodeURIComponent(preview.style.backgroundImage)).toContain('stroke-width="0.75" stroke-dasharray="8 4"');

      fireEvent.change(typeSelector, { target: { value: 'scale' } });
      expect(useChartSettingsStore.getState().symbolProperties.EURUSD).toMatchObject({
        gridType: 'scale',
        gridLineStyle: 'dashed',
      });
      expect(useChartSettingsStore.getState().globalProperties.gridType).toBe('square');
      expect(preview.style.backgroundSize).toBe('128px 48px');
      expect(decodeURIComponent(preview.style.backgroundImage)).toContain('width="128" height="48"');
      expect(decodeURIComponent(preview.style.backgroundImage)).toContain('stroke-width="1" stroke-dasharray="2 2"');

      fireEvent.change(selector, { target: { value: 'solid' } });
      expect(useChartSettingsStore.getState().symbolProperties.EURUSD.gridLineStyle).toBe('solid');
      expect(typeSelector).toHaveValue('scale');
      expect(useChartSettingsStore.getState().globalProperties.gridLineStyle).toBe('dashed');
      expect(decodeURIComponent(preview.style.backgroundImage)).not.toContain('stroke-dasharray');

      fireEvent.click(screen.getByRole('checkbox', { name: 'Show grid' }));
      expect(selector).toBeDisabled();
      expect(typeSelector).toBeDisabled();
      expect(useChartSettingsStore.getState().symbolProperties.EURUSD.gridLineStyle).toBe('solid');

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(useChartSettingsStore.getState().symbolProperties.EURUSD).toMatchObject({
        showGrid: true,
        gridType: 'square',
        gridLineStyle: 'dashed',
      });
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      unmount();
      useChartSettingsStore.setState(initial);
    }
  });

  it('updates the global grid choices when properties are opened without a symbol', () => {
    const initial = useChartSettingsStore.getState();
    useChartSettingsStore.setState({ globalProperties: { ...defaultChartProperties }, symbolProperties: {} });
    const { unmount } = render(<ChartPropertiesDialog isOpen symbol="" timeframe="M1" onClose={vi.fn()} />);
    try {
      fireEvent.click(screen.getByRole('tab', { name: 'Show' }));
      fireEvent.change(screen.getByRole('combobox', { name: 'Grid line style' }), { target: { value: 'solid' } });
      fireEvent.change(screen.getByRole('combobox', { name: 'Grid type' }), { target: { value: 'scale' } });
      expect(useChartSettingsStore.getState().globalProperties.gridLineStyle).toBe('solid');
      expect(useChartSettingsStore.getState().globalProperties.gridType).toBe('scale');
      fireEvent.change(screen.getByRole('combobox', { name: 'Grid type' }), { target: { value: 'mt5' } });
      expect(useChartSettingsStore.getState().globalProperties).toMatchObject({ gridType: 'mt5', gridLineStyle: 'dashed' });
      expect(useChartSettingsStore.getState().symbolProperties).toEqual({});
    } finally {
      unmount();
      useChartSettingsStore.setState(initial);
    }
  });

  it('previews the dense MT5 grid, starts with short dashes, and preserves subsequent style choices and Cancel', () => {
    const initial = useChartSettingsStore.getState();
    const original = { ...defaultChartProperties, gridType: 'scale' as const, gridLineStyle: 'solid' as const };
    useChartSettingsStore.setState({ globalProperties: original, symbolProperties: {} });
    const { unmount } = render(<ChartPropertiesDialog isOpen symbol="EURUSD" timeframe="M1" onClose={vi.fn()} />);
    try {
      fireEvent.click(screen.getByRole('tab', { name: 'Show' }));
      const type = screen.getByRole('combobox', { name: 'Grid type' });
      const style = screen.getByRole('combobox', { name: 'Grid line style' });
      const preview = screen.getByRole('dialog').querySelector<HTMLElement>('.rtx-cp-preview-inner')!;
      fireEvent.change(type, { target: { value: 'mt5' } });
      expect(type).toHaveValue('mt5');
      expect(screen.getByRole('option', { name: 'Fine grid' })).toBeInTheDocument();
      expect(style).toHaveValue('dashed');
      expect(preview.style.backgroundSize).toBe('32px 32px');
      expect(decodeURIComponent(preview.style.backgroundImage)).toContain('stroke-width="1" stroke-dasharray="3 3"');
      expect(useChartSettingsStore.getState().symbolProperties.EURUSD.colors).toEqual(original.colors);

      fireEvent.change(style, { target: { value: 'solid' } });
      expect(useChartSettingsStore.getState().symbolProperties.EURUSD).toMatchObject({ gridType: 'mt5', gridLineStyle: 'solid' });
      expect(decodeURIComponent(preview.style.backgroundImage)).not.toContain('stroke-dasharray');
      fireEvent.change(type, { target: { value: 'square' } });
      expect(style).toHaveValue('solid');
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(useChartSettingsStore.getState().symbolProperties.EURUSD).toEqual(original);
    } finally {
      unmount();
      useChartSettingsStore.setState(initial);
    }
  });
});
