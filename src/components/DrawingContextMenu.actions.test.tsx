// @vitest-environment jsdom

import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDrawingStorageKey } from '../drawing-tools/contextKey';

vi.mock('../services/drawingApi', () => ({
    drawingApi: {
        loadDrawings: vi.fn().mockResolvedValue([]),
        saveDrawing: vi.fn().mockResolvedValue(undefined),
        deleteDrawing: vi.fn().mockResolvedValue(undefined),
    },
}));

import { drawingManager, type DrawingType } from '../services/drawingManager';
import { DrawingContextMenu } from './DrawingContextMenu';

const charts: ReturnType<typeof createChart>[] = [];

function createChart(contextId: string, symbol: string) {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 500 });
    Object.defineProperty(container, 'clientHeight', { value: 300 });
    document.body.appendChild(container);
    const chart = {
        timeScale: () => ({
            timeToCoordinate: (time: number) => time,
            coordinateToTime: (x: number) => x,
            logicalToCoordinate: (logical: number) => logical,
            coordinateToLogical: (x: number) => x,
            height: () => 20,
        }),
        priceScale: () => ({ width: () => 40 }),
    } as unknown as IChartApi;
    const series = {
        priceToCoordinate: (price: number) => 220 - price,
        coordinateToPrice: (y: number) => 220 - y,
        data: () => [],
    } as unknown as ISeriesApi<'Candlestick'>;
    const activate = () => drawingManager.setChart(
        chart, series, symbol, 1, container, 'M1', contextId, 'menu-test-account',
    );
    activate();
    const fixture = { container, contextId, symbol, activate };
    charts.push(fixture);
    return fixture;
}

function draw(contextId: string, type: DrawingType, price: number) {
    drawingManager.startDrawing(type);
    if (!drawingManager.addPoint(150, price, undefined, contextId)) {
        expect(drawingManager.addPoint(210, price + 10, undefined, contextId)).toBe(true);
    }
    return drawingManager.getDrawings(contextId).at(-1)!;
}

function openMenu(contextId: string, drawingId: string) {
    act(() => window.dispatchEvent(new CustomEvent('drawing:contextmenu', {
        detail: { x: 20, y: 20, contextId, drawingId },
    })));
}

function fireHuePointer(element: Element, type: 'pointerdown' | 'pointerup') {
    const event = new MouseEvent(type, { bubbles: true, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    fireEvent(element, event);
}

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
});

afterEach(() => {
    cleanup();
    for (const { container, contextId, symbol } of charts.splice(0)) {
        drawingManager.clearAllDrawings(false, contextId);
        drawingManager.setChart(null, null, symbol, 1, container, 'M1', contextId, 'menu-test-account');
        container.remove();
    }
    vi.restoreAllMocks();
});

