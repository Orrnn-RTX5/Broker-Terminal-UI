import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useUiTranslation } from '../hooks/useUiTranslation';
import { TerminalLoadFallback } from './TerminalLoadFallback';
import { useDesktopStartupReady } from './useDesktopStartupReady';

type StartupPart = 'chart' | 'marketWatch';
const StartupReadyContext = createContext<((part: StartupPart) => void) | null>(null);

/** Report the first usable result (including an explicit empty/error state). */
export function useTerminalStartupReady(part: StartupPart, ready: boolean) {
  const reportReady = useContext(StartupReadyContext);
  useEffect(() => {
    if (ready) reportReady?.(part);
  }, [part, ready, reportReady]);
}

/** Keep the real workspace mounted and measured while its first data arrives. */
export function TerminalStartupBoundary({
  dataReady,
  waitForChart,
  children,
}: {
  dataReady: boolean;
  waitForChart: boolean;
  children: ReactNode;
}) {
  const tr = useUiTranslation();
  const [parts, setParts] = useState({ chart: false, marketWatch: false });
  const [revealed, setRevealed] = useState(false);
  const [slow, setSlow] = useState(false);
  const reportReady = useCallback((part: StartupPart) => {
    setParts(previous => previous[part] ? previous : { ...previous, [part]: true });
  }, []);
  const ready = dataReady && parts.marketWatch && (!waitForChart || parts.chart);
  const pending = !revealed && !ready;
  useDesktopStartupReady(!pending || slow);

  useEffect(() => {
    if (ready) setRevealed(true);
  }, [ready]);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setSlow(true), 15_000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  return (
    <StartupReadyContext.Provider value={reportReady}>
      <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0 }}
        data-terminal-startup-data-ready={dataReady}
        data-terminal-startup-chart-ready={!waitForChart || parts.chart}
        data-terminal-startup-market-watch-ready={parts.marketWatch}
        data-terminal-startup={pending ? 'pending' : 'ready'}>
        <div aria-hidden={pending || undefined} inert={pending || undefined}
          style={{ width: '100%', height: '100%', visibility: pending ? 'hidden' : undefined }}>
          {children}
        </div>
        {pending && (
          <div style={{ position: 'absolute', inset: 0 }}>
            <TerminalLoadFallback message={slow ? 'The connection is taking longer than usual.' : undefined}>
              {slow && (
                <div className="rtx-terminal-loading__actions">
                  <button type="button" onClick={() => window.location.reload()}>{tr('Retry')}</button>
                  <button type="button" onClick={() => setRevealed(true)}>{tr('Continue to terminal')}</button>
                </div>
              )}
            </TerminalLoadFallback>
          </div>
        )}
      </div>
    </StartupReadyContext.Provider>
  );
}
