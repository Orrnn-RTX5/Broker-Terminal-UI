import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { keyboardShortcutManager, type ShortcutDefinition } from '../services/keyboardShortcutManager';
import {
  activateActiveChartSource,
  clearActiveChartSources,
  registerActiveChartSource,
} from '../services/activeChartSource';
import { defaultChartProperties, useChartSettingsStore } from '../store/useChartSettingsStore';
import { useAppStore } from '../store/useAppStore';
import { commandBus } from '../services/commandBus';
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

const createTick = (symbol: string, bid: number, ask: number) => ({
  symbol,
  bid,
  ask,
  spread: ask - bid,
  timestamp: 1,
});

const registerActiveChart = (
  id = 'chart-active',
  symbol = 'EURUSD',
  timeframe = 'M5',
) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  registerActiveChartSource({
    id,
    getContainer: () => container,
    getSymbol: () => symbol,
    getTimeframe: () => timeframe,
  });
  activateActiveChartSource(id);
  return container;
};

describe('GlobalShortcuts chart shortcut registration', () => {
  beforeEach(() => {
    keyboardShortcutManager.clear();
    clearActiveChartSources();
    commandBus.clearHistory();
    useChartSettingsStore.setState({
      globalProperties: { ...defaultChartProperties },
      symbolProperties: {},
    });
    useAppStore.setState({ ticks: {}, tickLookup: {} });
  });

  afterEach(() => {
    cleanup();
    keyboardShortcutManager.clear();
    clearActiveChartSources();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('registers one canonical handler for every displayed chart shortcut without conflicts', () => {
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
    expect(registrationsFor('ctrl+i')).toHaveLength(1);
    expect(registrationsFor('ctrl+b')).toHaveLength(1);
    expect(registrationsFor('c')).toHaveLength(1);
    expect(registrationsFor('+')).toHaveLength(1);
    expect(registrationsFor('-')).toHaveLength(1);
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
    expect(useChartSettingsStore.getState().globalProperties.showGrid).toBe(true);
    expect(useChartSettingsStore.getState().symbolProperties.XAUUSD.showGrid).toBe(false);

    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(useChartSettingsStore.getState().globalProperties).toMatchObject({
      showTickVolumes: false,
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
    expect(activeRegistrationsFor('ctrl+i')).toHaveLength(1);
    expect(activeRegistrationsFor('ctrl+b')).toHaveLength(1);
    expect(activeRegistrationsFor('c')).toHaveLength(1);
    expect(activeRegistrationsFor('+')).toHaveLength(1);
    expect(activeRegistrationsFor('-')).toHaveLength(1);
    expect(activeRegistrationsFor('alt+g')).toHaveLength(1);
    expect(activeRegistrationsFor('ctrl+l')).toHaveLength(1);

    const disposeRerenderedKeyboardListener = keyboardShortcutManager.initialize();

    fireEvent.keyDown(document.body, { key: 'g', code: 'KeyG', ctrlKey: true });
    expect(useChartSettingsStore.getState().globalProperties.showGrid).toBe(true);

    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(useChartSettingsStore.getState().globalProperties).toMatchObject({
      showTickVolumes: false,
      showRealVolumes: false,
    });
    expect(useChartSettingsStore.getState().symbolProperties.EURUSD).toMatchObject({
      showTickVolumes: true,
      showRealVolumes: false,
    });

    fireEvent.keyDown(document.body, { key: 'g', code: 'KeyG', altKey: true });
    expect(useChartSettingsStore.getState().globalProperties.showGrid).toBe(true);
    expect(useChartSettingsStore.getState().symbolProperties.EURUSD.showGrid).toBe(true);

    fireEvent.keyDown(document.body, { key: 'l', code: 'KeyL', ctrlKey: true });
    expect(useChartSettingsStore.getState().globalProperties).toMatchObject({
      showTickVolumes: false,
      showRealVolumes: false,
    });
    expect(useChartSettingsStore.getState().symbolProperties.EURUSD).toMatchObject({
      showTickVolumes: false,
      showRealVolumes: false,
    });

    disposeRerenderedKeyboardListener();
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('[KeyboardShortcut] Conflict detected'));

    unmount();
    expect(keyboardShortcutManager.getShortcuts()).toHaveLength(0);
  });

  it('routes displayed chart commands and active-chart events to their real handlers', () => {
    registerActiveChart('chart-active', 'EURUSD', 'M5');
    useAppStore.setState({
      ticks: {
        EURUSD: createTick('EURUSD', 1.1234, 1.1236),
        XAUUSD: createTick('XAUUSD', 2450.1, 2450.6),
      },
    });
    const props = createProps();
    const dispatchSpy = vi.spyOn(commandBus, 'dispatch');
    const objectListListener = vi.fn();
    const propertiesListener = vi.fn();
    const closeModalListener = vi.fn();
    const escapedWindowListener = vi.fn();
    window.addEventListener('open-object-list', objectListListener);
    window.addEventListener('openChartProperties', propertiesListener);
    window.addEventListener('close-modal', closeModalListener);
    window.addEventListener('keydown', escapedWindowListener);

    render(<GlobalShortcuts {...props} />);
    const disposeKeyboardListener = keyboardShortcutManager.initialize();

    fireEvent.keyDown(document.body, { key: 'i', code: 'KeyI', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'c', code: 'KeyC' });
    fireEvent.keyDown(document.body, { key: '1', code: 'Digit1', altKey: true });
    fireEvent.keyDown(document.body, { key: '2', code: 'Digit2', altKey: true });
    fireEvent.keyDown(document.body, { key: '3', code: 'Digit3', altKey: true });
    fireEvent.keyDown(document.body, { key: '+', code: 'NumpadAdd' });
    fireEvent.keyDown(document.body, { key: '-', code: 'Minus' });
    fireEvent.keyDown(document.body, { key: 'b', code: 'KeyB', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'F8', code: 'F8' });
    fireEvent.keyDown(document.body, { key: 'b', code: 'KeyB', altKey: true });
    fireEvent.keyDown(document.body, { key: 'F9', code: 'F9' });
    fireEvent.keyDown(document.body, { key: 'n', code: 'KeyN', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });

    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'OPEN_INDICATOR_LIST',
      payload: { targetContextId: 'chart-active' },
    });
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'TOGGLE_CROSSHAIR',
      payload: { targetContextId: 'chart-active' },
    });
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'SET_CHART_TYPE',
      payload: { chartType: 'bar', targetContextId: 'chart-active' },
    });
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'SET_CHART_TYPE',
      payload: { chartType: 'candlestick', targetContextId: 'chart-active' },
    });
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'SET_CHART_TYPE',
      payload: { chartType: 'line', targetContextId: 'chart-active' },
    });
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'ZOOM_IN',
      payload: { targetContextId: 'chart-active' },
    });
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'ZOOM_OUT',
      payload: { targetContextId: 'chart-active' },
    });
    expect(dispatchSpy).toHaveBeenCalledWith({
      type: 'SELECT_TOOL',
      payload: { tool: 'cursor', targetContextId: 'chart-active' },
    });
    expect(objectListListener).toHaveBeenCalledTimes(1);
    expect((objectListListener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      symbol: 'EURUSD',
      timeframe: 'M5',
      targetContextId: 'chart-active',
    });
    expect(propertiesListener).toHaveBeenCalledTimes(1);
    expect((propertiesListener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      symbol: 'EURUSD',
      timeframe: 'M5',
      targetContextId: 'chart-active',
    });
    expect(props.onOpenDOM).toHaveBeenCalledWith('EURUSD');
    expect(props.onOpenOrderPanel).toHaveBeenNthCalledWith(1, 'EURUSD', {
      bid: 1.1234,
      ask: 1.1236,
    });
    expect(props.onOpenOrderPanel).toHaveBeenNthCalledWith(2, 'EURUSD', {
      bid: 1.1234,
      ask: 1.1236,
    });
    expect(closeModalListener).toHaveBeenCalledTimes(1);
    expect(escapedWindowListener).toHaveBeenCalledTimes(1);
    expect(escapedWindowListener.mock.calls[0][0]).toMatchObject({ key: 'Escape' });

    disposeKeyboardListener();
    window.removeEventListener('open-object-list', objectListListener);
    window.removeEventListener('openChartProperties', propertiesListener);
    window.removeEventListener('close-modal', closeModalListener);
    window.removeEventListener('keydown', escapedWindowListener);
  });

  it('uses the active chart symbol for grid and volume toggles, including aliases', () => {
    registerActiveChart('chart-active', 'EURUSD', 'H1');
    useChartSettingsStore.setState({
      globalProperties: { ...defaultChartProperties },
      symbolProperties: {
        EURUSD: {
          ...defaultChartProperties,
          showGrid: false,
          showTickVolumes: false,
          showRealVolumes: false,
        },
      },
    });

    render(<GlobalShortcuts {...createProps()} />);
    const disposeKeyboardListener = keyboardShortcutManager.initialize();

    fireEvent.keyDown(document.body, { key: 'g', code: 'KeyG', ctrlKey: true });
    expect(useChartSettingsStore.getState().globalProperties.showGrid).toBe(true);
    expect(useChartSettingsStore.getState().symbolProperties.EURUSD.showGrid).toBe(true);

    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(useChartSettingsStore.getState().globalProperties.showTickVolumes).toBe(false);
    expect(useChartSettingsStore.getState().symbolProperties.EURUSD).toMatchObject({
      showTickVolumes: true,
      showRealVolumes: false,
    });
    expect(useChartSettingsStore.getState().symbolProperties.XAUUSD).toBeUndefined();

    fireEvent.keyDown(document.body, { key: 'g', code: 'KeyG', altKey: true });
    expect(useChartSettingsStore.getState().symbolProperties.EURUSD.showGrid).toBe(false);

    fireEvent.keyDown(document.body, { key: 'l', code: 'KeyL', ctrlKey: true });
    expect(useChartSettingsStore.getState().symbolProperties.EURUSD).toMatchObject({
      showTickVolumes: false,
      showRealVolumes: false,
    });

    disposeKeyboardListener();
  });

  it('includes the active chart context in undo, redo, and drawing deletion events', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    registerActiveChartSource({ id: 'chart-active', getContainer: () => container });
    activateActiveChartSource('chart-active');

    const received = new Map<string, string | undefined>();
    const eventNames = [
      'chart-undo-drawing',
      'chart-redo-drawing',
      'chart-delete-drawing',
      'chart-delete-last-drawing',
    ] as const;
    const listeners = eventNames.map((eventName) => {
      const listener = (event: Event) => {
        received.set(
          eventName,
          (event as CustomEvent<{ targetContextId?: string }>).detail?.targetContextId,
        );
      };
      window.addEventListener(eventName, listener);
      return { eventName, listener };
    });

    render(<GlobalShortcuts {...createProps()} />);
    const disposeKeyboardListener = keyboardShortcutManager.initialize();

    fireEvent.keyDown(document.body, { key: 'z', code: 'KeyZ', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'y', code: 'KeyY', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Delete', code: 'Delete' });
    fireEvent.keyDown(document.body, { key: 'Backspace', code: 'Backspace' });

    expect(received).toEqual(new Map([
      ['chart-undo-drawing', 'chart-active'],
      ['chart-redo-drawing', 'chart-active'],
      ['chart-delete-drawing', 'chart-active'],
      ['chart-delete-last-drawing', 'chart-active'],
    ]));

    disposeKeyboardListener();
    listeners.forEach(({ eventName, listener }) => window.removeEventListener(eventName, listener));
  });
});
