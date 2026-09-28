import { describe, expect, it, vi } from 'vitest';
import { DrawingManager } from './drawingManager';

describe('DrawingManager lifecycle', () => {
  it('stops handling global drawing commands after dispose', () => {
    const manager = new DrawingManager();
    const undo = vi.spyOn(manager, 'undo').mockImplementation(() => undefined);
    const command = new CustomEvent('chart-undo-drawing', {
      detail: { targetContextId: 'chart:dispose-test' },
    });

    window.dispatchEvent(command);
    expect(undo).toHaveBeenCalledWith('chart:dispose-test');

    manager.dispose();
    manager.dispose();
    window.dispatchEvent(command);

    expect(undo).toHaveBeenCalledTimes(1);
  });
});
