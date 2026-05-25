/**
 * ============================================================================
 * 🚫 AI FENCE: ISOLATED SYSTEM COMPONENT
 * ============================================================================
 * Do not modify, rewrite, or alter this file when processing other features.
 * Drawing tools are self-contained and highly sensitive to state/prop updates.
 * Any adjustments must be done ONLY under explicit drawing-specific requests.
 * ============================================================================
 */

/**
 * Drawing Store (Zustand)
 * Manages chart drawing tools and drawings state
 */

import { create } from "zustand";
import { debounce } from "lodash-es";

const DRAWINGS_STORAGE_KEY_PREFIX = "rtx5-drawings";
const LEGACY_DRAWINGS_STORAGE_KEY = "rtx5-drawings";
const TEMPLATES_STORAGE_KEY = "rtx5-drawing-templates";
const DEFAULT_DRAWING_SYMBOL = "default";

/**
 * Safe localStorage setter with quota exceeded handling
 * Trims to last 100 items if quota exceeded and retries
 * @param key - localStorage key
 * @param value - JSON string to store
 * @returns boolean indicating success
 */
function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      console.error("localStorage quota exceeded for key:", key);
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed) && parsed.length > 100) {
          const trimmed = parsed.slice(-100);
          localStorage.setItem(key, JSON.stringify(trimmed));
          alert("Storage limit reached. Older drawings trimmed to last 100.");
          return false;
        }
      } catch (parseError) {
        console.error("Failed to parse or trim storage data:", parseError);
      }
    }
    console.error("Failed to save to localStorage:", e);
    return false;
  }
}

function resolveDrawingSymbol(symbol: string | null | undefined): string {
  if (!symbol || !symbol.trim()) return DEFAULT_DRAWING_SYMBOL;
  return symbol.trim().toUpperCase();
}

function getDrawingsStorageKey(symbol: string | null | undefined): string {
  return `${DRAWINGS_STORAGE_KEY_PREFIX}-${resolveDrawingSymbol(symbol)}`;
}

function getInitialDrawingSymbol(): string {
  try {
    return resolveDrawingSymbol(localStorage.getItem("rtx5_selected_symbol"));
  } catch {
    return DEFAULT_DRAWING_SYMBOL;
  }
}

const drawingSaveDebouncers = new Map<
  string,
  ReturnType<typeof debounce<(data: Drawing[]) => void>>
>();

function queueDrawingsSave(symbol: string | null | undefined, drawings: Drawing[]): void {
  const key = getDrawingsStorageKey(symbol);
  let debouncedSaver = drawingSaveDebouncers.get(key);

  if (!debouncedSaver) {
    debouncedSaver = debounce((data: Drawing[]) => {
      safeSetItem(key, JSON.stringify(data));
    }, 300);
    drawingSaveDebouncers.set(key, debouncedSaver);
  }

  debouncedSaver(drawings);
}

function commitDrawingsSave(symbol: string | null | undefined, drawings: Drawing[]): void {
  const key = getDrawingsStorageKey(symbol);
  const debouncedSaver = drawingSaveDebouncers.get(key);
  if (debouncedSaver) {
    debouncedSaver.cancel();
  }
  safeSetItem(key, JSON.stringify(drawings));
}

function clearDrawingsStorage(symbol: string | null | undefined): void {
  const key = getDrawingsStorageKey(symbol);
  drawingSaveDebouncers.get(key)?.cancel();
  localStorage.removeItem(key);
}

const debouncedSaveTemplates = debounce((data: any) => {
  safeSetItem(TEMPLATES_STORAGE_KEY, JSON.stringify(data));
}, 300);

