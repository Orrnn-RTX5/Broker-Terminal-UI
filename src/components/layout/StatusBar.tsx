import { useCallback, useState, useEffect } from 'react';
import { Icon } from '../ui/Icon';
import { ConnectionStatus } from '../ConnectionStatus';
import type { UpdateStatusPayload } from '../../types/trading';
import { useDesktopRelease } from '../../hooks/useDesktopRelease';
import {
    getDesktopReleaseButtonTitle,
    getDesktopReleaseVersionLabel,
    openDesktopReleaseDownload,
} from '../../services/desktopRelease';

interface StatusBarProps {
    wsRef?: React.RefObject<WebSocket | null>;
    reconnectCallback?: () => void;
}

export function StatusBar({ wsRef, reconnectCallback }: StatusBarProps) {
    const appVersion = window.electron?.appVersion || '1.0.0';
    const hasUpdater = Boolean(window.electron?.updater);
    const showDesktopDownload = !window.electron;
    const desktopReleaseState = useDesktopRelease({ enabled: showDesktopDownload });
    const desktopReleaseVersionLabel = getDesktopReleaseVersionLabel(desktopReleaseState.release);
    const [updatePhase, setUpdatePhase] = useState<UpdateStatusPayload['status'] | 'idle'>('idle');
    const [updateLabel, setUpdateLabel] = useState(hasUpdater ? 'Check updates' : '');
    const [actionPending, setActionPending] = useState(false);

    useEffect(() => {
        if (!window.electron?.updater) return;

        const cleanup = window.electron.updater.onStatus((data: UpdateStatusPayload) => {
            setUpdatePhase(data.status);
            switch (data.status) {
                case 'checking':
                    setUpdateLabel('Checking...');
                    break;
                case 'available':
                    setUpdateLabel('Download update');
                    setActionPending(false);
                    break;
                case 'downloading':
                    setUpdateLabel(`Downloading ${data.percent}%`);
                    break;
                case 'downloaded':
                    setUpdateLabel('Install update');
                    setActionPending(false);
                    break;
                case 'not-available':
                    setUpdateLabel('Check updates');
                    setUpdatePhase('idle');
                    setActionPending(false);
                    break;
                case 'error':
                    setUpdateLabel('Retry update');
                    setActionPending(false);
                    break;
                default:
                    break;
            }
        });

        return cleanup;
    }, []);

    const handleUpdateClick = useCallback(async () => {
        if (!window.electron?.updater || actionPending) return;
        if (updatePhase === 'checking' || updatePhase === 'downloading') return;

        if (updatePhase === 'available') {
            setActionPending(true);
            const result = await window.electron.updater.downloadNow();
            if (!result.ok) {
                setUpdatePhase('error');
                setUpdateLabel('Retry update');
            }
            setActionPending(false);
            return;
        }

        if (updatePhase === 'downloaded') {
            window.electron.updater.installNow();
            return;
        }

        setActionPending(true);
        const result = await window.electron.updater.checkForUpdates();
        if (!result.ok) {
            setUpdatePhase('error');
            setUpdateLabel('Retry update');
        }
        setActionPending(false);
    }, [actionPending, updatePhase]);

    const updateButtonDisabled = actionPending || updatePhase === 'checking' || updatePhase === 'downloading';
    const updateButtonTone =
        updatePhase === 'available' ? 'text-sky-700 hover:text-sky-900 border-sky-400/60 bg-sky-100/60'
            : updatePhase === 'downloaded' ? 'text-emerald-700 hover:text-emerald-900 border-emerald-400/60 bg-emerald-100/60'
                : updatePhase === 'error' ? 'text-red-700 hover:text-red-900 border-red-400/60 bg-red-100/60'
                    : 'text-zinc-600 hover:text-black border-zinc-400/70 bg-zinc-100/60';
    const desktopDownloadVersionLabel = desktopReleaseVersionLabel || (desktopReleaseState.status === 'loading' ? 'Latest' : '');

    return (
        <div className="bg-[#e1e1e1] border-t border-zinc-400 h-6 flex items-center justify-between px-2 text-[11px] font-sans text-black select-none z-50">
            <div className="text-zinc-600 font-medium">
                For Help, press F1
            </div>
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 border-r border-zinc-400 pr-4">
                    <Icon name="server" size="xs" className="text-zinc-500" />
                    <span className="font-medium text-black">RTX 5 Web Terminal</span>
                    {showDesktopDownload && (
                        <>
                            <span className="h-3 w-px bg-zinc-400/70" aria-hidden="true" />
                            <button
                                type="button"
                                onClick={() => openDesktopReleaseDownload(desktopReleaseState.release)}
                                className="group h-[18px] inline-flex items-center gap-1.5 rounded-[4px] border border-zinc-400/70 bg-gradient-to-b from-white to-zinc-100 px-1.5 text-[10px] font-semibold leading-none text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] transition-colors hover:border-zinc-500 hover:from-white hover:to-zinc-200 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500/70"
                                title={getDesktopReleaseButtonTitle(desktopReleaseState.release)}
                            >
                                <Icon name="download" size="xs" className="text-zinc-500 group-hover:text-zinc-700" />
                                <span>Desktop App</span>
                                {desktopDownloadVersionLabel && (
                                    <span className="rounded-[3px] border border-zinc-300 bg-zinc-200/80 px-1 py-[1px] font-mono text-[9px] font-semibold leading-none text-zinc-600">
                                        {desktopDownloadVersionLabel}
                                    </span>
                                )}
                            </button>
                        </>
                    )}
                </div>
                {/* Connection Status Indicator (Live) */}
                {wsRef && (
                    <ConnectionStatus wsRef={wsRef} reconnectCallback={reconnectCallback} />
                )}
                {/* Version & Update Status */}
                <div className="flex items-center gap-1.5 border-l border-zinc-400 pl-4">
                    {hasUpdater && updateLabel && (
                        <button
                            type="button"
                            onClick={handleUpdateClick}
                            disabled={updateButtonDisabled}
                            className={`h-[18px] rounded border px-1.5 text-[10px] font-semibold leading-none transition-colors disabled:cursor-default disabled:opacity-70 ${updateButtonTone}`}
                            title="Check for desktop app updates"
                        >
                            {updateLabel}
                        </button>
                    )}
                    <span className="text-zinc-500 font-mono text-[10px]">
                        v{appVersion}
                    </span>
                </div>
            </div>
        </div>
    );
}
