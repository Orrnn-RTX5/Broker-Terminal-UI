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
 * Drawing API Service
 * Handles all HTTP communication with /api/fix/drawings endpoints
 */

import { FIX_API_URL } from '../config/api';
import type { PositionSizing } from '../drawing-tools/positionDrawingValues';

// Server response types
export interface ServerDrawing {
  id: string;
  type: string;
  symbol: string;
  userId: string;
  properties: ServerDrawingProperties;
  createdAt: string;
  updatedAt: string;
}

export interface ServerDrawingProperties {
  id?: string;           // Client-generated ID (optional)
  points: Array<{
    time: number;
    price: number;
    logicalIndex?: number;
    barOffset?: number;
    pixelXOffset?: number;
  }>;
  color?: string;
  lineWidth?: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  fillColor?: string;
  fillOpacity?: number;
  text?: string;
  subtype?: string;
  locked?: boolean;
  selected?: boolean;
  channelOffset?: number;
  channelMidpointRatio?: number;
  regressionSource?: 'open' | 'high' | 'low' | 'close' | 'hl2';
  regressionUpperDeviation?: number;
  regressionLowerDeviation?: number;
  showRegressionPearson?: boolean;
  pitchforkLevels?: number[];
  positionTargetPrice?: number;
  positionStopPrice?: number;
  positionEndTime?: number;
  positionEndLogicalIndex?: number;
  positionSizing?: PositionSizing;
  seriesSnapshot?: Array<{
    time: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    value?: number;
    volume?: number;
    tickVolume?: number;
    realVolume?: number;
  }>;
}

export interface LoadDrawingsResponse {
  drawings: ServerDrawing[];
  success: boolean;
}

export interface SaveDrawingResponse {
  drawingId: string;
  message: string;
  success: boolean;
}

// Client drawing type (matches DrawingManager)
export interface ClientDrawing {
  id: string;
  type: string;
  points: Array<{
    time: number;
    price: number;
    logicalIndex?: number;
    barOffset?: number;
    pixelXOffset?: number;
  }>;
  text?: string;
  color?: string;
  lineWidth?: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  fillColor?: string;
  fillOpacity?: number;
  selected?: boolean;
  locked?: boolean;
  subtype?: string;
  serverId?: string;     // Server-generated ID for updates/deletes
  channelOffset?: number;
  channelMidpointRatio?: number;
  regressionSource?: 'open' | 'high' | 'low' | 'close' | 'hl2';
  regressionUpperDeviation?: number;
  regressionLowerDeviation?: number;
  showRegressionPearson?: boolean;
  pitchforkLevels?: number[];
  positionTargetPrice?: number;
  positionStopPrice?: number;
  positionEndTime?: number;
  positionEndLogicalIndex?: number;
  positionSizing?: PositionSizing;
  seriesSnapshot?: Array<{
    time: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    value?: number;
    volume?: number;
    tickVolume?: number;
    realVolume?: number;
  }>;
}

class DrawingApiService {
  // Use relative URL in dev (Vite proxy handles it), absolute in production
  private get baseUrl() {
    return import.meta.env.DEV
      ? '/api/fix/drawings'
      : `${FIX_API_URL}/api/fix/drawings`;
  }

  /**
   * Get auth headers with Bearer token
   */
  private getHeaders(): HeadersInit {
    const token = localStorage.getItem('auth_token');
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Extract user ID from JWT token
   */
  private getUserId(): string {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) return 'guest';

      // JWT payload is base64 encoded
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.sub || payload.userId || payload.id || 'guest';
    } catch (e) {
      console.warn('[DrawingApi] Failed to parse JWT:', e);
      return 'guest';
    }
  }

  /**
   * Transform server drawing to client format
   */
  private transformServerToClient(serverDrawing: ServerDrawing): ClientDrawing {
    const props: Partial<ServerDrawingProperties> = serverDrawing.properties || {};

    return {
      // Use client ID if available, otherwise generate new
      id: props.id || `drawing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: serverDrawing.type,
      points: props.points || [],
      text: props.text,
      color: props.color || '#3b82f6',
      lineWidth: props.lineWidth || 2,
      fillColor: props.fillColor,
      fillOpacity: props.fillOpacity,
      lineStyle: props.lineStyle || 'solid',
      selected: false,     // Always false on load
      locked: props.locked || false,
      subtype: props.subtype,
      channelOffset: props.channelOffset,
      channelMidpointRatio: props.channelMidpointRatio,
      regressionSource: props.regressionSource,
      regressionUpperDeviation: props.regressionUpperDeviation,
      regressionLowerDeviation: props.regressionLowerDeviation,
      showRegressionPearson: props.showRegressionPearson,
      pitchforkLevels: props.pitchforkLevels,
      positionTargetPrice: props.positionTargetPrice,
      positionStopPrice: props.positionStopPrice,
      positionEndTime: props.positionEndTime,
      positionEndLogicalIndex: props.positionEndLogicalIndex,
      positionSizing: props.positionSizing,
      seriesSnapshot: props.seriesSnapshot,
      serverId: serverDrawing.id,  // Store server ID for deletes/updates
    };
  }

  /**
   * Transform client drawing to server payload
   */
  private transformClientToServer(drawing: ClientDrawing, symbol: string): object {
    return {
      type: drawing.type,
      symbol: symbol,
      userId: this.getUserId(),
      properties: {
        id: drawing.id,           // Preserve client ID
        points: drawing.points,
        color: drawing.color,
        lineWidth: drawing.lineWidth,
        fillColor: drawing.fillColor,
        fillOpacity: drawing.fillOpacity,
        lineStyle: drawing.lineStyle,
        text: drawing.text,
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
        locked: drawing.locked,
        // Exclude 'selected' - it's transient UI state
      },
    };
  }

  /**
   * Load all drawings for a symbol
   */
  async loadDrawings(symbol: string): Promise<ClientDrawing[]> {
    // FRESH START: Permanently ignore cloud drawings on load as requested
    // The user wants a clean slate without old drawings respawning from the database
    console.log(`[DrawingApi] Bypassing cloud load for ${symbol} to maintain fresh start.`);
    return [];
  }

  /**
   * Save a new drawing
   */
  async saveDrawing(drawing: ClientDrawing, symbol: string): Promise<string> {
    const payload = this.transformClientToServer(drawing, symbol);

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Save failed: HTTP ${response.status}`);
    }

    const result: SaveDrawingResponse = await response.json();

    if (!result.success) {
      throw new Error('Server returned unsuccessful response');
    }

    console.log('[DrawingApi] Saved drawing:', result.drawingId);
    return result.drawingId;
  }

  /**
   * Delete a drawing by server ID
   */
  async deleteDrawing(serverId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${encodeURIComponent(serverId)}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Delete failed: HTTP ${response.status}`);
    }

    console.log('[DrawingApi] Deleted drawing:', serverId);
  }

  /**
   * Update an existing drawing (if your API supports it)
   * Note: Your API may require DELETE + POST instead
   */
  async updateDrawing(serverId: string, drawing: ClientDrawing, symbol: string): Promise<void> {
    // If your API supports PUT/PATCH for updates, implement here
    // Otherwise, use delete + save
    await this.deleteDrawing(serverId);
    await this.saveDrawing(drawing, symbol);
  }
}

// Export singleton
export const drawingApi = new DrawingApiService();