export type DrawingType =
  | "cursor"
  | "crosshair"
  | "zoom-in"
  | "zoom-out"
  | "pan"
  | "trend-line"
  | "horizontal-line"
  | "vertical-line"
  | "ray"
  | "infinite-line"
  | "channel"
  | "parallel-channel"
  | "fib-retracement"
  | "fib-extension"
  | "rectangle"
  | "ellipse"
  | "polygon"
  | "freehand"
  | "pitchfork"
  | "text-label"
  | "callout"
  | "arrow"
  | "crosshair-ruler"
  | "label";

export type LineStyle = "solid" | "dashed" | "dotted";

export interface Point {
  x: number;
  y: number;
  price?: number;
  time?: string;
}

export interface Drawing {
  id: string;
  type: DrawingType;
  points: Point[];
  color: string;
  lineWidth: number;
  lineStyle: LineStyle;
  extendLeft: boolean;
  extendRight: boolean;
  showPriceLabels: boolean;
  visible: boolean;
  locked: boolean;
  rotation: number; // degrees
  zIndex: number;
  text?: string;
  label?: string;
}

export interface DrawingTemplate {
  id: string;
  name: string;
  drawings: Drawing[];
  createdAt: string;
}

interface DrawingState {
  drawings: Drawing[];
  selectedDrawingId: string | null;
  activeTool: DrawingType | null;
  templates: DrawingTemplate[];
  isDrawing: boolean;
  currentSymbol: string | null;

  // History for undo/redo
  undoStack: Drawing[][];
  redoStack: Drawing[][];

  // Actions
  addDrawing: (drawing: Omit<Drawing, "id" | "zIndex" | "locked" | "rotation">) => void;
  updateDrawing: (id: string, updates: Partial<Drawing>) => void;
  deleteDrawing: (id: string) => void;
  duplicateDrawing: (id: string) => void;
  setSelectedDrawing: (id: string | null) => void;
  setActiveTool: (tool: DrawingType | null) => void;
  setIsDrawing: (isDrawing: boolean) => void;
  toggleDrawingVisibility: (id: string) => void;
  toggleDrawingLock: (id: string) => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  clearAllDrawings: () => void;
  setSymbol: (symbol: string) => void;

  // Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Template actions
  saveTemplate: (name: string) => void;
  loadTemplate: (id: string) => void;
  deleteTemplate: (id: string) => void;
}

// Helper to get next z-index
const getNextZIndex = (drawings: Drawing[]): number => {
  if (drawings.length === 0) return 1;
  return Math.max(...drawings.map((d) => d.zIndex)) + 1;
};

// Type guard to validate Drawing objects
function isValidDrawing(obj: any): obj is Drawing {
  return (
    obj &&
    typeof obj.id === "string" &&
    typeof obj.type === "string" &&
    Array.isArray(obj.points) &&
    obj.points.every(
      (p: any) => typeof p.x === "number" && typeof p.y === "number",
    ) &&
    typeof obj.color === "string" &&
    typeof obj.lineWidth === "number" &&
    typeof obj.visible === "boolean" &&
    typeof obj.zIndex === "number"
  );
}

interface StorageLoadResult {
  found: boolean;
  drawings: Drawing[];
}

// Load from localStorage with JSON validation
const loadDrawingsFromKey = (key: string): StorageLoadResult => {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return { found: false, drawings: [] };

    const parsed = JSON.parse(stored);

    // Ensure parsed data is an array
    if (!Array.isArray(parsed)) {
      console.warn("Invalid drawings data: expected array, got", typeof parsed);
      return { found: true, drawings: [] };
    }

    // Filter with type guard and log invalid entries
    const validDrawings = parsed.filter((item: any, index: number) => {
      if (!isValidDrawing(item)) {
        console.warn(
          `Invalid drawing at index ${index}: missing or invalid required fields`,
          item,
        );
        return false;
      }
      return true;
    });

    // Warn if drawings were filtered out
    if (validDrawings.length < parsed.length) {
      console.warn(
        `Filtered out ${parsed.length - validDrawings.length} invalid drawing(s) from localStorage key: ${key}`,
      );
    }

    return { found: true, drawings: validDrawings };
  } catch (error) {
    console.error(`Failed to parse drawings from localStorage key: ${key}`, error);
    return { found: true, drawings: [] };
  }
};

