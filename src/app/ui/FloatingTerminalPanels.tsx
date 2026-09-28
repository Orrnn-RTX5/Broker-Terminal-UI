import { lazy, Suspense, type CSSProperties } from 'react';
import type { DepthOrderRequest } from '../../components/DepthOfMarket';
import type { FloatingTerminalPanelsController, ResizeMode } from './useFloatingTerminalPanels';

const LazyDepthOfMarket = lazy(() => import('../../components/DepthOfMarket').then((module) => ({ default: module.DepthOfMarket })));
const LazyDataWindow = lazy(() => import('../../components/DataWindow'));

interface FloatingTerminalPanelsProps {
  panels: FloatingTerminalPanelsController;
  onCloseBulk: (type: 'ALL' | 'WINNERS' | 'LOSERS', symbol?: string) => void | Promise<void>;
  onPlaceOrder: (request: DepthOrderRequest) => void | Promise<void>;
}

const resizeEdges: Array<{
  mode: ResizeMode;
  style: CSSProperties;
}> = [
  { mode: 'n', style: { top: 0, left: 6, right: 6, height: 5, cursor: 'ns-resize' } },
  { mode: 's', style: { bottom: 0, left: 6, right: 6, height: 5, cursor: 'ns-resize' } },
  { mode: 'w', style: { top: 6, left: 0, bottom: 6, width: 5, cursor: 'ew-resize' } },
  { mode: 'e', style: { top: 6, right: 0, bottom: 6, width: 5, cursor: 'ew-resize' } },
  { mode: 'nw', style: { top: 0, left: 0, width: 10, height: 10, cursor: 'nwse-resize', zIndex: 21 } },
  { mode: 'ne', style: { top: 0, right: 0, width: 10, height: 10, cursor: 'nesw-resize', zIndex: 21 } },
  { mode: 'sw', style: { bottom: 0, left: 0, width: 10, height: 10, cursor: 'nesw-resize', zIndex: 21 } },
];

export const FloatingTerminalPanels = ({ panels, onCloseBulk, onPlaceOrder }: FloatingTerminalPanelsProps) => (
  <>
    {panels.showDOM && (
      <div
        className="rtx-dom-dialog absolute z-30 flex flex-col overflow-hidden"
        style={{
          left: panels.domPos.x,
          top: panels.domPos.y,
          width: panels.domSize.w,
          height: panels.domSize.h,
          minWidth: 360,
          minHeight: 200,
          borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)',
          background: '#131316',
        }}
      >
        <Suspense fallback={<div className="h-full w-full bg-[#131316]" />}>
          <LazyDepthOfMarket
            symbol={panels.domSymbol}
            onClose={() => panels.setShowDOM(false)}
            onCloseBulk={onCloseBulk}
            onDragHandleMouseDown={panels.handleDomMouseDown}
            onPlaceOrder={onPlaceOrder}
          />
        </Suspense>
        <div
          onMouseDown={(event) => panels.handleDomResizeMouseDown(event, 'e')}
          style={{ position: 'absolute', right: 0, top: 8, bottom: 8, width: 5, cursor: 'ew-resize', background: 'transparent', zIndex: 10 }}
          className="hover:bg-blue-500/30 rounded transition-colors"
        />
        <div
          onMouseDown={(event) => panels.handleDomResizeMouseDown(event, 's')}
          style={{ position: 'absolute', bottom: 0, left: 8, right: 8, height: 5, cursor: 'ns-resize', background: 'transparent', zIndex: 10 }}
          className="hover:bg-blue-500/30 rounded transition-colors"
        />
        <div
          onMouseDown={(event) => panels.handleDomResizeMouseDown(event, 'se')}
          style={{ position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, cursor: 'nwse-resize', zIndex: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '0 0 10px 0' }}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
            <path d="M7 1L1 7M7 4L4 7M7 7L7 7" stroke="#404048" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    )}

    {panels.showDataWindow && (
      <div
        className="absolute z-30"
        style={{
          left: panels.dataWindowPos.x,
          top: panels.dataWindowPos.y,
          width: panels.dataWindowSize.w,
          height: panels.dataWindowSize.h,
          minWidth: 200,
          minHeight: 200,
          overflow: 'hidden',
        }}
      >
        <Suspense fallback={<div className="h-full w-full bg-[#131316]" />}>
          <LazyDataWindow
            onClose={() => panels.setShowDataWindow(false)}
            onDragHandleMouseDown={panels.handleDataWindowMouseDown}
          />
        </Suspense>
        {resizeEdges.map(({ mode, style }) => (
          <div
            key={mode}
            onMouseDown={(event) => panels.handleDataWindowResizeMouseDown(event, mode)}
            style={{ position: 'absolute', zIndex: 20, ...style }}
          />
        ))}
        <div
          onMouseDown={(event) => panels.handleDataWindowResizeMouseDown(event, 'se')}
          style={{ position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, cursor: 'nwse-resize', zIndex: 21, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
            <path d="M7 1L1 7M7 4L4 7M7 7L7 7" stroke="#505060" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    )}
  </>
);
