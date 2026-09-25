import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalShortcuts } from './GlobalShortcuts';
import { keyboardShortcutManager } from '../services/keyboardShortcutManager';
import { TERMINAL_SHORTCUTS, getShortcutHelpEntries, getTerminalShortcutHint } from '../services/shortcutCatalog';
import { commandBus } from '../services/commandBus';
import { activateActiveChartSource, clearActiveChartSources, registerActiveChartSource } from '../services/activeChartSource';
import { useDockLayoutStore } from '../store/useDockLayoutStore';
import { useDrawingSidebarStore } from '../store/useDrawingSidebarStore';
import { defaultChartProperties, useChartSettingsStore } from '../store/useChartSettingsStore';
import { getRequestedBottomDockTab } from '../services/bottomDockNavigation';

vi.mock('./ShortcutFeedback', () => ({ ShortcutFeedback: () => null }));
vi.mock('./ShortcutHelpDialog', () => ({ ShortcutHelpDialog: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div data-testid="shortcut-help" /> : null }));
const props = () => ({
  onOpenOrderPanel: vi.fn(), onQuickBuy: vi.fn(), onQuickSell: vi.fn(), onSaveWorkspace: vi.fn(),
  onOpenDataFolder: vi.fn(), onPrintChart: vi.fn(), onToggleFullScreen: vi.fn(), onOpenDOM: vi.fn(),
  selectedSymbol: 'XAUUSD', isChartPropertiesOpen: false, isOrderPanelOpen: false,
});
let dispose: () => void;
const unsubscribe: Array<() => void> = [];
const listen = (name: string) => {
  const handler = vi.fn(); window.addEventListener(name, handler);
  unsubscribe.push(() => window.removeEventListener(name, handler)); return handler;
};
const press = (key: string, modifiers: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key, ...modifiers });

beforeEach(() => {
  keyboardShortcutManager.clear(); clearActiveChartSources(); commandBus.clearHistory();
  useChartSettingsStore.setState({ globalProperties: { ...defaultChartProperties }, symbolProperties: {} });
  useDrawingSidebarStore.setState({ visible: false, requestedMenu: null });
  const container = document.createElement('div'); document.body.appendChild(container);
  registerActiveChartSource({ id: 'trading-chart:eurusd', getContainer: () => container, getSymbol: () => 'EURUSD', getTimeframe: () => 'M5' });
  activateActiveChartSource('trading-chart:eurusd');
  dispose = keyboardShortcutManager.initialize();
});
afterEach(() => {
  cleanup(); dispose(); unsubscribe.splice(0).forEach(fn => fn()); vi.restoreAllMocks();
  keyboardShortcutManager.clear(); clearActiveChartSources(); document.body.replaceChildren();
});

