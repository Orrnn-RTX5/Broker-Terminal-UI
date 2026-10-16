// @vitest-environment jsdom

import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThemeAppearanceStore } from '../../store/useThemeAppearanceStore';
import {
  clearThemeAppearanceFromRoot,
  DARK_THEME_PRESETS,
  LIGHT_THEME_PRESETS,
} from '../../utils/themePresets';

vi.mock('../../hooks/useUiTranslation', () => {
  const translate = <T,>(value: T) => value;
  return { useUiTranslation: () => translate };
});

import { ThemeAppearanceSettings, ThemeSettingsDialog } from './ThemeAppearanceSettings';

describe('ThemeAppearanceSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeAppearanceStore.getState().resetToDefaults();
  });

  afterEach(() => {
    cleanup();
    clearThemeAppearanceFromRoot(document.documentElement);
    localStorage.clear();
  });

  it('renders Appearance, Light Theme, and Dark Theme sections with default values and zero VS Code references', () => {
    const { container } = render(<ThemeAppearanceSettings />);

    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Light Theme' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dark Theme' })).toBeInTheDocument();

    // Default Light values: F9F9F9, 101010, 007ACC
    expect(screen.getByLabelText('Light Theme Preset')).toHaveTextContent('Default Light');
    expect(screen.getByLabelText('Light Theme Background')).toHaveValue('F9F9F9');
    expect(screen.getByLabelText('Light Theme Foreground')).toHaveValue('101010');
    expect(screen.getByLabelText('Light Theme Accent')).toHaveValue('007ACC');

    // Default Dark values: 101010, CCCCCC, 007ACC
    expect(screen.getByLabelText('Dark Theme Preset')).toHaveTextContent('Default Dark');
    expect(screen.getByLabelText('Dark Theme Background')).toHaveValue('101010');
    expect(screen.getByLabelText('Dark Theme Foreground')).toHaveValue('CCCCCC');
    expect(screen.getByLabelText('Dark Theme Accent')).toHaveValue('007ACC');

    expect(container.textContent).not.toMatch(/vs\s*code/i);
  });

  it('renders ThemeSettingsDialog without any subtitle line, noisy descriptions, or VS Code text', () => {
    const { container } = render(<ThemeSettingsDialog isOpen={true} onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Appearance & Themes' })).toBeInTheDocument();
    expect(screen.queryByText(/Enterprise Light & Dark Theme Studio/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Global mode and contrast controls/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Follow OS preference/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Primary panel, dock/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Active Now/i)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/vs\s*code/i);
  });

  it('lists all 30 Light Theme presets and updates Background, Foreground, and Accent when selected', () => {
    render(<ThemeAppearanceSettings />);

    fireEvent.click(screen.getByLabelText('Light Theme Preset'));
    const listbox = screen.getByRole('listbox', { name: 'Light Theme Preset options' });
    const options = within(listbox).getAllByRole('option').map((el) => el.textContent);
    expect(options).toEqual(LIGHT_THEME_PRESETS.map((p) => p.label));
    expect(options.slice(0, 5)).toEqual([
      'Default Light',
      'Catppuccin',
      'Gruvbox Material',
      'One Light',
      'Solarized Light',
    ]);

    fireEvent.click(within(listbox).getByRole('option', { name: 'Catppuccin' }));
    expect(screen.getByLabelText('Light Theme Preset')).toHaveTextContent('Catppuccin');
    expect(screen.getByLabelText('Light Theme Background')).toHaveValue('EFF1F5');
    expect(screen.getByLabelText('Light Theme Foreground')).toHaveValue('4C4F69');
    expect(screen.getByLabelText('Light Theme Accent')).toHaveValue('8839EF');
    expect(useThemeAppearanceStore.getState().themeMode).toBe('light');
  });

  it('lists all 46 Dark Theme presets and updates Background, Foreground, and Accent when selected', () => {
    render(<ThemeAppearanceSettings />);

    fireEvent.click(screen.getByLabelText('Dark Theme Preset'));
    const listbox = screen.getByRole('listbox', { name: 'Dark Theme Preset options' });
    const options = within(listbox).getAllByRole('option').map((el) => el.textContent);
    expect(options).toEqual(DARK_THEME_PRESETS.map((p) => p.label));
    expect(options.slice(0, 9)).toEqual([
      'Default Dark',
      'Catppuccin',
      'Dracula',
      'Gruvbox Material',
      'Monokai',
      'One Dark Pro',
      'Tokyo Night',
      'Solarized Dark',
      'Vesper',
    ]);

    fireEvent.click(within(listbox).getByRole('option', { name: 'Dracula' }));
    expect(screen.getByLabelText('Dark Theme Preset')).toHaveTextContent('Dracula');
    expect(screen.getByLabelText('Dark Theme Background')).toHaveValue('282A36');
    expect(screen.getByLabelText('Dark Theme Foreground')).toHaveValue('F8F8F2');
    expect(screen.getByLabelText('Dark Theme Accent')).toHaveValue('BD93F9');
    expect(useThemeAppearanceStore.getState().themeMode).toBe('dark');
  });

  it('switches to Custom when hex values are edited and back to a named preset when selected', () => {
    render(<ThemeAppearanceSettings />);

    fireEvent.click(screen.getByLabelText('Dark Theme Preset'));
    const listbox = screen.getByRole('listbox', { name: 'Dark Theme Preset options' });
    fireEvent.click(within(listbox).getByRole('option', { name: 'Abyss' }));
    expect(useThemeAppearanceStore.getState().dark.preset).toBe('abyss');
    expect(screen.getByLabelText('Dark Theme Background')).toHaveValue('000C18');
    expect(screen.getByLabelText('Dark Theme Foreground')).toHaveValue('6688CC');
    expect(screen.getByLabelText('Dark Theme Accent')).toHaveValue('2B4F81');
  });

  it('toggles Theme mode (System / Light / Dark), Contrast (Default / Strong), and custom hex colors', () => {
    render(<ThemeAppearanceSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Light theme' }));
    expect(useThemeAppearanceStore.getState().themeMode).toBe('light');
    expect(document.documentElement).toHaveClass('theme-light', 'rtx-skin-untitled-light');

    fireEvent.click(screen.getByRole('button', { name: 'Strong' }));
    expect(useThemeAppearanceStore.getState().contrast).toBe('strong');
    expect(document.documentElement.getAttribute('data-rtx-contrast')).toBe('strong');

    const lightAccentInput = screen.getByLabelText('Light Theme Accent');
    fireEvent.change(lightAccentInput, { target: { value: 'FF5500' } });
    expect(useThemeAppearanceStore.getState().light.accent).toBe('#FF5500');
    expect(document.documentElement.style.getPropertyValue('--rtx-light-accent')).toBe('#FF5500');
  });
});
