// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopToolbar } from './TopToolbar';
import { commandBus } from '../../services/commandBus';

afterEach(() => { cleanup(); commandBus.clearHistory(); });

describe('toolbar selection synchronization', () => {
  it('reflects a restored symbol timeframe without sending a command back to the previous chart', () => {
    commandBus.clearHistory();
    const props = { chartType: 'candlestick' as const, timeframe: 'M5' as const, symbol: 'BTCUSD', onChartTypeChange: vi.fn(), onTimeframeChange: vi.fn() };
    const view = render(<TopToolbar {...props} />);
    expect(screen.getByRole('radio', { name: 'Timeframe: 5 minutes' })).toHaveAttribute('aria-checked', 'true');
    expect(commandBus.getHistory().filter(command => command.type === 'SET_TIMEFRAME' || command.type === 'SET_CHART_TYPE')).toHaveLength(0);
    view.rerender(<TopToolbar {...props} symbol="XAUUSD" timeframe="M1" />);
    expect(screen.getByRole('radio', { name: 'Timeframe: 1 minute' })).toHaveAttribute('aria-checked', 'true');
    expect(commandBus.getHistory().filter(command => command.type === 'SET_TIMEFRAME' || command.type === 'SET_CHART_TYPE')).toHaveLength(0);
    fireEvent.click(screen.getByRole('radio', { name: 'Timeframe: 15 minutes' }));
    expect(commandBus.getHistory().filter(command => command.type === 'SET_TIMEFRAME')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ timeframe: 'M15' }) }),
    ]);
  });
});
