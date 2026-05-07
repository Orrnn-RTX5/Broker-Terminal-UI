/**
 * SimpleDockExample - A simplified working example
 * This demonstrates the docking system without complex state issues
 */

import { Icon } from '../ui/Icon';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { DockLayout, DockPanelConfig, DockDirection, DockContainer as DockContainerType } from '../../services/dockManager';
import { DockManager, dockManager } from '../../services/dockManager';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GripVertical, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, LayoutGrid, LayoutDashboard } from 'lucide-react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Sample panels
const INITIAL_PANELS: DockPanelConfig[] = [
  { id: 'market-watch', title: 'Market Watch', component: 'MarketWatch', minWidth: 200, minHeight: 200, preferredWidth: 250, preferredHeight: 400 },
  { id: 'chart', title: 'Chart - EUR/USD', component: 'Chart', minWidth: 400, minHeight: 300, closable: false },
  { id: 'trades', title: 'Trades', component: 'Trades', minWidth: 300, minHeight: 200 },
  { id: 'account', title: 'Account', component: 'Account', minWidth: 250, minHeight: 150 },
];

// Simple Panel Content
const PanelContent: React.FC<{ type: string }> = ({ type }) => {
  switch (type) {
    case 'MarketWatch':
      return (
        <div className="p-2 space-y-1">
          <div className="flex items-center justify-between py-1 px-2 text-xs font-medium text-muted-foreground border-b border-border">
            <span>Symbol</span>
            <span>Bid/Ask</span>
          </div>
          {['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD'].map((pair) => (
            <div key={pair} className="flex items-center justify-between py-1.5 px-2 text-sm hover:bg-muted rounded cursor-pointer">
              <span className="font-medium">{pair}</span>
              <div className="text-right">
                <div className="text-emerald-500">1.08{Math.floor(Math.random() * 9)}</div>
                <div className="text-red-500 text-[10px]">1.08{Math.floor(Math.random() * 9)}</div>
              </div>
            </div>
          ))}
        </div>
      );
    case 'Chart':
      return (
        <div className="h-full w-full bg-muted/30 flex flex-col">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/50">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">EUR/USD</span>
              <span className="text-xs text-muted-foreground">M15</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-xs text-emerald-500">+0.15%</span>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center relative">
            <div className="absolute inset-0 opacity-10">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="absolute w-full border-t border-foreground" style={{ top: `${(i + 1) * 12}%` }} />
              ))}
            </div>
            <svg className="w-full h-full" preserveAspectRatio="none">
              <path d="M0,300 Q150,280 300,250 T600,200 T800,150" fill="none" stroke="#2196F3" strokeWidth="2" />
              <path d="M0,300 Q150,280 300,250 T600,200 T800,150 V400 H0 Z" fill="#2196F3" opacity="0.1" />
            </svg>
          </div>
        </div>
      );
    case 'Trades':
      return (
        <div className="h-full flex flex-col">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left py-1 px-2 font-medium text-muted-foreground">Symbol</th>
                <th className="text-right py-1 px-2 font-medium text-muted-foreground">P/L</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <td className="py-2 px-2"><span className="text-emerald-500">BUY</span> EUR/USD</td>
                <td className="text-right py-2 px-2 text-emerald-500">+$25.50</td>
              </tr>
              <tr>
                <td className="py-2 px-2"><span className="text-red-500">SELL</span> GBP/USD</td>
                <td className="text-right py-2 px-2 text-red-500">-$12.25</td>
              </tr>
            </tbody>
          </table>
        </div>
      );
    case 'Account':
      return (
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
            <span className="text-sm text-muted-foreground">Margin Level</span>
            <span className="font-semibold text-emerald-500">851.42%</span>
          </div>
        </div>
      );
    default:
      return <div className="p-4 text-muted-foreground">{type} Content</div>;
  }
};

