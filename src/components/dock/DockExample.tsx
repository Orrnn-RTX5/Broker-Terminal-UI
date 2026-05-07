/**
 * DockExample Component
 * Comprehensive example of the docking layout system
 * Demonstrates all features: dragging, docking, floating, tabs, resizing
 */

import { Icon } from '../ui/Icon';
import React, { useState, useCallback } from 'react';
import { DockContainer, FloatingPanelsLayer, GhostPreview, GlobalDropZoneOverlay, GlobalEdgeIndicators } from './index';
import { useDocking } from '../../hooks/useDocking';
import { DockPanelConfig, DockLayout } from '../../services/dockManager';
import { LayoutDashboard } from 'lucide-react';
// Sample panel configurations
const INITIAL_PANELS: DockPanelConfig[] = [
  {
    id: 'market-watch',
    title: 'Market Watch',
    icon: 'activity',
    component: 'MarketWatch',
    minWidth: 200,
    minHeight: 200,
    preferredWidth: 250,
    preferredHeight: 400,
  },
  {
    id: 'chart',
    title: 'Chart - EUR/USD',
    icon: 'chart',
    component: 'Chart',
    minWidth: 400,
    minHeight: 300,
    preferredWidth: 600,
    preferredHeight: 400,
    closable: false,
  },
  {
    id: 'trades',
    title: 'Trades',
    icon: 'trades',
    component: 'Trades',
    minWidth: 300,
    minHeight: 200,
  },
  {
    id: 'account',
    title: 'Account Summary',
    icon: 'account',
    component: 'Account',
    minWidth: 250,
    minHeight: 150,
  },
  {
    id: 'news',
    title: 'News',
    icon: 'news',
    component: 'News',
    minWidth: 200,
    minHeight: 150,
  },
  {
    id: 'orders',
    title: 'Orders',
    icon: 'orders',
    component: 'Orders',
    minWidth: 300,
    minHeight: 200,
  },
];

// Sample content components for panels
const PanelContent: React.FC<{ type: string }> = ({ type }) => {
  switch (type) {
    case 'MarketWatch':
      return <MarketWatchContent />;
    case 'Chart':
      return <ChartContent />;
    case 'Trades':
      return <TradesContent />;
    case 'Account':
      return <AccountContent />;
    case 'News':
      return <NewsContent />;
    case 'Orders':
      return <OrdersContent />;
    default:
      return <DefaultContent type={type} />;
  }
};

const MarketWatchContent: React.FC = () => (
  <div className="p-2 space-y-1">
    <div className="flex items-center justify-between py-1 px-2 text-xs font-medium text-muted-foreground border-b border-border">
      <span>Symbol</span>
      <span>Bid/Ask</span>
    </div>
    {['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD'].map((pair) => (
      <div key={pair} className="flex items-center justify-between py-1.5 px-2 text-sm hover:bg-muted rounded cursor-pointer">
        <span className="font-medium">{pair}</span>
        <div className="text-right">
          <div className="text-profit">1.0{Math.floor(Math.random() * 9)}</div>
          <div className="text-loss text-[10px]">1.0{Math.floor(Math.random() * 9)}</div>
        </div>
      </div>
    ))}
  </div>
);

const ChartContent: React.FC = () => (
  <div className="h-full w-full bg-muted/30 flex flex-col">
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/50">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">EUR/USD</span>
        <span className="text-xs text-muted-foreground">M15</span>
      </div>
      <div className="flex items-center gap-1">
        <div className="w-2 h-2 rounded-full bg-profit" />
        <span className="text-xs text-profit">+0.15%</span>
      </div>
    </div>
    <div className="flex-1 flex items-center justify-center relative">
      <div className="absolute inset-0 opacity-10">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={`h-${i}`} className="absolute w-full border-t border-foreground" style={{ top: `${(i + 1) * 12}%` }} />
        ))}
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={`v-${i}`} className="absolute h-full border-l border-foreground" style={{ left: `${(i + 1) * 12}%` }} />
        ))}
      </div>
      <svg className="w-full h-full" preserveAspectRatio="none">
        <path d="M0,300 Q150,280 300,250 T600,200 T800,150" fill="none" stroke="currentColor" strokeWidth="2" className="text-primary" />
        <path d="M0,300 Q150,280 300,250 T600,200 T800,150 V400 H0 Z" fill="currentColor" className="text-primary opacity-10" />
      </svg>
      <div className="absolute top-4 left-4 bg-background/80 backdrop-blur-sm px-2 py-1 rounded border border-border text-xs">
        <div className="font-semibold">1.08542</div>
        <div className="text-muted-foreground">H: 1.08650 L: 1.08230</div>
      </div>
    </div>
  </div>
);

