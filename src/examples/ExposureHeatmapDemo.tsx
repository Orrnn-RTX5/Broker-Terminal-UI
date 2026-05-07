/**
 * Exposure Heatmap Demo Page
 * Demonstrates the canvas-based real-time exposure visualization
 */

import { ExposureHeatmap } from '../components/ExposureHeatmap';

export const ExposureHeatmapDemo = () => {
  return (
    <div className="h-screen bg-zinc-950 p-4">
      <div className="h-full flex flex-col gap-4">
        {/* Header */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h1 className="text-2xl font-bold text-white mb-2">
            Exposure Heatmap Visualization
          </h1>
          <p className="text-sm text-zinc-400">
            Real-time canvas-based heatmap showing position exposure across symbols and time.
            Optimized for 60 FPS with batched WebSocket updates.
          </p>
          <div className="mt-4 flex gap-4 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded" />
              <span className="text-zinc-500">Low exposure</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-yellow-500 rounded" />
              <span className="text-zinc-500">Medium exposure</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-red-500 rounded" />
              <span className="text-zinc-500">High exposure</span>
            </div>
          </div>
          <div className="mt-3 flex gap-4 text-xs text-zinc-500">
            <span>✨ Zoom: Mouse wheel</span>
            <span>🖱️ Pan: Click and drag</span>
            <span>ℹ️ Tooltip: Hover over cells</span>
          </div>
        </div>

        {/* Heatmap */}
        <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <ExposureHeatmap />
        </div>

        {/* Performance Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">Rendering</div>
            <div className="text-lg font-bold text-green-400">60 FPS</div>
            <div className="text-xs text-zinc-600">Canvas-based</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">Update Batch</div>
            <div className="text-lg font-bold text-blue-400">50/frame</div>
            <div className="text-xs text-zinc-600">16ms budget</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">WebSocket</div>
            <div className="text-lg font-bold text-purple-400">Real-time</div>
            <div className="text-xs text-zinc-600">Buffered updates</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">Performance</div>
            <div className="text-lg font-bold text-yellow-400">Optimized</div>
            <div className="text-xs text-zinc-600">RAF + batching</div>
          </div>
        </div>
      </div>
    </div>
  );
};
