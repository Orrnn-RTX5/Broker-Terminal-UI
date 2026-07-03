/**
 * DockContainer Component
 * MT5-style docking with compass rose indicator and blue preview
 */

import { Icon } from '../ui/Icon';
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { DockContainer as DockContainerType, DockPanelConfig } from '../../services/dockManager';
import { DockPanel } from './DockPanel';
import { DockResizeHandle } from './DockResizeHandle';
import { X } from 'lucide-react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface DockContainerProps {
  container?: DockContainerType;
  isRoot?: boolean;
  className?: string;
  style?: React.CSSProperties;
  renderPanel?: (panel: DockPanelConfig, isActive: boolean) => React.ReactNode;
}

// ─── Shared Dock State (synchronous, no React state batching issues) ──
// Using a plain object that is mutated synchronously avoids the race condition
// where React setState batching causes the global mouseup to read stale values.
const dockIntent = {
  targetPanelId: null as string | null,
  direction: null as string | null,
};

const CHART_FOCUS_COMPONENTS = new Set(['Chart', 'EmptyChartArea']);

const isDockContainerNode = (
  node: DockContainerType | DockPanelConfig
): node is DockContainerType => 'children' in node;

const getDockComponentName = (component: string): string => component.trim().toLowerCase();

const isChartFocusPanel = (panel: DockPanelConfig): boolean => (
  CHART_FOCUS_COMPONENTS.has(panel.component)
);

const containerHasChartFocusPanel = (container: DockContainerType): boolean => (
  container.children.some((child) => (
    isDockContainerNode(child)
      ? containerHasChartFocusPanel(child)
      : isChartFocusPanel(child)
  ))
);

const getFocusChartTabId = (
  children: DockContainerType['children'],
  activeTabId: string | undefined
): string | null => {
  let fallbackPanelId: string | null = null;

  for (const child of children) {
    if (isDockContainerNode(child) || !isChartFocusPanel(child)) continue;
    if (fallbackPanelId === null) fallbackPanelId = child.id;
    if (child.id === activeTabId) return child.id;
  }

  return fallbackPanelId;
};

const getAdvancedFocusChartEnabled = (): boolean => (
  typeof document !== 'undefined' &&
  document.documentElement.classList.contains('rtx-advanced-focus-chart')
);

const useAdvancedFocusChartEnabled = (): boolean => {
  const [isEnabled, setIsEnabled] = useState(getAdvancedFocusChartEnabled);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;
    const syncFocusState = () => setIsEnabled(root.classList.contains('rtx-advanced-focus-chart'));
    const observer = new MutationObserver(syncFocusState);

    syncFocusState();
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  }, []);

  return isEnabled;
};

const CompassRose: React.FC<{
  targetPanelId: string;
  hoveredDir: string | null;
}> = ({ targetPanelId, hoveredDir }) => {
  const centerDirs = [
    { key: 'top', icon: '▲', pos: 'top-0 left-1/2 -translate-x-1/2' },
    { key: 'bottom', icon: '▼', pos: 'bottom-0 left-1/2 -translate-x-1/2' },
    { key: 'left', icon: '◄', pos: 'left-0 top-1/2 -translate-y-1/2' },
    { key: 'right', icon: '►', pos: 'right-0 top-1/2 -translate-y-1/2' },
    { key: 'center', icon: '■', pos: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2' },
  ];

  const renderBtn = ({ key, icon, pos }: any) => (
    <div
      key={key}
      data-dir={key}
      className={cn(
        'compass-dir-btn absolute flex items-center justify-center',
        'border border-zinc-400 rounded-[3px] text-[13px] leading-none',
        'transition-all duration-75 pointer-events-auto select-none w-[30px] h-[30px]',
        hoveredDir === key
          ? 'bg-zinc-800 text-white border-blue-400 shadow-lg scale-110 z-10'
          : 'bg-zinc-100 text-zinc-600 shadow-md',
        pos
      )}
    >
      {icon}
    </div>
  );

  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    let animationFrameId: number;
    const el = document.querySelector(`[data-dock-panel="${targetPanelId}"]`);

    if (!el) return;

    const updateRect = () => {
      setRect(el.getBoundingClientRect());
      animationFrameId = requestAnimationFrame(updateRect);
    };

    updateRect();

    return () => cancelAnimationFrame(animationFrameId);
  }, [targetPanelId]);

  if (!rect) return null;

  return createPortal(
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }}
    >
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[100px] h-[100px] pointer-events-none">
        {centerDirs.map(d => renderBtn(d))}
      </div>
    </div>,
    document.body
  );
};

