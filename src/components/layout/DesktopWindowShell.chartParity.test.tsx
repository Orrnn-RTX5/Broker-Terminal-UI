// @vitest-environment jsdom
import { useEffect, useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopWindowShell } from './DesktopWindowShell';
import { TopToolbar } from './TopToolbar';
import { DockContainer } from '../dock/DockContainer';
import { WebDrawingToolsRail } from '../../drawing-tools/WebDrawingToolsRail';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { useDrawingSidebarStore } from '../../store/useDrawingSidebarStore';
import { keyboardShortcutManager } from '../../services/keyboardShortcutManager';
import { commandBus } from '../../services/commandBus';
import { activateActiveChartSource, clearActiveChartSources, registerActiveChartSource } from '../../services/activeChartSource';
import { MAX_CHART_PANELS, type DockLayout, type DockPanelConfig } from '../../services/dockManager';
import i18n, { i18nReady } from '../../i18n';

// The real menu's own desktop behavior is covered by MenuBar.test.tsx.
vi.mock('./MenuBar', () => ({ MenuBar: () => <span>Application menu fixture</span> }));

const originalLayout = useDockLayoutStore.getState().layout;
const layout = (count = 2): DockLayout => ({
  version: 'desktop-parity-test', floatingPanels: [], root: {
    id: 'root', type: 'split', direction: 'horizontal', ratio: 1, children: [
      { id: 'left-sidebar', type: 'split', direction: 'vertical', ratio: .2, children: [
        { id: 'market-watch', component: 'MarketWatch', title: 'Market Watch', ratio: .5 },
        { id: 'navigator', component: 'Navigator', title: 'Navigator', ratio: .5 },
      ] },
      { id: 'center-main', type: 'split', direction: 'vertical', ratio: .8, children: [
        { id: 'chart-host', type: 'split', direction: 'horizontal', ratio: .75, children: Array.from({ length: count }, (_, index) => ({
          id: `chart-${index}`, component: 'Chart', title: `${index === 0 ? 'XAUUSD' : index === 1 ? 'EURUSD' : `TEST${index}`},M5`,
          props: { symbol: index === 0 ? 'XAUUSD' : index === 1 ? 'EURUSD' : `TEST${index}`, timeframe: 'M5', chartType: 'candlestick' },
          ratio: 1 / count, closable: true,
        })) },
        { id: 'toolbox', component: 'Terminal', title: 'Toolbox', ratio: .25 },
      ] },
    ],
  },
});

function ChartFixture({ panel }: { panel: DockPanelConfig }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => registerActiveChartSource({
    id: `trading-chart:${panel.id}`, getContainer: () => ref.current,
    getSymbol: () => panel.props!.symbol, getTimeframe: () => panel.props!.timeframe,
  }), [panel.id, panel.props]);
  return <div ref={ref} data-testid={`content-${panel.id}`}><input aria-label={`Saved drawing ${panel.id}`} defaultValue="Retained drawing" /></div>;
}

const renderPanel = (panel: DockPanelConfig) => panel.component === 'Chart'
  ? <ChartFixture panel={panel} /> : <div>{panel.component}</div>;

const installDesktop = () => {
  const native = { minimize: vi.fn(), maximize: vi.fn(), close: vi.fn(), isMaximized: vi.fn().mockResolvedValue(false),
    setTitle: vi.fn(), onMaximizeChange: vi.fn(() => vi.fn()) };
  Object.defineProperty(window, 'electron', { configurable: true, writable: true, value: { window: native } });
  return native;
};

const mount = () => {
  const desktop = Boolean(window.electron?.window);
  return render(<DesktopWindowShell>
    <TopToolbar chartType="candlestick" timeframe="M5" symbol="XAUUSD" onChartTypeChange={vi.fn()} onTimeframeChange={vi.fn()}
      feedStatus={{ symbols: [], loading: false, settled: true, current: false, error: null }} onRefreshConnection={vi.fn()}
      desktopDrawingTools={desktop ? <WebDrawingToolsRail selectedSymbol="XAUUSD" orientation="horizontal" /> : undefined} />
    <div className="flex" data-testid="chart-workspace">
      {!desktop && <WebDrawingToolsRail selectedSymbol="XAUUSD" />}
      <DockContainer isRoot renderPanel={renderPanel} />
    </div>
  </DesktopWindowShell>);
};

let disposeKeyboard: () => void;
beforeEach(async () => {
  await i18nReady;
  await i18n.changeLanguage('en');
  delete window.electron;
  keyboardShortcutManager.clear(); clearActiveChartSources(); commandBus.clearHistory();
  useDrawingSidebarStore.setState({ visible: true, requestedMenu: null });
  useDockLayoutStore.getState().setLayout(layout());
  disposeKeyboard = keyboardShortcutManager.initialize();
});
afterEach(() => {
  cleanup(); disposeKeyboard(); keyboardShortcutManager.clear(); clearActiveChartSources();
  useDockLayoutStore.getState().setLayout(originalLayout);
  delete window.electron;
  vi.restoreAllMocks();
});

