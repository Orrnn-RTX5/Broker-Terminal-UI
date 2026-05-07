/**
 * Chart Integration Demo
 * Demonstrates all chart features: crosshair toggle, zoom, drawing tools, and indicators
 */

import { Icon } from '../components/ui/Icon';
import { useState, useEffect } from 'react';
import { ChartWithIndicators } from '../components/ChartWithIndicators';
import { commandBus } from '../services/commandBus';
import { chartManager } from '../services/chartManager';
import { drawingManager } from '../services/drawingManager';
import { indicatorManager } from '../services/indicatorManager';
export function ChartIntegrationDemo() {
  const [crosshairEnabled, setCrosshairEnabled] = useState(true);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [indicators, setIndicators] = useState<any[]>([]);

  // Monitor drawing manager events
  useEffect(() => {
    const handleDrawingSaved = (e: any) => {
      console.log('Drawing saved:', e.detail);
    };

    const handleDrawingDeleted = (e: any) => {
      console.log('Drawing deleted:', e.detail);
    };

    window.addEventListener('drawing:saved', handleDrawingSaved as EventListener);
    window.addEventListener('drawing:deleted', handleDrawingDeleted as EventListener);

    return () => {
      window.removeEventListener('drawing:saved', handleDrawingSaved as EventListener);
      window.removeEventListener('drawing:deleted', handleDrawingDeleted as EventListener);
    };
  }, []);

  // Monitor indicator changes
  useEffect(() => {
    const interval = setInterval(() => {
      setIndicators(indicatorManager.getIndicators());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleCrosshairToggle = () => {
    commandBus.dispatch({ type: 'TOGGLE_CROSSHAIR', payload: {} });
    setCrosshairEnabled(!crosshairEnabled);
  };

  const handleZoomIn = () => {
    commandBus.dispatch({ type: 'ZOOM_IN', payload: {} });
  };

  const handleZoomOut = () => {
    commandBus.dispatch({ type: 'ZOOM_OUT', payload: {} });
  };

  const handleFitContent = () => {
    commandBus.dispatch({ type: 'FIT_CONTENT', payload: {} });
  };

  const handleToolSelect = (tool: string) => {
    setActiveTool(tool);
    commandBus.dispatch({ type: `SELECT_${tool.toUpperCase()}` as any, payload: {} });
  };

  const handleOpenIndicators = () => {
    commandBus.dispatch({ type: 'OPEN_INDICATORS' as any, payload: {} });
  };

  const handleClearDrawings = () => {
    drawingManager.clearAllDrawings();
  };

  const handleRemoveIndicator = (id: string) => {
    indicatorManager.removeIndicator(id);
    setIndicators(indicatorManager.getIndicators());
  };

  return (
    <div className="w-full h-screen flex flex-col bg-zinc-900">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-3 bg-zinc-800 border-b border-zinc-700">
        <div className="flex items-center gap-1 px-2 py-1 bg-zinc-900 rounded">
          <button
            onClick={handleCrosshairToggle}
            className={`p-2 rounded transition-colors ${crosshairEnabled
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            title="Toggle Crosshair (C)"
          >
            <Icon name="crosshair" size="lg" />
          </button>

          <div className="w-px h-6 bg-zinc-700 mx-1" />

          <button
            onClick={handleZoomIn}
            className="p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
            title="Zoom In (+)"
          >
            <Icon name="zoom-in" size="lg" />
          </button>

          <button
            onClick={handleZoomOut}
            className="p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
            title="Zoom Out (-)"
          >
            <Icon name="zoom-out" size="lg" />
          </button>

          <button
            onClick={handleFitContent}
            className="p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
            title="Fit Content"
          >
            <Icon name="grid" size="lg" />
          </button>
        </div>

        <div className="w-px h-6 bg-zinc-700" />

        <div className="flex items-center gap-1 px-2 py-1 bg-zinc-900 rounded">
          <span className="text-xs text-zinc-500 mr-2">Drawing Tools</span>

          <button
            onClick={() => handleToolSelect('trendline')}
            className={`p-2 rounded transition-colors ${activeTool === 'trendline'
                ? 'bg-zinc-700/20 text-zinc-300'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            title="Trendline (T)"
          >
            <Icon name="trending-up" size="lg" />
          </button>

          <button
            onClick={() => handleToolSelect('hline')}
            className={`p-2 rounded transition-colors ${activeTool === 'hline'
                ? 'bg-zinc-700/20 text-zinc-300'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            title="Horizontal Line (H)"
          >
            <Icon name="minus" size="lg" />
          </button>

          <button
            onClick={() => handleToolSelect('vline')}
            className={`p-2 rounded transition-colors ${activeTool === 'vline'
                ? 'bg-zinc-700/20 text-zinc-300'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            title="Vertical Line (V)"
          >
            <Icon name="minus" size="lg" className="rotate-90" />
          </button>

          <button
            onClick={() => handleToolSelect('text')}
            className={`p-2 rounded transition-colors ${activeTool === 'text'
                ? 'bg-zinc-700/20 text-zinc-300'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            title="Text (Shift+T)"
          >
            <Icon name="text" size="lg" />
          </button>

          <div className="w-px h-6 bg-zinc-700 mx-1" />

          <button
            onClick={handleClearDrawings}
            className="p-2 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 rounded transition-colors"
            title="Clear All Drawings"
          >
            <Icon name="trash" size="lg" />
          </button>
        </div>

        <div className="w-px h-6 bg-zinc-700" />

        <button
          onClick={handleOpenIndicators}
          className="px-4 py-2 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded transition-colors flex items-center gap-2"
        >
          <Icon name="activity" size="lg" />
          <span className="text-sm font-medium">Indicators</span>
        </button>

        <div className="flex-1" />

        {/* Active Indicators */}
        {indicators.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">Active:</span>
            {indicators.map(ind => (
              <div
                key={ind.id}
                className="flex items-center gap-2 px-2 py-1 bg-zinc-900 rounded"
              >
                <span className="text-xs text-zinc-300">{ind.name}</span>
                <button
                  onClick={() => handleRemoveIndicator(ind.id)}
                  className="text-zinc-500 hover:text-red-400 transition-colors"
                >
                  <Icon name="trash" size="xs" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        <ChartWithIndicators
          symbol="EURUSD"
          chartType="candlestick"
          timeframe="M1"
        />
      </div>

      {/* Info Panel */}
      <div className="p-3 bg-zinc-800 border-t border-zinc-700">
        <div className="grid grid-cols-3 gap-4 text-xs">
          <div>
            <div className="text-zinc-500 mb-1">Crosshair</div>
            <div className={crosshairEnabled ? 'text-emerald-400' : 'text-zinc-400'}>
              {crosshairEnabled ? 'Enabled' : 'Disabled'}
            </div>
          </div>

          <div>
            <div className="text-zinc-500 mb-1">Active Tool</div>
            <div className="text-zinc-300">
              {activeTool || 'None'}
            </div>
          </div>

          <div>
            <div className="text-zinc-500 mb-1">Indicators</div>
            <div className="text-zinc-300">
              {indicators.length} active
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
