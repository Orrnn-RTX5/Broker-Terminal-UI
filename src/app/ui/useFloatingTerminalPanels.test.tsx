import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFloatingTerminalPanels } from './useFloatingTerminalPanels';

describe('useFloatingTerminalPanels', () => {
  it('opens DOM for the requested symbol at the stable default position', () => {
    const { result } = renderHook(() => useFloatingTerminalPanels('EURUSD'));

    act(() => result.current.openDOM('BTCUSD'));

    expect(result.current.showDOM).toBe(true);
    expect(result.current.domSymbol).toBe('BTCUSD');
    expect(result.current.domPos).toEqual({ x: 620, y: 56 });
  });

  it('updates DOM position through the isolated drag controller', () => {
    const { result } = renderHook(() => useFloatingTerminalPanels('EURUSD'));
    const preventDefault = vi.fn();

    act(() => {
      result.current.handleDomMouseDown({ clientX: 100, clientY: 80, preventDefault } as never);
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 125, clientY: 100 }));
      window.dispatchEvent(new MouseEvent('mouseup'));
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(result.current.domPos).toEqual({ x: 645, y: 76 });
  });
});
