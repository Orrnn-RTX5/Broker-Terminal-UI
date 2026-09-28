import {
  buildDrawingContextKey,
  buildDrawingStorageKey,
  type DrawingContextIdentity,
} from '../contextKey';
import type {
  Drawing,
  DrawingCollectionChangeReason,
  DrawingType,
} from '../model/drawing';
import { drawingApi, type ClientDrawing } from '../../services/drawingApi';
import type { DrawingDocumentStore } from './DrawingDocumentStore';

export interface DrawingPersistenceCoordinatorOptions {
  documents: DrawingDocumentStore;
  getCurrentIdentity: () => DrawingContextIdentity | null;
  getCurrentTimeframe: () => string;
  getDrawings: (identity: DrawingContextIdentity) => Drawing[];
  resolveContextIdentity: (contextId: string) => DrawingContextIdentity | null;
  renderAll: () => void;
  dispatchChanged: (
    identity: DrawingContextIdentity,
    reason: DrawingCollectionChangeReason,
  ) => void;
}

/**
 * Owns browser/backend serialization for drawing documents.
 *
 * The manager supplies live context resolution and rendering callbacks; this
 * coordinator contains no chart or interaction state, which keeps loading a
 * document independent from whichever chart panel was most recently active.
 */
export class DrawingPersistenceCoordinator {
  constructor(private readonly options: DrawingPersistenceCoordinatorOptions) {}

  persistCurrent(): void {
    const identity = this.options.getCurrentIdentity();
    if (!identity) return;
    this.persistFor(identity, this.options.getDrawings(identity));
  }

  persistContext(targetContextId?: string): boolean {
    const identity = targetContextId
      ? this.options.resolveContextIdentity(targetContextId)
      : this.options.getCurrentIdentity();
    if (!identity) return false;
    this.persistFor(identity, this.options.getDrawings(identity));
    return true;
  }

  persistFor(identity: DrawingContextIdentity, drawings: Drawing[]): void {
    try {
      const key = buildDrawingStorageKey(identity);
      drawings.filter(drawing => drawing.type === 'vline').forEach(drawing => {
        const point = drawing.points[0];
        console.log('[VLine][4-PERSIST] id=', drawing.id,
          '| logicalIndex=', point?.logicalIndex,
          '| will survive JSON?', point?.logicalIndex !== undefined);
      });
      localStorage.setItem(key, JSON.stringify(drawings));
    } catch {
      // Drawings remain in memory when browser storage is unavailable.
    }
  }

  async save(
    drawing: Drawing,
    identity: DrawingContextIdentity | null = this.options.getCurrentIdentity(),
  ): Promise<void> {
    if (!identity?.symbol) return;
    const drawingContextKey = buildDrawingContextKey(identity);
    try {
      const serverId = await drawingApi.saveDrawing(
        drawing as unknown as ClientDrawing,
        identity.symbol,
      );
      const targetDrawings = this.options.documents.peek(drawingContextKey) || [];
      const index = targetDrawings.findIndex(candidate => candidate.id === drawing.id);
      if (index !== -1) {
        targetDrawings[index].serverId = serverId;
        // The optimistic local write happens before the API response. Persist
        // again after the server id arrives so a reload can still delete it.
        this.persistFor(identity, targetDrawings);
      }
    } catch {
      // The local optimistic drawing remains usable when backend persistence fails.
    }
  }

