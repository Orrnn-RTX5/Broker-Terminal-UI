import { useUiTranslation } from '../hooks/useUiTranslation';
interface TerminalLoadFallbackProps {
  sessionRestorePending?: boolean;
}

/** Data-free visual shell used while authenticated code or session validation finishes. */
export function TerminalLoadFallback({ sessionRestorePending = false }: TerminalLoadFallbackProps) {
    const tr = useUiTranslation();
  return (
    <div
      className="rtx-instant-terminal"
      data-terminal-module-loading="true"
      data-session-restore-pending={sessionRestorePending ? 'true' : undefined}
      aria-hidden="true"
    >
      <div className="rtx-instant-titlebar">{tr("RTX 5 Web Terminal")}</div>
      <div className="rtx-instant-toolbar">
        <span>{tr("File")}</span><span>{tr("View")}</span><span>{tr("Insert")}</span><span>{tr("Charts")}</span><span>{tr("Tools")}</span><span>{tr("Window")}</span><span>{tr("Help")}</span>
      </div>
      <div className="rtx-instant-workspace">
        <div className="rtx-instant-sidebar">
          <div>{tr("MARKET WATCH")}</div>
          <div>{tr("NAVIGATOR")}</div>
        </div>
        <div className="rtx-instant-main">
          <div className="rtx-instant-chart" />
          <div className="rtx-instant-toolbox" />
        </div>
      </div>
    </div>
  );
}
