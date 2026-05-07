/**
 * WorkingDockExample - Fully functional docking system
 * All features working: drag, drop, close, float, resize, tabs
 */

import { Icon } from '../ui/Icon';
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { DockLayout, DockPanelConfig, DockDirection, DockContainer as DockContainerType } from '../../services/dockManager';
import { DockManager, dockManager } from '../../services/dockManager';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GripVertical, LayoutDashboard } from 'lucide-react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ==================== TYPES ====================

interface FloatingPanel {
  id: string;
  panel: DockPanelConfig;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DragState {
  panel: DockPanelConfig | null;
  sourceContainerId: string | null;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

// ==================== INITIAL DATA ====================

const INITIAL_PANELS: DockPanelConfig[] = [
  { id: 'market-watch', title: 'Market Watch', component: 'MarketWatch', minWidth: 200, minHeight: 200, preferredWidth: 250, preferredHeight: 400 },
  { id: 'chart-eurusd', title: 'Chart - EUR/USD', component: 'Chart', minWidth: 400, minHeight: 300, closable: false },
  { id: 'trades', title: 'Trades', component: 'Trades', minWidth: 300, minHeight: 200 },
  { id: 'account', title: 'Account Summary', component: 'Account', minWidth: 250, minHeight: 150 },
];

// ==================== PANEL CONTENT COMPONENTS ====================

const MarketWatchContent = () => (
  <div className="p-2 space-y-1">
    <div className="flex items-center justify-between py-1 px-2 text-xs font-medium text-muted-foreground border-b border-border">
      <span>Symbol</span>
      <span>Bid/Ask</span>
    </div>
    {[
      { pair: 'EUR/USD', bid: '1.0852', ask: '1.0854', up: true },
      { pair: 'GBP/USD', bid: '1.2654', ask: '1.2656', up: false },
      { pair: 'USD/JPY', bid: '148.35', ask: '148.37', up: true },
      { pair: 'USD/CHF', bid: '0.8945', ask: '0.8947', up: false },
      { pair: 'AUD/USD', bid: '0.6542', ask: '0.6544', up: true },
    ].map((item) => (
      <div key={item.pair} className="flex items-center justify-between py-1.5 px-2 text-sm hover:bg-muted rounded cursor-pointer">
        <span className="font-medium">{item.pair}</span>
        <div className="text-right">
          <div className={item.up ? 'text-emerald-500' : 'text-red-500'}>{item.bid}</div>
          <div className="text-muted-foreground text-[10px]">{item.ask}</div>
        </div>
      </div>
    ))}
  </div>
);

const ChartContent = () => (
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
          <div key={`h-${i}`} className="absolute w-full border-t border-foreground" style={{ top: `${(i + 1) * 12}%` }} />
        ))}
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={`v-${i}`} className="absolute h-full border-l border-foreground" style={{ left: `${(i + 1) * 12}%` }} />
        ))}
      </div>
      <svg className="w-full h-full" preserveAspectRatio="none">
        <path d="M0,300 Q150,280 300,250 T600,200 T800,150" fill="none" stroke="#2196F3" strokeWidth="2" />
        <path d="M0,300 Q150,280 300,250 T600,200 T800,150 V400 H0 Z" fill="#2196F3" opacity="0.1" />
      </svg>
      <div className="absolute top-4 left-4 bg-background/80 backdrop-blur-sm px-2 py-1 rounded border border-border text-xs">
        <div className="font-semibold">1.08542</div>
        <div className="text-muted-foreground">H: 1.08650 L: 1.08230</div>
      </div>
    </div>
  </div>
);

const TradesContent = () => (
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
          <th className="text-right py-1 px-2 font-medium text-muted-foreground">P/L</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-b border-border">
          <td className="py-2 px-2"><span className="text-emerald-500">BUY</span> EUR/USD</td>
          <td className="text-right py-2 px-2">0.50</td>
          <td className="text-right py-2 px-2 text-emerald-500">+$25.50</td>
        </tr>
        <tr>
          <td className="py-2 px-2"><span className="text-red-500">SELL</span> GBP/USD</td>
          <td className="text-right py-2 px-2">0.25</td>
          <td className="text-right py-2 px-2 text-red-500">-$12.25</td>
        </tr>
      </tbody>
    </table>
    <div className="mt-auto p-3 border-t border-border bg-muted/30">
      <div className="flex justify-between items-center text-sm">
        <span className="text-muted-foreground">Total P/L</span>
        <span className="font-semibold text-emerald-500">+$13.25</span>
      </div>
    </div>
  </div>
);

