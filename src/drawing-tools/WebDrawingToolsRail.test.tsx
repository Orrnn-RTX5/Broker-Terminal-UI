import { CHART_PATTERN_GROUPS, CHART_PATTERN_TOOLS } from './chartPatternToolCatalog';
// @vitest-environment jsdom

import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const activeChartSource = vi.hoisted(() => ({
  id: 'chart-xauusd-m1' as string | undefined,
}));

vi.mock('../services/activeChartSource', () => ({
  activateActiveChartSource: (id: string) => {
    activeChartSource.id = id;
    return { id, canvas: null, container: null };
  },
  getActiveChartSourceId: () => activeChartSource.id ?? null,
  subscribeActiveChartSource: () => () => {},
  getActiveChartSource: () => activeChartSource.id ? {
    id: activeChartSource.id,
    canvas: null,
    container: null,
    symbol: 'XAUUSD',
    timeframe: 'M1',
  } : null,
}));

import { commandBus } from '../services/commandBus';
import { keyboardShortcutManager } from '../services/keyboardShortcutManager';
import { useDrawingSidebarStore } from '../store/useDrawingSidebarStore';
import { drawingManager } from '../services/drawingManager';
import { STAMP_OPTIONS } from '../components/layout/stampOptions';
import {
  FORECASTING_MEASUREMENT_TOOL_GROUPS,
  FORECASTING_MEASUREMENT_TOOLS,
  type ForecastingMeasurementToolDefinition,
} from './forecastingMeasurementToolCatalog';
import {
  GANN_FIBONACCI_TOOL_GROUPS,
  GANN_FIBONACCI_TOOLS,
  type GannFibonacciToolDefinition,
} from './gannFibonacciToolCatalog';
import { TREND_LINE_TOOLS, type TrendLineToolDefinition } from './toolCatalog';
import { BRUSH_SHAPE_TOOLS } from './brushShapeToolCatalog';
import { useChartObjectStateStore } from '../store/useChartObjectStateStore';
import { useDrawingToolPreferencesStore } from '../store/useDrawingToolPreferencesStore';
import { WebDrawingToolsRail } from './WebDrawingToolsRail';
import { useChartZoomStore } from '../store/useChartZoomStore';
import { useChartCursorStore } from '../store/useChartCursorStore';
import { CURSOR_TOOLS } from './cursorToolCatalog';
import { getPictographItems } from './pictographCatalog';

type TestWindow = Window & { electronAPI?: unknown };

const openTrendMenu = () => {
  fireEvent.click(screen.getByRole('button', { name: /Trend Line Tools$/i }));
  return screen.getByRole('menu', { name: 'Lines, channels, and pitchforks' });
};

const openRailMenu = (buttonName: string | RegExp, menuName: string) => {
  fireEvent.click(screen.getByRole('button', { name: buttonName }));
  return screen.getByRole('menu', { name: menuName });
};

const openGannFibonacciMenu = () => openRailMenu(
  'Fib retracement - Gann and Fibonacci Tools',
  'Gann and Fibonacci tools',
);

const openForecastingMeasurementMenu = () => openRailMenu(
  'Forecasting and measurement tools',
  'Forecasting and measurement tools',
);

const selectTrendTool = (tool: TrendLineToolDefinition) => {
  const menu = openTrendMenu();
  const item = within(menu).getAllByRole('menuitemradio').find(
    (candidate) => candidate.querySelector('.web-drawing-tools-menu__label')?.textContent === tool.label,
  );
  expect(item, `menu item for ${tool.id}`).toBeDefined();
  fireEvent.click(item!);
};

const selectGannFibonacciTool = (tool: GannFibonacciToolDefinition) => {
  const menu = openGannFibonacciMenu();
  const item = menu.querySelector<HTMLButtonElement>(`[data-tool-id="${tool.id}"]`);
  expect(item, `menu item for ${tool.id}`).not.toBeNull();
  expect(item!.querySelector('.web-drawing-tools-menu__label')).toHaveTextContent(tool.label);
  fireEvent.click(item!);
};

const selectForecastingMeasurementTool = (tool: ForecastingMeasurementToolDefinition) => {
  const menu = openForecastingMeasurementMenu();
  const item = menu.querySelector<HTMLButtonElement>(`[data-tool-id="${tool.id}"]`);
  expect(item, `menu item for ${tool.id}`).not.toBeNull();
  expect(item!.querySelector('.web-drawing-tools-menu__label')).toHaveTextContent(tool.label);
  expect(item!.querySelector('[data-tool-icon]')).toHaveAttribute('data-tool-icon', tool.id);
  fireEvent.click(item!);
};

let disposeKeyboard: (() => void) | undefined;
beforeEach(() => {
  cleanup();
  keyboardShortcutManager.clear();
  disposeKeyboard = keyboardShortcutManager.initialize();
  useDrawingSidebarStore.setState({ visible: true, requestedMenu: null });
  commandBus.clearHistory();
  window.localStorage.clear();
  activeChartSource.id = 'chart-xauusd-m1';
  delete (window as TestWindow).electronAPI;
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
  useDrawingToolPreferencesStore.setState({ keepDrawing: false, magnetMode: 'off', snapToIndicators: false });
  useChartObjectStateStore.setState({ byContext: {} });
  useChartZoomStore.setState({ byContext: {} });
  useChartCursorStore.setState({ mode: 'arrow', valuesTooltipOnLongPress: true });
});

