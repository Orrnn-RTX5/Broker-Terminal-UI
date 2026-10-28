import { afterEach, describe, expect, it } from 'vitest';
import {
  applyThemeAppearanceToRoot,
  clearThemeAppearanceFromRoot,
  DARK_THEME_PRESETS,
  DEFAULT_THEME_APPEARANCE_STATE,
  deriveThemeCssVariables,
  findMatchingDarkPreset,
  findMatchingLightPreset,
  getDarkPresetById,
  getLightPresetById,
  LIGHT_THEME_PRESETS,
  loadStoredThemeAppearance,
  RTX_THEME_APPEARANCE_STORAGE_KEY,
  THEME_PRESET_CATEGORIES,
} from './themePresets';

describe('themePresets', () => {
  afterEach(() => {
    clearThemeAppearanceFromRoot(document.documentElement);
    localStorage.removeItem(RTX_THEME_APPEARANCE_STORAGE_KEY);
    localStorage.removeItem('rtx5-advanced-view-enabled');
    localStorage.removeItem('rtx5-theme');
  });

  it('defines 30 Light Theme presets (starting with the 5 core presets) with no VS Code branding anywhere', () => {
    expect(LIGHT_THEME_PRESETS.slice(0, 5).map((p) => p.label)).toEqual([
      'Default Light',
      'Catppuccin',
      'Gruvbox Material',
      'One Light',
      'Solarized Light',
    ]);
    expect(LIGHT_THEME_PRESETS.length).toBe(30);

    const labels = LIGHT_THEME_PRESETS.map((p) => p.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Light Modern',
        'Light+',
        'Quiet Light',
        'High Contrast Light',
        'Abyss Light',
        'GitHub Light Default',
        'GitHub Light High Contrast',
        'Material Lighter',
        'Material Palenight Light',
        'Bluloco Light',
        'Min Light',
        'Ayu Light',
        'Rosé Pine Dawn',
        'Everforest Light',
        'Tokyo Night Light',
        'Night Owl Light',
        'Horizon Bright',
        'Kanagawa Lotus',
        'Nord Light',
        'Winter is Coming Light',
        'Dracula Alucard',
        'Monokai Pro Light',
        'Cobalt Daylight',
        'Vesper Daylight',
      ]),
    );

    const defaultLight = getLightPresetById('default-light');
    expect(defaultLight).toMatchObject({
      id: 'default-light',
      label: 'Default Light',
      background: '#F9F9F9',
      foreground: '#101010',
      accent: '#007ACC',
      category: 'Core & Classic',
    });

    for (const preset of LIGHT_THEME_PRESETS) {
      expect(THEME_PRESET_CATEGORIES).toContain(preset.category);
      expect(preset.description).toBeTruthy();
      expect(preset.label).not.toMatch(/vs\s*code/i);
      expect(preset.category).not.toMatch(/vs\s*code/i);
      expect(preset.description).not.toMatch(/vs\s*code/i);
    }
  });

  it('defines 46 Dark Theme presets (starting with the 9 core presets) with no VS Code branding anywhere', () => {
    expect(DARK_THEME_PRESETS.slice(0, 9).map((p) => p.label)).toEqual([
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
    expect(DARK_THEME_PRESETS.length).toBe(46);

    const labels = DARK_THEME_PRESETS.map((p) => p.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Dark Modern',
        'Dark+',
        'Monokai Dimmed',
        'Abyss',
        'Kimbie Dark',
        'Tomorrow Night Blue',
        'Crimson Night',
        'High Contrast Dark',
        'GitHub Dark Default',
        'GitHub Dark Dimmed',
        'Night Owl',
        'Nord',
        "SynthWave '84",
        'Cobalt2',
        'Material Palenight',
        'Ayu Dark',
        'Ayu Mirage',
        'Horizon Dark',
        'Rosé Pine',
        'Everforest Dark',
        'Kanagawa Wave',
        'Shades of Purple',
      ]),
    );

    const defaultDark = getDarkPresetById('default-dark');
    expect(defaultDark).toMatchObject({
      id: 'default-dark',
      label: 'Default Dark',
      background: '#101010',
      foreground: '#CCCCCC',
      accent: '#007ACC',
      category: 'Core & Classic',
    });

    for (const preset of DARK_THEME_PRESETS) {
      expect(THEME_PRESET_CATEGORIES).toContain(preset.category);
      expect(preset.description).toBeTruthy();
      expect(preset.label).not.toMatch(/vs\s*code/i);
      expect(preset.category).not.toMatch(/vs\s*code/i);
      expect(preset.description).not.toMatch(/vs\s*code/i);
    }
  });

  it('matches known light and dark palettes to their preset IDs or Custom', () => {
    expect(
      findMatchingLightPreset({
        background: '#EFF1F5',
        foreground: '#4C4F69',
        accent: '#8839EF',
      }),
    ).toBe('catppuccin');
    expect(
      findMatchingLightPreset({
        background: '#F5F5F5',
        foreground: '#333333',
        accent: '#7A3E9D',
      }),
    ).toBe('quiet-light');
    expect(
      findMatchingLightPreset({
        background: '#123456',
        foreground: '#101010',
        accent: '#007ACC',
      }),
    ).toBe('Custom');

    expect(
      findMatchingDarkPreset({
        background: '#282A36',
        foreground: '#F8F8F2',
        accent: '#BD93F9',
      }),
    ).toBe('dracula');
    expect(
      findMatchingDarkPreset({
        background: '#000C18',
        foreground: '#6688CC',
        accent: '#2B4F81',
      }),
    ).toBe('abyss');
    expect(
      findMatchingDarkPreset({
        background: '#112233',
        foreground: '#CCCCCC',
        accent: '#007ACC',
      }),
    ).toBe('Custom');
  });

  it('derives and applies Light and Dark theme CSS variables on the root element and cleans them up', () => {
    const root = document.documentElement;
    root.className = 'theme-dark sentinel';

    const tokyoNight = getDarkPresetById('tokyo-night');
    applyThemeAppearanceToRoot(root, {
      ...DEFAULT_THEME_APPEARANCE_STATE,
      themeMode: 'dark',
      contrast: 'strong',
      dark: {
        preset: 'tokyo-night',
        background: tokyoNight.background,
        foreground: tokyoNight.foreground,
        accent: tokyoNight.accent,
      },
    });

    expect(root.getAttribute('data-rtx-theme-configured')).toBe('true');
    expect(root.getAttribute('data-rtx-contrast')).toBe('strong');
    expect(root.getAttribute('data-rtx-theme-preset')).toBe('tokyo-night');
    expect(root.style.getPropertyValue('--rtx-dark-bg-secondary')).toBe('#1A1B26');
    expect(root.style.getPropertyValue('--color-primary')).toBe('#7AA2F7');

    const catppuccinLight = getLightPresetById('catppuccin');
    const lightVars = deriveThemeCssVariables('light', catppuccinLight, 'default');
    expect(lightVars['--rtx-light-panel']).toBe('#EFF1F5');
    expect(lightVars['--rtx-light-accent']).toBe('#8839EF');

    clearThemeAppearanceFromRoot(root);
    expect(root.getAttribute('data-rtx-theme-configured')).toBeNull();
    expect(root.style.getPropertyValue('--rtx-dark-bg-secondary')).toBe('');
    expect(root.className).toBe('theme-dark sentinel');
  });

  it('loads stored theme appearance from localStorage and falls back safely', () => {
    localStorage.setItem(
      RTX_THEME_APPEARANCE_STORAGE_KEY,
      JSON.stringify({
        themeMode: 'light',
        contrast: 'strong',
        light: {
          preset: 'solarized-light',
          background: '#FDF6E3',
          foreground: '#586E75',
          accent: '#268BD2',
        },
        dark: {
          preset: 'vesper',
          background: '#101010',
          foreground: '#FFFFFF',
          accent: '#FFC799',
        },
      }),
    );

    const loaded = loadStoredThemeAppearance();
    expect(loaded.themeMode).toBe('light');
    expect(loaded.contrast).toBe('strong');
    expect(loaded.light.preset).toBe('solarized-light');
    expect(loaded.dark.preset).toBe('vesper');
  });

  it('marks data-rtx-theme-preset as custom when hex colors diverge from default-light or default-dark', () => {
    const root = document.documentElement;
    applyThemeAppearanceToRoot(
      root,
      {
        ...DEFAULT_THEME_APPEARANCE_STATE,
        themeMode: 'light',
        light: {
          preset: 'default-light',
          background: '#F0EAD6',
          foreground: '#101010',
          accent: '#007ACC',
        },
      },
      'light',
    );

    expect(root.getAttribute('data-rtx-theme-preset')).toBe('custom');
    expect(root.style.getPropertyValue('--rtx-light-panel')).toBe('#F0EAD6');
    expect(root.style.getPropertyValue('--rtx-light-chart')).toBe('#F0EAD6');
    expect(root.style.getPropertyValue('--rtx-theme-chart-bg')).toBe('#F0EAD6');

    applyThemeAppearanceToRoot(
      root,
      {
        ...DEFAULT_THEME_APPEARANCE_STATE,
        themeMode: 'light',
      },
      'light',
    );
    expect(root.getAttribute('data-rtx-theme-preset')).toBe('default-light');
    expect(root.style.getPropertyValue('--rtx-light-panel')).toBe('');
    expect(root.style.getPropertyValue('--rtx-light-accent')).toBe('');
  });
});

