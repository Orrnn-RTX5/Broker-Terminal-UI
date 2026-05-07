/**
 * Command Bus Example Component
 * Demonstrates all features of the centralized command bus system
 */

import React, { useState } from 'react';
import {
  useCommandBus,
  useCommandDispatch,
  useCommandListener,
  useCommandHistory,
} from '../hooks/useCommandBus';
import type { Command } from '../types/commands';

/**
 * Example 1: Simple Command Dispatch
 * Shows how to dispatch commands from a component
 */
export function SimpleDispatchExample() {
  const dispatch = useCommandDispatch();

  const handleSetChartType = () => {
    dispatch({
      type: 'SET_CHART_TYPE',
      payload: { chartType: 'line' },
    });
  };

  const handleOpenOrderPanel = () => {
    dispatch({
      type: 'OPEN_ORDER_PANEL',
      payload: {
        symbol: 'EURUSD',
        price: { bid: 1.0950, ask: 1.0952 },
      },
    });
  };

  return (
    <div className="p-4 space-y-2">
      <button
        onClick={handleSetChartType}
        className="px-4 py-2 bg-zinc-8000 text-white rounded"
      >
        Set Chart Type to Line
      </button>
      <button
        onClick={handleOpenOrderPanel}
        className="px-4 py-2 bg-green-500 text-white rounded"
      >
        Open Order Panel
      </button>
    </div>
  );
}

/**
 * Example 2: Command Listening
 * Shows how to listen for specific commands
 */
export function CommandListenerExample() {
  const [lastChartType, setLastChartType] = useState<string>('candlestick');

  // Listen for SET_CHART_TYPE commands
  useCommandListener('SET_CHART_TYPE', (payload) => {
    setLastChartType((payload as any).chartType);
  });

  return (
    <div className="p-4 bg-gray-100 rounded">
      <p>Last Chart Type: {lastChartType}</p>
    </div>
  );
}

/**
 * Example 3: Full useCommandBus Hook
 * Shows all features of the main hook
 */
export function FullCommandBusExample() {
  const { dispatch, useCommandSubscription, getHistory, replay } =
    useCommandBus();
  const [commandCount, setCommandCount] = useState(0);

  // Subscribe to multiple command types
  useCommandSubscription('SET_CHART_TYPE', (payload) => {
    console.log('Chart type changed:', (payload as any).chartType);
    setCommandCount((c) => c + 1);
  });

  useCommandSubscription('ZOOM_IN', () => {
    console.log('Zoomed in');
    setCommandCount((c) => c + 1);
  });

  const handleZoom = (direction: 'in' | 'out') => {
    dispatch({
      type: (direction === 'in' ? 'ZOOM_IN' : 'ZOOM_OUT') as any,
      payload: {},
    });
  };

  const handleShowHistory = () => {
    const history = getHistory();
    console.log('Command History:', history);
    console.log('Total commands dispatched:', history.length);
  };

  const handleReplay = async () => {
    const history = getHistory();
    if (history.length > 0) {
      console.log('Replaying last 5 commands...');
      const lastFive = history.slice(-5);
      await replay(lastFive as any);
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-2">
        <button
          onClick={() => handleZoom('in')}
          className="px-4 py-2 bg-zinc-8000 text-white rounded"
        >
          Zoom In
        </button>
        <button
          onClick={() => handleZoom('out')}
          className="px-4 py-2 bg-zinc-8000 text-white rounded"
        >
          Zoom Out
        </button>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleShowHistory}
          className="px-4 py-2 bg-purple-500 text-white rounded"
        >
          Show History
        </button>
        <button
          onClick={handleReplay}
          className="px-4 py-2 bg-purple-500 text-white rounded"
        >
          Replay Last 5
        </button>
      </div>

      <p className="text-sm text-gray-600">
        Commands processed: {commandCount}
      </p>
    </div>
  );
}

/**
 * Example 4: Using Command History
 * Shows how to inspect and manage command history
 */
export function CommandHistoryExample() {
  const [history, setHistory] = useState<Command[]>([]);
  const { getHistory, clear, replay } = useCommandHistory();

  const handleRefreshHistory = () => {
    setHistory(getHistory() as any);
  };

  const handleClearHistory = () => {
    clear();
    setHistory([]);
  };

  const handleReplayAll = async () => {
    await replay();
  };

  return (
    <div className="p-4 space-y-2">
      <div className="flex gap-2">
        <button
          onClick={handleRefreshHistory}
          className="px-4 py-2 bg-gray-500 text-white rounded"
        >
          Refresh History
        </button>
        <button
          onClick={handleClearHistory}
          className="px-4 py-2 bg-red-500 text-white rounded"
        >
          Clear History
        </button>
        <button
          onClick={handleReplayAll}
          className="px-4 py-2 bg-green-500 text-white rounded"
        >
          Replay All
        </button>
      </div>

      <div className="bg-gray-100 p-3 rounded max-h-64 overflow-y-auto">
        <p className="font-bold mb-2">
          History ({history.length} commands):
        </p>
        {history.length === 0 ? (
          <p className="text-gray-600">No commands yet</p>
        ) : (
          <ul className="space-y-1">
            {history.map((cmd, idx) => (
              <li key={idx} className="text-sm">
                <span className="font-mono">{cmd.type}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Example 5: Context Menu Integration
 * Shows how to dispatch commands from a context menu
 */
export function ContextMenuCommandExample() {
  const dispatch = useCommandDispatch();
  const [selectedTool, setSelectedTool] = useState<string>('cursor');

  const tools = [
    { id: 'cursor', label: 'Cursor' },
    { id: 'trendline', label: 'Trendline' },
    { id: 'hline', label: 'Horizontal Line' },
    { id: 'vline', label: 'Vertical Line' },
    { id: 'text', label: 'Text' },
  ] as const;

  const handleSelectTool = (tool: (typeof tools)[number]['id']) => {
    setSelectedTool(tool);
    dispatch({
      type: 'SELECT_TOOL',
      payload: { tool },
    } as any);
  };

  return (
    <div className="p-4">
      <p className="mb-2 font-semibold">Drawing Tools:</p>
      <div className="space-y-1">
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => handleSelectTool(tool.id)}
            className={`w-full px-4 py-2 text-left rounded ${selectedTool === tool.id
              ? 'bg-zinc-8000 text-white'
              : 'bg-gray-100 hover:bg-gray-200'
              }`}
          >
            {tool.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Main Example Component
 * Demonstrates all examples together
 */
export function CommandBusExamplePage() {
  return (
    <div className="p-6 space-y-8 bg-white">
      <div>
        <h1 className="text-3xl font-bold mb-4">Command Bus Examples</h1>
        <p className="text-gray-600 mb-6">
          This page demonstrates all features of the centralized command bus
          system.
        </p>
      </div>

      <section>
        <h2 className="text-xl font-bold mb-3">1. Simple Dispatch</h2>
        <SimpleDispatchExample />
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">2. Command Listening</h2>
        <CommandListenerExample />
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">3. Full Hook Example</h2>
        <FullCommandBusExample />
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">4. Command History</h2>
        <CommandHistoryExample />
      </section>

      <section>
        <h2 className="text-xl font-bold mb-3">5. Context Menu</h2>
        <ContextMenuCommandExample />
      </section>
    </div>
  );
}
