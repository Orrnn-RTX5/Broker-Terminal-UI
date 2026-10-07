import { afterEach, describe, expect, it, vi } from 'vitest';
import { setTradeOverlayStyle } from './tradeOverlayStyle';

afterEach(() => vi.restoreAllMocks());
describe('setTradeOverlayStyle', () => {
  it('skips unchanged geometry and normalized CSS colors', () => {
    const node = document.createElement('div');
    const top = vi.spyOn(node.style, 'top', 'set');
    const color = vi.spyOn(node.style, 'color', 'set');
    for (let i = 0; i < 3; i++) {
      setTradeOverlayStyle(node, 'top', '40.25px');
      setTradeOverlayStyle(node, 'color', '#ff0000');
    }
    expect(top).toHaveBeenCalledTimes(1); expect(color).toHaveBeenCalledTimes(1);
    expect(node.style.top).toBe('40.25px'); expect(node.style.color).toBe('rgb(255, 0, 0)');
  });
  it('honors changed styles and repairs another renderer changing a normalized property', () => {
    const node = document.createElement('div');
    setTradeOverlayStyle(node, 'color', '#ff0000');
    node.style.color = '#0000ff';
    setTradeOverlayStyle(node, 'color', '#ff0000');
    expect(node.style.color).toBe('rgb(255, 0, 0)');
    setTradeOverlayStyle(node, 'top', '1px'); setTradeOverlayStyle(node, 'top', '2px');
    expect(node.style.top).toBe('2px');
  });
  it('keeps independent elements independent', () => {
    const first = document.createElement('div'), second = document.createElement('div');
    setTradeOverlayStyle(first, 'top', '50px'); setTradeOverlayStyle(second, 'top', '50px');
    expect(second.style.top).toBe('50px');
  });
});
