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
  getActiveChartSource: () => activeChartSource.id ? {
    id: activeChartSource.id,
    canvas: null,
    container: null,
    symbol: 'XAUUSD',
    timeframe: 'M1',
  } : null,
}));

import { commandBus } from '../services/commandBus';
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
import { WebDrawingToolsRail } from './WebDrawingToolsRail';

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

beforeEach(() => {
  cleanup();
  commandBus.clearHistory();
  window.localStorage.clear();
  activeChartSource.id = 'chart-xauusd-m1';
  delete (window as TestWindow).electronAPI;
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('WebDrawingToolsRail', () => {
  it.each(BRUSH_SHAPE_TOOLS)('routes $label to its exact drawing subtype', tool => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const menu = openRailMenu('Brush tools', 'Brushes, arrows, and shapes');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: tool.label, exact: true }));
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
      'Cursor',
      'Trendline — Trend Line Tools',
      'Fib retracement - Gann and Fibonacci Tools',
      'Forecasting and measurement tools',
      'Brush tools',
      'Annotation Tools',
      'Icons and Stamps',
      'Zoom In',
      'Magnet Mode',
      'Hide drawing tools',
      'Remove Drawings',
    ]);
    expect(screen.getByRole('button', { name: 'Cursor' })).toHaveAttribute('data-active', 'true');
    expect(within(rail).getAllByRole('separator')).toHaveLength(1);
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
      fireEvent.click(within(openTrendMenu()).getByRole('menuitemradio', { name: 'Pitchfork', exact: true }));
      expect(commandBus.getHistory()).toHaveLength(1);
      if (anchorCount) fireEvent.pointerDown(screen.getByTestId('active-chart'));
      else fireEvent.pointerMove(screen.getByTestId('active-chart'));
      expect(armed).toHaveBeenCalledWith('chart-xauusd-m1');
      expect(commandBus.getHistory()).toHaveLength(1);
      fireEvent.pointerMove(screen.getByTestId('active-chart'));
      expect(commandBus.getHistory()).toHaveLength(1);
    } finally {
      armed.mockRestore();
    }
  });

  it('re-arms the selected tool for the chart actually entered after a dock-tab switch', () => {
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
      expect(screen.getByRole('button', { name: 'Cursor' })).toHaveAttribute('data-active', 'false');
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
      'Text',
      'Callout',
    ]);
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Callout' }));
    expect(commandBus.getHistory().at(-1)).toEqual({
      type: 'SELECT_TOOL',
      payload: { tool: 'callout', subtype: undefined, targetContextId: 'chart-xauusd-m1' },
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

  it('keeps the RTX5 collapse control and restores the complete rail without dispatching a tool', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    selectTrendTool(TREND_LINE_TOOLS[1]);
    expect(screen.getByRole('button', { name: /Ray — Trend Line Tools$/i })).toHaveAttribute('data-active', 'true');

    openTrendMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Hide drawing tools' }));

    expect(commandBus.getHistory()).toEqual([{
      type: 'SELECT_TOOL',
      payload: { tool: 'trendline', subtype: 'ray', targetContextId: 'chart-xauusd-m1' },
    }]);

    const rail = screen.getByRole('toolbar', { name: 'Drawing tools for XAUUSD' });
    const showButton = screen.getByRole('button', { name: 'Show drawing tools' });
    expect(rail).toHaveAttribute('data-expanded', 'false');
    expect(showButton).toHaveAttribute('aria-expanded', 'false');
    expect(showButton.querySelector('img')).toHaveAttribute('src', '/favicon.png');
    expect(within(rail).getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(showButton);
    expect(rail).toHaveAttribute('data-expanded', 'true');
    expect(within(rail).getAllByRole('button')).toHaveLength(11);
    expect(screen.getByRole('button', { name: /Ray — Trend Line Tools$/i })).toHaveAttribute('data-active', 'true');
    expect(commandBus.getHistory()).toHaveLength(1);
  });

  it('routes cursor, zoom, and magnet utilities through the active chart command path', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const shapes = openRailMenu('Brush tools', 'Brushes, arrows, and shapes');
    fireEvent.click(within(shapes).getByRole('menuitemradio', { name: 'Brush' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cursor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom In' }));
    const magnet = screen.getByRole('button', { name: 'Magnet Mode' });
    fireEvent.click(magnet);

    expect(commandBus.getHistory().slice(-3)).toEqual([
      { type: 'SELECT_TOOL', payload: { tool: 'cursor', targetContextId: 'chart-xauusd-m1' } },
      { type: 'ZOOM_IN', payload: { targetContextId: 'chart-xauusd-m1' } },
      { type: 'TOGGLE_MAGNET', payload: {} },
    ]);
    expect(magnet).toHaveAttribute('aria-pressed', 'true');
  });

  it('puts destructive actions behind a remove menu and scopes them to the active chart', () => {
    const clearAll = vi.spyOn(drawingManager, 'clearAllDrawings').mockImplementation(() => undefined);
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);

    let menu = openRailMenu('Remove Drawings', 'Remove drawings');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete selected drawing' }));
    expect(commandBus.getHistory().at(-1)).toEqual({
      type: 'DELETE_SELECTED_DRAWING',
      payload: { targetContextId: 'chart-xauusd-m1' },
    });

    menu = openRailMenu('Remove Drawings', 'Remove drawings');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Remove all drawings' }));
    expect(clearAll).not.toHaveBeenCalled();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Click again to remove all drawings' }));
    expect(clearAll).toHaveBeenCalledWith(true, 'chart-xauusd-m1');
    expect(commandBus.getHistory().at(-1)).toEqual({
      type: 'SELECT_TOOL',
      payload: { tool: 'cursor', targetContextId: 'chart-xauusd-m1' },
    });
  });

  it('keeps the 40px rail footprint, compact fallback, and unclipped portal surfaces', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/drawing-tools/WebDrawingToolsRail.css'), 'utf8');
    expect(css).toMatch(/\.web-drawing-tools-rail\s*\{[\s\S]*?width:\s*40px;[\s\S]*?min-width:\s*40px;/);
    expect(css).toMatch(/\.web-drawing-tools-rail__button\s*\{[\s\S]*?width:\s*40px;[\s\S]*?height:\s*40px;[\s\S]*?min-height:\s*40px;/);
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
    expect(screen.getByRole('button', { name: 'Cursor' })).toHaveAttribute('data-active', 'true');

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
    'captures Alt+%s before document-level global shortcuts and selects %s',
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
      expect(documentCapture).not.toHaveBeenCalled();
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

  it('does not register drawing shortcut interception in an Electron runtime', () => {
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
    document.body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(documentCapture).toHaveBeenCalledOnce();
    expect(commandBus.getHistory()).toEqual([]);

    document.removeEventListener('keydown', documentCapture, { capture: true });
  });
});
