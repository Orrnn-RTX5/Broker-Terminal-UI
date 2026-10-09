import { useLayoutEffect, useRef, type HTMLAttributes } from 'react';
import { getTerminalResolutionSize, useTerminalResolutionStore } from '../../store/useTerminalResolutionStore';

/** Fit the requested CSS-pixel size inside the window without scaling chart coordinates. */
export function TerminalViewport({ style, ...props }: HTMLAttributes<HTMLDivElement>) {
  const resolution = useTerminalResolutionStore(state => state.resolution);
  const size = getTerminalResolutionSize(resolution);
  const viewportRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollLeft = 0;
      viewportRef.current.scrollTop = 0;
    }
    window.dispatchEvent(new Event('resize'));
  }, [resolution]);

  return (
    <div ref={viewportRef} className="rtx-terminal-viewport" data-terminal-resolution={resolution}
      style={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden', background: 'var(--bg-primary)' }}>
      <div {...props} data-terminal-fixed-resolution={size ? 'true' : undefined}
        // Oversized presets must reflow the dock into the window, keeping the Toolbox accessible.
        style={{ ...style, width: size?.width ?? '100%', height: size?.height ?? '100%', maxWidth: '100%', maxHeight: '100%', minWidth: 0, minHeight: 0 }} />
    </div>
  );
}
