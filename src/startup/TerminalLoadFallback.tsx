interface TerminalLoadFallbackProps {
  sessionRestorePending?: boolean;
}

/** Data-free visual shell used while authenticated code or session validation finishes. */
export function TerminalLoadFallback({ sessionRestorePending = false }: TerminalLoadFallbackProps) {
  return (
    <div
      className="rtx-instant-terminal"
      data-terminal-module-loading="true"
      data-session-restore-pending={sessionRestorePending ? 'true' : undefined}
      aria-hidden="true"
    >
      <div className="rtx-instant-titlebar">RTX 5 Web Terminal</div>
      <div className="rtx-instant-toolbar">
        <span>File</span><span>View</span><span>Insert</span><span>Charts</span><span>Tools</span><span>Window</span><span>Help</span>
      </div>
      <div className="rtx-instant-workspace">
        <div className="rtx-instant-sidebar">
          <div>MARKET WATCH</div>
          <div>NAVIGATOR</div>
        </div>
        <div className="rtx-instant-main">
          <div className="rtx-instant-chart" />
          <div className="rtx-instant-toolbox" />
        </div>
      </div>
    </div>
  );
}
