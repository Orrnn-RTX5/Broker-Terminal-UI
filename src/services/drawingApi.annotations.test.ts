// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { drawingApi } from './drawingApi';
afterEach(() => vi.restoreAllMocks());
it('preserves annotation text, typography, table content and image sizing in save and update payloads', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ success: true, drawingId: 'saved' }), { status: 200 }));
  const drawing = { id: 'annotation', type: 'text', subtype: 'table', points: [{ time: 123, price: 100.25 }], text: 'Two\nlines',
    annotation: { fontSize: 20, bold: true, textColor: '#ffffff', tableData: [['A', 'B']], cellWidth: 75, width: 240, height: 160, opacity: .75 } };
  await drawingApi.saveDrawing(drawing, 'XAUUSD');
  await drawingApi.updateDrawing('saved', drawing, 'XAUUSD');
  const saves = fetchMock.mock.calls.filter(call => call[1]?.method === 'POST');
  expect(saves).toHaveLength(2);
  for (const call of saves) {
    const payload = JSON.parse(String(call[1]?.body));
    expect(payload.properties.annotation).toEqual(drawing.annotation);
    expect(payload.properties.text).toBe('Two\nlines');
    expect(payload.properties.subtype).toBe('table');
  }
});
