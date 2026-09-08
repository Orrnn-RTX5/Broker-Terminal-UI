// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { drawingApi } from './drawingApi';
import { BRUSH_SHAPE_TOOLS } from '../drawing-tools/brushShapeToolCatalog';

afterEach(() => vi.restoreAllMocks());

it.each(BRUSH_SHAPE_TOOLS)('serializes $label anchors and style in its save payload', async tool => {
  const drawing = {
    id: `shape-${tool.id}`, type: 'shapes', subtype: tool.id,
    points: Array.from({ length: tool.id === 'double_curve' ? 4 : tool.id === 'curve' ? 3 : tool.requiredPoints || 3 }, (_, index) => ({
      time: 120, price: 99.25 + index, logicalIndex: 13.25 + index, barOffset: 3.25 + index,
    })),
    color: '#2962ff', fillColor: '#ff8800', fillOpacity: .35,
    lineWidth: 3, lineStyle: 'dashed' as const, locked: true,
  };
  const response = (body: unknown) => new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ success: true, drawingId: 'server-shape' }));
  await drawingApi.saveDrawing(drawing, 'XAUUSD');
  const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
  expect(payload.type).toBe('shapes');
  expect(payload.properties).toMatchObject({
    subtype: tool.id, points: drawing.points, fillColor: '#ff8800', fillOpacity: .35, locked: true,
  });
  expect(payload.properties).not.toHaveProperty('selected');
});
