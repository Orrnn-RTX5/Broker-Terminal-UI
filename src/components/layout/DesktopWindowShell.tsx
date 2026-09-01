import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import './DesktopWindowShell.css';

interface DesktopWindowShellProps {
  children: ReactNode;
}

type ElectronWindowApi = NonNullable<Window['electron']>['window'];

const DEFAULT_DESKTOP_TITLE = 'RTX Terminal';

const readDesktopTitle = (): string => {
  const title = typeof document === 'undefined' ? '' : document.title.trim();
  return !title || title === 'RTX 5 Web Terminal' ? DEFAULT_DESKTOP_TITLE : title;
};

function ElectronDesktopWindowShell({
  children,
  electronWindow,
}: DesktopWindowShellProps & { electronWindow: ElectronWindowApi }) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [title, setTitle] = useState(readDesktopTitle);

  useLayoutEffect(() => {
    document.documentElement.classList.add('rtx-desktop-shell-active');
    return () => document.documentElement.classList.remove('rtx-desktop-shell-active');
  }, []);

  useEffect(() => {
    let active = true;

    electronWindow.isMaximized()
      .then((maximized) => {
        if (active) setIsMaximized(maximized);
      })
      .catch(() => {
        if (active) setIsMaximized(false);
      });

    const unsubscribe = electronWindow.onMaximizeChange((maximized) => {
      if (active) setIsMaximized(maximized);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [electronWindow]);

  useEffect(() => {
    const refreshTitle = () => setTitle(readDesktopTitle());
    refreshTitle();

    const observer = new MutationObserver(refreshTitle);
    const titleElement = document.querySelector('title');
    if (titleElement) {
      observer.observe(titleElement, { childList: true, characterData: true, subtree: true });
    } else {
      observer.observe(document.head, { childList: true, subtree: true });
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div className="rtx-desktop-shell" data-rtx-desktop-shell="true">
      <header className="rtx-desktop-titlebar" aria-label="Application title bar">
        <div className="rtx-desktop-titlebar__drag-region">
          <img
            className="rtx-desktop-titlebar__icon"
            src="./titlebar-icon.png"
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <span className="rtx-desktop-titlebar__title" title={title}>{title}</span>
        </div>

        <div
          className="rtx-desktop-titlebar__controls"
          data-window-controls
          role="toolbar"
          aria-label="Window controls"
        >
          <button
            type="button"
            className="rtx-desktop-titlebar__control"
            aria-label="Minimize window"
            title="Minimize"
            onClick={() => electronWindow.minimize()}
          >
            <Minus size={13} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="rtx-desktop-titlebar__control"
            aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
            title={isMaximized ? 'Restore' : 'Maximize'}
            onClick={() => electronWindow.maximize()}
          >
            {isMaximized ? (
              <Copy size={12} strokeWidth={1.45} aria-hidden="true" />
            ) : (
              <Square size={11} strokeWidth={1.45} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="rtx-desktop-titlebar__control rtx-desktop-titlebar__control--close"
            aria-label="Close window"
            title="Close"
            onClick={() => electronWindow.close()}
          >
            <X size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className="rtx-desktop-shell__content">{children}</main>
    </div>
  );
}

/**
 * Adds native-feeling chrome only when the secure Electron preload bridge is
 * available. Browser builds receive their children without an extra wrapper.
 */
export function DesktopWindowShell({ children }: DesktopWindowShellProps) {
  const electronWindow = typeof window === 'undefined' ? undefined : window.electron?.window;
  if (!electronWindow) return <>{children}</>;

  return (
    <ElectronDesktopWindowShell electronWindow={electronWindow}>
      {children}
    </ElectronDesktopWindowShell>
  );
}
