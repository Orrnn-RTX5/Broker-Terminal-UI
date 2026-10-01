import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './client';
import { prepareOrderSubmission, tradingApi } from './endpoints';
import { tradingV2Api } from './trade';
import { resetTerminalQuoteFreshness, ingestTerminalQuote, calibrateTerminalQuoteClock, getTerminalQuoteFreshness, assertTerminalQuoteFresh, assertTerminalMarketOrderQuote } from '../services/terminalQuoteFreshness';
const epoch = 1800000000000;
const order = {symbol:'XAUUSD',side:'buy',volume:0.01,login:200038} as const;
const quote = {bid:100,ask:101,source:'lp',provider_timestamp:epoch,sequence:1};
describe('backend-authoritative market quote age', () => {
  beforeEach(() => {
    vi.spyOn(Date,'now').mockReturnValue(epoch); vi.spyOn(performance,'now').mockReturnValue(0);
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = {TERMINAL_QUOTE_FRESHNESS:true};
    resetTerminalQuoteFreshness();
  });
  afterEach(() => {vi.restoreAllMocks(); delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;});
  it('submits uncertain market routes once each while strict pending and execution guards remain blocked', async () => {
    ingestTerminalQuote(order.symbol,quote);
    expect(getTerminalQuoteFreshness(order.symbol)).toMatchObject({live:false,reason:'time-unverified'});
    const post = vi.spyOn(apiClient,'post').mockResolvedValue({ticket:1});
    await tradingApi.placeOrder(prepareOrderSubmission(order));
    await tradingV2Api.placeOrder({...order,account_login:200038});
    expect(post).toHaveBeenCalledTimes(2);
    expect(() => tradingApi.placePendingOrder({...order,type:'buy_limit',price:99} as never)).toThrow();
    expect(() => tradingV2Api.placePendingOrder({...order,type:'buy_limit',price:99} as never)).toThrow();
    expect(() => tradingV2Api.placeOco({...order} as never)).toThrow();
    expect(() => assertTerminalQuoteFresh(order.symbol)).toThrow();
    expect(post).toHaveBeenCalledTimes(2);
    calibrateTerminalQuoteClock(epoch,0,epoch,0,epoch);
    expect(post).toHaveBeenCalledTimes(2);
  });
  it('preserves a backend stale rejection without retrying it on clock recovery', async () => {
    ingestTerminalQuote(order.symbol,quote);
    const rejection = Object.assign(new Error('Quote is stale for XAUUSD'),{code:'STALE_QUOTE',symbol:'XAUUSD'});
    const post = vi.spyOn(apiClient,'post').mockRejectedValue(rejection);
    await expect(tradingApi.placeOrder(order)).rejects.toBe(rejection);
    calibrateTerminalQuoteClock(epoch,0,epoch,0,epoch);
    await Promise.resolve();
    expect(post).toHaveBeenCalledOnce();
  });
  it.each([{stale:true},{source_mismatch:true},{tradable:false}])('blocks upstream restrictions despite missing clock %j', flags => {
    ingestTerminalQuote(order.symbol,{...quote,...flags});
    expect(() => assertTerminalMarketOrderQuote(order.symbol)).toThrow();
  });
  it('blocks missing evidence, definite old quotes, and invalidated sessions', () => {
    expect(() => assertTerminalMarketOrderQuote(order.symbol)).toThrow();
    calibrateTerminalQuoteClock(epoch+4000,0,epoch,0,epoch);
    ingestTerminalQuote(order.symbol,quote);
    expect(() => assertTerminalMarketOrderQuote(order.symbol)).toThrow();
    resetTerminalQuoteFreshness();
    expect(() => assertTerminalMarketOrderQuote(order.symbol)).toThrow();
  });
});
