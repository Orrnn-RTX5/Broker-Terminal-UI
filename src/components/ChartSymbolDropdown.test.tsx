// @vitest-environment jsdom
import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartSymbolDropdown, ChartSymbolTrigger } from './ChartSymbolDropdown';

afterEach(() => { cleanup(); delete window.electron; });
describe('chart header symbol dropdown', () => {
  it('identifies the originating pane even when two charts show the same symbol', () => {
    Object.defineProperty(window, 'electron', { configurable: true, value: { window: {} } });
    const request = vi.fn();
    window.addEventListener('request-chart-symbol-change', request);
    try {
      render(<><ChartSymbolTrigger symbol="EURUSD" panelId="chart-a" /><ChartSymbolTrigger symbol="EURUSD" panelId="chart-b" /></>);
      fireEvent.click(screen.getAllByRole('button', { name: 'Change symbol for EURUSD' })[1]);
      expect(request.mock.calls[0][0].detail.panelId).toBe('chart-b');
      expect(request.mock.calls[0][0].detail.anchor).toEqual({ left: 0, bottom: 0 });
    } finally { window.removeEventListener('request-chart-symbol-change', request); }
  });
  it('filters the supplied broker catalog and applies keyboard selection', () => {
    const select = vi.fn(), close = vi.fn();
    render(<ChartSymbolDropdown symbols={['EURUSD.r', 'XAUUSD.raw', 'BTCUSD']} currentSymbol="EURUSD.r" anchor={{ left: 20, bottom: 70 }} onSelect={select} onClose={close} />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'xau' } });
    expect(screen.queryByRole('option', { name: 'EURUSD.r' })).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(select).toHaveBeenCalledExactlyOnceWith('XAUUSD.raw');
    expect(close).toHaveBeenCalledOnce();
  });
  it('does not select on Escape or an empty result', () => {
    const select = vi.fn(), close = vi.fn();
    render(<ChartSymbolDropdown symbols={['EURUSD']} anchor={{ left: 20, bottom: 70 }} onSelect={select} onClose={close} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'missing' } });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(select).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });
});
