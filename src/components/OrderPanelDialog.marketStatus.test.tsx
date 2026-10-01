// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SymbolMarketStatusState } from '../hooks/useSymbolMarketStatus';
import { useAppStore } from '../store/useAppStore';
import { normalizeMarketStatus, type KnownMarketStatus } from '../utils/marketStatus';
import { resetTerminalQuoteFreshness, ingestTerminalQuote } from '../services/terminalQuoteFreshness';
import { OrderPanelDialog } from './OrderPanelDialog';
const quoteSubscription = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useQuoteSubscription', () => ({ useQuoteSubscription: quoteSubscription }));

const marketStatusMock = vi.hoisted(() => ({
  current: {
    symbol: 'EURUSD',
    status: 'open',
    isOpen: true,
    isTradeBlocked: false,
    label: 'Market Open',
    loading: false,
    error: null,
    refreshedAt: 1,
  } as SymbolMarketStatusState,
}));

vi.mock('../hooks/useSymbolMarketStatus', () => ({
  useSymbolMarketStatus: () => marketStatusMock.current,
}));

const setMarketStatus = (status: KnownMarketStatus) => {
  marketStatusMock.current = {
    ...normalizeMarketStatus({ symbol: 'EURUSD', status }),
    loading: false,
    error: null,
    refreshedAt: 1,
  };
};

const setupTick = () => {
  useAppStore.getState().reset();
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
};

const renderDialog = () => render(
  <OrderPanelDialog
    isOpen
    onClose={vi.fn()}
    symbol="EURUSD"
    currentPrice={{ bid: 1.085, ask: 1.0852 }}
    onSubmitOrder={vi.fn()}
  />,
);

describe('OrderPanelDialog market status', () => {
  it('keeps selected-symbol demand while its quote is stale and releases it when closed', () => {
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = { TERMINAL_QUOTE_FRESHNESS: true };
    const props = { onClose: vi.fn(), symbol: 'EURUSD', currentPrice: { bid: 1, ask: 2 }, onSubmitOrder: vi.fn() };
    try {
      const view = render(<OrderPanelDialog {...props} isOpen />);
      expect(quoteSubscription).toHaveBeenLastCalledWith(['EURUSD'], expect.stringContaining('order-dialog:'), { enabled: true });
      expect(screen.getByRole('button', { name: /buy by market/i })).toBeDisabled();
      view.rerender(<OrderPanelDialog {...props} isOpen={false} />);
      expect(quoteSubscription).toHaveBeenLastCalledWith([], expect.stringContaining('order-dialog:'), { enabled: false });
    } finally { delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__; }
  });
  beforeEach(() => {
    localStorage.removeItem('lastLotSize');
    setupTick();
    setMarketStatus('open');
  });

  afterEach(() => {
    cleanup();
  });

  it('enables market execution buttons when the market is open', () => {
    renderDialog();

    expect(screen.getByRole<HTMLButtonElement>('button', { name: /sell by market/i }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /buy by market/i }).disabled).toBe(false);
  });

  it('exposes the themed order surface and live chart accessibly', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog', { name: 'New Order · EURUSD' });
    const chart = screen.getByRole('img', { name: 'Live EURUSD bid and ask tick chart' });

    expect(dialog.className).toContain('rtx-order-dialog');
    expect(dialog.querySelector('.rtx-order-dialog__header')).not.toBeNull();
    expect(dialog.querySelector('.rtx-order-dialog__price-summary')).not.toBeNull();
    expect(chart.getAttribute('data-testid')).toBe('order-mini-tick-chart');
    expect(screen.getByLabelText('EURUSD live bid and ask')).not.toBeNull();
  });

  it.each([
    ['closed', 'Market is closed for EURUSD.'],
    ['pre_market', 'EURUSD is in pre-market. Trading is currently disabled.'],
    ['after_hours', 'EURUSD is after hours. Trading is currently disabled.'],
  ] as const)('disables market execution for %s status', (status, message) => {
    setMarketStatus(status);
    renderDialog();

    expect(screen.getByRole<HTMLButtonElement>('button', { name: /sell by market/i }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /buy by market/i }).disabled).toBe(true);
    expect(screen.getByText(message)).not.toBeNull();
  });
});

describe('OrderPanelDialog symbol dropdown', () => {
  beforeEach(() => {
    setupTick();
    setMarketStatus('open');
    useAppStore.getState().setTicks({
      ...useAppStore.getState().ticks,
      BTCUSD: { symbol: 'BTCUSD', bid: 108000, ask: 108010, spread: 10, timestamp: Date.now(), digits: 2 },
    });
  });

  afterEach(() => {
    cleanup();
  });

  const getSymbolOptions = () => Array.from(
    (screen.getByLabelText('Symbol') as HTMLSelectElement).options,
  ).map((option) => ({ value: option.value, disabled: option.disabled }));

  it('offers only the account symbols instead of every quote in the tick store', () => {
    render(
      <OrderPanelDialog
        isOpen
        onClose={vi.fn()}
        symbol="EURUSD"
        currentPrice={{ bid: 1.085, ask: 1.0852 }}
        onSubmitOrder={vi.fn()}
        symbols={['XAUUSD', 'EURUSD']}
      />,
    );

    expect(getSymbolOptions()).toEqual([
      { value: 'XAUUSD', disabled: false },
      { value: 'EURUSD', disabled: false },
    ]);
  });

  it('keeps the legacy tick-store list for callers without an account catalogue', () => {
    renderDialog();

    expect(getSymbolOptions().map((option) => option.value).sort()).toEqual(['BTCUSD', 'EURUSD']);
  });
});

