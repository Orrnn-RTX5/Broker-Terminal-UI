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
import { TREND_LINE_TOOLS, type TrendLineToolDefinition } from './toolCatalog';
import { WebDrawingToolsRail } from './WebDrawingToolsRail';

type TestWindow = Window & { electronAPI?: unknown };

const openMenu = () => {
  fireEvent.click(screen.getByRole('button', { name: /open drawing tools/i }));
  return screen.getByRole('menu', { name: 'Lines, channels, and pitchforks' });
};

const selectMenuTool = (tool: TrendLineToolDefinition) => {
  const menu = openMenu();
  const item = within(menu).getAllByRole('menuitemradio').find(
    (candidate) => candidate.querySelector('.web-drawing-tools-menu__label')?.textContent === tool.label,
  );
  expect(item, `menu item for ${tool.id}`).toBeDefined();
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
  it('renders the exact 17-tool catalog in the three ordered groups', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const rail = screen.getByLabelText('Drawing tools for XAUUSD');
    expect(rail).toHaveClass('web-drawing-tools-rail');
    expect(rail).toHaveAttribute('data-expanded', 'true');
    expect(rail).toHaveAttribute('data-symbol', 'XAUUSD');
    expect(screen.getByRole('button', { name: 'Hide drawing tools' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('button', { name: 'Cursor' })).not.toBeInTheDocument();

    const menu = openMenu();
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(17);
    expect(within(menu).getAllByText(/^(Lines|Channels|Pitchforks)$/).map((node) => node.textContent))
      .toEqual(['Lines', 'Channels', 'Pitchforks']);
  });

  it.each(TREND_LINE_TOOLS)('$id dispatches its exact subtype to the active chart context', (tool) => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    selectMenuTool(tool);

    expect(commandBus.getHistory()).toEqual([{
      type: 'SELECT_TOOL',
      payload: {
        tool: tool.drawingType,
        subtype: tool.id,
        targetContextId: 'chart-xauusd-m1',
      },
    }]);
    expect(screen.getByTitle(tool.label)).toHaveAttribute('data-active', 'true');
    expect(window.localStorage.getItem('rtx5:web:last-trend-line-tool')).toBe(tool.id);
  });

  it('replaces Cursor with the hide toggle, shows the RTX5 mark when collapsed, and restores the tools', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    selectMenuTool(TREND_LINE_TOOLS[1]);
    expect(screen.getByTitle('Ray')).toHaveAttribute('data-active', 'true');

    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Hide drawing tools' }));

    expect(commandBus.getHistory()).toEqual([{
      type: 'SELECT_TOOL',
      payload: { tool: 'trendline', subtype: 'ray', targetContextId: 'chart-xauusd-m1' },
    }]);

    const rail = screen.getByLabelText('Drawing tools for XAUUSD');
    const showButton = screen.getByRole('button', { name: 'Show drawing tools' });
    expect(rail).toHaveAttribute('data-expanded', 'false');
    expect(showButton).toHaveAttribute('aria-expanded', 'false');
    expect(showButton.querySelector('img')).toHaveAttribute('src', '/favicon.png');
    expect(screen.queryByRole('button', { name: /open drawing tools/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: 'Lines, channels, and pitchforks' })).not.toBeInTheDocument();

    fireEvent.click(showButton);
    expect(rail).toHaveAttribute('data-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Hide drawing tools' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open drawing tools/i })).toBeInTheDocument();
    expect(screen.getByTitle('Ray')).toHaveAttribute('data-active', 'true');
    expect(commandBus.getHistory()).toHaveLength(1);
  });

  it('keeps the toggle visually separated from the rail without changing icon geometry', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    const hideButton = screen.getByRole('button', { name: 'Hide drawing tools' });
    expect(hideButton.querySelector('svg')).toBeVisible();

    fireEvent.click(hideButton);
    const showButton = screen.getByRole('button', { name: 'Show drawing tools' });
    expect(showButton.querySelector('img')).toBeVisible();

    const css = readFileSync(resolve(process.cwd(), 'src/drawing-tools/WebDrawingToolsRail.css'), 'utf8');
    const ruleBody = (selector: string) => {
      const ruleStart = css.indexOf(`${selector} {`);
      expect(ruleStart).toBeGreaterThanOrEqual(0);
      return css.slice(ruleStart, css.indexOf('}', ruleStart));
    };
    const baseToggleRule = ruleBody('.web-drawing-tools-rail__toggle');
    const expandedToggleRule = ruleBody(
      ".web-drawing-tools-rail[data-expanded='true'] .web-drawing-tools-rail__toggle",
    );

    expect(baseToggleRule).toContain('border-bottom: 1px solid var(--border-secondary);');
    expect(baseToggleRule).toContain('background: var(--bg-quaternary);');
    expect(baseToggleRule).toContain('color: var(--text-primary);');
    expect(expandedToggleRule).toContain(
      'background: color-mix(in srgb, var(--web-drawing-accent) 18%, var(--bg-quaternary));',
    );
    expect(expandedToggleRule).toContain(
      'color: color-mix(in srgb, var(--web-drawing-accent) 48%, var(--text-primary));',
    );
    expect(expandedToggleRule).toContain('box-shadow: inset 2px 0 0 var(--web-drawing-accent);');
  });

  it('ignores Cursor and saved events owned by another chart context', () => {
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    selectMenuTool(TREND_LINE_TOOLS[13]);
    expect(screen.getByTitle('Pitchfork')).toHaveAttribute('data-active', 'true');

    act(() => {
      commandBus.dispatch({
        type: 'SELECT_TOOL',
        payload: { tool: 'cursor', targetContextId: 'chart-other' },
      });
      window.dispatchEvent(new CustomEvent('drawing:saved', {
        detail: { contextId: 'chart-other' },
      }));
    });
    expect(screen.getByTitle('Pitchfork')).toHaveAttribute('data-active', 'true');

    act(() => {
      window.dispatchEvent(new CustomEvent('drawing:saved', {
        detail: { contextId: 'chart-xauusd-m1' },
      }));
    });
    expect(screen.getByTitle('Pitchfork')).toHaveAttribute('data-active', 'false');
  });

  it('uses the theme-token surface class in both dark and light document modes', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    render(<WebDrawingToolsRail selectedSymbol="XAUUSD" />);
    expect(openMenu()).toHaveClass('web-drawing-tools-menu');

    const css = readFileSync(resolve(process.cwd(), 'src/drawing-tools/WebDrawingToolsRail.css'), 'utf8');
    expect(css).toMatch(/\.web-drawing-tools-menu\s*\{[\s\S]*background:\s*var\(--bg-elevated\);/);
    expect(css).toMatch(/\.web-drawing-tools-menu\s*\{[\s\S]*color:\s*var\(--text-primary\);/);
    expect(css).toMatch(/:root\[data-theme='light'\]\s+\.web-drawing-tools-menu,[\s\S]*color-scheme:\s*light;/);
    expect(css).not.toMatch(/\.web-drawing-tools-menu\s*\{[^}]*background:\s*#(?:fff|ffffff)\b/i);
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
    const menu = openMenu();

    // There is no room on the right or below, so the measured menu flips left
    // and remains inside the measured viewport.
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
