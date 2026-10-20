import { useState, type Dispatch, type SetStateAction } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartType, Timeframe } from '../../types/chart';
import {
  useTerminalCommandEvents,
  type ChartObjectsTarget,
  type ChartSymbolPickerState,
} from './useTerminalCommandEvents';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import {
  acknowledgeBottomDockTab,
  getRequestedBottomDockTab,
} from '../../services/bottomDockNavigation';
import { DockManager, type DockContainer, type DockLayout } from '../../services/dockManager';

const setter = <T,>(): Dispatch<SetStateAction<T>> => vi.fn();

const useHarness = () => {
  const [showDataWindow, setShowDataWindow] = useState(false);
  const [showAccountPanel, setShowAccountPanel] = useState(false);
  useTerminalCommandEvents({
    selectedSymbol: 'EURUSD',
    setSelectedSymbol: setter<string>(),
    timeframe: 'M1' as Timeframe,
    setTimeframe: setter<Timeframe>(),
    chartType: 'candlestick' as ChartType,
    setChartType: setter<ChartType>(),
    chartEligibleSymbolNames: ['EURUSD'],
    displayToast: vi.fn(),
    placeOrder: vi.fn(),
    handleOpenDOM: vi.fn(),
    handleSaveWorkspace: vi.fn(),
    handleOpenDataFolder: vi.fn(),
    handlePrintChart: vi.fn(),
    getAllowedSymbol: () => 'EURUSD',
    getChartEligibleSymbol: () => 'EURUSD',
    openOrderPanelForSymbol: vi.fn(),
    setShowDataWindow,
    setShowAccountPanel,
    setDockHeight: setter<number>(),
    setChartSymbolPicker: setter<ChartSymbolPickerState | null>(),
    setShowChartProperties: setter<boolean>(),
    setChartPropsSymbol: setter<string>(),
    setChartPropsTimeframe: setter<string>(),
    setChartPropsContextId: setter<string | undefined>(),
    setChartObjectsTarget: setter<ChartObjectsTarget | null>(),
  });
  return { showDataWindow, showAccountPanel };
};

const scanContainer = (container: DockContainer, component: string): number => {
  let matches = 0;
  for (const child of container.children) {
    if ('children' in child) matches += scanContainer(child, component);
    else if (child.component === component) matches += 1;
  }
  return matches;
};

const countComponent = (layout: DockLayout, component: string): number =>
  scanContainer(layout.root, component)
  + layout.floatingPanels.reduce((total, panel) => total + scanContainer(panel, component), 0);

const resetToDefaultLayout = (): void => {
  useDockLayoutStore.getState().setLayout(new DockManager().getLayout());
  const pending = getRequestedBottomDockTab();
  if (pending) acknowledgeBottomDockTab(pending);
};

afterEach(() => {
  resetToDefaultLayout();
  vi.restoreAllMocks();
});

// SUI-T15: Insert > Experts/Scripts must reveal their bottom-dock tab through
// the existing dock navigation while the Navigator stays exactly as it was.
describe('useTerminalCommandEvents experts/scripts commands', () => {
  it.each([
    { command: 'Experts', tab: 'Experts', navigatorInitiallyOpen: true },
    { command: 'Experts', tab: 'Experts', navigatorInitiallyOpen: false },
    { command: 'Scripts', tab: 'Code Base', navigatorInitiallyOpen: true },
    { command: 'Scripts', tab: 'Code Base', navigatorInitiallyOpen: false },
  ])(
    '$command with navigator initially $navigatorInitiallyOpen leaves the Navigator untouched and shows $tab',
    ({ command, tab, navigatorInitiallyOpen }) => {
      resetToDefaultLayout();
      const store = useDockLayoutStore.getState();
      if (!navigatorInitiallyOpen) store.removePanel('navigator');
      // Remove the host panel so the command must restore it via the store.
      store.removePanel('toolbox');
      expect(countComponent(useDockLayoutStore.getState().layout, 'Navigator'))
        .toBe(navigatorInitiallyOpen ? 1 : 0);
      expect(countComponent(useDockLayoutStore.getState().layout, 'Terminal')).toBe(0);

      const delivered: Array<{ tab?: unknown }> = [];
      const capture = (event: Event) => {
        delivered.push((event as CustomEvent<{ tab?: unknown }>).detail);
      };
      window.addEventListener('rtx:open-bottom-dock-tab', capture);
      const { unmount } = renderHook(useHarness);
      try {
        act(() => {
          window.dispatchEvent(new CustomEvent('togglePanel', { detail: command }));
        });

        const layout = useDockLayoutStore.getState().layout;
        expect(countComponent(layout, 'Navigator')).toBe(navigatorInitiallyOpen ? 1 : 0);
        expect(countComponent(layout, 'Terminal')).toBe(1);
        expect(getRequestedBottomDockTab()).toBe(tab);
        expect(delivered.at(-1)).toMatchObject({ tab });
      } finally {
        window.removeEventListener('rtx:open-bottom-dock-tab', capture);
        unmount();
      }
    },
  );
});
