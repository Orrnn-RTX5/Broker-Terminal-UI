import { Icon } from './ui/Icon';
import { useState } from 'react';
import {
  Sparkline,
  HeatMapCell,
  ProgressBar,
  StatusIndicator,
  LoadingSkeleton,
  FlashPrice,
  Tooltip,
  ContextMenu,
  ToggleSwitch,
  Slider,
  Badge,
  ResizablePanel,
  CollapsiblePanel,
  DataTable,
  KeyboardShortcuts,
  KeyboardShortcutsModal
} from './ui';
export function UIShowcase() {
  const [volume, setVolume] = useState(0.5);
  const [darkMode, setDarkMode] = useState(true);
  const [marketOpen, setMarketOpen] = useState(true);
  const [currentPrice, setCurrentPrice] = useState(1.0850);

  // Mock data for demonstrations
  const priceHistory = [1.084, 1.0845, 1.0852, 1.085, 1.0848, 1.0851, 1.085];
  const mockPositions = [
    { id: '1', symbol: 'EUR/USD', side: 'BUY', size: 1.0, pnl: 125.50, margin: 500 },
    { id: '2', symbol: 'GBP/USD', side: 'SELL', size: 0.5, pnl: -45.20, margin: 250 },
    { id: '3', symbol: 'USD/JPY', side: 'BUY', size: 2.0, pnl: 85.30, margin: 1000 },
  ];

  const shortcuts = [
    { key: 'F1', description: 'Buy at Market', action: () => console.log('Buy'), category: 'Trading' },
    { key: 'F2', description: 'Sell at Market', action: () => console.log('Sell'), category: 'Trading' },
    { key: 'Ctrl+W', description: 'Close Position', action: () => console.log('Close'), category: 'Trading' },
    { key: 'Ctrl+S', description: 'Save Layout', action: () => console.log('Save'), category: 'Layout' },
  ];

  return (
    <div className="min-h-screen bg-[#0d0d11] text-zinc-300 p-8 space-y-8">
      <KeyboardShortcuts shortcuts={shortcuts} />
      <KeyboardShortcutsModal shortcuts={shortcuts} onClose={() => { }} />

      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">UI/UX Component Showcase</h1>
          <p className="text-zinc-400">Professional Trading Terminal Components</p>
        </div>
        <button className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors flex items-center gap-2">
          <Icon name="settings" size="lg" />
          Settings
        </button>
      </header>

      {/* Status Indicators */}
      <section className="panel p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Icon name="activity" size="lg" className="text-profit" />
          Status Indicators
        </h2>
        <div className="flex flex-wrap gap-4">
          <StatusIndicator status="connected" label="Trading Server" />
          <StatusIndicator status="disconnected" label="Market Data" />
          <StatusIndicator status="pending" label="Order Processing" />
          <StatusIndicator status="idle" label="Inactive" />
        </div>
      </section>

      {/* Flash Prices & Sparklines */}
      <section className="panel p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Icon name="trending-up" size="lg" className="text-primary" />
          Price Displays & Sparklines
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-zinc-900 p-4 rounded-lg">
            <div className="text-xs text-zinc-500 mb-2">EUR/USD</div>
            <FlashPrice
              value={currentPrice}
              direction="up"
              className="text-2xl font-bold"
            />
            <div className="mt-3">
              <Sparkline data={priceHistory} color="profit" width={200} height={40} />
            </div>
          </div>
          <div className="bg-zinc-900 p-4 rounded-lg">
            <div className="text-xs text-zinc-500 mb-2">GBP/USD</div>
            <FlashPrice
              value={1.2650}
              direction="down"
              className="text-2xl font-bold"
            />
            <div className="mt-3">
              <Sparkline data={[1.27, 1.268, 1.265, 1.267, 1.264]} color="loss" width={200} height={40} />
            </div>
          </div>
          <div className="bg-zinc-900 p-4 rounded-lg">
            <div className="text-xs text-zinc-500 mb-2">USD/JPY</div>
            <FlashPrice
              value={148.50}
              direction="none"
              className="text-2xl font-bold"
            />
            <div className="mt-3">
              <Sparkline data={[148.5, 148.5, 148.5, 148.5]} color="neutral" width={200} height={40} />
            </div>
          </div>
        </div>
      </section>

      {/* Progress Bars */}
      <section className="panel p-6">
        <h2 className="text-xl font-semibold mb-4">Progress Bars</h2>
        <div className="space-y-4">
          <ProgressBar value={25} label="Margin Usage" showLabel />
          <ProgressBar value={75} label="Risk Level" showLabel />
          <ProgressBar value={95} label="Critical Level" showLabel />
          <ProgressBar value={50} variant="success" label="Account Equity" showLabel />
        </div>
      </section>

      {/* Heat Map */}
      <section className="panel p-6">
        <h2 className="text-xl font-semibold mb-4">Heat Map Cells</h2>
        <div className="grid grid-cols-5 gap-2">
          {[-50, -25, 0, 25, 50].map((value, i) => (
            <HeatMapCell key={i} value={value} className="p-4 text-center rounded" />
          ))}
        </div>
      </section>

      {/* Badges */}
      <section className="panel p-6">
        <h2 className="text-xl font-semibold mb-4">Badges</h2>
        <div className="flex flex-wrap gap-2">
          <Badge variant="profit">PROFIT</Badge>
          <Badge variant="loss">LOSS</Badge>
          <Badge variant="neutral">PENDING</Badge>
          <Badge variant="primary">ACTIVE</Badge>
          <Badge variant="warning">WARNING</Badge>
          <Badge variant="info">INFO</Badge>
        </div>
      </section>

      {/* Controls */}
      <section className="panel p-6">
        <h2 className="text-xl font-semibold mb-4">Interactive Controls</h2>
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium mb-3 text-zinc-400">Toggle Switches</h3>
            <div className="flex flex-wrap gap-4">
              <ToggleSwitch
                checked={darkMode}
                onChange={setDarkMode}
                label="Dark Mode"
              />
              <ToggleSwitch
                checked={marketOpen}
                onChange={setMarketOpen}
                label="Market Open"
              />
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium mb-3 text-zinc-400">Slider</h3>
            <Slider
              value={volume}
              onChange={setVolume}
              min={0}
              max={1}
              step={0.01}
              label="Volume"
              showValue
              format={(v) => v.toFixed(2)}
            />
          </div>
        </div>
      </section>

      {/* Data Table */}
      <section className="panel p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Icon name="credit-card" size="lg" className="text-warning" />
          Data Table (Sortable)
        </h2>
        <DataTable
          data={mockPositions}
          keyExtractor={(row) => row.id}
          columns={[
            { key: 'symbol', header: 'Symbol', sortable: true },
            {
              key: 'side', header: 'Side', sortable: true, render: (value) => (
                <Badge variant={value === 'BUY' ? 'profit' : 'loss'}>{value}</Badge>
              )
            },
            { key: 'size', header: 'Size', sortable: true, align: 'right' as const, className: 'font-mono' },
            {
              key: 'pnl', header: 'P&L', sortable: true, align: 'right' as const, render: (value) => (
                <span className={`font-mono ${value >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {value >= 0 ? '+' : ''}{value.toFixed(2)}
                </span>
              )
            },
            { key: 'margin', header: 'Margin', sortable: true, align: 'right' as const, className: 'font-mono' },
          ]}
          maxHeight="300px"
        />
      </section>

      {/* Tooltips & Context Menus */}
      <section className="panel p-6">
        <h2 className="text-xl font-semibold mb-4">Tooltips & Context Menus</h2>
        <div className="flex gap-4">
          <Tooltip content="Click to buy at market price" position="top">
            <button className="px-4 py-2 bg-profit/10 text-profit border border-profit/20 rounded hover:bg-profit/20 transition-colors">
              Hover for Tooltip
            </button>
          </Tooltip>
          <ContextMenu
            items={[
              { label: 'Buy', action: () => alert('Buy'), icon: <Icon name="trending-up" size="md" /> },
              { label: 'Sell', action: () => alert('Sell'), icon: <Icon name="activity" size="md" /> },
              { label: '', divider: true },
              { label: 'Close All', action: () => alert('Close'), icon: <Icon name="x-close" size="md" /> },
            ]}
          >
            <button className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors">
              Right-Click for Menu
            </button>
          </ContextMenu>
        </div>
      </section>

      {/* Collapsible Panel */}
      <CollapsiblePanel
        title="Advanced Settings"
        icon={<Icon name="settings" size="md" />}
        defaultOpen={false}
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            This panel can be collapsed and expanded. Great for organizing complex UIs.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-zinc-900 p-3 rounded">
              <div className="text-xs text-zinc-500 mb-1">Setting 1</div>
              <div className="text-sm">Value A</div>
            </div>
            <div className="bg-zinc-900 p-3 rounded">
              <div className="text-xs text-zinc-500 mb-1">Setting 2</div>
              <div className="text-sm">Value B</div>
            </div>
          </div>
        </div>
      </CollapsiblePanel>

      {/* Loading States */}
      <section className="panel p-6">
        <h2 className="text-xl font-semibold mb-4">Loading Skeletons</h2>
        <div className="space-y-4">
          <LoadingSkeleton type="text" count={3} />
          <LoadingSkeleton type="row" count={2} />
          <div className="flex gap-4">
            <LoadingSkeleton type="circle" />
            <div className="flex-1">
              <LoadingSkeleton type="text" width="60%" />
              <LoadingSkeleton type="text" width="80%" className="mt-2" />
            </div>
          </div>
        </div>
      </section>

      {/* Resizable Panel Demo */}
      <section className="border border-zinc-800 rounded-lg overflow-hidden h-96 flex">
        <ResizablePanel defaultSize={300} minSize={200} maxSize={500}>
          <div className="bg-zinc-900 h-full p-6">
            <h3 className="text-lg font-semibold mb-2">Resizable Panel</h3>
            <p className="text-sm text-zinc-400">Drag the right edge to resize this panel</p>
          </div>
        </ResizablePanel>
        <div className="flex-1 bg-zinc-900/50 p-6">
          <h3 className="text-lg font-semibold mb-2">Main Content</h3>
          <p className="text-sm text-zinc-400">This area adjusts automatically</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="text-center text-xs text-zinc-600 pt-8">
        Professional Trading Terminal UI Components • Press <kbd className="px-1 bg-zinc-800 rounded">?</kbd> for keyboard shortcuts
      </footer>
    </div>
  );
}