describe('complete terminal shortcut inventory', () => {
  it('registers every catalog binding, shows the same keys in help, and leaves browser-reserved keys alone', () => {
    render(<GlobalShortcuts {...props()} />);
    const registered = keyboardShortcutManager.getShortcuts();
    const help = getShortcutHelpEntries(registered);
    for (const entry of TERMINAL_SHORTCUTS) {
      const actual = registered.find(shortcut => shortcut.id === entry.id);
      expect(actual, entry.id).toBeDefined();
      expect(keyboardShortcutManager.formatShortcut(actual!)).toBe(getTerminalShortcutHint(entry.id));
      expect(help.some(row => row.id === entry.id)).toBe(true);
    }
    const combos = registered.map(shortcut => keyboardShortcutManager.formatShortcut(shortcut));
    expect(new Set(combos).size).toBe(combos.length);
    for (const key of ['n', 't', 'w', 'l']) expect(press(key, { ctrlKey: true })).toBe(true);
  });

  it('opens the requested panels and tabs and runs all four real chart layouts', () => {
    render(<GlobalShortcuts {...props()} />);
    const panels = listen('togglePanel'); const options = listen('open-terminal-options');
    const symbols = listen('openSymbolsDialog');
    const arrange = vi.spyOn(useDockLayoutStore.getState(), 'arrangeCharts').mockImplementation(() => undefined);
    const addPanel = vi.spyOn(useDockLayoutStore.getState(), 'addPanel').mockReturnValue(true);
    press('m', { ctrlKey: true }); press('n', { altKey: true, shiftKey: true }); press('w', { altKey: true, shiftKey: true });
    expect(panels.mock.calls.map(([event]) => event.detail)).toEqual(['MarketWatch', 'Navigator', 'Terminal']);
    press('o', { ctrlKey: true }); press('u', { altKey: true });
    expect(options).toHaveBeenCalledOnce(); expect(symbols).toHaveBeenCalledOnce();
    press('o', { altKey: true, shiftKey: true }); expect(getRequestedBottomDockTab()).toBe('History');
    press('u', { altKey: true, shiftKey: true }); expect(getRequestedBottomDockTab()).toBe('Toolbox');
    press('F2'); expect(getRequestedBottomDockTab()).toBe('Historical Data');
    press('r', { altKey: true });
    for (const key of ['c', 'h', 'v']) press(key, { altKey: true, shiftKey: true });
    expect(arrange.mock.calls.map(([mode]) => mode)).toEqual(['grid', 'cascade', 'horizontal', 'vertical']);
    addPanel.mockRestore();
  });

  it('targets Area, every timeframe, period separators and OHLC at the active chart', () => {
    render(<GlobalShortcuts {...props()} />);
    press('0', { altKey: true });
    for (const key of ['4', '5', '6', '7', '8', '9']) press(key, { altKey: true, code: `Digit${key}` });
    // Shift changes event.key on real keyboards; physical codes must still work.
    for (const [key, code] of [['$', 'Digit4'], ['%', 'Digit5'], ['^', 'Digit6']]) press(key, { altKey: true, shiftKey: true, code });
    const history = commandBus.getHistory();
    expect(history[0]).toMatchObject({ type: 'SET_CHART_TYPE', payload: { chartType: 'area', targetContextId: 'trading-chart:eurusd' } });
    const timeframes = history.filter(cmd => cmd.type === 'SET_TIMEFRAME');
    expect(timeframes.map(cmd => cmd.payload.timeframe)).toEqual(['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN']);
    timeframes.forEach(cmd => expect(cmd.payload).toMatchObject({ targetContextId: 'trading-chart:eurusd', panelId: 'eurusd' }));
    press('p', { altKey: true, shiftKey: true }); press('l', { altKey: true, shiftKey: true });
    expect(useChartSettingsStore.getState().symbolProperties.EURUSD).toMatchObject({ showPeriodSeparators: false, showOHLC: false });
    expect(useChartSettingsStore.getState().symbolProperties.XAUUSD).toBeUndefined();
  });

  it('opens export dialogs, restores the emoji rail, and routes menu help directly', () => {
    const { getByTestId } = render(<GlobalShortcuts {...props()} />);
    const preview = listen('open-print-preview'); const picture = listen('open-save-picture');
    const oneClick = listen('toggle-one-click-trading');
    press('p', { ctrlKey: true, shiftKey: true }); press('s', { ctrlKey: true, shiftKey: true });
    expect(preview).toHaveBeenCalledOnce(); expect(picture).toHaveBeenCalledOnce();
    press('t', { altKey: true }); expect(oneClick).not.toHaveBeenCalled();
    press('t', { altKey: true, shiftKey: true }); expect(oneClick).toHaveBeenCalledOnce();
    press('e', { altKey: true }); expect(useDrawingSidebarStore.getState()).toMatchObject({ visible: true, requestedMenu: 'emojis' });
    press('g', { altKey: true, shiftKey: true }); expect(useDrawingSidebarStore.getState().requestedMenu).toBe('stamps');
    act(() => { window.dispatchEvent(new CustomEvent('open-shortcut-help')); });
    expect(getByTestId('shortcut-help')).toBeTruthy();
  });
});