describe('drawing context menu actions', () => {
    it('selects every drawing only in the menu chart and immediately allows deleting the selection', () => {
        const first = createChart('menu-select-all', 'BTCUSD');
        const firstDrawing = draw(first.contextId, 'trendline', 100);
        draw(first.contextId, 'rectangle', 120);
        drawingManager.unselectAll(first.contextId);
        const second = createChart('menu-other', 'EURUSD');
        const otherDrawing = draw(second.contextId, 'hline', 150);
        drawingManager.unselectAll(second.contextId);
        const onClose = vi.fn();

        render(<DrawingContextMenu contextId={first.contextId} onClose={onClose} />);
        openMenu(first.contextId, firstDrawing.id);
        second.activate();
        fireEvent.click(screen.getByText('Select All'));

        expect(drawingManager.getDrawings(first.contextId).every(d => d.selected)).toBe(true);
        expect(otherDrawing.selected).toBe(false);
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('Delete All Selected'));
        expect(drawingManager.getDrawings(first.contextId)).toEqual([]);
        expect(drawingManager.getDrawings(second.contextId).map(d => d.id)).toEqual([otherDrawing.id]);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('moves the menu by its header outside chart clipping without dragging or editing the drawing', () => {
        const first = createChart('menu-drag', 'BTCUSD');
        const drawing = draw(first.contextId, 'trendline', 100);
        const before = JSON.stringify(drawing);
        const update = vi.spyOn(drawingManager, 'updateDrawingProperties');
        render(<DrawingContextMenu contextId={first.contextId} onClose={vi.fn()} />, { container: first.container });
        openMenu(first.contextId, drawing.id);
        const menu = screen.getByTestId('drawing-context-menu');
        const header = screen.getByTestId('drawing-context-menu-drag-handle');
        expect(menu.parentElement).toBe(document.body);
        vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 20, 230, 340));
        const capture = vi.fn();
        Object.defineProperty(header, 'setPointerCapture', { configurable: true, value: capture });
        const pointer = (type: string, x: number, y: number) => {
            const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
            Object.defineProperty(event, 'pointerId', { value: 1 });
            fireEvent(header, event);
        };

        pointer('pointerdown', 35, 30);
        pointer('pointermove', 235, 130);
        expect(capture).toHaveBeenCalledWith(1);
        expect(menu).toHaveStyle({ left: '220px', top: '120px' });
        pointer('pointerup', 235, 130);
        pointer('pointermove', 300, 200);
        expect(menu).toHaveStyle({ left: '220px', top: '120px' });
        expect(JSON.stringify(drawing)).toBe(before);
        expect(update).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('Line Style & Width'));
        expect(screen.getByText('Line Width')).toBeInTheDocument();
    });

    it('saves a picked color to its owner chart and undoes the whole drag in one step', () => {
        const first = createChart('menu-a', 'BTCUSD');
        const firstDrawing = draw(first.contextId, 'trendline', 100);
        const originalColor = firstDrawing.color;
        const second = createChart('menu-b', 'EURUSD');
        const otherDrawing = draw(second.contextId, 'hline', 150);
        const otherColor = otherDrawing.color;
        const saveToBackend = vi.spyOn(drawingManager, 'saveToBackend').mockResolvedValue(undefined);
        const updateDrawingProperties = vi.spyOn(drawingManager, 'updateDrawingProperties');
        const storageKey = buildDrawingStorageKey({
            accountScope: 'menu-test-account', symbol: 'BTCUSD', timeframe: 'M1',
        });

        render(<DrawingContextMenu contextId={first.contextId} onClose={vi.fn()} />);
        openMenu(first.contextId, firstDrawing.id);
        second.activate();
        fireEvent.click(screen.getByText('Change Color'));
        const hue = screen.getByRole('slider', { name: 'Hue' });
        fireHuePointer(hue, 'pointerdown');
        fireEvent.change(hue, { target: { value: '120' } });
        fireEvent.change(hue, { target: { value: '240' } });
        const finalColor = firstDrawing.color;
        expect(finalColor).not.toBe(originalColor);
        expect(saveToBackend).not.toHaveBeenCalled();
        expect(updateDrawingProperties).not.toHaveBeenCalled();
        expect(JSON.parse(localStorage.getItem(storageKey) || '[]')[0].color).toBe(originalColor);

        fireHuePointer(hue, 'pointerup');
        expect(updateDrawingProperties).toHaveBeenCalledExactlyOnceWith(
            firstDrawing.id, { color: finalColor }, first.contextId,
        );
        expect(saveToBackend).toHaveBeenCalledExactlyOnceWith(
            firstDrawing, expect.objectContaining({ contextId: first.contextId, symbol: 'BTCUSD' }),
        );
        expect(JSON.parse(localStorage.getItem(storageKey) || '[]')[0].color).toBe(finalColor);
        expect(drawingManager.getDrawings(second.contextId)[0].color).toBe(otherColor);

        drawingManager.undo(first.contextId);
        expect(drawingManager.getDrawings(first.contextId)[0].color).toBe(originalColor);
        expect(drawingManager.getDrawings(first.contextId)).toHaveLength(1);
        expect(JSON.parse(localStorage.getItem(storageKey) || '[]')[0].color).toBe(originalColor);
        expect(drawingManager.getDrawings(second.contextId)[0].color).toBe(otherColor);
    });

    it('deletes the selected group from its owner even when another chart becomes active', () => {
        const first = createChart('menu-a', 'BTCUSD');
        const firstDrawing = draw(first.contextId, 'fibonacci', 100);
        const secondDrawing = draw(first.contextId, 'rectangle', 120);
        const retained = draw(first.contextId, 'hline', 140);
        drawingManager.selectDrawing(firstDrawing.id, false, first.contextId);
        drawingManager.selectDrawing(secondDrawing.id, true, first.contextId);
        const second = createChart('menu-b', 'EURUSD');
        const otherDrawing = draw(second.contextId, 'hline', 150);
        drawingManager.selectDrawing(otherDrawing.id, false, second.contextId);

        render(<>
            <DrawingContextMenu contextId={first.contextId} onClose={vi.fn()} />
            <DrawingContextMenu contextId={second.contextId} onClose={vi.fn()} />
        </>);
        openMenu(first.contextId, firstDrawing.id);
        expect(screen.getAllByText('Delete All Selected')).toHaveLength(1);
        expect(screen.queryByText('Object List')).not.toBeInTheDocument();
        second.activate();
        fireEvent.click(screen.getByText('Delete All Selected'));

        expect(drawingManager.getDrawings(first.contextId).map(d => d.id)).toEqual([retained.id]);
        expect(drawingManager.getDrawings(second.contextId).map(d => d.id)).toEqual([otherDrawing.id]);
        expect(first.container.querySelectorAll('g[data-id]')).toHaveLength(1);
        expect(screen.queryByText('Delete All Selected')).not.toBeInTheDocument();
    });

    it('deletes every drawing type in the menu chart, persists the removal, and retains undo', () => {
        const first = createChart('menu-a', 'BTCUSD');
        const fib = draw(first.contextId, 'fibonacci', 100);
        draw(first.contextId, 'rectangle', 120);
        draw(first.contextId, 'hline', 140);
        const second = createChart('menu-b', 'EURUSD');
        const otherDrawing = draw(second.contextId, 'hline', 150);
        render(<DrawingContextMenu contextId={first.contextId} onClose={vi.fn()} />);
        openMenu(first.contextId, fib.id);
        fireEvent.click(screen.getByText('Delete All Shapes'));

        expect(drawingManager.getDrawings(first.contextId)).toEqual([]);
        expect(first.container.querySelector('g[data-id]')).toBeNull();
        expect(drawingManager.getDrawings(second.contextId).map(d => d.id)).toEqual([otherDrawing.id]);
        expect(JSON.parse(localStorage.getItem(buildDrawingStorageKey({
            accountScope: 'menu-test-account', symbol: 'BTCUSD', timeframe: 'M1',
        })) || 'null')).toEqual([]);
        drawingManager.undo(first.contextId);
        expect(drawingManager.getDrawings(first.contextId)).toHaveLength(1);
    });

    it('deletes the right-clicked drawing when a different chart is active', () => {
        const first = createChart('menu-a', 'BTCUSD');
        const fib = draw(first.contextId, 'fibonacci', 100);
        const second = createChart('menu-b', 'EURUSD');
        const otherDrawing = draw(second.contextId, 'hline', 150);
        render(<DrawingContextMenu contextId={first.contextId} onClose={vi.fn()} />);
        openMenu(first.contextId, fib.id);
        fireEvent.click(screen.getByText('Delete Fibonacci Retracement'));
        expect(drawingManager.getDrawings(first.contextId)).toEqual([]);
        expect(drawingManager.getDrawings(second.contextId).map(d => d.id)).toEqual([otherDrawing.id]);
    });
});
