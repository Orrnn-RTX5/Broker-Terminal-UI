import { useUiTranslation } from '../../hooks/useUiTranslation';
import { ConnectionStatus } from '../ConnectionStatus';
import { toPublicAssetPath } from '../welcomeHeroAssets';
import { useDesktopUpdater } from '../../hooks/useDesktopUpdater';
import { useTerminalBarsStore } from '../../store/useTerminalBarsStore';
import {
    formatTerminalTitle,
    getWebTerminalTitle,
    isSameTerminalLabel,
    useTerminalBrokerInfo,
} from '../../hooks/useTerminalTitle';
import type { NormalizedMarketStatus } from '../../utils/marketStatus';
import { getAppVersion } from '../../config/appVersion';
import './StatusBar.css';

interface StatusBarProps {
    wsRef?: React.RefObject<WebSocket | null>;
    reconnectCallback?: () => void;
    symbol?: string;
    timeframe?: string;
    marketStatus?: NormalizedMarketStatus & { loading?: boolean };
}

export function StatusBar({ wsRef, reconnectCallback, symbol, timeframe, marketStatus }: StatusBarProps) {
    const tr = useUiTranslation();
    const visible = useTerminalBarsStore(state => state.statusBarVisible);
    const brokerInfo = useTerminalBrokerInfo();
    const statusBarLogoSrc = toPublicAssetPath('favicon.png');

    const terminalTitle = symbol && timeframe
        ? formatTerminalTitle(brokerInfo, symbol, timeframe, marketStatus)
        : (brokerInfo.accountId && brokerInfo.accountId !== '---'
            ? `${getWebTerminalTitle()} - ${brokerInfo.accountId}`
                + (isSameTerminalLabel(brokerInfo.brokerName, getWebTerminalTitle()) ? '' : ` - ${brokerInfo.brokerName}`)
                + ` - ${brokerInfo.marginMode}`
            : getWebTerminalTitle());

    const appVersion = getAppVersion();
    const hasUpdater = Boolean(window.electron?.updater?.isSupported);
    const { updatePhase, updateLabel, updateButtonDisabled, handleUpdateClick } = useDesktopUpdater();

    return (
        // Keep ConnectionStatus mounted: it also handles login requests outside the bar.
        <div style={{ display: visible ? undefined : 'none' }} className="rtx-status-bar h-6 flex items-center justify-between text-[13px] leading-[19.5px] font-normal font-sans select-none z-50">
            <div className="rtx-status-bar__identity flex min-w-0 flex-1 items-center">
                <div
                    className="rtx-status-bar__metric flex min-w-0 max-w-full items-center gap-2 overflow-hidden whitespace-nowrap font-normal"
                >
                    <img
                        src={statusBarLogoSrc}
                        alt={`${brokerInfo.brokerName} Logo`}
                        draggable={false}
                        className="rtx-status-bar__logo h-4 w-4 shrink-0 rounded-sm object-contain"
                    />
                    <span className="rtx-status-bar__metric rtx-status-bar__title truncate whitespace-nowrap font-normal" title={tr(terminalTitle)}>{tr(terminalTitle)}</span>
                </div>
            </div>
            <div className="rtx-status-bar__utilities flex shrink-0 items-center gap-3">
                {/* Connection Status Indicator (Live) */}
                {wsRef && (
                    <ConnectionStatus wsRef={wsRef} reconnectCallback={reconnectCallback} />
                )}
                {/* Version & Update Status */}
                <div className="rtx-status-bar__version-group flex items-center gap-2 border-l pl-3">
                    {hasUpdater && updateLabel && (
                        <button
                            type="button"
                            onClick={handleUpdateClick}
                            disabled={updateButtonDisabled}
                            className="rtx-status-bar__action h-[18px] rounded border px-1.5 text-[12px] font-normal leading-none transition-colors disabled:cursor-default disabled:opacity-70"
                            data-update-phase={updatePhase}
                            title={tr("Check for desktop app updates")}
                        >
                            {tr(updateLabel)}
                        </button>
                    )}
                    <span className="rtx-status-bar__metric rtx-status-bar__version whitespace-nowrap font-normal">
                        v{appVersion}
                    </span>
                </div>
            </div>
        </div>
    );
}
