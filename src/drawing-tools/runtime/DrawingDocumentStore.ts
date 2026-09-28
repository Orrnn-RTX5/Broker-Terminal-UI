import type { Drawing, DrawingHistoryEntry } from '../model/drawing';

/**
 * Context-scoped drawing documents and their history stacks.
 *
 * The manager remains responsible for rendering, persistence, and commands;
 * this store only owns in-memory document state.
 */
export class DrawingDocumentStore {
  private readonly drawingsByContext = new Map<string, Drawing[]>();
  private readonly undoStacksByContext = new Map<string, DrawingHistoryEntry[]>();
  private readonly redoStacksByContext = new Map<string, DrawingHistoryEntry[]>();
  private readonly loadedContexts = new Set<string>();

  has(contextKey: string): boolean {
    return this.drawingsByContext.has(contextKey);
  }

  peek(contextKey: string): Drawing[] | undefined {
    return this.drawingsByContext.get(contextKey);
  }

  get(contextKey: string): Drawing[] {
    let drawings = this.drawingsByContext.get(contextKey);
    if (!drawings) {
      drawings = [];
      this.drawingsByContext.set(contextKey, drawings);
    }
    return drawings;
  }

  replace(contextKey: string, drawings: Drawing[]): void {
    this.drawingsByContext.set(contextKey, drawings);
  }

  undoStack(contextKey: string): DrawingHistoryEntry[] {
    return this.stackFor(this.undoStacksByContext, contextKey);
  }

  redoStack(contextKey: string): DrawingHistoryEntry[] {
    return this.stackFor(this.redoStacksByContext, contextKey);
  }

  clearRedo(contextKey: string): void {
    this.redoStacksByContext.set(contextKey, []);
  }

  /** Returns true only for the first load attempt for this context. */
  markLoaded(contextKey: string): boolean {
    if (this.loadedContexts.has(contextKey)) return false;
    this.loadedContexts.add(contextKey);
    return true;
  }

  private stackFor(
    stacks: Map<string, DrawingHistoryEntry[]>,
    contextKey: string,
  ): DrawingHistoryEntry[] {
    let stack = stacks.get(contextKey);
    if (!stack) {
      stack = [];
      stacks.set(contextKey, stack);
    }
    return stack;
  }
}
