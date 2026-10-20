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
import { unavailableDockSections } from '../../config/terminalToolAvailability';
import { DockManager, type DockContainer, type DockLayout } from '../../services/dockManager';

// SUI-T15-guard: controllable availability lock. Real config by default
// (Experts + Code Base are locked); flipped off for the unlocked-path case.
const availabilityOverride = vi.hoisted(() => ({ forceAvailable: false }));
vi.mock('../../config/terminalToolAvailability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/terminalToolAvailability')>();
  return {
    ...actual,
    isUnavailableDockSection: (tab: string) =>
      !availabilityOverride.forceAvailable && actual.isUnavailableDockSection(tab),
  };
});

const setter = <T,>(): Dispatch<SetStateAction<T>> => vi.fn();

type DisplayToast = (message: unknown, type?: unknown) => void;
const useHarness = (displayToast: DisplayToast) => {
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
    displayToast,
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
  availabilityOverride.forceAvailable = false;
  vi.restoreAllMocks();
});

// SUI-T15-guard: a command targeting a locked/unavailable tab must surface a
// visible notice through the existing toast surface instead of failing
// silently; an available tab must still open exactly as before.
describe('useTerminalCommandEvents locked-tab guard', () => {
  it.each([
    { command: 'Experts', reason: unavailableDockSections.Experts },
    { command: 'Scripts', reason: unavailableDockSections['Code Base'] },
  ])('$command targets a locked tab and surfaces its reason instead of opening', ({ command, reason }) => {
    resetToDefaultLayout();
    const store = useDockLayoutStore.getState();
    store.removePanel('toolbox');
    expect(countComponent(useDockLayoutStore.getState().layout, 'Terminal')).toBe(0);

    const delivered: Array<{ tab?: unknown }> = [];
    const capture = (event: Event) => {
      delivered.push((event as CustomEvent<{ tab?: unknown }>).detail);
    };
    window.addEventListener('rtx:open-bottom-dock-tab', capture);
    const displayToast = vi.fn();
    const { unmount } = renderHook(() => useHarness(displayToast));
    try {
      act(() => {
        window.dispatchEvent(new CustomEvent('togglePanel', { detail: command }));
      });

      // Visible notice through the existing toast surface, not a silent no-op.
      expect(displayToast).toHaveBeenCalledTimes(1);
      expect(displayToast).toHaveBeenCalledWith(expect.stringContaining(reason), 'error');
      // Nothing opened or requested: the dock refuses locked tabs.
      expect(delivered).toHaveLength(0);
      expect(getRequestedBottomDockTab()).toBeNull();
      expect(countComponent(useDockLayoutStore.getState().layout, 'Terminal')).toBe(0);
    } finally {
      window.removeEventListener('rtx:open-bottom-dock-tab', capture);
      unmount();
    }
  });

  it('opens the tab as before once it is available', () => {
    availabilityOverride.forceAvailable = true;
    resetToDefaultLayout();
    const store = useDockLayoutStore.getState();
    store.removePanel('toolbox');
    expect(countComponent(useDockLayoutStore.getState().layout, 'Terminal')).toBe(0);

    const delivered: Array<{ tab?: unknown }> = [];
    const capture = (event: Event) => {
      delivered.push((event as CustomEvent<{ tab?: unknown }>).detail);
    };
    window.addEventListener('rtx:open-bottom-dock-tab', capture);
    const displayToast = vi.fn();
    const { unmount } = renderHook(() => useHarness(displayToast));
    try {
      act(() => {
        window.dispatchEvent(new CustomEvent('togglePanel', { detail: 'Experts' }));
      });

      expect(displayToast).not.toHaveBeenCalled();
      expect(countComponent(useDockLayoutStore.getState().layout, 'Terminal')).toBe(1);
      expect(getRequestedBottomDockTab()).toBe('Experts');
      expect(delivered.at(-1)).toMatchObject({ tab: 'Experts' });
    } finally {
      window.removeEventListener('rtx:open-bottom-dock-tab', capture);
      unmount();
    }
  });
});
