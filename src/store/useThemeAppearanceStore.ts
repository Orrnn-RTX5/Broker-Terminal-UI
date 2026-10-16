import { create } from 'zustand';
import {
  applyThemeAppearanceToRoot,
  DARK_THEME_PRESETS,
  DEFAULT_DARK_THEME_SETTINGS,
  DEFAULT_LIGHT_THEME_SETTINGS,
  DEFAULT_THEME_APPEARANCE_STATE,
  getDarkThemePreset,
  getLightThemePreset,
  LIGHT_THEME_PRESETS,
  loadStoredThemeAppearance,
  normalizeHexColor,
  resolveEffectiveThemeMode,
  RTX_THEME_APPEARANCE_CHANGE_EVENT,
  RTX_THEME_APPEARANCE_STORAGE_KEY,
  type DarkThemePresetId,
  type LightThemePresetId,
  type ThemeAppearanceState,
  type ThemeColorPalette,
  type ThemeContrast,
  type ThemeMode,
} from '../utils/themePresets';
import { RTX_ADVANCED_VIEW_CHANGE_EVENT } from '../utils/advancedViewRootClasses';

interface ThemeAppearanceActions {
  setThemeMode: (mode: ThemeMode) => void;
  setContrast: (contrast: ThemeContrast) => void;
  setLightPreset: (preset: LightThemePresetId, switchToLight?: boolean) => void;
  setDarkPreset: (preset: DarkThemePresetId, switchToDark?: boolean) => void;
  updateLightColors: (patch: Partial<ThemeColorPalette>, switchToLight?: boolean) => void;
  updateDarkColors: (patch: Partial<ThemeColorPalette>, switchToDark?: boolean) => void;
  resetToDefaults: () => void;
  getSnapshot: () => ThemeAppearanceState;
  restoreSnapshot: (snapshot: ThemeAppearanceState) => void;
  syncToDom: () => void;
}

export type ThemeAppearanceStore = ThemeAppearanceState & ThemeAppearanceActions;

function persistAndApplyThemeAppearance(state: ThemeAppearanceState): void {
  const effectiveMode = resolveEffectiveThemeMode(state.themeMode);
  const isLight = effectiveMode === 'light';

  try {
    localStorage.setItem(
      RTX_THEME_APPEARANCE_STORAGE_KEY,
      JSON.stringify({
        themeMode: state.themeMode,
        contrast: state.contrast,
        light: state.light,
        dark: state.dark,
      }),
    );
    localStorage.setItem('rtx5-advanced-view-enabled', String(isLight));
    localStorage.setItem('rtx5-theme', isLight ? 'light' : 'dark');
  } catch {
    // Ignore storage write errors in restricted browser contexts.
  }

  if (typeof document !== 'undefined' && document.documentElement) {
    const root = document.documentElement;
    root.classList.toggle('rtx-advanced-view', isLight);
    root.classList.toggle('rtx-skin-untitled-light', isLight);
    root.classList.toggle('theme-light', isLight);
    root.classList.toggle('theme-dark', !isLight);
    root.setAttribute('data-theme', isLight ? 'light' : 'dark');
    applyThemeAppearanceToRoot(root, state, effectiveMode);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(RTX_THEME_APPEARANCE_CHANGE_EVENT, {
        detail: {
          state,
          effectiveMode,
          isLight,
        },
      }),
    );
    window.dispatchEvent(
      new CustomEvent(RTX_ADVANCED_VIEW_CHANGE_EVENT, {
        detail: { isAdvancedUntitledLight: isLight },
      }),
    );
  }
}