const loadDrawingsForSymbol = (symbol: string | null | undefined): Drawing[] => {
  const symbolKey = getDrawingsStorageKey(symbol);
  const symbolDrawings = loadDrawingsFromKey(symbolKey);
  if (symbolDrawings.found) {
    return symbolDrawings.drawings;
  }

  // One-time migration from legacy global key to symbol-specific key
  const legacy = loadDrawingsFromKey(LEGACY_DRAWINGS_STORAGE_KEY);
  if (legacy.found) {
    if (legacy.drawings.length > 0) {
      safeSetItem(symbolKey, JSON.stringify(legacy.drawings));
    }
    localStorage.removeItem(LEGACY_DRAWINGS_STORAGE_KEY);
    return legacy.drawings;
  }

  return [];
};

const loadTemplatesFromStorage = () => {
  try {
    const stored = localStorage.getItem(TEMPLATES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error("Failed to load templates from localStorage:", error);
    return [];
  }
};

export const useDrawingStore = create<DrawingState>((set, get) => ({
  drawings: loadDrawingsForSymbol(getInitialDrawingSymbol()),
  selectedDrawingId: null,
  activeTool: null,
  templates: loadTemplatesFromStorage(),
  isDrawing: false,
  currentSymbol: getInitialDrawingSymbol(),
  undoStack: [],
  redoStack: [],

  addDrawing: (drawing) => {
    const newDrawing: Drawing = {
      ...drawing,
      id: `drawing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      zIndex: getNextZIndex(get().drawings),
      locked: false,
      rotation: 0,
    };

    set((state) => {
      const newDrawings = [...state.drawings, newDrawing];
      queueDrawingsSave(state.currentSymbol, newDrawings);
      return {
        drawings: newDrawings,
        undoStack: [...state.undoStack, state.drawings],
        redoStack: [],
      };
    });
  },

  updateDrawing: (id, updates) => {
    set((state) => {
      const newDrawings = state.drawings.map((d) =>
        d.id === id ? { ...d, ...updates } : d,
      );
      queueDrawingsSave(state.currentSymbol, newDrawings);
      return { drawings: newDrawings };
    });
  },

  deleteDrawing: (id) => {
    set((state) => {
      const newDrawings = state.drawings.filter((d) => d.id !== id);
      queueDrawingsSave(state.currentSymbol, newDrawings);
      return {
        drawings: newDrawings,
        selectedDrawingId:
          state.selectedDrawingId === id ? null : state.selectedDrawingId,
        undoStack: [...state.undoStack, state.drawings],
        redoStack: [],
      };
    });
  },

  duplicateDrawing: (id) => {
    const drawing = get().drawings.find((d) => d.id === id);
    if (!drawing) return;

    const duplicated: Drawing = {
      ...drawing,
      id: `drawing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      zIndex: getNextZIndex(get().drawings),
      locked: false,
      points: drawing.points.map((p) => ({ ...p, x: p.x + 20, y: p.y + 20 })),
    };

    set((state) => {
      const newDrawings = [...state.drawings, duplicated];
      queueDrawingsSave(state.currentSymbol, newDrawings);
      return { drawings: newDrawings, selectedDrawingId: duplicated.id };
    });
  },

  setSelectedDrawing: (id) => set({ selectedDrawingId: id }),

  setActiveTool: (tool) => set({ activeTool: tool }),

  setIsDrawing: (isDrawing) => set({ isDrawing }),

  toggleDrawingVisibility: (id) => {
    set((state) => {
      const newDrawings = state.drawings.map((d) =>
        d.id === id ? { ...d, visible: !d.visible } : d,
      );
      queueDrawingsSave(state.currentSymbol, newDrawings);
      return { drawings: newDrawings };
    });
  },

  toggleDrawingLock: (id) => {
    set((state) => {
      const newDrawings = state.drawings.map((d) =>
        d.id === id ? { ...d, locked: !d.locked } : d,
      );
      queueDrawingsSave(state.currentSymbol, newDrawings);
      return { drawings: newDrawings };
    });
  },

  bringToFront: (id) => {
    const maxZ = Math.max(...get().drawings.map((d) => d.zIndex));
    get().updateDrawing(id, { zIndex: maxZ + 1 });
  },

  sendToBack: (id) => {
    get().updateDrawing(id, { zIndex: 0 });
    // Re-index all drawings
    set((state) => {
      const newDrawings = state.drawings
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((d, idx) => ({ ...d, zIndex: idx + 1 }));
      queueDrawingsSave(state.currentSymbol, newDrawings);
      return { drawings: newDrawings };
    });
  },

  clearAllDrawings: () => {
    const state = get();
    set({
      drawings: [],
      selectedDrawingId: null,
      undoStack: [...state.undoStack, state.drawings],
      redoStack: [],
    });
    clearDrawingsStorage(state.currentSymbol);
  },

  setSymbol: (symbol) => {
    set((state) => {
      const normalizedSymbol = resolveDrawingSymbol(symbol);
      if (state.currentSymbol === normalizedSymbol) {
        return {};
      }

      commitDrawingsSave(state.currentSymbol, state.drawings);
      const nextDrawings = loadDrawingsForSymbol(normalizedSymbol);

      return {
        currentSymbol: normalizedSymbol,
        drawings: nextDrawings,
        selectedDrawingId: null,
        undoStack: [],
        redoStack: [],
      };
    });
  },

  // Undo / Redo
  undo: () => {
    set((state) => {
      if (state.undoStack.length === 0) return {};
      const previousDrawings = state.undoStack[state.undoStack.length - 1];
      const newUndoStack = state.undoStack.slice(0, -1);
      queueDrawingsSave(state.currentSymbol, previousDrawings);
      return {
        drawings: previousDrawings,
        undoStack: newUndoStack,
        redoStack: [...state.redoStack, state.drawings],
        selectedDrawingId: null,
      };
    });
  },

  redo: () => {
    set((state) => {
      if (state.redoStack.length === 0) return {};
      const nextDrawings = state.redoStack[state.redoStack.length - 1];
      const newRedoStack = state.redoStack.slice(0, -1);
      queueDrawingsSave(state.currentSymbol, nextDrawings);
      return {
        drawings: nextDrawings,
        undoStack: [...state.undoStack, state.drawings],
        redoStack: newRedoStack,
        selectedDrawingId: null,
      };
    });
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  saveTemplate: (name) => {
    const { drawings } = get();
    const template: DrawingTemplate = {
      id: `template-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      drawings: drawings.map((d) => ({ ...d })),
      createdAt: new Date().toISOString(),
    };

    set((state) => {
      const newTemplates = [...state.templates, template];
      debouncedSaveTemplates(newTemplates);
      return { templates: newTemplates };
    });
  },

  loadTemplate: (id) => {
    const template = get().templates.find((t) => t.id === id);
    if (!template) return;

    // Generate new IDs for loaded drawings
    const loadedDrawings: Drawing[] = template.drawings.map((d) => ({
      ...d,
      id: `drawing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      zIndex: getNextZIndex(get().drawings) + (d.zIndex || 0),
    }));

    set((state) => {
      const newDrawings = [...state.drawings, ...loadedDrawings];
      queueDrawingsSave(state.currentSymbol, newDrawings);
      return { drawings: newDrawings };
    });
  },

  deleteTemplate: (id) => {
    set((state) => {
      const newTemplates = state.templates.filter((t) => t.id !== id);
      debouncedSaveTemplates(newTemplates);
      return { templates: newTemplates };
    });
  },
}));
