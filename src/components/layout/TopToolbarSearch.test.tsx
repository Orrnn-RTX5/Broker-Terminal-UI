import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TopToolbarSearch } from './TopToolbarSearch';
import { commandBus } from '../../services/commandBus';
import { useAppStore } from '../../store/useAppStore';

describe('TopToolbarSearch (Zero-Dropdown Direct In-Place UI Locator)', () => {
  const defaultProps = {
    selectedSymbol: 'EURUSD',
    timeframe: 'M1' as const,
    chartType: 'candlestick' as const,
    onSymbolChange: vi.fn(),
    onTimeframeChange: vi.fn(),
    onChartTypeChange: vi.fn(),
    onNewOrder: vi.fn(),
    onOpenSymbols: vi.fn(),
    onOpenChart: vi.fn(),
    onOpenHistoryDownloader: vi.fn(),
    onOpenDepthOfMarket: vi.fn(),
    onOpenChartProperties: vi.fn(),
    onOpenChartObjects: vi.fn(),
    onTileWindows: vi.fn(),
    onCascadeWindows: vi.fn(),
    onResetWindows: vi.fn(),
    onPrintChart: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      symbols: [
        { symbol: 'GBPUSD', description: 'Great Britain Pound vs US Dollar', category: 'Forex', digits: 5 },
      ] as never,
    });
  });

  it('never renders a dropdown popover under the search bar and highlights Log Out directly inside Trading accounts', () => {
    const revealSpy = vi.fn();
    window.addEventListener('rtx:reveal-menu-path', revealSpy);

    const mockLogoutBtn = document.createElement('button');
    mockLogoutBtn.setAttribute('data-file-menu-item', 'logout');
    mockLogoutBtn.getBoundingClientRect = () => ({
      top: 120,
      left: 410,
      width: 88,
      height: 28,
      bottom: 148,
      right: 498,
      x: 410,
      y: 120,
      toJSON: () => ({}),
    });
    document.body.appendChild(mockLogoutBtn);

    render(<TopToolbarSearch {...defaultProps} />);
    const input = screen.getByRole('searchbox', { name: /search anywhere in application/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'logout' } });

    expect(document.querySelector('.rtx-toolbar-search__popover')).toBeNull();
    expect(revealSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          webRootId: 'trading-accounts',
          desktopMenuKey: 'File',
          submenuPath: [],
          openDepth: 0,
        },
      }),
    );
    expect(mockLogoutBtn.classList.contains('rtx-search-located-target')).toBe(true);
    expect(document.querySelector('.rtx-ui-spotlight-layer')).toBeNull();

    fireEvent.change(input, { target: { value: '' } });
    expect(mockLogoutBtn.classList.contains('rtx-search-located-target')).toBe(false);

    document.body.removeChild(mockLogoutBtn);
    window.removeEventListener('rtx:reveal-menu-path', revealSpy);
  });

  it('opens the Left Drawing Rail Trend flyout and highlights Trendline directly in place when searching "Trendline"', () => {
    const drawingSpy = vi.fn();
    window.addEventListener('rtx:reveal-drawing-menu', drawingSpy);

    const mockRailBtn = document.createElement('button');
    mockRailBtn.setAttribute('data-rail-menu', 'trend');
    mockRailBtn.getBoundingClientRect = () => ({
      top: 110,
      left: 8,
      width: 34,
      height: 34,
      bottom: 144,
      right: 42,
      x: 8,
      y: 110,
      toJSON: () => ({}),
    });

    const mockFlyout = document.createElement('div');
    mockFlyout.setAttribute('data-menu', 'trend');
    const mockTrendItem = document.createElement('button');
    mockTrendItem.className = 'web-drawing-tools-menu__item';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'web-drawing-tools-menu__label';
    labelSpan.textContent = 'Trendline';
    mockTrendItem.appendChild(labelSpan);
    mockTrendItem.getBoundingClientRect = () => ({
      top: 130,
      left: 52,
      width: 180,
      height: 32,
      bottom: 162,
      right: 232,
      x: 52,
      y: 130,
      toJSON: () => ({}),
    });
    mockFlyout.appendChild(mockTrendItem);
    document.body.appendChild(mockRailBtn);
    document.body.appendChild(mockFlyout);

    render(<TopToolbarSearch {...defaultProps} />);
    const input = screen.getByRole('searchbox', { name: /search anywhere in application/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Trendline' } });

    expect(document.querySelector('.rtx-toolbar-search__popover')).toBeNull();
    expect(drawingSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { menuId: 'trend' },
      }),
    );
    expect(mockRailBtn.classList.contains('rtx-search-located-step')).toBe(true);
    expect(mockTrendItem.classList.contains('rtx-search-located-target')).toBe(true);

    document.body.removeChild(mockRailBtn);
    document.body.removeChild(mockFlyout);
    window.removeEventListener('rtx:reveal-drawing-menu', drawingSpy);
  });

  it('reveals Menu Bar Indicators submenu and highlights Top Toolbar Indicators List button simultaneously when searching "Bollinger"', () => {
    const revealSpy = vi.fn();
    window.addEventListener('rtx:reveal-menu-path', revealSpy);

    const mockToolbarIndBtn = document.createElement('button');
    mockToolbarIndBtn.setAttribute('aria-label', 'Indicators List');
    mockToolbarIndBtn.getBoundingClientRect = () => ({
      top: 8,
      left: 360,
      width: 28,
      height: 28,
      bottom: 36,
      right: 388,
      x: 360,
      y: 8,
      toJSON: () => ({}),
    });
    document.body.appendChild(mockToolbarIndBtn);

    render(<TopToolbarSearch {...defaultProps} />);
    const input = screen.getByRole('searchbox', { name: /search anywhere in application/i });
    fireEvent.change(input, { target: { value: 'Bollinger' } });

    expect(revealSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          webRootId: 'chart-settings',
          desktopMenuKey: 'Insert',
          submenuPath: ['Insert & drawing tools', 'Indicators'],
          openDepth: 0,
        },
      }),
    );
    expect(mockToolbarIndBtn.classList.contains('rtx-search-located-target')).toBe(true);

    document.body.removeChild(mockToolbarIndBtn);
    window.removeEventListener('rtx:reveal-menu-path', revealSpy);
  });

  it('automatically reveals the Top Toolbar Trade History Overlays dropdown sheet when searching "arrows"', () => {
    const dropdownSpy = vi.fn();
    window.addEventListener('rtx:reveal-toolbar-dropdown', dropdownSpy);

    render(<TopToolbarSearch {...defaultProps} />);
    const input = screen.getByRole('searchbox', { name: /search anywhere in application/i });
    fireEvent.change(input, { target: { value: 'arrows' } });

    expect(dropdownSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { id: 'trade-history-overlays' },
      }),
    );
    window.removeEventListener('rtx:reveal-toolbar-dropdown', dropdownSpy);
  });

  it('does not execute options that have an action sheet (e.g. theme, RSI, insert) on Enter, but performs the action on Enter when the option has no action sheet (e.g. Candlesticks, M15, New Order, GBPUSD)', () => {
    const dispatchSpy = vi.spyOn(commandBus, 'dispatch');
    render(<TopToolbarSearch {...defaultProps} />);

    const input = screen.getByRole('searchbox', { name: /search anywhere in application/i });

    // 1. Options WITH an action sheet should NOT execute or mutate theme on Enter
    fireEvent.change(input, { target: { value: 'theme' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    fireEvent.change(input, { target: { value: 'RSI' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(dispatchSpy).not.toHaveBeenCalled();

    // 2. Options WITHOUT an action sheet SHOULD perform their action on Enter
    fireEvent.change(input, { target: { value: 'Candlesticks' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(defaultProps.onChartTypeChange).toHaveBeenCalledWith('candlestick');

    fireEvent.change(input, { target: { value: 'M15' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(defaultProps.onTimeframeChange).toHaveBeenCalledWith('M15');

    fireEvent.change(input, { target: { value: 'New Order' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(defaultProps.onNewOrder).toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'GBPUSD' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(defaultProps.onSymbolChange).toHaveBeenCalledWith('GBPUSD');
    expect(defaultProps.onOpenChart).toHaveBeenCalledWith('GBPUSD');
  });

  it('does not open menus on 1-letter or 2-letter inputs ("i", "in", "ind", "ins") and only reveals once a complete word ("insert", "indicator", or "incator") is written', () => {
    const revealSpy = vi.fn();
    window.addEventListener('rtx:reveal-menu-path', revealSpy);

    render(<TopToolbarSearch {...defaultProps} />);
    const input = screen.getByRole('searchbox', { name: /search anywhere in application/i });

    for (const partial of ['i', 'in', 'ind', 'indi', 'ins', 'inse', 'inser']) {
      fireEvent.change(input, { target: { value: partial } });
      expect(revealSpy).not.toHaveBeenCalled();
    }

    fireEvent.change(input, { target: { value: 'insert' } });
    expect(revealSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          webRootId: 'chart-settings',
          desktopMenuKey: 'Insert',
          submenuPath: ['Insert & drawing tools'],
          openDepth: 0,
        },
      }),
    );

    revealSpy.mockClear();
    fireEvent.change(input, { target: { value: 'incator' } });
    expect(revealSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          webRootId: 'chart-settings',
          desktopMenuKey: 'Insert',
          submenuPath: ['Insert & drawing tools', 'Indicators'],
          openDepth: 0,
        },
      }),
    );

    window.removeEventListener('rtx:reveal-menu-path', revealSpy);
  });

  it('opens only the 1st action sheet initially, opens the 2nd action sheet on ArrowRight, navigates up/down among options (e.g. Color Templates: Green and Red -> Yellow and White), and executes on Enter', () => {
    const revealSpy = vi.fn();
    window.addEventListener('rtx:reveal-menu-path', revealSpy);

    const rect = {
      top: 40,
      left: 10,
      width: 240,
      height: 32,
      bottom: 72,
      right: 250,
      x: 10,
      y: 40,
      toJSON: () => ({}),
    };

    // Mock 1st Action Sheet (.rtx-application-menu) with Color Templates root item
    const appMenu = document.createElement('div');
    appMenu.className = 'rtx-application-menu';
    appMenu.getBoundingClientRect = () => rect;

    const colorTemplatesBtn = document.createElement('button');
    colorTemplatesBtn.setAttribute('data-root-menu-item', 'true');
    colorTemplatesBtn.setAttribute('data-menu-key', 'color-templates');
    colorTemplatesBtn.setAttribute('aria-haspopup', 'menu');
    colorTemplatesBtn.textContent = 'Color Templates';
    colorTemplatesBtn.getBoundingClientRect = () => rect;
    appMenu.appendChild(colorTemplatesBtn);
    document.body.appendChild(appMenu);

    render(<TopToolbarSearch {...defaultProps} />);
    const input = screen.getByRole('searchbox', { name: /search anywhere in application/i });

    // Step 1: Search "color templates" -> only 1st action sheet opens (openDepth: 0), highlighting Color Templates
    fireEvent.change(input, { target: { value: 'color templates' } });
    expect(revealSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        detail: {
          webRootId: 'color-templates',
          desktopMenuKey: 'Charts',
          submenuPath: [],
          openDepth: 0,
        },
      }),
    );
    expect(colorTemplatesBtn.classList.contains('rtx-search-located-target')).toBe(true);

    // Pressing Enter while on parent Color Templates (has child action sheet) should NOT trigger an action
    const parentClickSpy = vi.fn();
    colorTemplatesBtn.addEventListener('click', parentClickSpy);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(parentClickSpy).not.toHaveBeenCalled();

    // Step 2: Press ArrowRight -> opens 2nd action sheet (openDepth: 1)
    const secondSheet = document.createElement('div');
    secondSheet.className = 'rtx-menu-surface';
    secondSheet.getBoundingClientRect = () => rect;

    const schemeNames = [
      'Green and Red',
      'Green and White',
      'Green and Blue',
      'Blue and White',
      'Blue and Red',
      'Gray and White',
      'Yellow and White',
    ];
    const schemeBtns = schemeNames.map((name) => {
      const btn = document.createElement('button');
      btn.className = 'rtx-menu-row';
      btn.setAttribute('data-menu-item-label', name);
      btn.textContent = name;
      btn.getBoundingClientRect = () => rect;
      secondSheet.appendChild(btn);
      return btn;
    });
    appMenu.appendChild(secondSheet);

    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(revealSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        detail: {
          webRootId: 'color-templates',
          desktopMenuKey: 'Charts',
          submenuPath: [],
          openDepth: 1,
        },
      }),
    );
    expect(schemeBtns[0].classList.contains('rtx-search-located-target')).toBe(true);

    // Step 3: Navigate down with ArrowDown from "Green and Red" to "Yellow and White" (6 steps)
    for (let i = 0; i < 6; i++) {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
    }
    expect(schemeBtns[0].classList.contains('rtx-search-located-target')).toBe(false);
    expect(schemeBtns[6].classList.contains('rtx-search-located-target')).toBe(true);

    // Navigate up 1 step to "Gray and White" and back down to "Yellow and White"
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(schemeBtns[5].classList.contains('rtx-search-located-target')).toBe(true);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(schemeBtns[6].classList.contains('rtx-search-located-target')).toBe(true);

    // Step 4: Press Enter on "Yellow and White" (single option) -> executes its action!
    const yellowWhiteClickSpy = vi.fn();
    schemeBtns[6].addEventListener('click', yellowWhiteClickSpy);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(yellowWhiteClickSpy).toHaveBeenCalledTimes(1);

    document.body.removeChild(appMenu);
    window.removeEventListener('rtx:reveal-menu-path', revealSpy);
  });
});
