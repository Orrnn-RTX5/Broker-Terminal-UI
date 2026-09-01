// @vitest-environment jsdom

import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandBus } from '../../services/commandBus';
import { LeftDrawingToolbar } from './LeftDrawingToolbar';

beforeEach(() => {
  window.localStorage.clear();
  commandBus.clearHistory();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LeftDrawingToolbar', () => {
  it('supports the compact horizontal Electron toolbar without changing the drawing catalog', () => {
    render(<LeftDrawingToolbar selectedSymbol="XAUUSD" orientation="horizontal" />);

    const toolbar = screen.getByLabelText('Drawing tools for XAUUSD');
    expect(toolbar).toHaveAttribute('data-orientation', 'horizontal');
    expect(toolbar).toHaveClass('left-drawing-toolbar--horizontal');

    fireEvent.click(screen.getByRole('button', { name: /Trendline/i }));
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(17);
  });

  it('opens the exact 17-tool menu in the three TradingView groups without shortcuts', () => {
    render(<LeftDrawingToolbar selectedSymbol="BTCUSD" />);
    fireEvent.click(screen.getByRole('button', { name: /Trendline — open trend line tools/i }));

    const menu = screen.getByRole('menu', { name: 'Trend line tools' });
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(17);
    expect(within(menu).getByText('Lines')).toBeInTheDocument();
    expect(within(menu).getByText('Channels')).toBeInTheDocument();
    expect(within(menu).getByText('Pitchforks')).toBeInTheDocument();
    expect(menu).toHaveTextContent('Modified Schiff pitchfork');
    expect(menu).not.toHaveTextContent(/Alt\s*\+/i);
  });

  it('dispatches the selected subtype and replaces the collapsed rail icon label', () => {
    const dispatch = vi.spyOn(commandBus, 'dispatch');
    render(<LeftDrawingToolbar selectedSymbol="BTCUSD" />);

    fireEvent.click(screen.getByRole('button', { name: /Trendline — open trend line tools/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Info line' }));

    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'SELECT_TOOL',
      payload: { tool: 'trendline', subtype: 'info_line' },
    });
    expect(screen.queryByRole('menu', { name: 'Trend line tools' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Info line — open trend line tools/i })).toHaveAttribute('data-active', 'true');
    expect(window.localStorage.getItem('rtx5:last-trend-line-tool')).toBe('info_line');

    act(() => {
      window.dispatchEvent(new CustomEvent('drawing:saved'));
    });
    expect(screen.getByRole('button', { name: /Info line — open trend line tools/i })).toHaveAttribute('data-active', 'false');
  });

  it('syncs external selections and keeps the active chart symbol on the rail', () => {
    render(<LeftDrawingToolbar selectedSymbol="EURUSD" />);
    act(() => {
      commandBus.dispatch({
        type: 'SELECT_TOOL',
        payload: { tool: 'channel', subtype: 'pitchfork' },
      });
    });

    const rail = screen.getByLabelText('Drawing tools for EURUSD');
    expect(rail).toHaveAttribute('data-symbol', 'EURUSD');
    expect(screen.getByRole('button', { name: /Pitchfork — open trend line tools/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cursor' }));
    expect(screen.getByRole('button', { name: 'Cursor' })).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: /Pitchfork — open trend line tools/i })).toBeInTheDocument();
  });
});