describe.each([{ name: 'web', desktop: false }, { name: 'desktop', desktop: true }])('$name chart-feature composition', ({ desktop }) => {
  it('keeps chart header actions independent of native window controls and preserves the sidebar', async () => {
    const native = desktop ? installDesktop() : null;
    const requestSymbol = vi.fn();
    window.addEventListener('request-chart-symbol-change', requestSymbol);
    const view = mount();
    await act(async () => {});
    try {
      expect(Boolean(view.container.querySelector('[data-rtx-desktop-shell]'))).toBe(desktop);
      expect(Boolean(view.container.querySelector('.rtx-desktop-menu-row'))).toBe(desktop);
      const rail = screen.getByRole('toolbar', { name: 'Drawing tools for XAUUSD' });
      expect(rail).toHaveAttribute('aria-orientation', desktop ? 'horizontal' : 'vertical');
      expect(rail).toHaveAttribute('data-orientation', desktop ? 'horizontal' : 'vertical');
      const workspace = screen.getByTestId('chart-workspace');
      expect(workspace.contains(rail)).toBe(!desktop);
      if (desktop) {
        expect(rail.closest('.rtx-desktop-command-row')).not.toBeNull();
        const search = screen.getByRole('button', { name: 'Search Symbols' });
        expect(rail.closest('.rtx-desktop-inline-drawings')?.previousElementSibling).toBe(search);
        expect(search.previousElementSibling).toHaveClass('rtx-desktop-command-scroll');
        expect(rail.closest('.rtx-desktop-inline-drawings')?.nextElementSibling)
          .toHaveAttribute('aria-label', 'Desktop quick actions');
      }
      const chart = screen.getByTestId('content-chart-0');
      const drawing = screen.getByRole('textbox', { name: 'Saved drawing chart-0' });
      fireEvent.change(drawing, { target: { value: 'Custom annotation' } });
      fireEvent.click(screen.getByRole('button', { name: 'Minimize chart XAUUSD' }));
      expect(chart).toBeInTheDocument();
      expect(chart.closest('.dock-panel__content')).toHaveAttribute('hidden');
      fireEvent.click(screen.getByRole('button', { name: 'Restore chart XAUUSD' }));
      expect(screen.getByTestId('content-chart-0')).toBe(chart);
      expect(drawing).toHaveValue('Custom annotation');
      fireEvent.click(screen.getByRole('button', { name: 'Change symbol for EURUSD' }));
      expect(requestSymbol).toHaveBeenCalledOnce();
      expect(requestSymbol.mock.calls[0][0].detail).toEqual({ panelId: 'chart-1' });
      fireEvent.click(screen.getByRole('button', { name: 'Close chart EURUSD' }));
      expect(screen.queryByTestId('content-chart-1')).toBeNull();
      expect(screen.getByTestId('content-chart-0')).toBe(chart);
      expect(view.container.querySelector<HTMLElement>('[data-dock-child="left-sidebar"]')?.style.flexGrow).toBe('0.2');
      expect(view.container.querySelector<HTMLElement>('[data-dock-child="center-main"]')?.style.flexGrow).toBe('0.8');
      if (native) {
        expect(screen.getByRole('button', { name: 'Minimize window' })).toBeVisible();
        for (const method of [native.minimize, native.maximize, native.close]) expect(method).not.toHaveBeenCalled();
      }
    } finally { window.removeEventListener('request-chart-symbol-change', requestSymbol); }
  });

  it('offers the shared Add chart action when empty and disables it at the six-chart limit', async () => {
    if (desktop) installDesktop();
    useDockLayoutStore.getState().setLayout(layout(0));
    const add = vi.fn(); window.addEventListener('add-chart-panel', add);
    mount(); await act(async () => {});
    try {
      const emptyAdd = screen.getByRole('button', { name: `Add chart (0/${MAX_CHART_PANELS})` });
      expect(emptyAdd).toBeEnabled(); fireEvent.click(emptyAdd); expect(add).toHaveBeenCalledOnce();
      act(() => useDockLayoutStore.getState().setLayout(layout(MAX_CHART_PANELS)));
      const cappedAdd = screen.getByRole('button', { name: `Maximum ${MAX_CHART_PANELS} charts are open` });
      expect(cappedAdd).toBeDisabled(); fireEvent.click(cappedAdd); expect(add).toHaveBeenCalledOnce();
      expect(screen.getAllByRole('button', { name: /^Close chart / })).toHaveLength(6);
    } finally { window.removeEventListener('add-chart-panel', add); }
  });

  it('keeps shared drawing shortcuts and the bundled emoji picker available inside the shell', async () => {
    if (desktop) installDesktop();
    mount(); await act(async () => {});
    act(() => activateActiveChartSource('trading-chart:chart-0'));
    commandBus.clearHistory();
    fireEvent.keyDown(document.body, { key: 't', code: 'KeyT', altKey: true });
    expect(commandBus.getHistory()).toEqual([{ type: 'SELECT_TOOL', payload: {
      tool: 'trendline', subtype: 'trendline', targetContextId: 'trading-chart:chart-0',
    } }]);
    fireEvent.click(screen.getByRole('button', { name: 'Emojis', exact: true }));
    const picker = screen.getByRole('dialog', { name: 'Emoji picker' });
    expect(picker).toBeVisible();
    expect(within(picker).getByRole('tab', { name: 'Emojis', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(within(picker).getByRole('tab', { name: 'Stickers', exact: true })).toBeVisible();
    expect(within(picker).getByRole('tab', { name: 'Icons', exact: true })).toBeVisible();
  });
});
