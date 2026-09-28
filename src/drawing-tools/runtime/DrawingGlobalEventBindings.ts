export interface DrawingGlobalEventHandlers {
  pointerMove: (event: PointerEvent) => void;
  pointerUp: (event: PointerEvent) => void;
  undo: (contextId?: string) => void;
  redo: (contextId?: string) => void;
  deleteSelected: (contextId?: string) => void;
  deleteLast: (contextId?: string) => void;
}

type DrawingCommandEvent = CustomEvent<{ targetContextId?: string }>;

/** Owns the manager's window listeners and provides one idempotent teardown. */
export class DrawingGlobalEventBindings {
  private disposed = false;

  private readonly onUndo = (event: Event): void => {
    this.handlers.undo((event as DrawingCommandEvent).detail?.targetContextId);
  };

  private readonly onRedo = (event: Event): void => {
    this.handlers.redo((event as DrawingCommandEvent).detail?.targetContextId);
  };

  private readonly onDeleteSelected = (event: Event): void => {
    this.handlers.deleteSelected((event as DrawingCommandEvent).detail?.targetContextId);
  };

  private readonly onDeleteLast = (event: Event): void => {
    this.handlers.deleteLast((event as DrawingCommandEvent).detail?.targetContextId);
  };

  constructor(
    private readonly target: Window,
    private readonly handlers: DrawingGlobalEventHandlers,
  ) {
    target.addEventListener('pointermove', handlers.pointerMove);
    target.addEventListener('pointerup', handlers.pointerUp);
    target.addEventListener('chart-undo-drawing', this.onUndo);
    target.addEventListener('chart-redo-drawing', this.onRedo);
    target.addEventListener('chart-delete-drawing', this.onDeleteSelected);
    target.addEventListener('chart-delete-last-drawing', this.onDeleteLast);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.target.removeEventListener('pointermove', this.handlers.pointerMove);
    this.target.removeEventListener('pointerup', this.handlers.pointerUp);
    this.target.removeEventListener('chart-undo-drawing', this.onUndo);
    this.target.removeEventListener('chart-redo-drawing', this.onRedo);
    this.target.removeEventListener('chart-delete-drawing', this.onDeleteSelected);
    this.target.removeEventListener('chart-delete-last-drawing', this.onDeleteLast);
  }
}