const AccountContent = () => (
  <div className="p-4 space-y-3">
    {[
      { label: 'Balance', value: '$10,584.50' },
      { label: 'Equity', value: '$10,642.75' },
      { label: 'Margin', value: '$1,250.00' },
      { label: 'Free Margin', value: '$9,392.75', color: 'text-emerald-500' },
      { label: 'Margin Level', value: '851.42%', color: 'text-emerald-500' },
    ].map((item) => (
      <div key={item.label} className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{item.label}</span>
        <span className={cn("font-semibold", item.color)}>{item.value}</span>
      </div>
    ))}
    <div className="pt-3 border-t border-border">
      <div className="w-full bg-muted rounded-full h-2">
        <div className="bg-primary h-2 rounded-full" style={{ width: '15%' }} />
      </div>
      <div className="text-xs text-muted-foreground mt-1">Margin usage: 15%</div>
    </div>
  </div>
);

const PanelContent: React.FC<{ type: string }> = ({ type }) => {
  switch (type) {
    case 'MarketWatch': return <MarketWatchContent />;
    case 'Chart': return <ChartContent />;
    case 'Trades': return <TradesContent />;
    case 'Account': return <AccountContent />;
    default: return <div className="p-4 text-muted-foreground">{type}</div>;
  }
};

// No DropZoneIndicator component needed manually.
// Replaced by DropZoneOverlay connected directly to store.

// ==================== PANEL HEADER ====================

const PanelHeader: React.FC<{
  title: string;
  onDragStart: (e: React.MouseEvent) => void;
  onClose?: () => void;
  onFloat?: () => void;
  className?: string;
}> = ({ title, onDragStart, onClose, onFloat, className }) => (
  <div
    className={cn(
      'flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30 select-none cursor-grab active:cursor-grabbing',
      className
    )}
    onMouseDown={onDragStart}
  >
    <GripVertical className="w-4 h-4 text-muted-foreground" />
    <span className="flex-1 text-sm font-medium truncate">{title}</span>
    <div className="flex items-center gap-1">
      {onFloat && (
        <button
          onClick={(e) => { e.stopPropagation(); onFloat(); }}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors"
          title="Float panel"
        >
          <Icon name="grid" size="sm" className="w-3.5 h-3.5" />
        </button>
      )}
      {onClose && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="p-1.5 rounded hover:bg-destructive hover:text-destructive-foreground text-muted-foreground transition-colors"
          title="Close panel"
        >
          <Icon name="x-close" size="sm" className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  </div>
);

// ==================== RESIZE HANDLE ====================

const ResizeHandle: React.FC<{
  direction: 'vertical' | 'horizontal';
  onResize: (delta: number) => void;
}> = ({ direction, onResize }) => {
  const [isDragging, setIsDragging] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        const delta = direction === 'vertical' ? e.movementX : e.movementY;
        onResize(delta);
        rafRef.current = null;
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isDragging, direction, onResize]);

  return (
    <div
      className={cn(
        'relative flex items-center justify-center transition-colors z-10 hover:bg-primary/50',
        direction === 'vertical' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize',
        isDragging && 'bg-primary'
      )}
      onMouseDown={() => setIsDragging(true)}
    >
      <div className={cn(
        'bg-muted-foreground/30 rounded-full',
        direction === 'vertical' ? 'w-0.5 h-8' : 'w-8 h-0.5'
      )} />
    </div>
  );
};

// ==================== MAIN COMPONENT ====================

