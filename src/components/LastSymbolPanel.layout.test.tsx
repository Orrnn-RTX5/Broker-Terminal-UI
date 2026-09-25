// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  closePosition: vi.fn(),
  placeMarketOrder: vi.fn(),
  marketStatus: {
    status: 'open',
    isOpen: true,
    label: 'Market Open',
    reason: '',
  },
}));

vi.mock('../services/api', () => ({
  api: {
    orders: { placeMarketOrder: mocks.placeMarketOrder },
    positions: { closePosition: mocks.closePosition },
  },
}));

vi.mock('../hooks/useSymbolMarketStatus', () => ({
  useSymbolMarketStatus: (symbol: string) => ({
    symbol,
    ...mocks.marketStatus,
  }),
}));

import { useAppStore } from '../store/useAppStore';
import { useLastSymbolStore } from '../store/useLastSymbolStore';
import { LastSymbolPanel } from './LastSymbolPanel';

const firePointer = (element: Element, type: string, clientX: number, clientY: number) => {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(element, event);
};

const setEmptyPanelState = () => {
  useAppStore.getState().reset();
  useAppStore.setState({ accountId: '200002', isAuthenticated: true, authToken: 'layout-test-token' });
  useLastSymbolStore.setState({
    lastSymbol: '',
    lastTradeSide: null,
    lastTradeTime: 0,
    panelVisible: true,
    volume: 0.01,
    useRiskSizing: false,
    riskPercent: 1,
    autoSLTP: false,
    slPips: 30,
    tpPips: 60,
  });
};

describe('LastSymbolPanel enterprise layout', () => {
  beforeEach(() => {
    localStorage.clear();
    setEmptyPanelState();
    mocks.placeMarketOrder.mockReset();
    mocks.closePosition.mockReset();
    Object.assign(mocks.marketStatus, {
      status: 'open',
      isOpen: true,
      label: 'Market Open',
      reason: '',
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('presents a clear, accessible idle state', () => {
    render(<LastSymbolPanel />);

    expect(screen.getByRole('region', { name: 'Last symbol trader' })).toBeInTheDocument();
    expect(screen.getByText('Missing symbol')).toBeInTheDocument();
    expect(screen.getByText('Idle')).toHaveAttribute('data-tone', 'idle');

    expect(screen.getByRole('button', { name: 'Sell Last Symbol at market' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Buy Last Symbol at market' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close all Last Symbol positions' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decrease order volume' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'Order volume in lots' })).toHaveValue(0.01);
  });

  it('opens centered on physical pixels without a text transform or restoring an old position', () => {
    localStorage.setItem('lst_panel_pos', JSON.stringify({ x: 9999, y: 9999 }));
    vi.stubGlobal('devicePixelRatio', 1.25);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 368, 461));

    render(<LastSymbolPanel />);

    const panel = screen.getByRole('region', { name: 'Last symbol trader' });
    expect(panel).toHaveStyle({
      left: `${Math.round((window.innerWidth - 368) / 2 * 1.25) / 1.25}px`,
      top: `${Math.round((window.innerHeight - 461) / 2 * 1.25) / 1.25}px`,
    });
    expect(panel.style.transform).toBe('');
  });

  it('drags by the title bar without jumping, keeps the new position on resize, and stops on cancellation', () => {
    render(<LastSymbolPanel />);
    const panel = screen.getByRole('region', { name: 'Last symbol trader' });
    const header = screen.getByText('Last Symbol Trader').closest('header')!;
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 368, 460));
    Object.defineProperty(panel, 'offsetWidth', { configurable: true, value: 368 });
    Object.defineProperty(panel, 'offsetHeight', { configurable: true, value: 460 });
    const capture = vi.fn();
    Object.defineProperty(header, 'setPointerCapture', { configurable: true, value: capture });

    firePointer(header, 'pointerdown', 125, 115);
    firePointer(header, 'pointermove', 205, 165);
    expect(capture).toHaveBeenCalledWith(1);
    expect(panel).toHaveStyle({ left: '180px', top: '150px' });
    fireEvent(window, new Event('resize'));
    expect(panel).toHaveStyle({ left: '180px', top: '150px' });
    firePointer(header, 'pointercancel', 205, 165);
    firePointer(header, 'pointermove', 300, 200);
    expect(panel).toHaveStyle({ left: '180px', top: '150px' });
    expect(panel).not.toHaveClass('is-dragging');
    expect(mocks.placeMarketOrder).not.toHaveBeenCalled();
    expect(mocks.closePosition).not.toHaveBeenCalled();
  });

  it('exposes settings and panel controls with explicit state', () => {
    render(<LastSymbolPanel />);

    const settings = screen.getByRole('button', { name: 'Execution settings' });
    expect(settings).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(settings);
    expect(settings).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Execution settings panel' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Risk-based sizing/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Automatic protection/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close trader panel' }));
    expect(useLastSymbolStore.getState().panelVisible).toBe(false);
  });

  it('maps live bid and ask prices to explicit sell and buy actions', () => {
    useAppStore.getState().setTicks({
      EURUSD: {
        symbol: 'EURUSD',
        bid: 1.085,
        ask: 1.0852,
        spread: 0.0002,
        timestamp: Date.now(),
        digits: 5,
      },
    });
    useAppStore.setState({
      account: {
        balance: 10896.61,
        equity: 10920.71,
        margin: 20,
        freeMargin: 10900.71,
        unrealizedPL: 24.1,
        marginLevel: 500,
        currency: 'USD',
        leverage: 100,
      },
      positions: [{
        id: 901,
        symbol: 'EURUSD',
        side: 'BUY',
        volume: 0.05,
        openPrice: 1.08,
        currentPrice: 1.085,
        openTime: new Date().toISOString(),
        sl: 0,
        tp: 0,
        swap: 0,
        commission: 0,
        unrealizedPnL: 24.1,
      }],
    });
    useLastSymbolStore.setState({
      lastSymbol: 'EURUSD',
      lastTradeSide: 'BUY',
      lastTradeTime: Date.now(),
      volume: 0.05,
    });

    render(<LastSymbolPanel />);

    expect(screen.getByText('Live')).toHaveAttribute('data-tone', 'live');
    const sell = screen.getByRole('button', { name: 'Sell EURUSD at market' });
    const buy = screen.getByRole('button', { name: 'Buy EURUSD at market' });
    expect(within(sell).getByText('1.08500')).toBeInTheDocument();
    expect(within(buy).getByText('1.08520')).toBeInTheDocument();
    expect(sell).toBeEnabled();
    expect(buy).toBeEnabled();

    expect(screen.getByText('10,896.61')).toBeInTheDocument();
    expect(screen.getByText('10,920.71 USD')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close all EURUSD positions' })).toBeEnabled();

    const preset = screen.getByRole('button', { name: 'Set order volume to 0.1 lots' });
    fireEvent.click(preset);
    expect(useLastSymbolStore.getState().volume).toBe(0.1);
    expect(preset).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not alias a suffixed contract quote to the base symbol', () => {
    useAppStore.getState().setTicks({
      'XAUUSD.raw': {
        symbol: 'XAUUSD.raw',
        bid: 2500,
        ask: 2500.2,
        spread: 0.2,
        timestamp: Date.now(),
        digits: 2,
      },
    });
    useLastSymbolStore.setState({ lastSymbol: 'XAUUSD' });

    render(<LastSymbolPanel />);

    expect(screen.getByText('Awaiting quote')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sell XAUUSD at market' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Buy XAUUSD at market' })).toBeDisabled();
  });
});