const TradesContent: React.FC = () => (
  <div className="h-full flex flex-col">
    <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-muted/30">
      <button className="px-2 py-1 text-xs font-medium bg-primary text-primary-foreground rounded">Open</button>
      <button className="px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground">Closed</button>
    </div>
    <table className="w-full text-xs">
      <thead className="bg-muted/50">
        <tr>
          <th className="text-left py-1 px-2 font-medium text-muted-foreground">Symbol</th>
          <th className="text-right py-1 px-2 font-medium text-muted-foreground">Volume</th>
          <th className="text-right py-1 px-2 font-medium text-muted-foreground">Price</th>
          <th className="text-right py-1 px-2 font-medium text-muted-foreground">P/L</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-b border-border">
          <td className="py-2 px-2"><span className="text-profit">BUY</span> EUR/USD</td>
          <td className="text-right py-2 px-2">0.50</td>
          <td className="text-right py-2 px-2">1.08520</td>
          <td className="text-right py-2 px-2 text-profit">+$25.50</td>
        </tr>
        <tr className="border-b border-border">
          <td className="py-2 px-2"><span className="text-loss">SELL</span> GBP/USD</td>
          <td className="text-right py-2 px-2">0.25</td>
          <td className="text-right py-2 px-2">1.26540</td>
          <td className="text-right py-2 px-2 text-loss">-$12.25</td>
        </tr>
        <tr>
          <td className="py-2 px-2"><span className="text-profit">BUY</span> USD/JPY</td>
          <td className="text-right py-2 px-2">1.00</td>
          <td className="text-right py-2 px-2">148.350</td>
          <td className="text-right py-2 px-2 text-profit">+$45.00</td>
        </tr>
      </tbody>
    </table>
    <div className="mt-auto p-3 border-t border-border bg-muted/30">
      <div className="flex justify-between items-center text-sm">
        <span className="text-muted-foreground">Total P/L</span>
        <span className="font-semibold text-profit">+$58.25</span>
      </div>
    </div>
  </div>
);

const AccountContent: React.FC = () => (
  <div className="p-4 space-y-3">
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">Balance</span>
      <span className="font-semibold">$10,584.50</span>
    </div>
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">Equity</span>
      <span className="font-semibold">$10,642.75</span>
    </div>
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">Margin</span>
      <span className="font-semibold">$1,250.00</span>
    </div>
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">Free Margin</span>
      <span className="font-semibold text-success">$9,392.75</span>
    </div>
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">Margin Level</span>
      <span className="font-semibold text-success">851.42%</span>
    </div>
    <div className="pt-3 border-t border-border">
      <div className="w-full bg-muted rounded-full h-2">
        <div className="bg-primary h-2 rounded-full" style={{ width: '15%' }} />
      </div>
      <div className="text-xs text-muted-foreground mt-1">Margin usage: 15%</div>
    </div>
  </div>
);

const NewsContent: React.FC = () => (
  <div className="p-2 space-y-2">
    {[
      { time: '10:30', impact: 'high', title: 'ECB Interest Rate Decision' },
      { time: '10:00', impact: 'medium', title: 'Eurozone CPI Flash Estimate' },
      { time: '08:30', impact: 'low', title: 'German Retail Sales' },
      { time: 'Yesterday', impact: 'high', title: 'FOMC Meeting Minutes' },
    ].map((news, i) => (
      <div key={i} className="p-2 hover:bg-muted rounded cursor-pointer">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-muted-foreground">{news.time}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${news.impact === 'high' ? 'bg-destructive/20 text-destructive' : news.impact === 'medium' ? 'bg-warning/20 text-warning' : 'bg-muted-foreground/20 text-muted-foreground'}`}>
            {news.impact}
          </span>
        </div>
        <div className="text-sm">{news.title}</div>
      </div>
    ))}
  </div>
);

