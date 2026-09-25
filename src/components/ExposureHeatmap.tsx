/**
 * Exposure Heatmap Component
 * Canvas-based real-time visualization of position exposure across symbols and time
 * Optimized for 60 FPS with batched updates and requestAnimationFrame
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { buildApiUrl } from '../config/api';

// ============================================
// Types
// ============================================

type TimeInterval = '15m' | '1h' | '4h' | '1d';

interface ExposureCell {
  symbol: string;
  time: number;
  exposure: number; // -100 to 100 (negative = short, positive = long)
  volume: number;
  netPnL: number;
}

interface ExposureData {
  cells: ExposureCell[];
  symbols: string[];
  timeRange: { start: number; end: number };
}

interface TooltipData {
  x: number;
  y: number;
  cell: ExposureCell;
}

// ============================================
// Color Calculation
// ============================================

/**
 * Convert exposure value (-100 to 100) to HSL color
 * Green (low) → Yellow → Red (high)
 */
const exposureToColor = (exposure: number): string => {
  const absExposure = Math.abs(exposure);
  const normalized = Math.min(absExposure / 100, 1);

  // HSL color space: 120 (green) → 60 (yellow) → 0 (red)
  const hue = 120 - normalized * 120;
  const saturation = 70 + normalized * 30; // 70-100%
  const lightness = 50 - normalized * 20; // 50-30%

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

/**
 * Get text color based on background brightness
 */
const getTextColor = (exposure: number): string => {
  const absExposure = Math.abs(exposure);
  return absExposure > 50 ? '#ffffff' : '#1a1a1a';
};

// ============================================
// Canvas Rendering
// ============================================

interface RenderConfig {
  canvas: HTMLCanvasElement;
  data: ExposureData;
  interval: TimeInterval;
  viewport: { offsetX: number; offsetY: number; zoom: number };
  hoveredCell: ExposureCell | null;
}

const CELL_WIDTH = 80;
const CELL_HEIGHT = 40;
const HEADER_HEIGHT = 30;
const SYMBOL_WIDTH = 100;

/**
 * Render heatmap to canvas using RAF for smooth 60 FPS
 */
const renderHeatmap = (config: RenderConfig): void => {
  const { canvas, data, viewport, hoveredCell } = config;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { symbols, cells } = data;
  const { offsetX, offsetY, zoom } = viewport;

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Calculate visible range
  const cellWidth = CELL_WIDTH * zoom;
  const cellHeight = CELL_HEIGHT * zoom;

  const visibleStartX = Math.max(0, Math.floor(-offsetX / cellWidth));
  const visibleEndX = Math.min(
    Math.ceil((canvas.width - SYMBOL_WIDTH - offsetX) / cellWidth) + visibleStartX,
    cells.length
  );

  const visibleStartY = Math.max(0, Math.floor(-offsetY / cellHeight));
  const visibleEndY = Math.min(
    Math.ceil((canvas.height - HEADER_HEIGHT - offsetY) / cellHeight) + visibleStartY,
    symbols.length
  );

  // Group cells by symbol and time for efficient lookup
  const cellMap = new Map<string, ExposureCell>();
  cells.forEach(cell => {
    const key = `${cell.symbol}-${cell.time}`;
    cellMap.set(key, cell);
  });

  // Render cells (only visible ones)
  for (let row = visibleStartY; row < visibleEndY; row++) {
    const symbol = symbols[row];

    for (let col = visibleStartX; col < visibleEndX; col++) {
      const timeIndex = col;
      const cell = cellMap.get(`${symbol}-${timeIndex}`);

      if (!cell) continue;

      const x = SYMBOL_WIDTH + col * cellWidth + offsetX;
      const y = HEADER_HEIGHT + row * cellHeight + offsetY;

      // Skip if outside visible area
      if (x + cellWidth < SYMBOL_WIDTH || x > canvas.width ||
        y + cellHeight < HEADER_HEIGHT || y > canvas.height) {
        continue;
      }

      // Draw cell background
      ctx.fillStyle = exposureToColor(cell.exposure);
      ctx.fillRect(x, y, cellWidth, cellHeight);

      // Draw border
      ctx.strokeStyle = cell === hoveredCell ? '#ffffff' : 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = cell === hoveredCell ? 2 : 1;
      ctx.strokeRect(x, y, cellWidth, cellHeight);

      // Draw exposure value (only if cell is large enough)
      if (cellWidth > 50 && cellHeight > 25) {
        ctx.fillStyle = getTextColor(cell.exposure);
        ctx.font = `${Math.min(12 * zoom, 12)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          `${cell.exposure.toFixed(0)}%`,
          x + cellWidth / 2,
          y + cellHeight / 2
        );
      }
    }
  }

  // Render symbol labels (fixed on left)
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, HEADER_HEIGHT, SYMBOL_WIDTH, canvas.height - HEADER_HEIGHT);

  for (let row = visibleStartY; row < visibleEndY; row++) {
    const symbol = symbols[row];
    const y = HEADER_HEIGHT + row * cellHeight + offsetY;

    if (y + cellHeight < HEADER_HEIGHT || y > canvas.height) continue;

    // Background
    ctx.fillStyle = row % 2 === 0 ? '#2a2a2a' : '#1a1a1a';
    ctx.fillRect(0, y, SYMBOL_WIDTH, cellHeight);

    // Symbol text
    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.min(11 * zoom, 11)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(symbol, 8, y + cellHeight / 2);
  }

  // Render time labels (fixed on top)
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(SYMBOL_WIDTH, 0, canvas.width - SYMBOL_WIDTH, HEADER_HEIGHT);

  for (let col = visibleStartX; col < visibleEndX; col++) {
    const x = SYMBOL_WIDTH + col * cellWidth + offsetX;

    if (x + cellWidth < SYMBOL_WIDTH || x > canvas.width) continue;

    // Background
    ctx.fillStyle = col % 2 === 0 ? '#2a2a2a' : '#1a1a1a';
    ctx.fillRect(x, 0, cellWidth, HEADER_HEIGHT);

    // Time label (only if cell is large enough)
    if (cellWidth > 40) {
      const timeLabel = new Date(col * 1000).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });

      ctx.fillStyle = '#ffffff';
      ctx.font = `${Math.min(10 * zoom, 10)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(timeLabel, x + cellWidth / 2, HEADER_HEIGHT / 2);
    }
  }

  // Render corner (top-left fixed area)
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, SYMBOL_WIDTH, HEADER_HEIGHT);
  ctx.fillStyle = '#888888';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Symbol', SYMBOL_WIDTH / 2, HEADER_HEIGHT / 2);
};

// ============================================
// Component
// ============================================

export const ExposureHeatmap = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const updateBatchRef = useRef<ExposureCell[]>([]);
  const lastRenderTime = useRef<number>(0);

  // State
  const [timeInterval, setTimeInterval] = useState<TimeInterval>('1h');
  const [data, setData] = useState<ExposureData>({
    cells: [],
    symbols: [],
    timeRange: { start: Date.now() - 24 * 60 * 60 * 1000, end: Date.now() }
  });
  const [viewport, setViewport] = useState({ offsetX: 0, offsetY: 0, zoom: 1 });
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [hoveredCell, setHoveredCell] = useState<ExposureCell | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });

  // ============================================
  // Data Fetching
  // ============================================

  const fetchExposureData = useCallback(async () => {
    try {
      // TODO: Replace with actual API endpoint
      const response = await fetch(
        `${buildApiUrl(`/api/analytics/exposure/heatmap?interval=${timeInterval}`)}`
      );

      if (!response.ok) throw new Error('Failed to fetch exposure data');

      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error('[ExposureHeatmap] Failed to fetch data:', error);

      // Mock data for development
      const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD'];
      const cells: ExposureCell[] = [];
      const now = Date.now();

      for (let i = 0; i < 24; i++) {
        symbols.forEach(symbol => {
          cells.push({
            symbol,
            time: now - i * 60 * 60 * 1000,
            exposure: Math.random() * 200 - 100, // -100 to 100
            volume: Math.random() * 10,
            netPnL: Math.random() * 1000 - 500
          });
        });
      }

      setData({
        cells,
        symbols,
        timeRange: { start: now - 24 * 60 * 60 * 1000, end: now }
      });
    }
  }, [timeInterval]);

  useEffect(() => {
    fetchExposureData();
    const refreshInterval = setInterval(fetchExposureData, 60000); // Refresh every minute

    return () => clearInterval(refreshInterval);
  }, [fetchExposureData]);

  // ============================================
  // WebSocket Updates
  // ============================================

  const { subscribe } = useWebSocket();

  useEffect(() => {
    const unsubscribe = subscribe('exposure-updates', (update: any) => {
      // Batch updates for 60 FPS
      updateBatchRef.current.push(update);
    });

    return () => {
      unsubscribe();
    };
  }, [subscribe]);

  // ============================================
  // Rendering Loop (60 FPS)
  // ============================================

  const render = useCallback(() => {
    const now = performance.now();
    const elapsed = now - lastRenderTime.current;

    // Target 60 FPS (16.67ms per frame)
    if (elapsed < 16) {
      animationFrameRef.current = requestAnimationFrame(render);
      return;
    }

    // Process batched updates
    if (updateBatchRef.current.length > 0) {
      setData(prevData => {
        const updatedCells = [...prevData.cells];
        const cellMap = new Map(updatedCells.map((c, i) => [`${c.symbol}-${c.time}`, i]));

        // Batch process up to 50 updates per frame (prevents frame drops)
        const batch = updateBatchRef.current.splice(0, 50);

        batch.forEach(update => {
          const key = `${update.symbol}-${update.time}`;
          const index = cellMap.get(key);

          if (index !== undefined) {
            updatedCells[index] = update;
          } else {
            updatedCells.push(update);
          }
        });

        return { ...prevData, cells: updatedCells };
      });
    }

    // Render to canvas
    if (canvasRef.current) {
      renderHeatmap({
        canvas: canvasRef.current,
        data,
        interval: timeInterval,
        viewport,
        hoveredCell
      });
    }

    lastRenderTime.current = now;
    animationFrameRef.current = requestAnimationFrame(render);
  }, [data, timeInterval, viewport, hoveredCell]);

  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [render]);

  // ============================================
  // Canvas Resize
  // ============================================

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current && containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        canvasRef.current.width = width;
        canvasRef.current.height = height;
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ============================================
  // Mouse Interactions
  // ============================================

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Handle panning
    if (isPanning) {
      const deltaX = x - lastMousePos.x;
      const deltaY = y - lastMousePos.y;

      setViewport(prev => ({
        ...prev,
        offsetX: prev.offsetX + deltaX,
        offsetY: prev.offsetY + deltaY
      }));

      setLastMousePos({ x, y });
      return;
    }

    // Calculate hovered cell
    const cellWidth = CELL_WIDTH * viewport.zoom;
    const cellHeight = CELL_HEIGHT * viewport.zoom;

    const col = Math.floor((x - SYMBOL_WIDTH - viewport.offsetX) / cellWidth);
    const row = Math.floor((y - HEADER_HEIGHT - viewport.offsetY) / cellHeight);

    if (col >= 0 && row >= 0 && row < data.symbols.length) {
      const symbol = data.symbols[row];
      const cell = data.cells.find(c => c.symbol === symbol && c.time === col);

      if (cell) {
        setHoveredCell(cell);
        setTooltip({ x: e.clientX, y: e.clientY, cell });
        return;
      }
    }

    setHoveredCell(null);
    setTooltip(null);
  }, [isPanning, lastMousePos, viewport, data]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsPanning(true);
    setLastMousePos({ x: e.clientX - (containerRef.current?.getBoundingClientRect().left || 0), y: e.clientY - (containerRef.current?.getBoundingClientRect().top || 0) });
  }, []);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
    setViewport(prev => ({
      ...prev,
      zoom: Math.max(0.5, Math.min(3, prev.zoom * zoomDelta))
    }));
  }, []);

  // ============================================
  // Render
  // ============================================

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Controls */}
      <div className="flex items-center justify-between p-3 border-b border-zinc-800">
        <h3 className="text-sm font-semibold text-white">Exposure Heatmap</h3>

        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Interval:</span>
          {(['15m', '1h', '4h', '1d'] as TimeInterval[]).map(int => (
            <button
              key={int}
              onClick={() => setTimeInterval(int)}
              className={`px-3 py-1 text-xs rounded ${timeInterval === int
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
            >
              {int}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewport({ offsetX: 0, offsetY: 0, zoom: 1 })}
            className="px-3 py-1 text-xs bg-zinc-800 text-zinc-400 rounded hover:bg-zinc-700"
          >
            Reset View
          </button>
        </div>
      </div>

      {/* Canvas Container */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          className="cursor-grab active:cursor-grabbing"
        />

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute pointer-events-none z-50 bg-zinc-900 border border-zinc-700 rounded-lg p-3 shadow-xl"
            style={{
              left: tooltip.x + 10,
              top: tooltip.y + 10,
            }}
          >
            <div className="text-xs space-y-1">
              <div className="font-semibold text-white">{tooltip.cell.symbol}</div>
              <div className="text-zinc-400">
                {new Date(tooltip.cell.time).toLocaleString()}
              </div>
              <div className="pt-1 border-t border-zinc-800 space-y-1">
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">Exposure:</span>
                  <span
                    className={tooltip.cell.exposure >= 0 ? 'text-green-400' : 'text-red-400'}
                  >
                    {tooltip.cell.exposure.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">Volume:</span>
                  <span className="text-white">{tooltip.cell.volume.toFixed(2)} lots</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">Net P&L:</span>
                  <span
                    className={tooltip.cell.netPnL >= 0 ? 'text-green-400' : 'text-red-400'}
                  >
                    ${tooltip.cell.netPnL.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 p-2 border-t border-zinc-800 bg-zinc-900">
        <span className="text-xs text-zinc-500">Exposure:</span>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: exposureToColor(-100) }} />
          <span className="text-xs text-zinc-400">Short (-100%)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: exposureToColor(0) }} />
          <span className="text-xs text-zinc-400">Neutral (0%)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: exposureToColor(100) }} />
          <span className="text-xs text-zinc-400">Long (+100%)</span>
        </div>
      </div>
    </div>
  );
};
