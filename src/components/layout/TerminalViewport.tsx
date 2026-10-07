import { useLayoutEffect, useRef, type HTMLAttributes } from 'react';
import { getTerminalResolutionSize, useTerminalResolutionStore } from '../../store/useTerminalResolutionStore';

/** Resize the terminal in CSS pixels without scaling chart pointer coordinates. */
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
      style={{ width: '100%', height: '100%', overflow: 'auto', background: 'var(--bg-primary)' }}>
      <div {...props} data-terminal-fixed-resolution={size ? 'true' : undefined}
        style={{ ...style, width: size?.width ?? '100%', height: size?.height ?? '100%' }} />
    </div>
  );
}