const OrdersContent: React.FC = () => (
  <div className="h-full flex flex-col">
    <table className="w-full text-xs">
      <thead className="bg-muted/50">
        <tr>
          <th className="text-left py-1 px-2 font-medium text-muted-foreground">Symbol</th>
          <th className="text-left py-1 px-2 font-medium text-muted-foreground">Type</th>
          <th className="text-right py-1 px-2 font-medium text-muted-foreground">Volume</th>
          <th className="text-right py-1 px-2 font-medium text-muted-foreground">Price</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-b border-border">
          <td className="py-2 px-2">EUR/USD</td>
          <td className="py-2 px-2"><span className="text-profit">Buy Limit</span></td>
          <td className="text-right py-2 px-2">0.50</td>
          <td className="text-right py-2 px-2">1.08200</td>
        </tr>
        <tr className="border-b border-border">
          <td className="py-2 px-2">GBP/USD</td>
          <td className="py-2 px-2"><span className="text-loss">Sell Stop</span></td>
          <td className="text-right py-2 px-2">0.25</td>
          <td className="text-right py-2 px-2">1.26000</td>
        </tr>
        <tr>
          <td className="py-2 px-2">USD/JPY</td>
          <td className="py-2 px-2"><span className="text-profit">Buy Stop</span></td>
          <td className="text-right py-2 px-2">1.00</td>
          <td className="text-right py-2 px-2">149.000</td>
        </tr>
      </tbody>
    </table>
    <div className="mt-auto p-2 border-t border-border">
      <button className="w-full py-1.5 text-xs font-medium bg-muted hover:bg-muted/80 rounded transition-colors">
        New Order
      </button>
    </div>
  </div>
);

const DefaultContent: React.FC<{ type: string }> = ({ type }) => (
  <div className="flex items-center justify-center h-full text-muted-foreground">
    <div className="text-center">
      <Icon name="layers" size="sm" className="w-8 h-8 mx-auto mb-2 opacity-50" />
      <p className="text-sm">{type} Panel</p>
    </div>
  </div>
);

// Panel selector for adding new panels
const PanelSelector: React.FC<{ onSelect: (panel: DockPanelConfig) => void }> = ({ onSelect }) => {
  const availablePanels: DockPanelConfig[] = [
    { id: `market-watch-${Date.now()}`, title: 'Market Watch', component: 'MarketWatch', icon: 'activity', minWidth: 200, minHeight: 200 },
    { id: `chart-${Date.now()}`, title: 'Chart', component: 'Chart', icon: 'chart', minWidth: 400, minHeight: 300, closable: false },
    { id: `trades-${Date.now()}`, title: 'Trades', component: 'Trades', icon: 'trades', minWidth: 300, minHeight: 200 },
    { id: `orders-${Date.now()}`, title: 'Orders', component: 'Orders', icon: 'orders', minWidth: 300, minHeight: 200 },
    { id: `account-${Date.now()}`, title: 'Account', component: 'Account', icon: 'account', minWidth: 250, minHeight: 150 },
    { id: `news-${Date.now()}`, title: 'News', component: 'News', icon: 'news', minWidth: 200, minHeight: 150 },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 p-2">
      {availablePanels.map((panel) => (
        <button
          key={panel.id}
          onClick={() => onSelect(panel)}
          className="flex items-center gap-2 p-2 text-sm hover:bg-muted rounded transition-colors text-left"
        >
          <Icon name="plus" size="sm" className="w-4 h-4 text-muted-foreground" />
          <span className="truncate">{panel.title}</span>
        </button>
      ))}
    </div>
  );
};

