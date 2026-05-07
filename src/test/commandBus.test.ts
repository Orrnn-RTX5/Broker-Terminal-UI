/**
 * Command Bus Tests
 * Unit tests for the centralized command dispatching system
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { commandBus } from '../services/commandBus';
import type { Command } from '../types/commands';

describe('CommandBus', () => {
  beforeEach(() => {
    commandBus.clearHistory();
  });

  describe('dispatch', () => {
    it('should dispatch commands', () => {
      const handler = vi.fn();
      commandBus.subscribe('SET_CHART_TYPE', handler);

      commandBus.dispatch({
        type: 'SET_CHART_TYPE',
        payload: { chartType: 'line' },
      });

      expect(handler).toHaveBeenCalledWith({ chartType: 'line' });
    });

    it('should call all subscribers for a command type', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      commandBus.subscribe('ZOOM_IN', handler1);
      commandBus.subscribe('ZOOM_IN', handler2);

      commandBus.dispatch({
        type: 'ZOOM_IN',
        payload: {},
      });

      expect(handler1).toHaveBeenCalledWith({});
      expect(handler2).toHaveBeenCalledWith({});
    });

    it('should not call handlers for other command types', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      commandBus.subscribe('SET_CHART_TYPE', handler1);
      commandBus.subscribe('ZOOM_IN', handler2);

      commandBus.dispatch({
        type: 'SET_CHART_TYPE',
        payload: { chartType: 'candlestick' },
      });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it('should add commands to history', () => {
      commandBus.dispatch({
        type: 'SET_CHART_TYPE',
        payload: { chartType: 'line' },
      });

      const history = commandBus.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].type).toBe('SET_CHART_TYPE');
    });

    it('should limit history to 100 commands', () => {
      for (let i = 0; i < 150; i++) {
        commandBus.dispatch({
          type: 'ZOOM_IN',
          payload: {},
        });
      }

      const history = commandBus.getHistory();
      expect(history).toHaveLength(100);
    });
  });

  describe('subscribe', () => {
    it('should return an unsubscribe function', () => {
      const handler = vi.fn();
      const unsubscribe = commandBus.subscribe('ZOOM_IN', handler);

      expect(typeof unsubscribe).toBe('function');
    });

    it('should unsubscribe when returned function is called', () => {
      const handler = vi.fn();
      const unsubscribe = commandBus.subscribe('ZOOM_IN', handler);

      commandBus.dispatch({ type: 'ZOOM_IN', payload: {} });
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      commandBus.dispatch({ type: 'ZOOM_IN', payload: {} });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple subscriptions and unsubscriptions', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const unsub1 = commandBus.subscribe('ZOOM_IN', handler1);
      const unsub2 = commandBus.subscribe('ZOOM_IN', handler2);

      commandBus.dispatch({ type: 'ZOOM_IN', payload: {} });
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);

      unsub1();

      commandBus.dispatch({ type: 'ZOOM_IN', payload: {} });
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(2);
    });
  });

  describe('getHistory', () => {
    it('should return command history', () => {
      commandBus.dispatch({
        type: 'SET_CHART_TYPE',
        payload: { chartType: 'line' },
      });
      commandBus.dispatch({
        type: 'ZOOM_IN',
        payload: {},
      });

      const history = commandBus.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].type).toBe('SET_CHART_TYPE');
      expect(history[1].type).toBe('ZOOM_IN');
    });

    it('should return a copy of history (not reference)', () => {
      commandBus.dispatch({
        type: 'ZOOM_IN',
        payload: {},
      });

      const history1 = commandBus.getHistory();
      const history2 = commandBus.getHistory();

      expect(history1).not.toBe(history2);
      expect(history1).toEqual(history2);
    });
  });

  describe('clearHistory', () => {
    it('should clear all history', () => {
      commandBus.dispatch({
        type: 'SET_CHART_TYPE',
        payload: { chartType: 'line' },
      });
      commandBus.dispatch({
        type: 'ZOOM_IN',
        payload: {},
      });

      expect(commandBus.getHistory()).toHaveLength(2);

      commandBus.clearHistory();

      expect(commandBus.getHistory()).toHaveLength(0);
    });
  });

  describe('replay', () => {
    it('should replay commands in order', async () => {
      const handler = vi.fn();
      commandBus.subscribe('SET_CHART_TYPE', handler);

      const commands: Command[] = [
        {
          type: 'SET_CHART_TYPE',
          payload: { chartType: 'line' },
        },
        {
          type: 'SET_CHART_TYPE',
          payload: { chartType: 'candlestick' },
        },
      ];

      await commandBus.replay(commands);

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenNthCalledWith(1, { chartType: 'line' });
      expect(handler).toHaveBeenNthCalledWith(2, { chartType: 'candlestick' });
    });

    it('should handle errors in handlers gracefully', async () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Test error');
      });
      const normalHandler = vi.fn();

      commandBus.subscribe('ZOOM_IN', errorHandler);
      commandBus.subscribe('ZOOM_IN', normalHandler);

      const commands: Command[] = [
        { type: 'ZOOM_IN', payload: {} },
      ];

      await expect(commandBus.replay(commands)).resolves.not.toThrow();
      expect(errorHandler).toHaveBeenCalled();
      expect(normalHandler).toHaveBeenCalled();
    });

    it('should prevent nested replay', async () => {
      const commands: Command[] = [
        { type: 'ZOOM_IN', payload: {} },
      ];

      const promise1 = commandBus.replay(commands);
      const promise2 = commandBus.replay(commands);

      // Both should complete without issue
      await Promise.all([promise1, promise2]);
    });
  });

  describe('Complex scenarios', () => {
    it('should handle full workflow: subscribe, dispatch, unsubscribe, dispatch', () => {
      const handler = vi.fn();

      // Subscribe
      const unsubscribe = commandBus.subscribe('SET_CHART_TYPE', handler);

      // Dispatch
      commandBus.dispatch({
        type: 'SET_CHART_TYPE',
        payload: { chartType: 'line' },
      });
      expect(handler).toHaveBeenCalledTimes(1);

      // Unsubscribe
      unsubscribe();

      // Dispatch again - handler should not be called
      commandBus.dispatch({
        type: 'SET_CHART_TYPE',
        payload: { chartType: 'candlestick' },
      });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle order panel workflow', () => {
      const handler = vi.fn();
      commandBus.subscribe('OPEN_ORDER_PANEL', handler);

      commandBus.dispatch({
        type: 'OPEN_ORDER_PANEL',
        payload: {
          symbol: 'EURUSD',
          price: { bid: 1.0950, ask: 1.0952 },
        },
      });

      expect(handler).toHaveBeenCalledWith({
        symbol: 'EURUSD',
        price: { bid: 1.0950, ask: 1.0952 },
      });
    });

    it('should handle drawing tool workflow', () => {
      const toolHandler = vi.fn();
      const drawingHandler = vi.fn();

      commandBus.subscribe('SELECT_TOOL', toolHandler);
      commandBus.subscribe('SAVE_DRAWING', drawingHandler);

      // Select tool
      commandBus.dispatch({
        type: 'SELECT_TOOL',
        payload: { tool: 'trendline' },
      });

      // Save drawing
      commandBus.dispatch({
        type: 'SAVE_DRAWING',
        payload: {
          type: 'line',
          points: [
            { x: 100, y: 200 },
            { x: 300, y: 400 },
          ],
        },
      });

      expect(toolHandler).toHaveBeenCalledWith({ tool: 'trendline' });
      expect(drawingHandler).toHaveBeenCalledWith({
        type: 'line',
        points: [
          { x: 100, y: 200 },
          { x: 300, y: 400 },
        ],
      });
    });
  });
});