describe('OrderPanelDialog live instrument specifications', () => {
  beforeEach(() => { localStorage.removeItem('lastLotSize'); setupTick(); setMarketStatus('open'); });
  afterEach(() => cleanup());

  it('updates volume limits on an open ticket without replacing its draft or comment', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const props = {isOpen:true,onClose:vi.fn(),symbol:'EURUSD',currentPrice:{bid:1.085,ask:1.0852},onSubmitOrder:submit,authorizedSymbols:['EURUSD'],authorizationSettled:true};
    const {rerender}=render(<OrderPanelDialog {...props} instruments={[{symbol:'EURUSD',minVolume:0.001,maxVolume:2,volumeStep:0.001}]} />);
    const volume=screen.getByLabelText('Volume') as HTMLInputElement;
    fireEvent.change(volume,{target:{value:'0.015'}});
    fireEvent.change(screen.getByLabelText('Comment'),{target:{value:'keep this draft'}});
    expect((screen.getByRole('button',{name:/buy by market/i}) as HTMLButtonElement).disabled).toBe(false);
    rerender(<OrderPanelDialog {...props} instruments={[{symbol:'EURUSD',minVolume:0.01,maxVolume:1,volumeStep:0.01}]} />);
    expect(volume.value).toBe('0.015');
    expect(volume.getAttribute('data-volume-step')).toBe('0.01');
    expect((screen.getByLabelText('Comment') as HTMLInputElement).value).toBe('keep this draft');
    expect((screen.getByRole('button',{name:/buy by market/i}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.blur(volume);
    expect(volume.value).toBe('0.015');
    expect(submit).not.toHaveBeenCalled();
    fireEvent.change(volume,{target:{value:'0.02'}});
    fireEvent.click(screen.getByRole('button',{name:/buy by market/i}));
    await waitFor(()=>expect(submit).toHaveBeenCalledWith(expect.objectContaining({symbol:'EURUSD',volume:0.02,comment:'keep this draft'})));
  });

  it('keeps an unfinished empty volume through refresh and blocks removed authorization', () => {
    const props = {isOpen:true,onClose:vi.fn(),symbol:'EURUSD',currentPrice:{bid:1.085,ask:1.0852},onSubmitOrder:vi.fn(),instruments:[{symbol:'EURUSD',minVolume:0.1,maxVolume:2,volumeStep:0.1}]};
    const {rerender}=render(<OrderPanelDialog {...props} authorizedSymbols={['EURUSD']} />);
    const volume=screen.getByLabelText('Volume') as HTMLInputElement;
    fireEvent.change(volume,{target:{value:''}});
    rerender(<OrderPanelDialog {...props} authorizedSymbols={[]} authorizationSettled={false} />);
    expect(volume.value).toBe('');
    expect((screen.getByRole('button',{name:/buy by market/i}) as HTMLButtonElement).disabled).toBe(true);
    rerender(<OrderPanelDialog {...props} authorizedSymbols={['EURUSD']} authorizationSettled />);
    expect(volume.value).toBe('');
    fireEvent.change(volume,{target:{value:'0.2'}});
    fireEvent.click(screen.getByRole('button',{name:'Increase volume'}));
    expect(volume.value).toBe('0.3');
    rerender(<OrderPanelDialog {...props} instruments={[]} authorizedSymbols={[]} authorizationSettled />);
    expect(volume.value).toBe('0.3');
    expect((screen.getByRole('button',{name:/buy by market/i}) as HTMLButtonElement).disabled).toBe(true);
  });
});

it('allows uncertain market age with an advisory and submits one user click', async () => {
  setupTick(); setMarketStatus('open');
  (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = {TERMINAL_QUOTE_FRESHNESS:true};
  resetTerminalQuoteFreshness();
  ingestTerminalQuote('EURUSD',{bid:1.085,ask:1.0852,source:'lp',provider_timestamp:Date.now(),sequence:1});
  const submit = vi.fn().mockResolvedValue({});
  try {
    render(<OrderPanelDialog isOpen onClose={vi.fn()} symbol="EURUSD" currentPrice={{bid:1.085,ask:1.0852}} onSubmitOrder={submit} />);
    const buy = screen.getByRole('button',{name:/buy by market/i});
    expect(buy).not.toBeDisabled();
    expect(screen.getByText(/server will validate quote age/)).toBeTruthy();
    fireEvent.click(buy);
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
  } finally {cleanup();delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;resetTerminalQuoteFreshness();}
});