export const DockExample: React.FC = () => {
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [savedLayouts, setSavedLayouts] = useState<string[]>([]);

  const {
    layout,
    isDragging,
    addPanel,
    undo,
    redo,
    canUndo,
    canRedo,
    saveLayout,
    loadLayout,
    setLayout,
  } = useDocking({
    onLayoutChange: (newLayout) => {
      console.log('Layout changed:', newLayout);
    },
    onPanelAdd: (panel) => {
      console.log('Panel added:', panel);
    },
    onPanelRemove: (panelId) => {
      console.log('Panel removed:', panelId);
    },
  });

  // Initialize with some panels
  React.useEffect(() => {
    if (layout.root.children.length === 0) {
      INITIAL_PANELS.forEach((panel, index) => {
        setTimeout(() => addPanel(panel, index === 0 ? undefined : 'root', 'right'), index * 100);
      });
    }
  }, []);

  const handleAddPanel = (panel: DockPanelConfig) => {
    addPanel(panel);
    setShowAddPanel(false);
  };

  const handleSaveLayout = () => {
    saveLayout();
    const layouts = JSON.parse(localStorage.getItem('saved-layouts') || '[]');
    layouts.push({ name: `Layout ${layouts.length + 1}`, timestamp: Date.now() });
    localStorage.setItem('saved-layouts', JSON.stringify(layouts));
    setSavedLayouts(layouts);
  };

  const handleResetLayout = () => {
    // Reset to initial layout
    const newLayout = {
      root: { id: 'root', type: 'root' as const, ratio: 1, children: [] },
      floatingPanels: [],
      version: '1.0',
    };
    setLayout(newLayout);
    INITIAL_PANELS.forEach((panel, index) => {
      setTimeout(() => addPanel(panel, index === 0 ? undefined : 'root', 'right'), index * 100);
    });
  };

  // Render panel content based on type
  const renderPanel = useCallback((panel: DockPanelConfig) => {
    return <PanelContent type={panel.component} />;
  }, []);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Toolbar */}
      <div className="h-12 border-b border-border bg-muted/30 flex items-center px-4 gap-2">
        <div className="flex items-center gap-2 mr-4">
          <LayoutDashboard className="w-5 h-5 text-primary" />
          <span className="font-semibold">Docking System Demo</span>
        </div>

        <div className="h-6 w-px bg-border mx-2" />

        {/* History controls */}
        <button
          onClick={undo}
          disabled={!canUndo}
          className="p-2 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Undo (Ctrl+Z)"
        >
          <Icon name="refresh" size="sm" className="w-4 h-4" />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className="p-2 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Redo (Ctrl+Shift+Z)"
        >
          <Icon name="refresh" size="sm" className="w-4 h-4 scale-x-[-1]" />
        </button>

        <div className="h-6 w-px bg-border mx-2" />

        {/* Add panel */}
        <div className="relative">
          <button
            onClick={() => setShowAddPanel(!showAddPanel)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
          >
            <Icon name="plus" size="sm" className="w-4 h-4" />
            Add Panel
          </button>
          {showAddPanel && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-popover border border-border rounded-lg shadow-xl z-50">
              <div className="px-3 py-2 text-sm font-medium border-b border-border">Select Panel</div>
              <PanelSelector onSelect={handleAddPanel} />
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Layout controls */}
        <button
          onClick={handleSaveLayout}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium hover:bg-muted rounded transition-colors"
        >
          <Icon name="save" size="sm" className="w-4 h-4" />
          Save
        </button>
        <button
          onClick={loadLayout}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium hover:bg-muted rounded transition-colors"
        >
          <Icon name="upload" size="sm" className="w-4 h-4" />
          Load
        </button>
        <button
          onClick={handleResetLayout}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium hover:bg-muted rounded transition-colors"
        >
          <Icon name="refresh" size="sm" className="w-4 h-4" />
          Reset
        </button>
      </div>

      {/* Main dock area */}
      <div className="flex-1 overflow-hidden relative">
        <DockContainer isRoot renderPanel={renderPanel} />

        {/* Floating panels layer */}
        <FloatingPanelsLayer renderPanel={renderPanel} />
        <GlobalEdgeIndicators />

        {/* Global overlays */}
        <GhostPreview />
        <GlobalDropZoneOverlay />
      </div>

      {/* Status bar */}
      <div className="h-6 border-t border-border bg-muted/30 flex items-center px-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-4">
          <span>Panels: {layout.root.children.length}</span>
          <span>Floating: {layout.floatingPanels.length}</span>
          <span>{isDragging ? 'Dragging...' : 'Ready'}</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <span>Drag panels to dock • ESC to cancel • Ctrl+Z to undo</span>
        </div>
      </div>
    </div>
  );
};

export default DockExample;