export const WorkingDockExample: React.FC = () => {
  // State
  const [layout, setLayout] = useState<DockLayout>(() => {
    const manager = new DockManager();
    INITIAL_PANELS.forEach((panel, i) => {
      manager.addPanel(panel, i === 0 ? undefined : 'root', i === 0 ? 'center' : 'right');
    });
    return manager.getLayout();
  });

  const [floatingPanels, setFloatingPanels] = useState<FloatingPanel[]>([]);
  const [dragState, setDragState] = useState<DragState>({
    panel: null, sourceContainerId: null, startX: 0, startY: 0, currentX: 0, currentY: 0
  });
  const [activeDropZone, setActiveDropZone] = useState<{ direction: DockDirection; containerId: string } | null>(null);
  const [hoveredContainer, setHoveredContainer] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Refs
  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const floatingDragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

  // Initialize
  useEffect(() => {
    setIsInitialized(true);
  }, []);

  // Get manager instance
  const getManager = useCallback(() => {
    const manager = new DockManager();
    manager.setLayout(layout);
    return manager;
  }, [layout]);

  // Panel operations
  const addPanel = useCallback((panel: DockPanelConfig, targetId?: string, direction?: DockDirection) => {
    const manager = getManager();
    manager.addPanel(panel, targetId, direction);
    setLayout(manager.getLayout());
  }, [getManager]);

  const removePanel = useCallback((panelId: string) => {
    // Remove from layout
    const manager = getManager();
    const found = manager.removePanel(panelId);
    if (found) {
      setLayout(manager.getLayout());
      return;
    }
    // Remove from floating
    setFloatingPanels(prev => prev.filter(fp => fp.panel.id !== panelId));
  }, [getManager]);

  const floatPanel = useCallback((panel: DockPanelConfig, containerId: string) => {
    // Remove from dock
    const manager = getManager();
    manager.removePanel(panel.id);
    setLayout(manager.getLayout());

    // Add to floating
    setFloatingPanels(prev => [...prev, {
      id: `floating-${Date.now()}`,
      panel,
      x: 100 + prev.length * 30,
      y: 100 + prev.length * 30,
      width: panel.preferredWidth || 400,
      height: panel.preferredHeight || 300
    }]);
  }, [getManager]);

  const dockFloatingPanel = useCallback((floatingId: string, targetId: string, direction: DockDirection) => {
    const floating = floatingPanels.find(fp => fp.id === floatingId);
    if (!floating) return;

    const manager = getManager();
    manager.addPanel(floating.panel, targetId, direction);
    setLayout(manager.getLayout());
    setFloatingPanels(prev => prev.filter(fp => fp.id !== floatingId));
  }, [floatingPanels, getManager]);

  // Drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent, panel: DockPanelConfig, sourceContainerId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragState({
      panel,
      sourceContainerId,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY
    });
  }, []);

  // Global drag handlers
  useEffect(() => {
    if (!dragState.panel) return;

    const handleMouseMove = (e: MouseEvent) => {
      setDragState(prev => ({ ...prev, currentX: e.clientX, currentY: e.clientY }));

      // Find container under cursor
      let foundContainer: string | null = null;
      containerRefs.current.forEach((el, id) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        ) {
          foundContainer = id;
        }
      });
      setHoveredContainer(foundContainer);

      // Calculate drop zone
      if (foundContainer) {
        // Collect container rects for the dock manager finder
        const rects = new Map<string, { x: number; y: number; width: number; height: number }>();
        containerRefs.current.forEach((el, id) => {
          if (el) {
            rects.set(id, el.getBoundingClientRect());
          }
        });

        const activeZone = dockManager.findDropZoneAtPoint(e.clientX, e.clientY, rects);
        setActiveDropZone(activeZone ? { direction: activeZone.direction, containerId: activeZone.targetContainerId } : null);
      } else {
        setActiveDropZone(null);
      }
    };

    const handleMouseUp = () => {
      if (dragState.panel && activeDropZone) {
        // Perform dock
        const manager = getManager();

        // If coming from another container, remove first
        if (dragState.sourceContainerId) {
          manager.removePanel(dragState.panel.id);
        }

        manager.addPanel(dragState.panel, activeDropZone.containerId, activeDropZone.direction);
        setLayout(manager.getLayout());
        setFloatingPanels(prev => prev.filter(fp => fp.panel.id !== dragState.panel!.id));
      } else if (dragState.panel && dragState.sourceContainerId && !hoveredContainer) {
        // Float the panel if dropped in empty space
        floatPanel(dragState.panel, dragState.sourceContainerId);
      }

      setDragState({ panel: null, sourceContainerId: null, startX: 0, startY: 0, currentX: 0, currentY: 0 });
      setActiveDropZone(null);
      setHoveredContainer(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDragState({ panel: null, sourceContainerId: null, startX: 0, startY: 0, currentX: 0, currentY: 0 });
        setActiveDropZone(null);
        setHoveredContainer(null);
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
  }, [dragState.panel, dragState.sourceContainerId, activeDropZone, hoveredContainer, getManager, floatPanel]);

  // Floating panel drag
  const handleFloatingDragStart = (e: React.MouseEvent, id: string) => {
    const floating = floatingPanels.find(fp => fp.id === id);
    if (!floating) return;

    floatingDragRef.current = {
      id,
      offsetX: e.clientX - floating.x,
      offsetY: e.clientY - floating.y
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!floatingDragRef.current) return;
      setFloatingPanels(prev => prev.map(fp =>
        fp.id === id
          ? { ...fp, x: e.clientX - floatingDragRef.current!.offsetX, y: e.clientY - floatingDragRef.current!.offsetY }
          : fp
      ));
    };

    const handleMouseUp = () => {
      floatingDragRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Render functions
  const renderDropZones = (containerId: string) => {
    // Magnetic rendering handled correctly inside DropZoneOverlay via app-state
    // However, WorkingDockExample manages activeDropZone state locally.
    // Given the prompt asked to replace old buttons with new magnetic edge highlight, we port DropZoneOverlay logic here manually or use the imported component if connected.
    // WorkingDockExample acts mostly independently, so we'll render a subtle highlight matching the activeDropZone.
    if (!dragState.panel || hoveredContainer !== containerId || !activeDropZone || activeDropZone.containerId !== containerId) return null;

    return (
      <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden rounded-lg">
        <div
          className={cn(
            "absolute bg-primary/20 backdrop-blur-[2px] transition-all duration-200 ease-out border-primary/50 shadow-[0_0_15px_rgba(var(--primary),0.3)]",
            activeDropZone.direction === 'top' && "top-0 left-0 right-0 h-1/3 border-b-2",
            activeDropZone.direction === 'bottom' && "bottom-0 left-0 right-0 h-1/3 border-t-2",
            activeDropZone.direction === 'left' && "left-0 top-0 bottom-0 w-1/3 border-r-2",
            activeDropZone.direction === 'right' && "right-0 top-0 bottom-0 w-1/3 border-l-2",
            activeDropZone.direction === 'center' && "inset-0 border-2"
          )}
        />
      </div>
    );
  };

  const renderContainer = (container: DockContainerType, depth = 0): React.ReactNode => {
    if (!isInitialized) return null;

    // Split container
    if (container.type === 'split') {
      const isHorizontal = container.direction === 'horizontal';
      return (
        <div
          ref={el => { if (el) containerRefs.current.set(container.id, el); }}
          className={cn('flex h-full overflow-hidden', isHorizontal ? 'flex-row' : 'flex-col')}
        >
          {container.children.map((child, index) => {
            const isContainer = 'children' in child;
            const ratio = (child as any).ratio || 1 / container.children.length;

            return (
              <React.Fragment key={(child as any).id || index}>
                <div className="flex-1 min-w-0 min-h-0 relative" style={{ flex: ratio }}>
                  {isContainer
                    ? renderContainer(child as DockContainerType, depth + 1)
                    : (
                      <div className="h-full flex flex-col bg-background border border-border rounded-lg overflow-hidden">
                        <PanelHeader
                          title={(child as DockPanelConfig).title}
                          onDragStart={(e) => handleDragStart(e, child as DockPanelConfig, container.id)}
                          onClose={(child as DockPanelConfig).closable !== false ? () => removePanel((child as DockPanelConfig).id) : undefined}
                          onFloat={() => floatPanel(child as DockPanelConfig, container.id)}
                        />
                        <div className="flex-1 overflow-auto">
                          <PanelContent type={(child as DockPanelConfig).component} />
                        </div>
                        {renderDropZones(container.id)}
                      </div>
                    )
                  }
                </div>
                {index < container.children.length - 1 && (
                  <ResizeHandle
                    direction={isHorizontal ? 'vertical' : 'horizontal'}
                    onResize={(delta) => {
                      const total = isHorizontal
                        ? containerRefs.current.get(container.id)?.offsetWidth || 1000
                        : containerRefs.current.get(container.id)?.offsetHeight || 600;
                      const ratioDelta = delta / total;

                      const manager = getManager();
                      const current = (container.children[index] as any).ratio || 1 / container.children.length;
                      const next = (container.children[index + 1] as any).ratio || 1 / container.children.length;

                      (container.children[index] as any).ratio = Math.max(0.1, Math.min(0.9, current + ratioDelta));
                      (container.children[index + 1] as any).ratio = Math.max(0.1, Math.min(0.9, next - ratioDelta));

                      manager.setLayout({ ...layout });
                      setLayout(manager.getLayout());
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
          {renderDropZones(container.id)}
        </div>
      );
    }

    // Tabs container
    if (container.type === 'tabs') {
      const activeTabId = container.activeTab || (container.children[0] as DockPanelConfig)?.id;
      return (
        <div
          ref={el => { if (el) containerRefs.current.set(container.id, el); }}
          className="flex flex-col h-full bg-background border border-border rounded-lg overflow-hidden"
        >
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-2 py-1 bg-muted/50 border-b border-border overflow-x-auto">
            {container.children.map(child => {
              const panel = child as DockPanelConfig;
              const isActive = panel.id === activeTabId;
              return (
                <div
                  key={panel.id}
                  className={cn(
                    'group flex items-center gap-2 px-3 py-1.5 text-sm rounded-md cursor-pointer transition-colors select-none',
                    isActive ? 'bg-background shadow-sm' : 'text-muted-foreground hover:bg-muted'
                  )}
                  onMouseDown={(e) => handleDragStart(e as any, panel, container.id)}
                >
                  <GripVertical className="w-3 h-3 opacity-0 group-hover:opacity-50" />
                  <span className="truncate max-w-[120px]">{panel.title}</span>
                  {panel.closable !== false && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removePanel(panel.id); }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted-foreground/20"
                    >
                      <Icon name="x-close" size="sm" className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {/* Content */}
          <div className="flex-1 overflow-hidden relative">
            {container.children.map(child => {
              const panel = child as DockPanelConfig;
              if (panel.id !== activeTabId) return null;
              return (
                <div key={panel.id} className="absolute inset-0 flex flex-col">
                  <div className="flex-1 overflow-auto">
                    <PanelContent type={panel.component} />
                  </div>
                </div>
              );
            })}
            {renderDropZones(container.id)}
          </div>
        </div>
      );
    }

    // Root or single panel
    return (
      <div
        ref={el => { if (el) containerRefs.current.set(container.id, el); }}
        className="h-full relative"
      >
        {container.children.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <LayoutDashboard className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Drag panels here</p>
            </div>
          </div>
        ) : container.children.length === 1 && !('children' in container.children[0]) ? (
          <div className="h-full flex flex-col bg-background border border-border rounded-lg overflow-hidden">
            <PanelHeader
              title={(container.children[0] as DockPanelConfig).title}
              onDragStart={(e) => handleDragStart(e, container.children[0] as DockPanelConfig, container.id)}
              onClose={(container.children[0] as DockPanelConfig).closable !== false ? () => removePanel((container.children[0] as DockPanelConfig).id) : undefined}
              onFloat={() => floatPanel(container.children[0] as DockPanelConfig, container.id)}
            />
            <div className="flex-1 overflow-auto">
              <PanelContent type={(container.children[0] as DockPanelConfig).component} />
            </div>
            {renderDropZones(container.id)}
          </div>
        ) : (
          <div className={cn('h-full', container.children.length > 1 ? 'flex flex-col gap-2' : '')}>
            {container.children.map((child, i) =>
              'children' in child
                ? renderContainer(child as DockContainerType, depth + 1)
                : (
                  <div key={(child as DockPanelConfig).id} className="flex-1">
                    <div className="h-full flex flex-col bg-background border border-border rounded-lg overflow-hidden">
                      <PanelHeader
                        title={(child as DockPanelConfig).title}
                        onDragStart={(e) => handleDragStart(e, child as DockPanelConfig, container.id)}
                        onClose={(child as DockPanelConfig).closable !== false ? () => removePanel((child as DockPanelConfig).id) : undefined}
                        onFloat={() => floatPanel(child as DockPanelConfig, container.id)}
                      />
                      <div className="flex-1 overflow-auto">
                        <PanelContent type={(child as DockPanelConfig).component} />
                      </div>
                      {renderDropZones(container.id)}
                    </div>
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
          <span className="font-semibold">Professional Docking System</span>
        </div>
        <div className="h-6 w-px bg-border" />
        <button
          onClick={() => addPanel({
            id: `panel-${Date.now()}`,
            title: `New Panel ${Date.now().toString().slice(-4)}`,
            component: 'Account',
            minWidth: 200,
            minHeight: 150
          })}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90"
        >
          <Icon name="plus" size="sm" className="w-4 h-4" />
          Add Panel
        </button>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Panels: {layout.root.children.length + floatingPanels.length}</span>
          <span>•</span>
          <span>Floating: {floatingPanels.length}</span>
          <span>•</span>
          <span>{dragState.panel ? 'Dragging...' : 'Ready'}</span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 p-2 overflow-hidden">
        {renderContainer(layout.root)}
      </div>

      {/* Floating panels */}
      {floatingPanels.map(fp => (
        <div
          key={fp.id}
          className="fixed z-50"
          style={{ left: fp.x, top: fp.y, width: fp.width, height: fp.height }}
        >
          <div className="h-full flex flex-col bg-background border border-border rounded-lg shadow-xl overflow-hidden">
            <PanelHeader
              title={fp.panel.title}
              onDragStart={(e) => {
                // Check if clicking the header area
                const target = e.target as HTMLElement;
                if (target.closest('button')) return;
                handleDragStart(e, fp.panel, `floating-${fp.id}`);
              }}
              onClose={() => removePanel(fp.panel.id)}
            />
            <div className="flex-1 overflow-auto">
              <PanelContent type={fp.panel.component} />
            </div>
          </div>
          {/* Resize handle */}
          <div
            className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const startX = e.clientX;
              const startY = e.clientY;
              const startW = fp.width;
              const startH = fp.height;

              const handleMove = (e: MouseEvent) => {
                setFloatingPanels(prev => prev.map(p =>
                  p.id === fp.id
                    ? { ...p, width: Math.max(200, startW + e.clientX - startX), height: Math.max(150, startH + e.clientY - startY) }
                    : p
                ));
              };

              const handleUp = () => {
                window.removeEventListener('mousemove', handleMove);
                window.removeEventListener('mouseup', handleUp);
              };

              window.addEventListener('mousemove', handleMove);
              window.addEventListener('mouseup', handleUp);
            }}
          >
            <div className="absolute bottom-1 right-1 w-2 h-2 border-r-2 border-b-2 border-muted-foreground/50" />
          </div>
        </div>
      ))}

      {/* Drag ghost */}
      {dragState.panel && (
        <div
          className="fixed z-[100] pointer-events-none"
          style={{ left: dragState.currentX + 10, top: dragState.currentY + 10 }}
        >
          <div className="bg-primary text-primary-foreground px-3 py-2 rounded-lg shadow-lg flex items-center gap-2">
            <GripVertical className="w-4 h-4" />
            {dragState.panel.title}
          </div>
        </div>
      )}

      {/* Instructions */}
      {dragState.panel && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-background border border-border px-4 py-2 rounded-full shadow-lg z-[100]">
          <span className="text-xs text-muted-foreground">
            Drop on a zone to dock • Drop in empty space to float • ESC to cancel
          </span>
        </div>
      )}
    </div>
  );
};

export default WorkingDockExample;