export const useThemeAppearanceStore = create<ThemeAppearanceStore>()((set, get) => {
  const initial = typeof window !== 'undefined'
    ? loadStoredThemeAppearance()
    : DEFAULT_THEME_APPEARANCE_STATE;

  return {
    ...initial,

    setThemeMode: (themeMode) => {
      set((state) => {
        const next: ThemeAppearanceState = {
          themeMode,
          contrast: state.contrast,
          light: state.light,
          dark: state.dark,
        };
        persistAndApplyThemeAppearance(next);
        return { themeMode };
      });
    },

    setContrast: (contrast) => {
      set((state) => {
        const next: ThemeAppearanceState = {
          themeMode: state.themeMode,
          contrast,
          light: state.light,
          dark: state.dark,
        };
        persistAndApplyThemeAppearance(next);
        return { contrast };
      });
    },

    setLightPreset: (preset, switchToLight = false) => {
      const def = getLightThemePreset(preset);
      set((state) => {
        const nextLight = {
          preset: def.id,
          background: def.background,
          foreground: def.foreground,
          accent: def.accent,
        };
        const nextThemeMode = switchToLight ? 'light' : state.themeMode;
        const next: ThemeAppearanceState = {
          themeMode: nextThemeMode,
          contrast: state.contrast,
          light: nextLight,
          dark: state.dark,
        };
        persistAndApplyThemeAppearance(next);
        return {
          themeMode: nextThemeMode,
          light: nextLight,
        };
      });
    },

    setDarkPreset: (preset, switchToDark = false) => {
      const def = getDarkThemePreset(preset);
      set((state) => {
        const nextDark = {
          preset: def.id,
          background: def.background,
          foreground: def.foreground,
          accent: def.accent,
        };
        const nextThemeMode = switchToDark ? 'dark' : state.themeMode;
        const next: ThemeAppearanceState = {
          themeMode: nextThemeMode,
          contrast: state.contrast,
          light: state.light,
          dark: nextDark,
        };
        persistAndApplyThemeAppearance(next);
        return {
          themeMode: nextThemeMode,
          dark: nextDark,
        };
      });
    },

    updateLightColors: (patch, switchToLight = false) => {
      set((state) => {
        const background = patch.background !== undefined
          ? normalizeHexColor(patch.background, state.light.background)
          : state.light.background;
        const foreground = patch.foreground !== undefined
          ? normalizeHexColor(patch.foreground, state.light.foreground)
          : state.light.foreground;
        const accent = patch.accent !== undefined
          ? normalizeHexColor(patch.accent, state.light.accent)
          : state.light.accent;

        const matchedPreset = LIGHT_THEME_PRESETS.find(
          (p) =>
            p.background.toUpperCase() === background &&
            p.foreground.toUpperCase() === foreground &&
            p.accent.toUpperCase() === accent,
        );

        const nextLight = {
          preset: matchedPreset ? matchedPreset.id : state.light.preset,
          background,
          foreground,
          accent,
        };
        const nextThemeMode = switchToLight ? 'light' : state.themeMode;
        const next: ThemeAppearanceState = {
          themeMode: nextThemeMode,
          contrast: state.contrast,
          light: nextLight,
          dark: state.dark,
        };
        persistAndApplyThemeAppearance(next);
        return {
          themeMode: nextThemeMode,
          light: nextLight,
        };
      });
    },

    updateDarkColors: (patch, switchToDark = false) => {
      set((state) => {
        const background = patch.background !== undefined
          ? normalizeHexColor(patch.background, state.dark.background)
          : state.dark.background;
        const foreground = patch.foreground !== undefined
          ? normalizeHexColor(patch.foreground, state.dark.foreground)
          : state.dark.foreground;
        const accent = patch.accent !== undefined
          ? normalizeHexColor(patch.accent, state.dark.accent)
          : state.dark.accent;

        const matchedPreset = DARK_THEME_PRESETS.find(
          (p) =>
            p.background.toUpperCase() === background &&
            p.foreground.toUpperCase() === foreground &&
            p.accent.toUpperCase() === accent,
        );

        const nextDark = {
          preset: matchedPreset ? matchedPreset.id : state.dark.preset,
          background,
          foreground,
          accent,
        };
        const nextThemeMode = switchToDark ? 'dark' : state.themeMode;
        const next: ThemeAppearanceState = {
          themeMode: nextThemeMode,
          contrast: state.contrast,
          light: state.light,
          dark: nextDark,
        };
        persistAndApplyThemeAppearance(next);
        return {
          themeMode: nextThemeMode,
          dark: nextDark,
        };
      });
    },

    resetToDefaults: () => {
      const next: ThemeAppearanceState = {
        themeMode: 'dark',
        contrast: 'default',
        light: { ...DEFAULT_LIGHT_THEME_SETTINGS },
        dark: { ...DEFAULT_DARK_THEME_SETTINGS },
      };
      set(next);
      persistAndApplyThemeAppearance(next);
    },

    getSnapshot: () => {
      const state = get();
      return {
        themeMode: state.themeMode,
        contrast: state.contrast,
        light: { ...state.light },
        dark: { ...state.dark },
      };
    },

    restoreSnapshot: (snapshot) => {
      const next: ThemeAppearanceState = {
        themeMode: snapshot.themeMode,
        contrast: snapshot.contrast,
        light: { ...snapshot.light },
        dark: { ...snapshot.dark },
      };
      set(next);
      persistAndApplyThemeAppearance(next);
    },

    syncToDom: () => {
      const state = get();
      persistAndApplyThemeAppearance({
        themeMode: state.themeMode,
        contrast: state.contrast,
        light: state.light,
        dark: state.dark,
      });
    },
  };
});
