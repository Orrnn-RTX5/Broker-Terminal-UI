import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { keyboardShortcutManager, type ShortcutDefinition } from '../services/keyboardShortcutManager';
import { defaultChartProperties, useChartSettingsStore } from '../store/useChartSettingsStore';
import { GlobalShortcuts } from './GlobalShortcuts';

vi.mock('./ShortcutFeedback', () => ({
  ShortcutFeedback: () => null,
}));

vi.mock('./ShortcutHelpDialog', () => ({
  ShortcutHelpDialog: () => null,
}));

const createProps = () => ({
  onOpenOrderPanel: vi.fn(),
  onQuickBuy: vi.fn(),
  onQuickSell: vi.fn(),
  onSaveWorkspace: vi.fn(),
  onOpenDataFolder: vi.fn(),
  onPrintChart: vi.fn(),
  onToggleFullScreen: vi.fn(),
  onOpenDOM: vi.fn(),
  selectedSymbol: 'XAUUSD',
  isChartPropertiesOpen: false,
  isOrderPanelOpen: false,
});

const normalizedCombo = (shortcut: ShortcutDefinition): string =>
  `${shortcut.ctrl ? 'ctrl+' : ''}${shortcut.shift ? 'shift+' : ''}${shortcut.alt ? 'alt+' : ''}${shortcut.meta ? 'meta+' : ''}${shortcut.key.toLowerCase()}`;

describe('GlobalShortcuts chart shortcut registration', () => {
  beforeEach(() => {
    keyboardShortcutManager.clear();
    useChartSettingsStore.setState({
      globalProperties: { ...defaultChartProperties },
      symbolProperties: {},
    });
  });

  afterEach(() => {
    keyboardShortcutManager.clear();
    vi.restoreAllMocks();
  });

  it('registers one canonical Ctrl+G/Ctrl+K handler without conflict warnings on mount or update', () => {
    const registerSpy = vi.spyOn(keyboardShortcutManager, 'register');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const props = createProps();

    const { rerender, unmount } = render(<GlobalShortcuts {...props} />);

    const registrationsFor = (combo: string) => registerSpy.mock.calls
      .map(([shortcut]) => shortcut)
      .filter((shortcut) => normalizedCombo(shortcut) === combo);

    expect(registrationsFor('ctrl+g')).toHaveLength(1);
    expect(registrationsFor('ctrl+k')).toHaveLength(1);
    expect(keyboardShortcutManager.findShortcut('charts.toggle-grid')).toMatchObject({
      key: 'g',
      ctrl: true,
      priority: 92,
    });
    expect(keyboardShortcutManager.findShortcut('charts.toggle-volumes')).toMatchObject({
      key: 'k',
      ctrl: true,
      priority: 92,
    });

    const disposeKeyboardListener = keyboardShortcutManager.initialize();
    fireEvent.keyDown(document.body, { key: 'g', code: 'KeyG', ctrlKey: true });
    expect(useChartSettingsStore.getState().globalProperties.showGrid).toBe(false);

    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(useChartSettingsStore.getState().globalProperties).toMatchObject({
      showTickVolumes: true,
      showRealVolumes: false,
    });
    expect(useChartSettingsStore.getState().symbolProperties.XAUUSD).toMatchObject({
      showTickVolumes: true,
      showRealVolumes: false,
    });
    disposeKeyboardListener();

    rerender(<GlobalShortcuts {...props} selectedSymbol="EURUSD" />);

    expect(registrationsFor('ctrl+g')).toHaveLength(2);
    expect(registrationsFor('ctrl+k')).toHaveLength(2);
    const activeRegistrationsFor = (combo: string) => keyboardShortcutManager
      .getShortcuts()
      .filter((shortcut) => normalizedCombo(shortcut) === combo);

    expect(activeRegistrationsFor('ctrl+g')).toHaveLength(1);
    expect(activeRegistrationsFor('ctrl+k')).toHaveLength(1);
    expect(activeRegistrationsFor('alt+g')).toHaveLength(1);
    expect(activeRegistrationsFor('ctrl+l')).toHaveLength(1);

    const toggleGridListener = vi.fn();
    window.addEventListener('chart-toggle-grid', toggleGridListener);
    const disposeRerenderedKeyboardListener = keyboardShortcutManager.initialize();

    fireEvent.keyDown(document.body, { key: 'g', code: 'KeyG', ctrlKey: true });
    expect(useChartSettingsStore.getState().globalProperties.showGrid).toBe(true);

    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(useChartSettingsStore.getState().globalProperties).toMatchObject({
      showTickVolumes: false,
      showRealVolumes: false,
    });
    expect(useChartSettingsStore.getState().symbolProperties.EURUSD).toMatchObject({
      showTickVolumes: false,
      showRealVolumes: false,
    });

    fireEvent.keyDown(document.body, { key: 'g', code: 'KeyG', altKey: true });
    expect(toggleGridListener).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document.body, { key: 'l', code: 'KeyL', ctrlKey: true });
    expect(useChartSettingsStore.getState().globalProperties).toMatchObject({
      showTickVolumes: true,
      showRealVolumes: false,
    });
    expect(useChartSettingsStore.getState().symbolProperties.EURUSD).toMatchObject({
      showTickVolumes: true,
      showRealVolumes: false,
    });

    disposeRerenderedKeyboardListener();
    window.removeEventListener('chart-toggle-grid', toggleGridListener);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('[KeyboardShortcut] Conflict detected'));

    unmount();
    expect(keyboardShortcutManager.getShortcuts()).toHaveLength(0);
  });
});
