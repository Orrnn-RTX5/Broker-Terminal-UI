import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildDepthOrderRequest } from './DepthOfMarket';

describe('Depth of Market order routing', () => {
  it('routes depth rows to limits and explicit Buy/Sell buttons to market execution', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/DepthOfMarket.tsx'), 'utf8');
    expect(source).toContain("buildDepthOrderRequest('SELL', level.price, volume, 'limit'");
    expect(source).toContain("buildDepthOrderRequest('BUY', level.price, volume, 'limit'");
    expect(source).toContain("buildDepthOrderRequest('SELL', bestBid, volume, 'market'");
    expect(source).toContain("buildDepthOrderRequest('BUY', bestAsk, volume, 'market'");

    const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    const handler = appSource.slice(
      appSource.indexOf('const handleDepthOrder'),
      appSource.indexOf('const handleOrderPanelSubmit'),
    );
    expect(appSource).toContain('getChartEligibleSymbol(targetSymbol) || getAllowedSymbol(targetSymbol)');
    expect(handler).toContain("request.execution === 'market'");
    expect(handler).toContain('api.orders.placePendingOrder({');
    expect(handler).toContain('type: `${side}_limit`');
  });

  it('builds a buy-limit request from a bid row with point-based protection prices', () => {
    expect(buildDepthOrderRequest('BUY', 1.23456, 0.2, 'limit', 5, 10, 20)).toEqual({
      side: 'BUY',
      price: 1.23456,
      volume: 0.2,
      execution: 'limit',
      priceSl: 1.23446,
      priceTp: 1.23476,
    });
  });

  it('builds a sell-market request and reverses SL/TP direction', () => {
    expect(buildDepthOrderRequest('SELL', 2500.25, 0.01, 'market', 2, 15, 30)).toEqual({
      side: 'SELL',
      price: 2500.25,
      volume: 0.01,
      execution: 'market',
      priceSl: 2500.4,
      priceTp: 2499.95,
    });
  });

  it('omits disabled protection values', () => {
    expect(buildDepthOrderRequest('BUY', 100, 1, 'market', 2)).toEqual({
      side: 'BUY',
      price: 100,
      volume: 1,
      execution: 'market',
    });
  });
});
