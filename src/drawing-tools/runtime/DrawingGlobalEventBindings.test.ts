import { describe, expect, it, vi } from 'vitest';
import { DrawingGlobalEventBindings } from './DrawingGlobalEventBindings';

describe('DrawingGlobalEventBindings', () => {
  it('routes scoped commands and removes every listener on dispose', () => {
    const handlers = {
      pointerMove: vi.fn(),
      pointerUp: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      deleteSelected: vi.fn(),
      deleteLast: vi.fn(),
    };
    const bindings = new DrawingGlobalEventBindings(window, handlers);
    const scoped = { detail: { targetContextId: 'chart:1' } };

    window.dispatchEvent(new CustomEvent('chart-undo-drawing', scoped));
    window.dispatchEvent(new CustomEvent('chart-redo-drawing', scoped));
    window.dispatchEvent(new CustomEvent('chart-delete-drawing', scoped));
    window.dispatchEvent(new CustomEvent('chart-delete-last-drawing', scoped));

    expect(handlers.undo).toHaveBeenCalledWith('chart:1');
    expect(handlers.redo).toHaveBeenCalledWith('chart:1');
    expect(handlers.deleteSelected).toHaveBeenCalledWith('chart:1');
    expect(handlers.deleteLast).toHaveBeenCalledWith('chart:1');

    bindings.dispose();
    bindings.dispose();
    window.dispatchEvent(new CustomEvent('chart-undo-drawing', scoped));
    window.dispatchEvent(new CustomEvent('chart-redo-drawing', scoped));

    expect(handlers.undo).toHaveBeenCalledTimes(1);
    expect(handlers.redo).toHaveBeenCalledTimes(1);
  });
});
