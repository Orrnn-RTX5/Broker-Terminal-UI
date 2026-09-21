// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BottomDock, ToolboxTab } from './BottomDock';
import { getTerminalShortcutHint, runTerminalShortcutAction } from '../services/shortcutCatalog';
import { acknowledgeBottomDockTab, getRequestedBottomDockTab, openBottomDockTab } from '../services/bottomDockNavigation';
import { useDockLayoutStore } from '../store/useDockLayoutStore';
import { DockManager } from '../services/dockManager';

vi.mock('../services/shortcutCatalog', async importOriginal => ({
  ...await importOriginal<typeof import('../services/shortcutCatalog')>(),
  runTerminalShortcutAction: vi.fn(),
}));
vi.mock('../hooks/useToolboxTradeData', () => ({
  useToolboxTradeData: () => ({
    account: null, positions: [], pendingPositions: [], loading: false, error: null,
    login: null, restBaseUrl: '', wsUrl: '', wsState: 'connected', lastRestAt: null,
    lastWsAt: null, debug: [], refresh: vi.fn(), removePosition: vi.fn(), removePositionsByMode: vi.fn(),
  }),
}));

const originalLayout = useDockLayoutStore.getState().layout;
afterEach(() => {
  cleanup();
  useDockLayoutStore.getState().setLayout(originalLayout);
  const pending = getRequestedBottomDockTab();
  if (pending) acknowledgeBottomDockTab(pending);
  vi.clearAllMocks();
});

describe('Toolbox utility commands', () => {
  it('mounts optional Toolbox and Exposure content on first activation and retains their surfaces', () => {
    const { container } = render(<BottomDock height={300} />);
    expect(screen.queryByTitle('Cascade')).not.toBeInTheDocument();
    expect(container.querySelector('.rtx-exposure-tab')).toBeNull();
    expect(container.querySelector('.rtx-trade-tab')).toBeInTheDocument();

    act(() => openBottomDockTab('Toolbox'));
    const toolboxCommand = screen.getByTitle('Cascade');
    expect(toolboxCommand).toBeVisible();
    fireEvent.click(toolboxCommand);
    expect(runTerminalShortcutAction).toHaveBeenLastCalledWith('window.cascade');

    act(() => openBottomDockTab('Exposure'));
    const exposure = container.querySelector('.rtx-exposure-tab');
    expect(exposure).toBeVisible();
    expect(toolboxCommand).toBeInTheDocument();
    expect(toolboxCommand).not.toBeVisible();

    act(() => openBottomDockTab('Trade'));
    expect(exposure).toBeInTheDocument();
    expect(exposure).not.toBeVisible();
    act(() => openBottomDockTab('Toolbox'));
    expect(screen.getByTitle('Cascade')).toBe(toolboxCommand);
    act(() => openBottomDockTab('Exposure'));
    expect(container.querySelector('.rtx-exposure-tab')).toBe(exposure);
  });

  it('uses the executable shortcut catalog for every enabled tool', () => {
    render(<ToolboxTab />);
    const tools = [
      ['New Order', 'tools.new-order'], ['Depth of Market', 'view.depth-of-market'],
      ['One Click Trading', 'trading.toggle-one-click'], ['Order History', 'trading.order-history'],
      ['Market Watch', 'view.market-watch'], ['Data Window', 'view.data-window'],
      ['Navigator', 'view.navigator'], ['Terminal', 'view.terminal'], ['Toolbox', 'view.toolbox'],
      ['Bar Chart', 'charts.bar-chart'], ['Candlesticks', 'charts.candlestick'],
      ['Line Chart', 'charts.line-chart'], ['Area Chart', 'charts.area-chart'],
      ['Indicators', 'charts.indicator-list'], ['Objects', 'charts.object-list'],
      ['History Center', 'tools.history-center'], ['Options', 'tools.options'],
      ['Tile Windows', 'window.tile'], ['Cascade', 'window.cascade'],
      ['Tile Horizontally', 'window.tile-horizontal'], ['Tile Vertically', 'window.tile-vertical'],
      ['Help Topics', 'help.shortcuts'],
    ];
    for (const [label, id] of tools) {
      const button = screen.getByTitle(label);
      expect(button).toBeEnabled();
      expect(getTerminalShortcutHint(id)).not.toBe('');
      expect(button).toHaveTextContent(getTerminalShortcutHint(id));
      fireEvent.click(button);
      expect(runTerminalShortcutAction).toHaveBeenLastCalledWith(id);
    }
    expect(runTerminalShortcutAction).toHaveBeenCalledTimes(tools.length);
  });

  it('keeps backend-only utilities and unconfigured documentation locked', () => {
    render(<ToolboxTab />);
    for (const label of ['Strategy Tester', 'Global Variables', 'MetaEditor', 'Documentation', 'Market', 'Signals']) {
      const button = screen.getByRole('button', { name: label, exact: true });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-description');
      fireEvent.click(button);
    }
    expect(runTerminalShortcutAction).not.toHaveBeenCalled();
  });

  it('selects a retained destination after the restored Terminal mounts, then handles later requests', () => {
    const manager = new DockManager();
    manager.removePanel('toolbox');
    useDockLayoutStore.getState().setLayout(manager.getLayout());
    openBottomDockTab('Toolbox');
    render(<React.StrictMode><BottomDock height={300} /></React.StrictMode>);
    expect(screen.getByText('Toolbox', { selector: '.rtx-dock-tab' })).toHaveClass('active-tab');
    expect(screen.getByTitle('Cascade')).toBeEnabled();
    expect(getRequestedBottomDockTab()).toBeNull();
    act(() => openBottomDockTab('Historical Data'));
    expect(screen.getByText('Historical Data', { selector: '.rtx-dock-tab' })).toHaveClass('active-tab');
    expect(getRequestedBottomDockTab()).toBeNull();
  });
});
