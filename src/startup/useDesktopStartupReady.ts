import { useEffect, useRef } from 'react';

/** Reveal the desktop window only after its first usable surface can paint. */
export function useDesktopStartupReady(ready = true) {
  const reported = useRef(false);

  useEffect(() => {
    const reportReady = window.electron?.startupReady;
    if (!ready || reported.current || !reportReady) return;

    let frame = window.requestAnimationFrame(() => {
      // A second frame leaves one paint opportunity for the committed screen.
      frame = window.requestAnimationFrame(() => {
        reported.current = true;
        reportReady();
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [ready]);
}
