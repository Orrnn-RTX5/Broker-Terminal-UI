import { useUiTranslation } from '../../hooks/useUiTranslation';
import { useState, useEffect } from 'react';
import { Icon } from '../ui/Icon';
import { ConnectionStatus } from '../ConnectionStatus';
import { useDesktopUpdater } from '../../hooks/useDesktopUpdater';
import { useDesktopRelease } from '../../hooks/useDesktopRelease';
import {
    getDesktopReleaseButtonTitle,
    getDesktopReleaseVersionLabel,
    openDesktopReleaseDownload,
} from '../../services/desktopRelease';
import {
    WEB_TERMINAL_TITLE,
    formatTerminalTitle,
    getLogoUrl,
    useTerminalBrokerInfo,
} from '../../hooks/useTerminalTitle';
import type { NormalizedMarketStatus } from '../../utils/marketStatus';

interface StatusBarProps {
    wsRef?: React.RefObject<WebSocket | null>;
    reconnectCallback?: () => void;
    symbol?: string;
    timeframe?: string;
    marketStatus?: NormalizedMarketStatus & { loading?: boolean };
}

export function StatusBar({ wsRef, reconnectCallback, symbol, timeframe, marketStatus }: StatusBarProps) {
    const tr = useUiTranslation();
    const brokerInfo = useTerminalBrokerInfo();
    const [currentTime, setCurrentTime] = useState(new Date());
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);
    const gmtTimeStr = currentTime.toISOString().substring(11, 19);

    const [logoError, setLogoError] = useState(false);
    useEffect(() => {
        setLogoError(false); // Reset error state on server/logo change
    }, [brokerInfo.logoUrl]);
    const brokerLogo = brokerInfo.logoUrl && !logoError
        ? getLogoUrl(brokerInfo.logoUrl, brokerInfo.logoBaseCandidates)
        : './titlebar-icon.png';

    const terminalTitle = symbol && timeframe
        ? formatTerminalTitle(brokerInfo, symbol, timeframe, marketStatus)
        : (brokerInfo.accountId && brokerInfo.accountId !== '---'
            ? `${WEB_TERMINAL_TITLE} - ${brokerInfo.accountId} - ${brokerInfo.brokerName} - ${brokerInfo.marginMode}`
            : WEB_TERMINAL_TITLE);

    const statusText = `${gmtTimeStr} - ${terminalTitle}`;

    const appVersion = window.electron?.appVersion || '1.0.0';
    const hasUpdater = Boolean(window.electron?.updater?.isSupported);
    const showDesktopDownload = !window.electron || !window.electron.isPackaged;
    const desktopReleaseState = useDesktopRelease({ enabled: showDesktopDownload });
    const desktopReleaseVersionLabel = getDesktopReleaseVersionLabel(desktopReleaseState.release);
    const { updatePhase, updateLabel, updateButtonDisabled, handleUpdateClick } = useDesktopUpdater();
    const updateButtonTone =
        updatePhase === 'available' ? 'text-sky-300 hover:text-sky-100 border-sky-500/50 bg-sky-500/10 [.rtx-advanced-view_&]:text-sky-700 [.rtx-advanced-view_&]:hover:text-sky-900 [.rtx-advanced-view_&]:border-sky-400/60 [.rtx-advanced-view_&]:bg-sky-100/60'
            : updatePhase === 'downloaded' ? 'text-emerald-300 hover:text-emerald-100 border-emerald-500/50 bg-emerald-500/10 [.rtx-advanced-view_&]:text-emerald-700 [.rtx-advanced-view_&]:hover:text-emerald-900 [.rtx-advanced-view_&]:border-emerald-400/60 [.rtx-advanced-view_&]:bg-emerald-100/60'
                : updatePhase === 'error' ? 'text-red-300 hover:text-red-100 border-red-500/50 bg-red-500/10 [.rtx-advanced-view_&]:text-red-700 [.rtx-advanced-view_&]:hover:text-red-900 [.rtx-advanced-view_&]:border-red-400/60 [.rtx-advanced-view_&]:bg-red-100/60'
                    : 'text-zinc-400 hover:text-zinc-100 border-zinc-700 bg-zinc-900/60 [.rtx-advanced-view_&]:text-zinc-600 [.rtx-advanced-view_&]:hover:text-black [.rtx-advanced-view_&]:border-zinc-400/70 [.rtx-advanced-view_&]:bg-zinc-100/60';
    const desktopDownloadVersionLabel = desktopReleaseVersionLabel || (desktopReleaseState.status === 'loading' ? 'Latest' : '');

    return (
        <div className="rtx-status-bar h-6 flex items-center justify-between border-t border-[#2a3342] bg-[#10151d] px-2 text-[13px] leading-[19.5px] font-normal font-sans text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] select-none z-50 [.rtx-advanced-view_&]:border-zinc-400 [.rtx-advanced-view_&]:bg-[#e1e1e1] [.rtx-advanced-view_&]:text-black [.rtx-advanced-view_&]:shadow-none">
            <div className="flex min-w-0 flex-1 items-center">
                <div
                    className="rtx-status-bar__metric flex min-w-0 max-w-full items-center gap-2 overflow-hidden whitespace-nowrap font-normal text-zinc-400 [.rtx-advanced-view_&]:text-zinc-600"
                >
                    <img
                        src={brokerLogo}
                        alt={`${brokerInfo.brokerName} Logo`}
                        className="h-4 w-4 shrink-0 rounded-sm object-contain"
                        onError={() => setLogoError(true)}
                    />
                    <span className="rtx-status-bar__metric truncate whitespace-nowrap font-normal text-zinc-100 [.rtx-advanced-view_&]:text-black">{tr(statusText)}</span>
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-4">
                {showDesktopDownload && (
                    <div className="flex items-center gap-2 border-r border-zinc-700 pr-4 [.rtx-advanced-view_&]:border-zinc-400">
                            <button
                                type="button"
                                onClick={() => openDesktopReleaseDownload(desktopReleaseState.release)}
                                className="group h-[18px] inline-flex items-center gap-1.5 rounded-[3px] border border-transparent bg-transparent px-0.5 text-[12px] font-normal leading-none text-zinc-300 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500/70 [.rtx-advanced-view_&]:text-zinc-700 [.rtx-advanced-view_&]:hover:text-black"
                                title={getDesktopReleaseButtonTitle(desktopReleaseState.release)}
                            >
                                <Icon name="download" size="xs" className="text-zinc-400 [.rtx-advanced-view_&]:text-zinc-500" />
                                <span>{tr("Desktop App")}</span>
                                {desktopDownloadVersionLabel && (
                                    <span className="font-mono text-[12px] font-normal leading-none text-zinc-500 [.rtx-advanced-view_&]:text-zinc-600">
                                        {desktopDownloadVersionLabel}
                                    </span>
                                )}
                            </button>
                    </div>
                )}
                {/* Connection Status Indicator (Live) */}
                {wsRef && (
                    <ConnectionStatus wsRef={wsRef} reconnectCallback={reconnectCallback} />
                )}
                {/* Version & Update Status */}
                <div className="flex items-center gap-1.5 border-l border-zinc-700 pl-4 [.rtx-advanced-view_&]:border-zinc-400">
                    {hasUpdater && updateLabel && (
                        <button
                            type="button"
                            onClick={handleUpdateClick}
                            disabled={updateButtonDisabled}
                            className={`h-[18px] rounded border px-1.5 text-[12px] font-normal leading-none transition-colors disabled:cursor-default disabled:opacity-70 ${updateButtonTone}`}
                            title={tr("Check for desktop app updates")}
                        >
                            {tr(updateLabel)}
                        </button>
                    )}
                    <span className="rtx-status-bar__metric text-zinc-500 font-mono text-[13px] font-normal [.rtx-advanced-view_&]:text-zinc-500">
                        v{appVersion}
                    </span>
                </div>
            </div>
        </div>
    );
}
