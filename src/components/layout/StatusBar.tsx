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
    const hasUpdater = Boolean(window.electron?.updater?.isSupported);
    const showDesktopDownload = !window.electron || !window.electron.isPackaged;
    const desktopReleaseState = useDesktopRelease({ enabled: showDesktopDownload });
    const desktopReleaseVersionLabel = getDesktopReleaseVersionLabel(desktopReleaseState.release);
    const [updatePhase, setUpdatePhase] = useState<UpdateStatusPayload['status'] | 'idle'>('idle');
    const [updateLabel, setUpdateLabel] = useState(hasUpdater ? 'Check updates' : '');
    const [actionPending, setActionPending] = useState(false);

    useEffect(() => {
        if (!window.electron?.updater?.isSupported) return;

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
        updatePhase === 'available' ? 'text-sky-300 hover:text-sky-100 border-sky-500/50 bg-sky-500/10 [.rtx-advanced-view_&]:text-sky-700 [.rtx-advanced-view_&]:hover:text-sky-900 [.rtx-advanced-view_&]:border-sky-400/60 [.rtx-advanced-view_&]:bg-sky-100/60'
            : updatePhase === 'downloaded' ? 'text-emerald-300 hover:text-emerald-100 border-emerald-500/50 bg-emerald-500/10 [.rtx-advanced-view_&]:text-emerald-700 [.rtx-advanced-view_&]:hover:text-emerald-900 [.rtx-advanced-view_&]:border-emerald-400/60 [.rtx-advanced-view_&]:bg-emerald-100/60'
                : updatePhase === 'error' ? 'text-red-300 hover:text-red-100 border-red-500/50 bg-red-500/10 [.rtx-advanced-view_&]:text-red-700 [.rtx-advanced-view_&]:hover:text-red-900 [.rtx-advanced-view_&]:border-red-400/60 [.rtx-advanced-view_&]:bg-red-100/60'
                    : 'text-zinc-400 hover:text-zinc-100 border-zinc-700 bg-zinc-900/60 [.rtx-advanced-view_&]:text-zinc-600 [.rtx-advanced-view_&]:hover:text-black [.rtx-advanced-view_&]:border-zinc-400/70 [.rtx-advanced-view_&]:bg-zinc-100/60';
    const desktopDownloadVersionLabel = desktopReleaseVersionLabel || (desktopReleaseState.status === 'loading' ? 'Latest' : '');

    return (
        <div className="h-6 flex items-center justify-between border-t border-[#2a3342] bg-[#10151d] px-2 text-[11px] font-sans text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] select-none z-50 [.rtx-advanced-view_&]:border-zinc-400 [.rtx-advanced-view_&]:bg-[#e1e1e1] [.rtx-advanced-view_&]:text-black [.rtx-advanced-view_&]:shadow-none">
            <div className="text-zinc-400 font-medium [.rtx-advanced-view_&]:text-zinc-600">
                For Help, press F1
            </div>
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 border-r border-zinc-700 pr-4 [.rtx-advanced-view_&]:border-zinc-400">
                    <Icon name="server" size="xs" className="text-zinc-500 [.rtx-advanced-view_&]:text-zinc-500" />
                    <span className="font-medium text-zinc-100 [.rtx-advanced-view_&]:text-black">RTX 5 Web Terminal</span>
                    {showDesktopDownload && (
                        <>
                            <span className="h-3 w-px bg-zinc-700/80 [.rtx-advanced-view_&]:bg-zinc-400/70" aria-hidden="true" />
                            <button
                                type="button"
                                onClick={() => openDesktopReleaseDownload(desktopReleaseState.release)}
                                className="group h-[18px] inline-flex items-center gap-1.5 rounded-[3px] border border-transparent bg-transparent px-0.5 text-[10px] font-semibold leading-none text-zinc-300 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500/70 [.rtx-advanced-view_&]:text-zinc-700 [.rtx-advanced-view_&]:hover:text-black"
                                title={getDesktopReleaseButtonTitle(desktopReleaseState.release)}
                            >
                                <Icon name="download" size="xs" className="text-zinc-400 [.rtx-advanced-view_&]:text-zinc-500" />
                                <span>Desktop App</span>
                                {desktopDownloadVersionLabel && (
                                    <span className="font-mono text-[9px] font-semibold leading-none text-zinc-500 [.rtx-advanced-view_&]:text-zinc-600">
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
                <div className="flex items-center gap-1.5 border-l border-zinc-700 pl-4 [.rtx-advanced-view_&]:border-zinc-400">
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
                    <span className="text-zinc-500 font-mono text-[10px] [.rtx-advanced-view_&]:text-zinc-500">
                        v{appVersion}
                    </span>
                </div>
            </div>
        </div>
    );
}