afterEach(() => {
  cleanup();
  disposeKeyboard?.();
  keyboardShortcutManager.clear();
  vi.restoreAllMocks();
});

describe('WebDrawingToolsRail', () => {
  it('keeps emojis and trading stamps in separate rail sections and arms the active chart', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const emojiTrigger = screen.getByRole('button', { name: 'Emojis' });
    const stampTrigger = screen.getByRole('button', { name: 'Icons and Stamps' });
    expect(emojiTrigger.querySelector('svg')?.innerHTML).not.toBe(stampTrigger.querySelector('svg')?.innerHTML);
    fireEvent.click(emojiTrigger);
    const picker = screen.getByRole('dialog', { name: 'Emoji picker' });
    expect(within(picker).queryByRole('menuitemradio', { name: 'Thumbs Up' })).not.toBeInTheDocument();
    const emoji = getPictographItems('emojis', 'smileys')[0];
    fireEvent.click(picker.querySelector(`[data-pictograph-id="${emoji.id}"]`)!);
    expect(commandBus.getHistory().at(-1)).toEqual({
      type: 'SELECT_TOOL', payload: { tool: 'stamp', subtype: emoji.id, targetContextId: 'chart-xauusd-m1' },
    });
    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument();
    expect(emojiTrigger).toHaveAttribute('data-active', 'true');
    expect(stampTrigger).toHaveAttribute('data-active', 'false');
    const stamps = openRailMenu('Icons and Stamps', 'Icons and stamps');
    expect(within(stamps).getAllByRole('menuitemradio')).toHaveLength(STAMP_OPTIONS.length);
    fireEvent.click(within(stamps).getByRole('menuitemradio', { name: 'Thumbs Up' }));
    expect(commandBus.getHistory().at(-1)).toEqual({
      type: 'SELECT_TOOL', payload: { tool: 'stamp', subtype: 'thumbsUp', targetContextId: 'chart-xauusd-m1' },
    });
    expect(emojiTrigger).toHaveAttribute('data-active', 'false');
    expect(stampTrigger).toHaveAttribute('data-active', 'true');
  });

  it('dismisses the emoji picker with Escape or an outside press and restores trigger focus', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const trigger = screen.getByRole('button', { name: 'Emojis' });
    fireEvent.click(trigger);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument();
    expect(commandBus.getHistory()).toHaveLength(0);
  });

  it.each(BRUSH_SHAPE_TOOLS)('routes $label to its exact drawing subtype', tool => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const menu = openRailMenu('Brush tools', 'Brushes, arrows, and shapes');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: tool.label }));
    expect(commandBus.getHistory().at(-1)).toEqual({
      type: 'SELECT_TOOL', payload: { tool: 'shapes', subtype: tool.id, targetContextId: 'chart-xauusd-m1' },
    });
  });
  it('renders the screenshot-style icon stack in a stable accessible order', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const rail = screen.getByRole('toolbar', { name: 'Drawing tools for XAUUSD' });
    expect(rail).toHaveClass('web-drawing-tools-rail');
    expect(rail).toHaveAttribute('data-expanded', 'true');
    expect(rail).toHaveAttribute('data-symbol', 'XAUUSD');
    expect(rail).toHaveAttribute('aria-orientation', 'vertical');

    expect(within(rail).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Arrow — Cursors',
      'Trendline — Trend Line Tools',
      'Fib retracement - Gann and Fibonacci Tools',
      'Chart patterns',
      'Forecasting and measurement tools',
      'Brush tools',
      'Annotation Tools',
      'Emojis',
      'Icons and Stamps',
      'Measure',
      'Zoom In',
      'Magnet mode',
      'Keep drawing',
      'Lock objects',
      'Hide objects',
      'Remove Drawings',
    ]);
    expect(screen.queryByRole('button', { name: 'Cursor' })).not.toBeInTheDocument();
    expect(within(rail).getAllByRole('separator')).toHaveLength(3);
  });

  it('opens the TradingView cursors flyout and arms the selected pointer', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const menu = openRailMenu('Arrow — Cursors', 'Cursors');
    expect(within(menu).getAllByRole('menuitemradio').map((item) => item.getAttribute('data-tool-id')))
      .toEqual(CURSOR_TOOLS.map((tool) => tool.id));
    expect(within(menu).getByRole('menuitemradio', { name: 'Arrow' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Demonstration' }));
    expect(useChartCursorStore.getState().mode).toBe('demonstration');
    expect(commandBus.getHistory().at(-1)).toEqual({
      type: 'SELECT_TOOL',
      payload: { tool: 'cursor', targetContextId: 'chart-xauusd-m1' },
    });
    expect(screen.getByRole('button', { name: 'Demonstration — Cursors' })).toHaveAttribute('data-active', 'true');
    expect(screen.queryByRole('menu', { name: 'Cursors' })).not.toBeInTheDocument();
  });

  it('keeps the long-press values tooltip toggle in the cursors menu', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const menu = openRailMenu('Arrow — Cursors', 'Cursors');
    const valuesToggle = within(menu).getByRole('switch', { name: 'Values tooltip on long press' });
    expect(valuesToggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(valuesToggle);
    expect(useChartCursorStore.getState().valuesTooltipOnLongPress).toBe(false);
    expect(screen.getByRole('menu', { name: 'Cursors' })).toBeInTheDocument();
    expect(useChartCursorStore.getState().mode).toBe('arrow');
  });

  it('keeps the exact 17-tool catalog in its three ordered flyout groups', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const menu = openTrendMenu();
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(17);
    expect(within(menu).getAllByText(/^(Lines|Channels|Pitchforks)$/).map((node) => node.textContent))
      .toEqual(['Lines', 'Channels', 'Pitchforks']);
  });

  it.each(TREND_LINE_TOOLS)('$id dispatches its exact subtype to the active chart context', (tool) => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    selectTrendTool(tool);

    expect(commandBus.getHistory()).toEqual([{
      type: 'SELECT_TOOL',
      payload: {
        tool: tool.drawingType,
        subtype: tool.id,
        targetContextId: 'chart-xauusd-m1',
      },
    }]);
    expect(screen.getByRole('button', { name: new RegExp(`${tool.label} — Trend Line Tools$`, 'i') }))
      .toHaveAttribute('data-active', 'true');
    expect(window.localStorage.getItem('rtx5:web:last-trend-line-tool')).toBe(tool.id);
  });

  it('keeps the exact 15-tool Gann and Fibonacci catalog in its two ordered groups', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const trigger = screen.getByRole('button', {
      name: 'Fib retracement - Gann and Fibonacci Tools',
    });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');

    const menu = openGannFibonacciMenu();
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items).toHaveLength(15);
    expect(within(menu).getAllByText(/^(Fibonacci|Gann)$/).map((node) => node.textContent))
      .toEqual([...GANN_FIBONACCI_TOOL_GROUPS]);
    expect(items.map((item) => item.querySelector('.web-drawing-tools-menu__label')?.textContent))
      .toEqual(GANN_FIBONACCI_TOOLS.map((tool) => tool.label));
    expect(items[0]).toHaveTextContent('Alt + F');
  });

  it.each(GANN_FIBONACCI_TOOLS)(
    '$id dispatches its exact Gann/Fibonacci type and subtype to the active chart context',
    (tool) => {
      render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
      selectGannFibonacciTool(tool);

      expect(commandBus.getHistory()).toEqual([{
        type: 'SELECT_TOOL',
        payload: {
          tool: tool.drawingType,
          subtype: tool.id,
          targetContextId: 'chart-xauusd-m1',
        },
      }]);
      expect(screen.getByRole('button', {
        name: 'Fib retracement - Gann and Fibonacci Tools',
      })).toHaveAttribute('data-active', 'true');
    },
  );

  it.each([0, 1])('does not restart an armed pitchfork with %i anchors on the first chart pointer event', (anchorCount) => {
    const armed = vi.spyOn(drawingManager, 'getActiveDrawing').mockReturnValue({
      id: 'armed-pitchfork', type: 'channel', subtype: 'pitchfork',
      points: anchorCount ? [{ time: 150, price: 100 }] : [],
    });
    try {
      render(<>
        <WebDrawingToolsRail selectedSymbol="XAUUSD" />
        <div className="rtx-chart-wrapper" data-testid="active-chart" />
      </>);
      fireEvent.click(within(openTrendMenu()).getByRole('menuitemradio', { name: 'Pitchfork' }));
      expect(commandBus.getHistory()).toHaveLength(1);
      fireEvent.pointerMove(screen.getByTestId('active-chart'));
      fireEvent.pointerDown(screen.getByTestId('active-chart'));
      expect(armed).toHaveBeenCalledWith('chart-xauusd-m1');
      expect(commandBus.getHistory()).toHaveLength(1);
      fireEvent.pointerMove(screen.getByTestId('active-chart'));
      expect(commandBus.getHistory()).toHaveLength(1);
    } finally {
      armed.mockRestore();
    }
  });

  it('re-arms the selected tool for the chart clicked after a dock-tab switch', () => {
    activeChartSource.id = 'chart-before-switch';
    render(
      <>
        <WebDrawingToolsRail selectedSymbol="XAUUSD" />
        <div className="rtx-chart-wrapper" data-testid="active-chart" />
      </>,
    );

    const fibRetracement = GANN_FIBONACCI_TOOLS.find((tool) => tool.id === 'fib_retracement');
    expect(fibRetracement).toBeDefined();
    selectGannFibonacciTool(fibRetracement!);
    expect(commandBus.getHistory()).toHaveLength(1);
    expect(commandBus.getHistory()[0]).toMatchObject({
      payload: { targetContextId: 'chart-before-switch' },
    });

    activeChartSource.id = 'chart-after-switch';
    fireEvent.pointerMove(screen.getByTestId('active-chart'));
    expect(commandBus.getHistory()).toHaveLength(1);
    fireEvent.pointerDown(screen.getByTestId('active-chart'));

    expect(commandBus.getHistory()).toHaveLength(2);
    expect(commandBus.getHistory()[1]).toEqual({
      type: 'SELECT_TOOL',
      payload: {
        tool: 'fibonacci',
        subtype: 'fib_retracement',
        targetContextId: 'chart-after-switch',
      },
    });

    fireEvent.pointerMove(screen.getByTestId('active-chart'));
    expect(commandBus.getHistory()).toHaveLength(2);
  });

  it('keeps the clicked chart selected during sibling hover and arms the sibling before its first drawing point', () => {
    activeChartSource.id = 'chart-a';
    const firstPoint = vi.fn(() => {
      expect(activeChartSource.id).toBe('chart-b');
      expect(commandBus.getHistory().at(-1)).toEqual({
        type: 'SELECT_TOOL', payload: { tool: 'fibonacci', subtype: 'fib_retracement', targetContextId: 'chart-b' },
      });
    });
    render(<>
      <WebDrawingToolsRail selectedSymbol="XAUUSD" orientation="horizontal" />
      <div className="rtx-chart-wrapper" data-chart-context-id="chart-a" data-testid="chart-a" />
      <div className="rtx-chart-wrapper" data-chart-context-id="chart-b" data-testid="chart-b" onPointerDown={firstPoint} />
    </>);
    const fibRetracement = GANN_FIBONACCI_TOOLS.find(tool => tool.id === 'fib_retracement')!;
    selectGannFibonacciTool(fibRetracement);
    expect(commandBus.getHistory().at(-1)).toMatchObject({ payload: { targetContextId: 'chart-a' } });
    fireEvent.pointerMove(screen.getByTestId('chart-b'));
    fireEvent.pointerMove(screen.getByTestId('chart-a'));
    fireEvent.pointerMove(screen.getByTestId('chart-b'));
    expect(activeChartSource.id).toBe('chart-a');
    expect(commandBus.getHistory()).toHaveLength(1);
    fireEvent.pointerDown(screen.getByTestId('chart-b'));
    expect(firstPoint).toHaveBeenCalledOnce();
    expect(commandBus.getHistory()).toHaveLength(2);
    fireEvent.pointerDown(screen.getByTestId('chart-b'));
    expect(firstPoint).toHaveBeenCalledTimes(2);
    expect(commandBus.getHistory()).toHaveLength(2);
  });

  it('keeps the exact 12 Forecasting and Measurement tools in three ordered groups', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const trigger = screen.getByRole('button', {
      name: 'Forecasting and measurement tools',
    });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');

    const menu = openForecastingMeasurementMenu();
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items).toHaveLength(12);
    expect(within(menu).getAllByText(/^(Forecasting|Volume-based|Measurers)$/).map((node) => node.textContent))
      .toEqual([...FORECASTING_MEASUREMENT_TOOL_GROUPS]);
    expect(items.map((item) => item.querySelector('.web-drawing-tools-menu__label')?.textContent))
      .toEqual(FORECASTING_MEASUREMENT_TOOLS.map((tool) => tool.label));
    expect(items.map((item) => item.querySelector('[data-tool-icon]')?.getAttribute('data-tool-icon')))
      .toEqual(FORECASTING_MEASUREMENT_TOOLS.map((tool) => tool.id));
  });

  it.each(FORECASTING_MEASUREMENT_TOOLS)(
    '$id dispatches measure with its exact Forecasting/Measurement subtype to the active chart context',
    (tool) => {
      render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
      selectForecastingMeasurementTool(tool);

      expect(commandBus.getHistory()).toEqual([{
        type: 'SELECT_TOOL',
        payload: {
          tool: 'measure',
          subtype: tool.id,
          targetContextId: 'chart-xauusd-m1',
        },
      }]);
      expect(screen.getByRole('button', {
        name: 'Forecasting and measurement tools',
      })).toHaveAttribute('data-active', 'true');
    },
  );

  it('keeps subtype-less Measure commands visibly active for legacy callers', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);

    act(() => {
      commandBus.dispatch({
        type: 'SELECT_TOOL',
        payload: { tool: 'measure', targetContextId: 'chart-xauusd-m1' },
      });
    });

    expect(screen.getByRole('button', {
      name: 'Forecasting and measurement tools',
    })).toHaveAttribute('data-active', 'true');
    expect(
      within(openForecastingMeasurementMenu())
        .getAllByRole('menuitemradio')
        .every((item) => item.getAttribute('aria-checked') === 'false'),
    ).toBe(true);
  });

  it('opens functional geometric, annotation, and stamp flyouts', () => {
    const { rerender } = render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);

    let menu = openRailMenu('Brush tools', 'Brushes, arrows, and shapes');
    expect(within(menu).getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'Brush',
      'Highlighter',
      'Arrow marker',
      'Arrow',
      'Arrow mark up',
      'Arrow mark down',
        'Rectangle',
        'Rotated rectangle',
        'Path',
        'Circle',
        'Ellipse',
        'Polyline',
        'Triangle',
        'Arc',
        'Curve',
        'Double curve',
    ]);
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Ellipse' }));
    expect(commandBus.getHistory().at(-1)).toEqual({
      type: 'SELECT_TOOL',
        payload: { tool: 'shapes', subtype: 'ellipse', targetContextId: 'chart-xauusd-m1' },
    });

    rerender(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    menu = openRailMenu('Annotation Tools', 'Annotation tools');
    expect(within(menu).getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'Text', 'Note', 'Price note', 'Pin', 'Table', 'Callout', 'Comment', 'Price label', 'Signpost', 'Flag mark', 'Image', 'Post', 'Idea',
    ]);
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Callout' }));
    expect(commandBus.getHistory().at(-1)).toEqual({
      type: 'SELECT_TOOL',
      payload: { tool: 'text', subtype: 'callout', targetContextId: 'chart-xauusd-m1' },
    });

    rerender(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    menu = openRailMenu('Icons and Stamps', 'Icons and stamps');
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(STAMP_OPTIONS.length);
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Thumbs Up' }));
    expect(commandBus.getHistory().at(-1)).toEqual({
      type: 'SELECT_TOOL',
      payload: { tool: 'stamp', subtype: 'thumbsUp', targetContextId: 'chart-xauusd-m1' },
    });
  });

  it('shows a styled portal tooltip on mouse hover and keyboard focus', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(900);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(700);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 50,
      bottom: 60,
      width: 40,
      height: 40,
      toJSON: () => ({}),
    } as DOMRect);

    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const rail = screen.getByRole('toolbar', { name: 'Drawing tools for XAUUSD' });
    const brush = screen.getByRole('button', { name: 'Brush tools' });

    fireEvent.mouseEnter(brush);
    let tooltip = screen.getByRole('tooltip', { name: 'Brush tools' });
    expect(tooltip).toHaveStyle({ left: '58px', top: '40px' });
    expect(brush).toHaveAttribute('aria-describedby', 'web-drawing-tools-tooltip');
    expect(rail).not.toContainElement(tooltip);

    fireEvent.mouseLeave(brush);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.focus(brush);
    tooltip = screen.getByRole('tooltip', { name: 'Brush tools' });
    expect(tooltip).toBeInTheDocument();
    fireEvent.blur(brush);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    const annotations = screen.getByRole('button', { name: 'Annotation Tools' });
    fireEvent.focus(brush);
    fireEvent.mouseEnter(annotations);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Annotation Tools');
    fireEvent.mouseLeave(annotations);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Brush tools');
    fireEvent.blur(brush);

    fireEvent.mouseEnter(brush);
    fireEvent.focus(annotations);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Annotation Tools');
    fireEvent.blur(annotations);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Brush tools');
    fireEvent.mouseLeave(brush);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('provides a hover name for every visible rail icon', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const rail = screen.getByRole('toolbar', { name: 'Drawing tools for XAUUSD' });

    within(rail).getAllByRole('button').forEach((button) => {
      fireEvent.mouseEnter(button);
      expect(screen.getByRole('tooltip')).toHaveTextContent(button.getAttribute('aria-label')!);
      fireEvent.mouseLeave(button);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  it('routes zoom utilities through the active chart command path', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom In' }));

    expect(commandBus.getHistory().slice(-1)).toEqual([
      { type: 'ZOOM_IN', payload: { targetContextId: 'chart-xauusd-m1' } },
    ]);
  });

  it('keeps the full shared catalog and scoped emoji/drawing actions in the horizontal desktop toolbar', () => {
    const view = render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const verticalLabels = within(screen.getByRole('toolbar', { name: 'Drawing tools for XAUUSD' }))
      .getAllByRole('button').map(button => button.getAttribute('aria-label'));
    view.rerender(<WebDrawingToolsRail selectedSymbol="XAUUSD" orientation="horizontal" />);
    const rail = screen.getByRole('toolbar', { name: 'Drawing tools for XAUUSD' });
    expect(rail).toHaveAttribute('aria-orientation', 'horizontal');
    expect(within(rail).getAllByRole('button').map(button => button.getAttribute('aria-label')))
      .toEqual(verticalLabels.filter(label => !['Keep drawing', 'Zoom In', 'Zoom Out'].includes(label)));
    const lines = openTrendMenu();
    expect(within(lines).getAllByRole('menuitemradio')).toHaveLength(TREND_LINE_TOOLS.length);
    const horizontalLine = within(lines).getAllByRole('menuitemradio').find(item =>
      item.querySelector('.web-drawing-tools-menu__label')?.textContent === 'Horizontal line');
    expect(horizontalLine).toBeDefined();
    fireEvent.click(horizontalLine!);
    expect(commandBus.getHistory().at(-1)).toEqual({
      type: 'SELECT_TOOL', payload: { tool: 'hline', subtype: 'horizontal_line', targetContextId: 'chart-xauusd-m1' },
    });
    fireEvent.click(within(rail).getByRole('button', { name: 'Emojis' }));
    const emoji = getPictographItems('emojis', 'smileys')[0];
    fireEvent.click(screen.getByRole('dialog', { name: 'Emoji picker' }).querySelector(`[data-pictograph-id="${emoji.id}"]`)!);
    expect(commandBus.getHistory().at(-1)).toEqual({
      type: 'SELECT_TOOL', payload: { tool: 'stamp', subtype: emoji.id, targetContextId: 'chart-xauusd-m1' },
    });
  });

  it('places horizontal flyouts below the toolbar and keeps them inside a resized viewport', () => {
    let viewportWidth = 500;
    let triggerLeft = 450;
    vi.spyOn(window, 'innerWidth', 'get').mockImplementation(() => viewportWidth);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const isMenu = this.classList.contains('web-drawing-tools-menu');
      const left = isMenu ? 0 : triggerLeft;
      const top = isMenu ? 0 : 84;
      const width = isMenu ? 288 : 36;
      const height = isMenu ? 520 : 32;
      return { x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) } as DOMRect;
    });
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" orientation="horizontal" />);
    const menu = openTrendMenu();
    expect(menu).toHaveStyle({ left: '204px', top: '120px', maxHeight: 'calc(100vh - 128px)' });
    viewportWidth = 1_000;
    triggerLeft = 36;
    act(() => window.dispatchEvent(new Event('resize')));
    expect(menu).toHaveStyle({ left: '36px', top: '120px', maxHeight: 'calc(100vh - 128px)' });
  });

  it('shows zoom out directly below zoom in only after the active chart reports a larger scale', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const zoomIn = screen.getByRole('button', { name: 'Zoom In' });
    fireEvent.click(zoomIn);
    // Dispatch alone must not advertise a successful zoom on an empty chart.
    expect(screen.queryByRole('button', { name: 'Zoom Out' })).not.toBeInTheDocument();

    act(() => {
      const zoom = useChartZoomStore.getState();
      zoom.syncSpacing('chart-xauusd-m1', 30, true);
      zoom.syncSpacing('chart-xauusd-m1', 36);
    });
    const zoomOut = screen.getByRole('button', { name: 'Zoom Out' });
    expect(zoomIn.nextElementSibling).toBe(zoomOut);
    fireEvent.focus(zoomOut);
    fireEvent.click(zoomOut);
    expect(commandBus.getHistory().at(-1)).toEqual({
      type: 'ZOOM_OUT', payload: { targetContextId: 'chart-xauusd-m1' },
    });
    act(() => useChartZoomStore.getState().syncSpacing('chart-xauusd-m1', 30));
    expect(screen.queryByRole('button', { name: 'Zoom Out' })).not.toBeInTheDocument();
    fireEvent.mouseEnter(zoomIn);
    fireEvent.mouseLeave(zoomIn);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('keeps zoom-out availability local to the selected chart, including same-symbol panels', () => {
    useChartZoomStore.getState().syncSpacing('chart-xauusd-m1', 8, true);
    useChartZoomStore.getState().syncSpacing('chart-xauusd-m1', 16);
    const { rerender } = render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    expect(screen.getByRole('button', { name: 'Zoom Out' })).toBeInTheDocument();
    activeChartSource.id = 'second-xauusd-panel';
    rerender(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    expect(screen.queryByRole('button', { name: 'Zoom Out' })).not.toBeInTheDocument();
    activeChartSource.id = 'chart-xauusd-m1';
    rerender(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    expect(screen.getByRole('button', { name: 'Zoom Out' })).toBeInTheDocument();
  });

  it('does not send a zoom command when no chart is available', () => {
    activeChartSource.id = undefined;
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom In' }));
    expect(commandBus.getHistory()).toEqual([]);
  });

  it('offers weak and strong magnet modes plus indicator snapping behind a flyout', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const magnet = screen.getByRole('button', { name: 'Magnet mode' });
    expect(magnet).toHaveAttribute('data-active', 'false');

    const menu = openRailMenu('Magnet mode', 'Magnet mode');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Strong magnet' }));
    expect(useDrawingToolPreferencesStore.getState().magnetMode).toBe('strong');
    expect(screen.getByRole('button', { name: 'Magnet mode' })).toHaveAttribute('data-active', 'true');

    // The flyout stays open so the snap toggle and mode flip remain reachable.
    const openMenu = screen.getByRole('menu', { name: 'Magnet mode' });
    fireEvent.click(within(openMenu).getByRole('switch', { name: 'Snap to indicators' }));
    expect(useDrawingToolPreferencesStore.getState().snapToIndicators).toBe(true);
    fireEvent.click(within(openMenu).getByRole('menuitemradio', { name: 'Strong magnet' }));
    expect(useDrawingToolPreferencesStore.getState().magnetMode).toBe('off');
  });

  it.each(['trendline', 'freehand'] as const)('returns desktop %s tools to idle even with a saved repeat preference', async (type) => {
    useDrawingToolPreferencesStore.setState({ keepDrawing: true });
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" orientation="horizontal" />);
    expect(screen.queryByRole('button', { name: 'Cursor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep drawing' })).not.toBeInTheDocument();
    act(() => commandBus.dispatch({ type: 'SELECT_TOOL', payload: {
      tool: type, targetContextId: 'chart-xauusd-m1',
    } }));
    const history = commandBus.getHistory();
    act(() => window.dispatchEvent(new CustomEvent('drawing:saved', {
      detail: { contextId: 'chart-xauusd-m1', type },
    })));
    await act(async () => { await Promise.resolve(); });
    expect(commandBus.getHistory()).toEqual(history);
    const rail = screen.getByRole('toolbar', { name: 'Drawing tools for XAUUSD' });
    expect(rail.querySelector('[data-active="true"]')).toBeNull();
  });

  it('toggles keep drawing so saved drawings re-arm the same tool', async () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const keep = screen.getByRole('button', { name: 'Keep drawing' });
    expect(keep).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(keep);
    expect(useDrawingToolPreferencesStore.getState().keepDrawing).toBe(true);
    expect(screen.getByRole('button', { name: 'Keep drawing' })).toHaveAttribute('aria-pressed', 'true');

    selectTrendTool(TREND_LINE_TOOLS[0]);
    act(() => {
      window.dispatchEvent(new CustomEvent('drawing:saved', {
        detail: { contextId: 'chart-xauusd-m1', type: 'trendline' },
      }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(commandBus.getHistory().at(-1)).toEqual({
      type: 'SELECT_TOOL',
      payload: { tool: 'trendline', subtype: 'trendline', targetContextId: 'chart-xauusd-m1' },
    });
    expect(screen.getByRole('button', { name: /Trend Line Tools$/i })).toHaveAttribute('data-active', 'true');
  });

  it('locks drawings and indicators per active chart behind the lock flyout', () => {
    const setAllDrawingsLocked = vi.spyOn(drawingManager, 'setAllDrawingsLocked').mockImplementation(() => 0);
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);

    let menu = openRailMenu('Lock objects', 'Lock objects');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Lock drawings' }));
    expect(setAllDrawingsLocked).toHaveBeenCalledWith(true, 'chart-xauusd-m1');
    expect(useChartObjectStateStore.getState().byContext['chart-xauusd-m1']?.drawingsLocked).toBe(true);

    menu = openRailMenu('Lock objects', 'Lock objects');
    expect(within(menu).getByRole('menuitem', { name: 'Unlock drawings' })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Lock indicators' }));
    expect(useChartObjectStateStore.getState().byContext['chart-xauusd-m1']?.indicatorsLocked).toBe(true);
    expect(screen.getByRole('button', { name: 'Lock objects' })).toHaveAttribute('data-active', 'true');
  });

  it('hides drawings, indicators, and trade objects per active chart behind the eye flyout', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);

    let menu = openRailMenu('Hide objects', 'Hide objects');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Hide positions and orders' }));
    expect(useChartObjectStateStore.getState().byContext['chart-xauusd-m1']?.tradesHidden).toBe(true);

    menu = openRailMenu('Hide objects', 'Hide objects');
    expect(within(menu).getByRole('menuitem', { name: 'Show positions and orders' })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Hide all' }));
    expect(useChartObjectStateStore.getState().byContext['chart-xauusd-m1']).toEqual({
      drawingsHidden: true,
      indicatorsHidden: true,
      tradesHidden: true,
      drawingsLocked: false,
      indicatorsLocked: false,
    });
  });

  it('puts destructive actions behind a remove menu and scopes them to the active chart', () => {
    const deleteDrawing = vi.spyOn(drawingManager, 'deleteDrawing').mockImplementation(() => true);
    vi.spyOn(drawingManager, 'getDrawings').mockImplementation(() => [
      { id: 'd-1', locked: false },
      { id: 'd-2', locked: false },
    ] as ReturnType<typeof drawingManager.getDrawings>);
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    act(() => {
      window.dispatchEvent(new CustomEvent('indicators:changed', {
        detail: { contextId: 'chart-xauusd-m1', count: 1 },
      }));
    });

    const menu = openRailMenu('Remove Drawings', 'Remove drawings');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Remove 2 drawings',
      'Remove 1 indicator',
      'Remove 2 drawings & 1 indicator',
    ]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Remove 2 drawings' }));
    expect(deleteDrawing).toHaveBeenCalledWith('d-1', 'chart-xauusd-m1');
    expect(deleteDrawing).toHaveBeenCalledWith('d-2', 'chart-xauusd-m1');
    expect(commandBus.getHistory().at(-1)).toEqual({
      type: 'SELECT_TOOL',
      payload: { tool: 'cursor', targetContextId: 'chart-xauusd-m1' },
    });
  });

  it('matches the reference rail dimensions with a compact fallback and unclipped portals', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/drawing-tools/WebDrawingToolsRail.css'), 'utf8');
    expect(css).toMatch(/\.web-drawing-tools-rail\s*\{[\s\S]*?width:\s*53px;[\s\S]*?min-width:\s*53px;/);
    expect(css).toMatch(/\.web-drawing-tools-rail__button\s*\{[\s\S]*?width:\s*52px;[\s\S]*?height:\s*38px;[\s\S]*?min-height:\s*38px;/);
    expect(css).toMatch(/\.web-drawing-tools-rail__tools\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/);
    expect(css).toMatch(/\.web-drawing-tools-rail__footer\s*\{[\s\S]*?flex:\s*0 0 auto;/);
    expect(css).toMatch(/\.web-drawing-tools-tooltip\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?z-index:\s*10030;/);
    expect(css).toContain('border-top: 1px solid var(--border-secondary);');
    expect(css).toContain('@media (max-height: 620px)');
  });

  it('ignores Cursor and saved events owned by another chart context', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    selectTrendTool(TREND_LINE_TOOLS[13]);
    const trendButton = screen.getByRole('button', { name: /Pitchfork — Trend Line Tools$/i });
    expect(trendButton).toHaveAttribute('data-active', 'true');

    act(() => {
      commandBus.dispatch({
        type: 'SELECT_TOOL',
        payload: { tool: 'cursor', targetContextId: 'chart-other' },
      });
      window.dispatchEvent(new CustomEvent('drawing:saved', {
        detail: { contextId: 'chart-other' },
      }));
    });
    expect(trendButton).toHaveAttribute('data-active', 'true');

    act(() => {
      window.dispatchEvent(new CustomEvent('drawing:saved', {
        detail: { contextId: 'chart-xauusd-m1' },
      }));
    });
    expect(trendButton).toHaveAttribute('data-active', 'false');
  });

  it('clears stale tool state when the active chart changes without a symbol change', () => {
    const { rerender } = render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    let menu = openRailMenu('Brush tools', 'Brushes, arrows, and shapes');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Brush' }));
    expect(screen.getByRole('button', { name: 'Brush tools' })).toHaveAttribute('data-active', 'true');

    activeChartSource.id = 'chart-other';
    rerender(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    expect(screen.getByRole('button', { name: 'Brush tools' })).toHaveAttribute('data-active', 'false');

    act(() => {
      commandBus.dispatch({
        type: 'SELECT_TOOL',
        payload: { tool: 'text', targetContextId: 'chart-xauusd-m1' },
      });
    });
    expect(screen.getByRole('button', { name: 'Annotation Tools' })).toHaveAttribute('data-active', 'false');

    act(() => {
      commandBus.dispatch({
        type: 'SELECT_TOOL',
        payload: { tool: 'text', targetContextId: 'chart-other' },
      });
    });
    expect(screen.getByRole('button', { name: 'Annotation Tools' })).toHaveAttribute('data-active', 'true');

    menu = openRailMenu('Brush tools', 'Brushes, arrows, and shapes');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Ellipse' }));
    expect(commandBus.getHistory().at(-1)).toEqual({
      type: 'SELECT_TOOL',
      payload: { tool: 'shapes', subtype: 'ellipse', targetContextId: 'chart-other' },
    });
  });

  it('uses theme-token menu and tooltip surfaces in both dark and light document modes', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    expect(openTrendMenu()).toHaveClass('web-drawing-tools-menu');
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Brush tools' }));
    expect(screen.getByRole('tooltip')).toHaveClass('web-drawing-tools-tooltip');

    const css = readFileSync(resolve(process.cwd(), 'src/drawing-tools/WebDrawingToolsRail.css'), 'utf8');
    expect(css).toMatch(/\.web-drawing-tools-menu\s*\{[\s\S]*background:\s*var\(--bg-elevated\);/);
    expect(css).toMatch(/\.web-drawing-tools-tooltip\s*\{[\s\S]*background:\s*var\(--bg-elevated\);/);
    expect(css).toMatch(/:root\[data-theme='light'\]\s+\.web-drawing-tools-menu,[\s\S]*color-scheme:\s*light;/);
  });

  it('derives menu placement from the live trigger, menu size, and viewport', () => {
    let viewportWidth = 500;
    let viewportHeight = 400;
    let triggerLeft = 450;
    let triggerTop = 350;
    vi.spyOn(window, 'innerWidth', 'get').mockImplementation(() => viewportWidth);
    vi.spyOn(window, 'innerHeight', 'get').mockImplementation(() => viewportHeight);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const isMenu = this.classList.contains('web-drawing-tools-menu');
      const left = isMenu ? 0 : triggerLeft;
      const top = isMenu ? 0 : triggerTop;
      const width = isMenu ? 265 : 40;
      const height = isMenu ? 380 : 40;
      return {
        x: left,
        y: top,
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        toJSON: () => ({}),
      } as DOMRect;
    });

    render(<WebDrawingToolsRail selectedSymbol="EURUSD" />);
    const menu = openTrendMenu();
    expect(menu).toHaveStyle({ left: '181px', top: '12px' });

    viewportWidth = 1_000;
    viewportHeight = 800;
    triggerLeft = 20;
    triggerTop = 40;
    act(() => window.dispatchEvent(new Event('resize')));
    expect(menu).toHaveStyle({ left: '64px', top: '40px' });
  });

  it.each([
    ['t', 'trendline', 'trendline'],
    ['h', 'horizontal_line', 'hline'],
    ['j', 'horizontal_ray', 'hline'],
    ['v', 'vertical_line', 'vline'],
    ['c', 'crossline', 'vline'],
    ['f', 'fib_retracement', 'fibonacci'],
  ] as const)(
    'registers Alt+%s in the shared manager and selects %s',
    (key, subtype, tool) => {
      render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
      const documentCapture = vi.fn();
      document.addEventListener('keydown', documentCapture, { capture: true });

      const event = new KeyboardEvent('keydown', {
        key,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        document.body.dispatchEvent(event);
      });

      expect(event.defaultPrevented).toBe(true);
      expect(documentCapture).toHaveBeenCalledOnce();
      expect(commandBus.getHistory()).toEqual([{
        type: 'SELECT_TOOL',
        payload: {
          tool,
          subtype,
          targetContextId: 'chart-xauusd-m1',
        },
      }]);

      document.removeEventListener('keydown', documentCapture, { capture: true });
    },
  );

  it('does not capture unrelated Alt shortcuts', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const documentCapture = vi.fn();
    document.addEventListener('keydown', documentCapture, { capture: true });

    const event = new KeyboardEvent('keydown', {
      key: 'b',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(documentCapture).toHaveBeenCalledOnce();
    expect(commandBus.getHistory()).toEqual([]);

    document.removeEventListener('keydown', documentCapture, { capture: true });
  });

  it('registers the same scoped drawing shortcuts in an Electron runtime', () => {
    (window as TestWindow).electronAPI = {};
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const documentCapture = vi.fn();
    document.addEventListener('keydown', documentCapture, { capture: true });

    const event = new KeyboardEvent('keydown', {
      key: 't',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => { document.body.dispatchEvent(event); });

    expect(event.defaultPrevented).toBe(true);
    expect(documentCapture).toHaveBeenCalledOnce();
    expect(commandBus.getHistory()).toEqual([{
      type: 'SELECT_TOOL',
      payload: { tool: 'trendline', subtype: 'trendline', targetContextId: 'chart-xauusd-m1' },
    }]);

    document.removeEventListener('keydown', documentCapture, { capture: true });
  });
});


it.each(CHART_PATTERN_TOOLS)('Chart Patterns menu arms $label on the active chart', tool => {
  render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
  const menu = openRailMenu('Chart patterns', 'Chart patterns');
  expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(14);
  CHART_PATTERN_GROUPS.forEach(group => expect(within(menu).getByRole('region', { name: group })).toBeInTheDocument());
  fireEvent.click(within(menu).getByRole('menuitemradio', { name: tool.label }));
  expect(commandBus.getHistory().at(-1)).toMatchObject({ type: 'SELECT_TOOL', payload: { tool: 'pattern', subtype: tool.id, targetContextId: 'chart-xauusd-m1' } });
  expect(screen.queryByRole('menu', { name: 'Chart patterns' })).not.toBeInTheDocument();
});
