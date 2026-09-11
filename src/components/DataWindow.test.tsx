import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DataWindow from './DataWindow';
import { createChartDataSnapshot } from '../services/chartDataSnapshot';
const state = vi.hoisted(() => ({ read: vi.fn(), listener: null as null | (() => void) }));
vi.mock('../hooks/useUiTranslation', () => ({ useUiTranslation: () => (s: string) => s }));
vi.mock('../services/activeChartSource', () => ({
  getActiveChartSource: () => ({ getDataWindowData: state.read }),
  subscribeActiveChartSource: (listener: () => void) => { state.listener = listener; return () => { state.listener = null; }; },
}));
const candle = { time: 1789128000, open: 4340.12, high: 4344.23, low: 4330.45, close: 4343.67, volume: 123, tickVolume: 17 };
beforeEach(() => { vi.useFakeTimers(); state.read.mockReturnValue(createChartDataSnapshot(candle, 'XAUUSD', 'M1', 2)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('Data Window chart connection', () => {
  it('populates immediately without requiring a mouse event and follows updated candles', () => {
    render(<DataWindow onClose={() => {}} />);
    expect(screen.getByText('XAUUSD,M1')).toBeInTheDocument();
    expect(screen.getByText('4343.67')).toBeInTheDocument();
    state.read.mockReturnValue(createChartDataSnapshot({ ...candle, close: 4342.11 }, 'XAUUSD', 'M1', 2));
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByText('4342.11')).toBeInTheDocument();
  });
  it('switches active charts and clears previous values when the source is removed', () => {
    render(<DataWindow onClose={() => {}} />);
    state.read.mockReturnValue(createChartDataSnapshot({ ...candle, close: 1.12345 }, 'EURUSD', 'H1', 5));
    act(() => { state.listener?.(); });
    expect(screen.getByText('EURUSD,H1')).toBeInTheDocument();
    expect(screen.getByText('1.12345')).toBeInTheDocument();
    state.read.mockReturnValue(null);
    act(() => { state.listener?.(); });
    expect(screen.queryByText('1.12345')).not.toBeInTheDocument();
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves zero volume, broker time offset and unavailable fields honestly', () => {
    const data = createChartDataSnapshot({ ...candle, volume: 0, tickVolume: undefined }, 'TEST', 'M5', 3, 3600)!;
    expect(data.volume).toBe(0);
    expect(data.tickVolume).toBeUndefined();
    expect(data.spread).toBeUndefined();
    expect(data.time).toBe(new Date((candle.time + 3600) * 1000).toISOString().slice(11, 19));
    expect(createChartDataSnapshot(null, 'TEST', 'M5', 3)).toBeNull();
  });
});