// Simple Panel Component
interface SimplePanelProps {
  panel: DockPanelConfig;
  onDragStart: (e: React.MouseEvent, panel: DockPanelConfig) => void;
  onClose: () => void;
  onFloat?: () => void;
}

const SimplePanel: React.FC<SimplePanelProps> = ({ panel, onDragStart, onClose, onFloat }) => {
  return (
    <div className="flex flex-col h-full bg-background border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30 select-none cursor-grab active:cursor-grabbing"
        onMouseDown={(e) => onDragStart(e, panel)}
      >
        <GripVertical className="w-4 h-4 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium truncate">{panel.title}</span>
        <div className="flex items-center gap-1">
          {onFloat && (
            <button onClick={onFloat} className="p-1.5 rounded hover:bg-muted text-muted-foreground">
              <Icon name="grid" size="sm" className="w-3.5 h-3.5" />
            </button>
          )}
          {panel.closable !== false && (
            <button onClick={onClose} className="p-1.5 rounded hover:bg-red-500 hover:text-white text-muted-foreground">
              <Icon name="x-close" size="sm" className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {/* Content */}
      <div className="flex-1 overflow-auto">
        <PanelContent type={panel.component} />
      </div>
    </div>
  );
};

// Drop Zone Indicator
const DropZoneIndicator: React.FC<{
  direction: DockDirection;
  isActive: boolean;
  onEnter: () => void;
  onLeave: () => void;
}> = ({ direction, isActive, onEnter, onLeave }) => {
  const icons = {
    top: ArrowUp,
    bottom: ArrowDown,
    left: ArrowLeft,
    right: ArrowRight,
    center: LayoutGrid,
    tab: LayoutGrid,
  };

  const labels = { top: 'Top', bottom: 'Bottom', left: 'Left', right: 'Right', center: 'Tab', tab: 'Tab' };
  const Icon = icons[direction];

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1 p-3 rounded-lg transition-all',
        isActive ? 'bg-primary text-white scale-110' : 'bg-white/90 hover:bg-muted'
      )}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <Icon className="w-5 h-5" />
      <span className="text-[10px] font-medium">{labels[direction]}</span>
    </div>
  );
};