  async load(identityOrSymbol: DrawingContextIdentity | string): Promise<void> {
    const identity = this.resolveIdentity(identityOrSymbol);
    const drawingContextKey = buildDrawingContextKey(identity);

    try {
      const drawings = await drawingApi.loadDrawings(identity.symbol);
      if (drawings.length === 0) {
        this.loadLocal(identity);
        return;
      }

      const purgeKey = `drawings_purged_${drawingContextKey}`;
      const shouldPurge = !sessionStorage.getItem(purgeKey);
      if (shouldPurge) {
        for (const drawing of drawings) {
          if (drawing.serverId) {
            await drawingApi.deleteDrawing(drawing.serverId).catch(() => {});
          }
        }
        sessionStorage.setItem(purgeKey, '1');
        this.options.documents.replace(drawingContextKey, []);
        this.options.renderAll();
        this.options.dispatchChanged(identity, 'loaded');
        return;
      }

      const existing = this.options.documents.peek(drawingContextKey) || [];
      if (existing.length > 0) return;
      const loadedDrawings = drawings.map(drawing => ({
        id: drawing.id,
        type: drawing.type as DrawingType,
        points: drawing.points,
        text: drawing.text,
        annotation: drawing.annotation,
        color: drawing.color,
        lineWidth: drawing.lineWidth,
        fillColor: drawing.fillColor,
        fillOpacity: drawing.fillOpacity,
        lineStyle: drawing.lineStyle,
        selected: false as const,
        locked: drawing.locked ?? false,
        subtype: drawing.subtype,
        channelOffset: drawing.channelOffset,
        channelMidpointRatio: drawing.channelMidpointRatio,
        regressionSource: drawing.regressionSource,
        regressionUpperDeviation: drawing.regressionUpperDeviation,
        regressionLowerDeviation: drawing.regressionLowerDeviation,
        showRegressionPearson: drawing.showRegressionPearson,
        pitchforkLevels: drawing.pitchforkLevels,
        positionTargetPrice: drawing.positionTargetPrice,
        positionStopPrice: drawing.positionStopPrice,
        positionEndTime: drawing.positionEndTime,
        positionEndLogicalIndex: drawing.positionEndLogicalIndex,
        positionSizing: drawing.positionSizing,
        seriesSnapshot: drawing.seriesSnapshot,
        serverId: drawing.serverId ?? undefined,
      } as Drawing));
      this.options.documents.replace(drawingContextKey, loadedDrawings);
      this.options.renderAll();
      this.persistFor(identity, loadedDrawings);
      this.options.dispatchChanged(identity, 'loaded');
    } catch {
      this.loadLocal(identity);
    }
  }

  loadLocal(identityOrSymbol: DrawingContextIdentity | string): void {
    const identity = this.resolveIdentity(identityOrSymbol);
    const drawingContextKey = buildDrawingContextKey(identity);

    try {
      const key = buildDrawingStorageKey(identity);
      const legacyKey = buildDrawingStorageKey({
        symbol: identity.symbol,
        timeframe: identity.timeframe,
      });
      const scopedRaw = localStorage.getItem(key);
      const legacyRaw = identity.accountScope && key !== legacyKey
        ? localStorage.getItem(legacyKey)
        : null;
      const raw = scopedRaw || legacyRaw;
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;

      const existing = this.options.documents.peek(drawingContextKey) || [];
      if (existing.length > 0) return;
      const loadedDrawings = parsed.filter(
        drawing => drawing
          && typeof drawing.id === 'string'
          && typeof drawing.type === 'string'
          && Array.isArray(drawing.points),
      ) as Drawing[];
      this.options.documents.replace(drawingContextKey, loadedDrawings);
      if (!scopedRaw && legacyRaw) {
        localStorage.setItem(key, JSON.stringify(loadedDrawings));
      }
      loadedDrawings.filter(drawing => drawing.type === 'vline').forEach(drawing => {
        const point = drawing.points[0];
        console.log('[VLine][4-RELOAD] id=', drawing.id,
          '| logicalIndex=', point?.logicalIndex,
          '| recovered?', point?.logicalIndex !== undefined,
          '(undefined here means it was never saved or was stripped during JSON.parse)');
      });
      this.options.renderAll();
      this.options.dispatchChanged(identity, 'loaded');
    } catch {
      // Ignore malformed or unavailable local storage and keep the current document.
    }
  }

  async delete(
    serverId?: string,
    identity: DrawingContextIdentity | null = this.options.getCurrentIdentity(),
  ): Promise<void> {
    if (serverId) await drawingApi.deleteDrawing(serverId).catch(() => {});
    if (identity) this.persistFor(identity, this.options.getDrawings(identity));
  }

  saveSymbol(symbol: string): void {
    const identity = this.options.getCurrentIdentity();
    if (!identity) return;
    const target = { ...identity, symbol };
    this.persistFor(target, this.options.getDrawings(target));
  }

  loadSymbol(symbol: string): void {
    const identity = this.options.getCurrentIdentity();
    this.loadLocal(identity ? { ...identity, symbol } : symbol);
  }

  private resolveIdentity(
    identityOrSymbol: DrawingContextIdentity | string,
  ): DrawingContextIdentity {
    if (typeof identityOrSymbol !== 'string') return { ...identityOrSymbol };
    const currentIdentity = this.options.getCurrentIdentity();
    const timeframe = currentIdentity?.timeframe || this.options.getCurrentTimeframe();
    return {
      contextId: currentIdentity?.contextId || `legacy:${identityOrSymbol}:${timeframe}`,
      symbol: identityOrSymbol,
      timeframe,
      accountScope: currentIdentity?.accountScope,
    };
  }
}
