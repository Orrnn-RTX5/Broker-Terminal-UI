import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronDown,
  Monitor,
  Moon,
  Sun,
  X,
} from 'lucide-react';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import { useThemeAppearanceStore } from '../../store/useThemeAppearanceStore';
import {
  DARK_THEME_PRESETS,
  findMatchingDarkPreset,
  findMatchingLightPreset,
  isValidHexColor,
  LIGHT_THEME_PRESETS,
  normalizeHexColor,
  type DarkThemePresetId,
  type LightThemePresetId,
  type ThemeContrast,
  type ThemeMode,
  type ThemePresetDefinition,
} from '../../utils/themePresets';
import './theme-appearance.css';

export const OPEN_THEME_SETTINGS_EVENT = 'rtx5:open-theme-settings';

interface PresetDropdownProps<T extends string> {
  id: string;
  label: string;
  value: T | 'Custom';
  presets: readonly ThemePresetDefinition<T>[];
  onSelect: (preset: T) => void;
}

function PresetDropdown<T extends string>({
  id,
  label,
  value,
  presets,
  onSelect,
}: PresetDropdownProps<T>) {
  const tr = useUiTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedPreset = presets.find((p) => p.id === value || p.label === value);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  return (
    <div className="rtx-theme-preset-dropdown" ref={containerRef}>
      <button
        id={id}
        type="button"
        className="rtx-theme-preset-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="rtx-theme-preset-trigger__label">
          {selectedPreset ? selectedPreset.label : tr('Custom')}
        </span>
        <ChevronDown size={13} className="rtx-theme-preset-trigger__chevron" aria-hidden="true" />
      </button>

      {open && (
        <div
          className="rtx-theme-preset-menu"
          role="listbox"
          aria-label={`${label} options`}
        >
          <div className="rtx-theme-preset-menu__list">
            {presets.map((preset) => {
              const selected = value === preset.id || value === preset.label;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`rtx-theme-preset-option ${selected ? 'is-selected' : ''}`}
                  onClick={() => {
                    onSelect(preset.id);
                    setOpen(false);
                  }}
                >
                  <span className="rtx-theme-preset-option__label">{preset.label}</span>
                  {selected && <Check size={14} className="rtx-theme-preset-option__check" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface ColorHexInputRowProps {
  id: string;
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (hex: string) => void;
}

const ColorHexInputRow: React.FC<ColorHexInputRowProps> = ({
  id,
  label,
  ariaLabel,
  value,
  onChange,
}) => {
  const cleanHex = value.replace(/^#/, '').toUpperCase();
  const [draft, setDraft] = useState(cleanHex);

  useEffect(() => {
    setDraft(value.replace(/^#/, '').toUpperCase());
  }, [value]);

  const commitDraft = (raw: string) => {
    const normalized = raw.trim().replace(/^#/, '').toUpperCase();
    if (/^[0-9A-F]{6}$/.test(normalized)) {
      onChange(`#${normalized}`);
    } else if (isValidHexColor(normalized)) {
      onChange(normalizeHexColor(normalized, value));
    } else {
      setDraft(cleanHex);
    }
  };

  return (
    <div className="rtx-theme-appearance__row">
      <label className="rtx-theme-appearance__label" htmlFor={id}>
        {label}
      </label>
      <div className="rtx-theme-color-control">
        <label
          className="rtx-theme-color-swatch-label"
          style={{ backgroundColor: value }}
          title={`${ariaLabel} (${value})`}
        >
          <input
            type="color"
            className="rtx-theme-color-native-input"
            aria-label={`${ariaLabel} picker`}
            value={value.toLowerCase()}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
          />
        </label>
        <span className="rtx-theme-color-hash" aria-hidden="true">#</span>
        <input
          id={id}
          type="text"
          inputMode="text"
          maxLength={7}
          spellCheck={false}
          aria-label={ariaLabel}
          className="rtx-theme-color-hex-input"
          value={draft}
          onChange={(event) => {
            const next = event.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6).toUpperCase();
            setDraft(next);
            if (next.length === 6) {
              onChange(`#${next}`);
            }
          }}
          onBlur={() => commitDraft(draft)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />
      </div>
    </div>
  );
};

export const ThemeAppearanceSettings: React.FC = () => {
  const tr = useUiTranslation();
  const uid = useId();
  const themeMode = useThemeAppearanceStore((state) => state.themeMode);
  const contrast = useThemeAppearanceStore((state) => state.contrast);
  const light = useThemeAppearanceStore((state) => state.light);
  const dark = useThemeAppearanceStore((state) => state.dark);
  const setThemeMode = useThemeAppearanceStore((state) => state.setThemeMode);
  const setContrast = useThemeAppearanceStore((state) => state.setContrast);
  const setLightPreset = useThemeAppearanceStore((state) => state.setLightPreset);
  const setLightColors = useThemeAppearanceStore((state) => state.updateLightColors);
  const setDarkPreset = useThemeAppearanceStore((state) => state.setDarkPreset);
  const setDarkColors = useThemeAppearanceStore((state) => state.updateDarkColors);

  const matchedLightPreset = findMatchingLightPreset(light);
  const matchedDarkPreset = findMatchingDarkPreset(dark);

  const themeModes: { id: ThemeMode; label: string; icon: React.ReactNode }[] = [
    {
      id: 'system',
      label: tr('System theme'),
      icon: <Monitor size={14} aria-hidden="true" />,
    },
    {
      id: 'light',
      label: tr('Light theme'),
      icon: <Sun size={14} aria-hidden="true" />,
    },
    {
      id: 'dark',
      label: tr('Dark theme'),
      icon: <Moon size={14} aria-hidden="true" />,
    },
  ];

  const contrastModes: { id: ThemeContrast; label: string }[] = [
    { id: 'default', label: tr('Default') },
    { id: 'strong', label: tr('Strong') },
  ];

  return (
    <div className="rtx-theme-appearance" data-testid="rtx-theme-appearance-settings">
      {/* Appearance Section */}
      <section className="rtx-theme-appearance__group" aria-labelledby={`${uid}-appearance-heading`}>
        <h3 id={`${uid}-appearance-heading`} className="rtx-theme-appearance__heading">
          {tr('Appearance')}
        </h3>
        <div className="rtx-theme-appearance__card">
          <div className="rtx-theme-appearance__row">
            <span className="rtx-theme-appearance__label">{tr('Theme')}</span>
            <div className="rtx-theme-segmented" role="group" aria-label={tr('Theme mode')}>
              {themeModes.map((mode) => {
                const active = themeMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    aria-label={mode.label}
                    aria-pressed={active}
                    title={mode.label}
                    className={`rtx-theme-segmented__btn rtx-theme-segmented__btn--icon ${active ? 'is-active' : ''}`}
                    onClick={() => setThemeMode(mode.id)}
                  >
                    {mode.icon}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rtx-theme-appearance__row">
            <span className="rtx-theme-appearance__label">{tr('Contrast')}</span>
            <div className="rtx-theme-segmented" role="group" aria-label={tr('Contrast')}>
              {contrastModes.map((item) => {
                const active = contrast === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={active}
                    className={`rtx-theme-segmented__btn ${active ? 'is-active' : ''}`}
                    onClick={() => setContrast(item.id)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Light Theme Section */}
      <section className="rtx-theme-appearance__group" aria-labelledby={`${uid}-light-heading`}>
        <h3 id={`${uid}-light-heading`} className="rtx-theme-appearance__heading">
          {tr('Light Theme')}
        </h3>
        <div className="rtx-theme-appearance__card">
          <div className="rtx-theme-appearance__row">
            <label className="rtx-theme-appearance__label" htmlFor={`${uid}-light-preset`}>
              {tr('Preset')}
            </label>
            <PresetDropdown<LightThemePresetId>
              id={`${uid}-light-preset`}
              label={tr('Light Theme Preset')}
              value={matchedLightPreset === 'Custom' ? 'Custom' : light.preset}
              presets={LIGHT_THEME_PRESETS}
              onSelect={(preset) => setLightPreset(preset, true)}
            />
          </div>

          <ColorHexInputRow
            id={`${uid}-light-bg`}
            label={tr('Background')}
            ariaLabel={tr('Light Theme Background')}
            value={light.background}
            onChange={(background) => setLightColors({ background }, true)}
          />
          <ColorHexInputRow
            id={`${uid}-light-fg`}
            label={tr('Foreground')}
            ariaLabel={tr('Light Theme Foreground')}
            value={light.foreground}
            onChange={(foreground) => setLightColors({ foreground }, true)}
          />
          <ColorHexInputRow
            id={`${uid}-light-accent`}
            label={tr('Accent')}
            ariaLabel={tr('Light Theme Accent')}
            value={light.accent}
            onChange={(accent) => setLightColors({ accent }, true)}
          />
        </div>
      </section>

      {/* Dark Theme Section */}
      <section className="rtx-theme-appearance__group" aria-labelledby={`${uid}-dark-heading`}>
        <h3 id={`${uid}-dark-heading`} className="rtx-theme-appearance__heading">
          {tr('Dark Theme')}
        </h3>
        <div className="rtx-theme-appearance__card">
          <div className="rtx-theme-appearance__row">
            <label className="rtx-theme-appearance__label" htmlFor={`${uid}-dark-preset`}>
              {tr('Preset')}
            </label>
            <PresetDropdown<DarkThemePresetId>
              id={`${uid}-dark-preset`}
              label={tr('Dark Theme Preset')}
              value={matchedDarkPreset === 'Custom' ? 'Custom' : dark.preset}
              presets={DARK_THEME_PRESETS}
              onSelect={(preset) => setDarkPreset(preset, true)}
            />
          </div>

          <ColorHexInputRow
            id={`${uid}-dark-bg`}
            label={tr('Background')}
            ariaLabel={tr('Dark Theme Background')}
            value={dark.background}
            onChange={(background) => setDarkColors({ background }, true)}
          />
          <ColorHexInputRow
            id={`${uid}-dark-fg`}
            label={tr('Foreground')}
            ariaLabel={tr('Dark Theme Foreground')}
            value={dark.foreground}
            onChange={(foreground) => setDarkColors({ foreground }, true)}
          />
          <ColorHexInputRow
            id={`${uid}-dark-accent`}
            label={tr('Accent')}
            ariaLabel={tr('Dark Theme Accent')}
            value={dark.accent}
            onChange={(accent) => setDarkColors({ accent }, true)}
          />
        </div>
      </section>
    </div>
  );
};

interface ThemeSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ThemeSettingsDialog: React.FC<ThemeSettingsDialogProps> = ({ isOpen, onClose }) => {
  const tr = useUiTranslation();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="rtx-theme-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="rtx-theme-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={tr('Appearance & Theme Settings')}
      >
        <header className="rtx-theme-dialog__header">
          <div className="rtx-theme-dialog__title-wrap">
            <h2 className="rtx-theme-dialog__title">{tr('Appearance & Themes')}</h2>
          </div>
          <button
            type="button"
            className="options-close"
            aria-label={tr('Close appearance settings')}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="rtx-theme-dialog__body">
          <ThemeAppearanceSettings />
        </div>
      </div>
    </div>,
    document.body,
  );
};