// Main Component
export const SimpleDockExample: React.FC = () => {
  const [layout, setLayout] = useState<DockLayout>(() => dockManager.getLayout());
  const [draggingPanel, setDraggingPanel] = useState<DockPanelConfig | null>(null);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [activeDropZone, setActiveDropZone] = useState<{ direction: DockDirection; containerId: string } | null>(null);
  const [containerRects, setContainerRects] = useState<Map<string, DOMRect>>(new Map());
  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Initialize with panels
  useEffect(() => {
    if (layout.root.children.length === 0) {
      const manager = new DockManager();
      INITIAL_PANELS.forEach((panel, i) => {
        manager.addPanel(panel, i === 0 ? undefined : 'root', i === 0 ? 'center' : 'right');
      });
      setLayout(manager.getLayout());
    }
  }, []);

  // Update container rects
  useEffect(() => {
    const updateRects = () => {
      const rects = new Map<string, DOMRect>();
      containerRefs.current.forEach((el, id) => {
        if (el) rects.set(id, el.getBoundingClientRect());
      });
      setContainerRects(rects);
    };

    updateRects();
    window.addEventListener('resize', updateRects);
    return () => window.removeEventListener('resize', updateRects);
  }, [layout]);

  // Global mouse handlers for drag
  useEffect(() => {
    if (!draggingPanel) return;

    const handleMouseMove = (e: MouseEvent) => {
      setDragPos({ x: e.clientX, y: e.clientY });

      // Find active drop zone
      containerRects.forEach((rect, containerId) => {
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        ) {
          // Determine direction based on position within container
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const threshold = 0.3; // 30% center zone

          let direction: DockDirection = 'center';

          if (e.clientX < rect.left + rect.width * threshold) direction = 'left';
          else if (e.clientX > rect.right - rect.width * threshold) direction = 'right';
          else if (e.clientY < rect.top + rect.height * threshold) direction = 'top';
          else if (e.clientY > rect.bottom - rect.height * threshold) direction = 'bottom';

          setActiveDropZone({ direction, containerId });
        }
      });
    };

    const handleMouseUp = () => {
      if (draggingPanel && activeDropZone) {
        // Perform dock operation
        const manager = new DockManager();
        manager.setLayout(layout);
        manager.dockPanel(draggingPanel.id, activeDropZone.containerId, activeDropZone.direction);
        setLayout(manager.getLayout());
      }
      setDraggingPanel(null);
      setActiveDropZone(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDraggingPanel(null);
        setActiveDropZone(null);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [draggingPanel, activeDropZone, containerRects, layout]);

  // Handle drag start
  const handleDragStart = (e: React.MouseEvent, panel: DockPanelConfig) => {
    e.preventDefault();
    setDraggingPanel(panel);
    setDragPos({ x: e.clientX, y: e.clientY });
  };

  // Remove panel
  const removePanel = (panelId: string) => {
    const manager = new DockManager();
    manager.setLayout(layout);
    manager.removePanel(panelId);
    setLayout(manager.getLayout());
  };

  // Register container ref
  const registerContainer = (id: string, el: HTMLDivElement | null) => {
    if (el) {
      containerRefs.current.set(id, el);
    }
  };

  // Render container recursively
  const renderContainer = (container: DockContainerType, depth = 0): React.ReactNode => {
    const isSplit = container.type === 'split';
    const isTabs = container.type === 'tabs';

    if (isSplit) {
      const isHorizontal = container.direction === 'horizontal';
      return (
        <div
          ref={(el) => registerContainer(container.id, el)}
          className={cn(
            'flex h-full overflow-hidden',
            isHorizontal ? 'flex-row' : 'flex-col'
          )}
        >
          {container.children.map((child, i) => {
            const childContainer = child as DockContainerType;
            const childPanel = child as DockPanelConfig;
            const ratio = childContainer.ratio || 1 / container.children.length;

            return (
              <div key={childContainer.id || childPanel.id || i} className="flex-1 min-w-0 min-h-0 relative">
                {'children' in child
                  ? renderContainer(childContainer, depth + 1)
                  : (
                    <SimplePanel
                      panel={childPanel}
                      onDragStart={handleDragStart}
                      onClose={() => removePanel(childPanel.id)}
                    />
                  )
                }

                {/* Drop zones overlay */}
                {draggingPanel && activeDropZone?.containerId === (childContainer.id || childPanel.id) && (
                  <div className="absolute inset-0 z-50 pointer-events-none">
                    <div className="absolute inset-0 bg-black/20" />
                    {/* Center */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto">
                      <DropZoneIndicator
                        direction="center"
                        isActive={activeDropZone.direction === 'center'}
                        onEnter={() => setActiveDropZone({ direction: 'center', containerId: childContainer.id || childPanel.id })}
                        onLeave={() => setActiveDropZone(null)}
                      />
                    </div>
                    {/* Top */}
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-auto">
                      <DropZoneIndicator
                        direction="top"
                        isActive={activeDropZone.direction === 'top'}
                        onEnter={() => setActiveDropZone({ direction: 'top', containerId: childContainer.id || childPanel.id })}
                        onLeave={() => setActiveDropZone(null)}
                      />
                    </div>
                    {/* Bottom */}
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto">
                      <DropZoneIndicator
                        direction="bottom"
                        isActive={activeDropZone.direction === 'bottom'}
                        onEnter={() => setActiveDropZone({ direction: 'bottom', containerId: childContainer.id || childPanel.id })}
                        onLeave={() => setActiveDropZone(null)}
                      />
                    </div>
                    {/* Left */}
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-auto">
                      <DropZoneIndicator
                        direction="left"
                        isActive={activeDropZone.direction === 'left'}
                        onEnter={() => setActiveDropZone({ direction: 'left', containerId: childContainer.id || childPanel.id })}
                        onLeave={() => setActiveDropZone(null)}
                      />
                    </div>
                    {/* Right */}
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-auto">
                      <DropZoneIndicator
                        direction="right"
                        isActive={activeDropZone.direction === 'right'}
                        onEnter={() => setActiveDropZone({ direction: 'right', containerId: childContainer.id || childPanel.id })}
                        onLeave={() => setActiveDropZone(null)}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    if (isTabs) {
      const activeTabId = container.activeTab || (container.children[0] as DockPanelConfig)?.id;
      return (
        <div ref={(el) => registerContainer(container.id, el)} className="flex flex-col h-full border border-border rounded-lg overflow-hidden">
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 border-b border-border overflow-x-auto">
            {container.children.map((child) => {
              const panel = child as DockPanelConfig;
              const isActive = panel.id === activeTabId;
              return (
                <div
                  key={panel.id}
                  className={cn(
                    'group flex items-center gap-2 px-3 py-1.5 text-sm rounded-md cursor-pointer transition-colors',
                    isActive ? 'bg-background shadow-sm' : 'hover:bg-muted text-muted-foreground'
                  )}
                  onMouseDown={(e) => handleDragStart(e as any, panel)}
                >
                  <GripVertical className="w-3 h-3 opacity-0 group-hover:opacity-50" />
                  <span className="truncate max-w-[100px]">{panel.title}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removePanel(panel.id); }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted-foreground/20"
                  >
                    <Icon name="x-close" size="sm" className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
          {/* Tab content */}
          <div className="flex-1 overflow-hidden relative">
            {container.children.map((child) => {
              const panel = child as DockPanelConfig;
              if (panel.id !== activeTabId) return null;
              return (
                <div key={panel.id} className="absolute inset-0">
                  <SimplePanel
                    panel={panel}
                    onDragStart={handleDragStart}
                    onClose={() => removePanel(panel.id)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // Single panel or root
    return (
      <div ref={(el) => registerContainer(container.id, el)} className="h-full">
        {container.children.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <LayoutDashboard className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Drag panels here</p>
            </div>
          </div>
        ) : container.children.length === 1 && !('children' in container.children[0]) ? (
          <SimplePanel
            panel={container.children[0] as DockPanelConfig}
            onDragStart={handleDragStart}
            onClose={() => removePanel((container.children[0] as DockPanelConfig).id)}
          />
        ) : (
          <div className="h-full flex flex-col gap-2">
            {container.children.map((child, i) =>
              'children' in child
                ? renderContainer(child as DockContainerType, depth + 1)
                : (
                  <div key={(child as DockPanelConfig).id} className="flex-1">
                    <SimplePanel
                      panel={child as DockPanelConfig}
                      onDragStart={handleDragStart}
                      onClose={() => removePanel((child as DockPanelConfig).id)}
                    />
                  </div>
                )
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Toolbar */}
      <div className="h-12 border-b border-border bg-muted/30 flex items-center px-4 gap-4">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="w-5 h-5 text-primary" />
          <span className="font-semibold">Simple Dock System</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Drag panel headers to dock</span>
          <span>•</span>
          <span>ESC to cancel</span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 p-2 overflow-hidden">
        {renderContainer(layout.root)}
      </div>

      {/* Drag ghost */}
      {draggingPanel && (
        <div
          className="fixed z-[100] pointer-events-none"
          style={{ left: dragPos.x + 10, top: dragPos.y + 10 }}
        >
          <div className="bg-primary text-white px-3 py-2 rounded-lg shadow-lg">
            {draggingPanel.title}
          </div>
        </div>
      )}

      {/* Instructions */}
      {draggingPanel && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-background border border-border px-4 py-2 rounded-full shadow-lg z-[100]">
          <span className="text-xs text-muted-foreground">
            Drop on a zone to dock • ESC to cancel
          </span>
        </div>
      )}
    </div>
  );
};

export default SimpleDockExample;
