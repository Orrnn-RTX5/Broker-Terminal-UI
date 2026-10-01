// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { drawingApi, type ClientDrawing } from './drawingApi';
vi.mock('../api/brokerRequestGuard', () => ({ assertBrokerRequestAllowed: () => undefined }));

describe('Drawing API forecasting payloads', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('serializes the stable subtype, future logical anchors, and captured Bars Pattern candles', async () => {
    const seriesSnapshot = [
      {
        time: 120,
        open: 100,
        high: 104,
        low: 99,
        close: 103,
        volume: 24,
        tickVolume: 25,
      },
    ];
    const drawing: ClientDrawing = {
      id: 'bars-pattern-1',
      type: 'measure',
      subtype: 'bars_pattern',
      points: [
        { time: 120, price: 100, logicalIndex: 10 },
        { time: 180, price: 103, logicalIndex: 11.5 },
      ],
      seriesSnapshot,
      color: '#2962ff',
      lineWidth: 2,
      lineStyle: 'solid',
      selected: true,
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      drawingId: 'server-bars-pattern-1',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(drawingApi.saveDrawing(drawing, 'XAUUSD')).resolves.toBe('server-bars-pattern-1');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, request] = fetchMock.mock.calls[0];
    const payload = JSON.parse(String(request?.body));
    expect(payload).toMatchObject({
      type: 'measure',
      symbol: 'XAUUSD',
      properties: {
        id: drawing.id,
        subtype: 'bars_pattern',
        points: drawing.points,
        seriesSnapshot,
      },
    });
    expect(payload.properties).not.toHaveProperty('selected');
  });

  it('serializes independently adjustable Long/Short Position levels and duration', async () => {
    const drawing: ClientDrawing = {
      id: 'long-position-1',
      type: 'measure',
      subtype: 'long_position',
      points: [{ time: 120, price: 100, logicalIndex: 10 }],
      positionTargetPrice: 104,
      positionStopPrice: 98,
      positionEndTime: 1_320,
      positionEndLogicalIndex: 30,
      positionSizing: { accountSize: 2500, risk: 2, riskMode: 'percent', pointValue: 10, lotSize: 100, leverage: 20, quantityPrecision: 3 },
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      drawingId: 'server-long-position-1',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await drawingApi.saveDrawing(drawing, 'XAUUSD');

    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      properties: {
        positionTargetPrice: 104,
        positionStopPrice: 98,
        positionEndTime: 1_320,
        positionEndLogicalIndex: 30,
        positionSizing: drawing.positionSizing,
      },
    });
  });
});
