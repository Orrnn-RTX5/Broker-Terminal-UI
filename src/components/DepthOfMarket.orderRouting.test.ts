import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildDepthOrderRequest, depthExecutionForLevel } from './depthOfMarketModel';

describe('Depth of Market order routing', () => {
  it('routes depth rows to limits and explicit Buy/Sell buttons to market execution', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/DepthOfMarket.tsx'), 'utf8');
    expect(source).toContain("buildDepthOrderRequest('SELL', level.price, volume, depthExecutionForLevel('SELL'");
    expect(source).toContain("buildDepthOrderRequest('BUY', level.price, volume, depthExecutionForLevel('BUY'");
    expect(source).toContain("buildDepthOrderRequest('SELL', bestBid, volume, 'market'");
    expect(source).toContain("buildDepthOrderRequest('BUY', bestAsk, volume, 'market'");

    const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    const orderExecutionSource = readFileSync(
      join(process.cwd(), 'src/app/trading/useOrderExecution.ts'),
      'utf8',
    );
    const handler = orderExecutionSource.slice(
      orderExecutionSource.indexOf('const handleDepthOrder'),
      orderExecutionSource.indexOf('const handleOrderPanelSubmit'),
    );

    expect(appSource).toContain("import { useOrderExecution } from './app/trading/useOrderExecution'");
    expect(appSource).toContain('} = useOrderExecution({');
    expect(appSource).toContain('onPlaceOrder={handleDepthOrder}');
    expect(handler).toContain('getAllowedSymbol(normalizeSymbolName(domSymbol))');
    expect(handler).toContain("request.execution === 'market'");
    expect(handler).toContain('await placeOrder(request.side, domSymbol, request.volume, {');
    expect(handler).toContain('api.orders.placePendingOrder({');
    expect(handler).toContain('type: `${side}_${pendingKind}`');
  });

  it('derives stop execution by comparing click price against the live quote (MT5 rule)', () => {
    // BUY above the ask => stop; at/below => limit.
    expect(depthExecutionForLevel('BUY', 1.0856, 1.0854, 1.0855)).toBe('stop');
    expect(depthExecutionForLevel('BUY', 1.0855, 1.0854, 1.0855)).toBe('limit');
    expect(depthExecutionForLevel('BUY', 1.0853, 1.0854, 1.0855)).toBe('limit');
    // SELL below the bid => stop; at/above => limit.
    expect(depthExecutionForLevel('SELL', 1.0853, 1.0854, 1.0855)).toBe('stop');
    expect(depthExecutionForLevel('SELL', 1.0854, 1.0854, 1.0855)).toBe('limit');
    expect(depthExecutionForLevel('SELL', 1.0856, 1.0854, 1.0855)).toBe('limit');
    // Unknown quote or bad price fails closed to limit (previous behavior).
    expect(depthExecutionForLevel('BUY', 1.09, 0, 0)).toBe('limit');
    expect(depthExecutionForLevel('SELL', 1.08, 0, 0)).toBe('limit');
    expect(depthExecutionForLevel('BUY', NaN, 1.0854, 1.0855)).toBe('limit');
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