// ─── Blue Preview Overlay ───────────────────────────────────────────
const DockPreview: React.FC<{ direction: string | null; isGlobal?: boolean }> = ({ direction, isGlobal }) => {
  if (!direction) return null;

  const classes: Record<string, string> = {
    top: 'top-0 left-0 right-0 h-1/2',
    bottom: 'bottom-0 left-0 right-0 h-1/2',
    left: 'left-0 top-0 bottom-0 w-1/2',
    right: 'right-0 top-0 bottom-0 w-1/2',
    center: 'inset-0',
    'edge-top': 'top-0 left-0 right-0 h-1/3',
    'edge-bottom': 'bottom-0 left-0 right-0 h-1/3',
    'edge-left': 'left-0 top-0 bottom-0 w-1/3',
    'edge-right': 'right-0 top-0 bottom-0 w-1/3',
  };

  return (
    <div
      className={cn(
        isGlobal ? 'fixed' : 'absolute',
        'pointer-events-none z-[9999] transition-all duration-100',
        'bg-zinc-500/25 border-2 border-blue-400/50',
        classes[direction] || ''
      )}
    />
  );
};

// ─── Main DockContainer ─────────────────────────────────────────────

export const DockContainer: React.FC<DockContainerProps> = ({
  container,
  isRoot = false,
  className,
  style,
  renderPanel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const focusChartEnabled = useAdvancedFocusChartEnabled();


  const {
    layout,
    dragState,
    dragInfo,
    dropTargetId,
    compassDir,
    setDropIntent,
    startDrag,
    endDrag,
    cancelDrag,
    setActiveTab,
    removePanel,
    floatPanel,
    dockPanel,
    updateContainerSize,
    updateFloatingPosition,
  } = useDockLayoutStore();

  const currentContainer = container || layout.root;

  // Handle panel drag start
  const handlePanelDragStart = useCallback((panel: DockPanelConfig, isFloating: boolean) => (e: React.MouseEvent | React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    startDrag(panel.id, panel.title, clientX, clientY, isFloating);
  }, [startDrag]);

  // Global drag handling — only attach on root container
  useEffect(() => {
    if (!isRoot) return;
    if (dragState !== 'dragging') {
      dockIntent.targetPanelId = null;
      dockIntent.direction = null;
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      const { dragInfo, updateDrag, setDropIntent } = useDockLayoutStore.getState();
      if (!dragInfo) return;

      updateDrag(e.clientX, e.clientY);

      // 1. Find which panel we're hovering over
      const panels = document.querySelectorAll('[data-dock-panel]');
      let foundTarget: string | null = null;
      let foundDir: string | null = null;

      // 2. First check if we are hovering over a compass button
      const compassBtns = document.querySelectorAll('.compass-dir-btn');
      compassBtns.forEach((btn) => {
        const rect = btn.getBoundingClientRect();
        if (
          e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom
        ) {
          foundDir = btn.getAttribute('data-dir');
        }
      });

      // 3. Find the panel
      panels.forEach((panelEl) => {
        const rect = panelEl.getBoundingClientRect();
        if (
          e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom
        ) {
          const panelId = panelEl.getAttribute('data-dock-panel');
          if (panelId && panelId !== dragInfo.panelId) {
            foundTarget = panelId;
          }
        }
      });

      if (foundDir?.startsWith('edge-')) {
        setDropIntent('root', foundDir);
        dockIntent.targetPanelId = 'root';
        dockIntent.direction = foundDir;
      } else if (foundTarget) {
        setDropIntent(foundTarget, foundDir);
        dockIntent.targetPanelId = foundTarget;
        dockIntent.direction = foundDir;
      } else if (foundDir && dockIntent.targetPanelId) {
        // Mouse is hovering a compass button (portal element) — no panel under cursor,
        // but we still know which panel the compass belongs to. Keep the target alive.
        setDropIntent(dockIntent.targetPanelId, foundDir);
        dockIntent.direction = foundDir;
      } else {
        setDropIntent(null, null);
        dockIntent.targetPanelId = null;
        dockIntent.direction = null;
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      const { dragInfo, endDrag } = useDockLayoutStore.getState();
      if (!dragInfo) return;

      const dx = dragInfo.currentX - dragInfo.startX;
      const dy = dragInfo.currentY - dragInfo.startY;
      const dragDistance = Math.sqrt(dx * dx + dy * dy);

      // Check if it was just a click rather than a drag
      if (dragDistance < 5) {
        cancelDrag();
      } else if (dockIntent.targetPanelId && dockIntent.direction) {
        // Delegate docking routing (panel vs workspace edge) to the store
        endDrag(dockIntent.targetPanelId, dockIntent.direction as any);
      } else if (dragInfo.isFloating) {
        // Keep floating, update position
        let newX = e.clientX - 200;
        let newY = e.clientY - 50;
        newX = Math.max(20, Math.min(newX, window.innerWidth - 200));
        newY = Math.max(20, Math.min(newY, window.innerHeight - 200));
        updateFloatingPosition(dragInfo.panelId, { x: newX, y: newY });
        endDrag();
      } else {
        // Float the panel
        let newX = e.clientX - 200;
        let newY = e.clientY - 50;
        newX = Math.max(20, Math.min(newX, window.innerWidth - 200));
        newY = Math.max(20, Math.min(newY, window.innerHeight - 200));
        floatPanel(dragInfo.panelId, { x: newX, y: newY });
        endDrag();
      }

      // Reset local state
      dockIntent.targetPanelId = null;
      dockIntent.direction = null;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelDrag();
        dockIntent.targetPanelId = null;
        dockIntent.direction = null;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isRoot, dragState, endDrag, cancelDrag, floatPanel, dockPanel, updateFloatingPosition]);

  // Handle resize
  const handleResize = useCallback((childIndex: number, newRatio: number) => {
    if (!currentContainer.children[childIndex]) return;
    const child = currentContainer.children[childIndex] as any;
    if (child.id) {
      updateContainerSize(child.id, newRatio);
    }
  }, [currentContainer, updateContainerSize]);

  const isDragging = dragState === 'dragging';

  // ─── Render split container ─────────────────────────────────────
  if (currentContainer.type === 'split') {
    const isHorizontal = currentContainer.direction === 'horizontal';
    const hasChartFocusPanel = containerHasChartFocusPanel(currentContainer);

    return (
      <div
        ref={containerRef}
        data-dock-container={currentContainer.id || undefined}
        data-dock-container-kind="split"
        data-dock-container-direction={currentContainer.direction}
        data-dock-container-has-focus-chart={hasChartFocusPanel ? 'true' : 'false'}
        className={cn(
          'flex h-full overflow-hidden',
          isHorizontal ? 'flex-row' : 'flex-col',
          className
        )}
        style={style}
      >
        {currentContainer.children.map((child, index) => {
          const isContainer = isDockContainerNode(child);
          const childContainer = isContainer ? child : null;
          const childPanel = isContainer ? null : child;
          const childItem = child;
          const ratio = childItem.ratio || (1 / currentContainer.children.length);
          const childHasChartFocusPanel = childContainer !== null
            ? containerHasChartFocusPanel(childContainer)
            : childPanel !== null && isChartFocusPanel(childPanel);

          return (
            <React.Fragment key={childItem.id || index}>
              <div
                data-dock-child={childItem.id || undefined}
                data-dock-child-kind={isContainer ? 'container' : 'panel'}
                data-dock-child-component={childPanel !== null ? getDockComponentName(childPanel.component) : undefined}
                data-dock-child-has-focus-chart={childHasChartFocusPanel ? 'true' : 'false'}
                className="flex flex-col overflow-hidden min-h-0 min-w-0"
                style={{
                  flex: ratio,
                  minWidth: isHorizontal ? 40 : undefined,
                  minHeight: !isHorizontal ? 24 : undefined,
                }}
              >
                {childContainer !== null ? (
                  <DockContainer
                    container={childContainer}
                    renderPanel={renderPanel}
                  />
                ) : childPanel !== null ? (
                  <PanelSlot
                    panel={childPanel}
                    isDragging={isDragging}
                    dropTargetId={dropTargetId}
                    compassDir={compassDir}
                    onDragStart={handlePanelDragStart(childPanel, false)}
                    onClose={() => removePanel(childPanel.id)}
                    onFloat={() => floatPanel(childPanel.id)}
                    renderPanel={renderPanel}
                  />
                ) : (
                  null
                )}
              </div>

              {index < currentContainer.children.length - 1 && (
                <DockResizeHandle
                  direction={isHorizontal ? 'vertical' : 'horizontal'}
                  onResize={(delta) => {
                    // For a horizontal split (flex-row), we are dragging a vertical handle left/right.
                    // The total size we care about is the container's width.
                    // For a vertical split (flex-col), we drag a horizontal handle up/down.
                    const totalSize = isHorizontal
                      ? containerRef.current?.offsetWidth || window.innerWidth
                      : containerRef.current?.offsetHeight || window.innerHeight;

                    const ratioDelta = delta / totalSize;
                    const currentRatio = childItem.ratio || (1 / currentContainer.children.length);
                    const nextChild = currentContainer.children[index + 1];
                    const nextRatio = nextChild?.ratio || (1 / currentContainer.children.length);

                    const newCur = Math.max(0.05, Math.min(0.95, currentRatio + ratioDelta));
                    const newNext = Math.max(0.05, Math.min(0.95, nextRatio - ratioDelta));
                    const combined = currentRatio + nextRatio;

                    handleResize(index, combined * (newCur / (newCur + newNext)));
                    handleResize(index + 1, combined * (newNext / (newCur + newNext)));
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  // ─── Render tabs container ──────────────────────────────────────
  if (currentContainer.type === 'tabs') {
    const activeTabId = currentContainer.activeTab || (currentContainer.children[0] as DockPanelConfig)?.id;
    const hasChartFocusPanel = containerHasChartFocusPanel(currentContainer);
    const focusChartTabId = getFocusChartTabId(currentContainer.children, activeTabId);

    return (
      <div
        ref={containerRef}
        data-dock-container={currentContainer.id || undefined}
        data-dock-container-kind="tabs"
        data-dock-container-has-focus-chart={hasChartFocusPanel ? 'true' : 'false'}
        className={cn('flex flex-col h-full bg-[#131316] border border-zinc-700/30 overflow-hidden', className)}
        style={style}
      >
        {/* Tab Bar */}
        <div
          data-dock-tab-bar="true"
          className="flex-none flex items-center gap-0 bg-[#2a2a2a] border-b border-zinc-700/40 overflow-x-auto h-[24px]"
        >
          {currentContainer.children.map((child) => {
            const panel = child as DockPanelConfig;
            const isActive = panel.id === activeTabId;

            return (
              <div
                key={panel.id}
                className={cn(
                  'group flex items-center gap-1 px-2 h-full text-[11px] cursor-pointer select-none border-r border-zinc-700/30',
                  isActive
                    ? 'bg-[#131316] text-zinc-200'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/30'
                )}
                onClick={() => {
                  setActiveTab(currentContainer.id, panel.id);
                  if (panel.component === 'Chart' && panel.props?.symbol) {
                    window.dispatchEvent(new CustomEvent('chartSymbolChanged', {
                      detail: { symbol: panel.props.symbol }
                    }));
                  }
                }}
                onMouseDown={(e) => {
                  if (e.button !== 0 || panel.floatable === false) return;
                  const startX = e.clientX;
                  const startY = e.clientY;
                  const onMove = (me: MouseEvent) => {
                    if (Math.abs(me.clientX - startX) > 5 || Math.abs(me.clientY - startY) > 5) {
                      cleanup();
                      handlePanelDragStart(panel, false)(e);
                    }
                  };
                  const onUp = () => cleanup();
                  const cleanup = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                  };
                  window.addEventListener('mousemove', onMove);
                  window.addEventListener('mouseup', onUp);
                }}
              >
                <span className="truncate max-w-[120px]">{panel.title}</span>
                {panel.closable !== false && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removePanel(panel.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded-sm hover:bg-red-500/60 text-zinc-400 hover:text-white"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Tab Content */}
        <div data-dock-tab-content-layer="true" className="flex-1 overflow-hidden relative">
          {currentContainer.children.map((child) => {
            const panel = child as DockPanelConfig;
            const isActive = panel.id === activeTabId;
            const isFocusChartPanel = isChartFocusPanel(panel);
            const isFocusChartTarget = isFocusChartPanel && panel.id === focusChartTabId;
            const isContentVisible = focusChartEnabled && hasChartFocusPanel
              ? isFocusChartTarget
              : isActive;

            return (
              <div
                key={panel.id}
                data-dock-tab-content={panel.id}
                data-dock-tab-content-component={getDockComponentName(panel.component)}
                data-dock-tab-content-is-focus-chart={isFocusChartPanel ? 'true' : 'false'}
                data-dock-tab-content-focus-target={isFocusChartTarget ? 'true' : 'false'}
                data-dock-tab-content-active={isActive ? 'true' : 'false'}
                className="absolute inset-0"
                style={{
                  opacity: isContentVisible ? 1 : 0,
                  pointerEvents: isContentVisible ? 'auto' : 'none',
                  zIndex: isContentVisible ? 1 : 0,
                }}
              >
                <PanelSlot
                  panel={panel}
                  isActive={isContentVisible}
                  showHeader={panel.component !== 'EmptyChartArea' && panel.component !== 'Chart'}
                  isDragging={false}
                  dropTargetId={dropTargetId}
                  compassDir={compassDir}
                  onDragStart={handlePanelDragStart(panel, false)}
                  onClose={() => removePanel(panel.id)}
                  onFloat={() => floatPanel(panel.id)}
                  renderPanel={renderPanel}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ─── Render root or single panel ───────────────────────────────
  return (
    <div
      ref={containerRef}
      data-dock-container={currentContainer.id || undefined}
      data-dock-container-kind={currentContainer.type}
      data-dock-container-has-focus-chart={containerHasChartFocusPanel(currentContainer) ? 'true' : 'false'}
      className={cn('flex flex-col h-full', className)}
      style={style}
    >
      {currentContainer.children.length === 0 ? (
        <div className="flex items-center justify-center h-full text-zinc-500">
          <p className="text-sm">Empty — drag panels here</p>
        </div>
      ) : currentContainer.children.length === 1 && !isDockContainerNode(currentContainer.children[0]) ? (
        <PanelSlot
          panel={currentContainer.children[0] as DockPanelConfig}
          isDragging={isDragging}
          dropTargetId={dropTargetId}
          compassDir={compassDir}
          onDragStart={handlePanelDragStart(currentContainer.children[0] as DockPanelConfig, false)}
          onClose={() => removePanel((currentContainer.children[0] as DockPanelConfig).id)}
          onFloat={() => floatPanel((currentContainer.children[0] as DockPanelConfig).id)}
          renderPanel={renderPanel}
        />
      ) : (
        currentContainer.children.map((child, index) => {
          const isContainer = isDockContainerNode(child);
          if (isContainer) {
            return (
              <DockContainer
                key={(child as DockContainerType).id || index}
                container={child as DockContainerType}
                renderPanel={renderPanel}
                className="flex-1"
              />
            );
          }
          const p = child as DockPanelConfig;
          return (
            <PanelSlot
              key={p.id}
              panel={p}
              showHeader={p.component !== 'EmptyChartArea' && p.component !== 'Chart'}
              isDragging={isDragging}
              dropTargetId={dropTargetId}
              compassDir={compassDir}
              onDragStart={handlePanelDragStart(p, false)}
              onClose={() => removePanel(p.id)}
              onFloat={() => floatPanel(p.id)}
              renderPanel={renderPanel}
              className="flex-1"
            />
          );
        })
      )}
    </div>
  );
};

// ─── Panel Slot ──────────────────────────────────────────────────────
interface PanelSlotProps {
  panel: DockPanelConfig;
  isActive?: boolean;
  showHeader?: boolean;
  isDragging: boolean;
  dropTargetId: string | null;
  compassDir: string | null;
  onDragStart: (e: React.MouseEvent | React.TouchEvent) => void;
  onClose: () => void;
  onFloat: () => void;
  renderPanel?: (panel: DockPanelConfig, isActive: boolean) => React.ReactNode;
  className?: string;
}

const PanelSlot: React.FC<PanelSlotProps> = ({
  panel,
  isActive = true,
  showHeader = true,
  isDragging,
  dropTargetId,
  compassDir,
  onDragStart,
  onClose,
  onFloat,
  renderPanel,
  className,
}) => {
  const isDropTarget = isDragging && dropTargetId === panel.id;
  const showCompass = isDropTarget;
  const showPreview = isDropTarget && compassDir !== null;
  const isFocusChartPanel = isChartFocusPanel(panel);

  return (
    <div
      data-dock-panel={panel.id}
      data-dock-panel-component={getDockComponentName(panel.component)}
      data-dock-focus-chart-panel={isFocusChartPanel ? 'true' : 'false'}
      className={cn('h-full relative', className)}
    >
      <DockPanel
        panel={panel}
        isActive={isActive}
        showHeader={showHeader}
        isDropTarget={isDropTarget}
        onClose={onClose}
        onFloat={onFloat}
        onDragStart={onDragStart}
      >
        {renderPanel ? renderPanel(panel, isActive) : null}
      </DockPanel>

      {/* Blue preview highlight */}
      {showPreview && !compassDir?.startsWith('edge-') && <DockPreview direction={compassDir} />}

      {/* Compass rose centered on this panel */}
      {showCompass && (
        <div className="absolute inset-0 z-[180] flex items-center justify-center pointer-events-none">
          <CompassRose
            targetPanelId={panel.id}
            hoveredDir={compassDir}
          />
        </div>
      )}
    </div>
  );
};

// ─── Floating Panels Layer ───────────────────────────────────────────
export const FloatingPanelsLayer: React.FC<{
  renderPanel?: (panel: DockPanelConfig, isActive: boolean) => React.ReactNode;
}> = ({ renderPanel }) => {
  const {
    layout,
    removePanel,
    dockPanel,
    updateFloatingPosition,
    updateFloatingSize,
    startDrag,
  } = useDockLayoutStore();

  // 8-directional resize
  const startResize = (e: React.MouseEvent, floating: any, direction: string) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = floating.size?.width || 400;
    const startH = floating.size?.height || 300;
    const startPX = floating.position?.x || 100;
    const startPY = floating.position?.y || 100;

    let curW = startW, curH = startH, curX = startPX, curY = startPY;

    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;

      if (direction.includes('w')) {
        const pw = startW - dx;
        if (pw >= 200) { curW = pw; curX = startPX + dx; }
        else { curW = 200; curX = startPX + (startW - 200); }
      }
      if (direction.includes('e')) curW = Math.max(200, startW + dx);
      if (direction.includes('n')) {
        const ph = startH - dy;
        if (ph >= 150) { curH = ph; curY = startPY + dy; }
        else { curH = 150; curY = startPY + (startH - 150); }
      }
      if (direction.includes('s')) curH = Math.max(150, startH + dy);

      updateFloatingSize(floating.id, { width: curW, height: curH });
      updateFloatingPosition(floating.id, { x: curX, y: curY });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Floating drag
  const handleFloatingDrag = (floating: any, panel: DockPanelConfig) => (e: React.MouseEvent) => {
    const startMX = e.clientX, startMY = e.clientY;
    const startPX = floating.position?.x || 100;
    const startPY = floating.position?.y || 100;

    startDrag(panel.id, panel.title, startMX, startMY, true);

    const onMove = (me: MouseEvent) => {
      updateFloatingPosition(floating.id, {
        x: startPX + (me.clientX - startMX),
        y: startPY + (me.clientY - startMY),
      });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (layout.floatingPanels.length === 0) return null;

  return (
    <>
      {layout.floatingPanels.map((floating) => {
        const panel = floating.children[0] as DockPanelConfig;
        if (!panel) return null;
        const isFocusChartPanel = isChartFocusPanel(panel);

        return (
          <div
            key={floating.id}
            data-dock-panel={panel.id}
            data-dock-floating-panel="true"
            data-dock-panel-component={getDockComponentName(panel.component)}
            data-dock-focus-chart-panel={isFocusChartPanel ? 'true' : 'false'}
            className="fixed z-50"
            style={{
              left: floating.position?.x || 100,
              top: floating.position?.y || 100,
              width: floating.size?.width || 400,
              height: floating.size?.height || 300,
            }}
          >
            <DockPanel
              panel={panel}
              isActive={true}
              isFloating={true}
              onClose={() => removePanel(panel.id)}
              onFloat={() => dockPanel(panel.id, 'root', 'center')}
              onDragStart={handleFloatingDrag(floating, panel)}
            >
              {renderPanel?.(panel, true)}
            </DockPanel>

            {/* 8 resize handles */}
            <div data-dock-floating-resize-handle="true" className="absolute top-0 left-6 right-6 h-2 cursor-ns-resize z-20" onMouseDown={(e) => startResize(e, floating, 'n')} />
            <div data-dock-floating-resize-handle="true" className="absolute bottom-0 left-6 right-6 h-2 cursor-ns-resize z-20" onMouseDown={(e) => startResize(e, floating, 's')} />
            <div data-dock-floating-resize-handle="true" className="absolute top-6 bottom-6 left-0 w-2 cursor-ew-resize z-20" onMouseDown={(e) => startResize(e, floating, 'w')} />
            <div data-dock-floating-resize-handle="true" className="absolute top-6 bottom-6 right-0 w-2 cursor-ew-resize z-20" onMouseDown={(e) => startResize(e, floating, 'e')} />
            <div data-dock-floating-resize-handle="true" className="absolute top-0 left-0 w-5 h-5 cursor-nwse-resize z-30" onMouseDown={(e) => startResize(e, floating, 'nw')} />
            <div data-dock-floating-resize-handle="true" className="absolute top-0 right-0 w-5 h-5 cursor-nesw-resize z-30" onMouseDown={(e) => startResize(e, floating, 'ne')} />
            <div data-dock-floating-resize-handle="true" className="absolute bottom-0 left-0 w-5 h-5 cursor-nesw-resize z-30" onMouseDown={(e) => startResize(e, floating, 'sw')} />
            <div data-dock-floating-resize-handle="true" className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize z-30" onMouseDown={(e) => startResize(e, floating, 'se')} />
          </div>
        );
      })}
    </>
  );
};

export default DockContainer;

export const GlobalEdgeIndicators: React.FC = () => {
  const { dragState, compassDir } = useDockLayoutStore();
  if (dragState !== 'dragging') return null;

  const edgeDirs = [
    { key: 'edge-top', icon: '▲', pos: 'top-2 left-1/2 -translate-x-1/2' },
    { key: 'edge-bottom', icon: '▼', pos: 'bottom-2 left-1/2 -translate-x-1/2' },
    { key: 'edge-left', icon: '◄', pos: 'left-2 top-1/2 -translate-y-1/2' },
    { key: 'edge-right', icon: '►', pos: 'right-2 top-1/2 -translate-y-1/2' },
  ];

  return createPortal(
    <>
      {/* The 4 static outer edge arrows */}
      <div className="fixed inset-0 z-[9999] pointer-events-none">
        {edgeDirs.map(({ key, icon, pos }) => (
          <div
            key={key}
            data-dir={key}
            className={cn(
              'compass-dir-btn absolute flex items-center justify-center',
              'border border-zinc-400 rounded-[3px] text-[13px] leading-none',
              'transition-all duration-75 pointer-events-auto select-none',
              'w-[28px] h-[28px]',
              compassDir === key
                ? 'bg-zinc-800 text-white border-blue-400 shadow-lg scale-110 z-10'
                : 'bg-zinc-300 text-zinc-700 shadow-sm opacity-80',
              pos
            )}
          >
            {icon}
          </div>
        ))}
      </div>

      {/* The full-width/height blue preview overlay */}
      {compassDir?.startsWith('edge-') && (
        <DockPreview direction={compassDir} isGlobal={true} />
      )}
    </>,
    document.body
  );
};
