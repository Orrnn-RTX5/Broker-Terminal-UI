import { useUiTranslation } from '../../hooks/useUiTranslation';
/**
 * UpdateBanner renders the Electron OTA update prompt.
 *
 * The main process detects updates automatically, but downloads only after the
 * user clicks Download.
 */
import { useState, useEffect, useCallback } from 'react';
import type { UpdateStatusPayload } from '../../types/trading';

type BannerPhase = 'idle' | 'available' | 'downloading' | 'ready' | 'error';

const getVersionLabel = (data: UpdateStatusPayload): string =>
    data.version ? `v${data.version}` : data.message || 'new version';

export function UpdateBanner() {
    const tr = useUiTranslation();
    const [phase, setPhase] = useState<BannerPhase>('idle');
    const [percent, setPercent] = useState(0);
    const [message, setMessage] = useState('');
    const [versionLabel, setVersionLabel] = useState('');
    const [dismissed, setDismissed] = useState(false);
    const [actionPending, setActionPending] = useState(false);

    useEffect(() => {
        if (!window.electron?.updater?.isSupported) return;

        const cleanup = window.electron.updater.onStatus((data: UpdateStatusPayload) => {
            switch (data.status) {
                case 'checking':
                    break;

                case 'available':
                    setPhase('available');
                    setPercent(0);
                    setMessage(data.message || 'A new update is available');
                    setVersionLabel(getVersionLabel(data));
                    setDismissed(false);
                    setActionPending(false);
                    break;

                case 'downloading':
                    setPhase('downloading');
                    setPercent(data.percent);
                    setMessage(data.message || `${data.percent}%`);
                    setDismissed(false);
                    break;

                case 'downloaded':
                    setPhase('ready');
                    setPercent(100);
                    setMessage(data.message || 'Update ready to install');
                    setVersionLabel(getVersionLabel(data));
                    setDismissed(false);
                    setActionPending(false);
                    break;

                case 'not-available':
                    setPhase('idle');
                    setActionPending(false);
                    break;

                case 'error':
                    setPhase('error');
                    setMessage(data.message || 'Update failed');
                    setActionPending(false);
                    window.setTimeout(() => setPhase('idle'), 8000);
                    break;
            }
        });

        return cleanup;
    }, []);

    const handleDownload = useCallback(async () => {
        if (!window.electron?.updater || actionPending) return;

        setActionPending(true);
        const result = await window.electron.updater.downloadNow();
        if (!result.ok) {
            setPhase('error');
            setMessage(result.error || 'Update download failed');
            setActionPending(false);
        }
    }, [actionPending]);

    const handleRestart = useCallback(() => {
        if (window.electron?.updater) {
            window.electron.updater.installNow();
        }
    }, []);

    if (phase === 'idle' || dismissed || !window.electron?.updater?.isSupported) {
        return null;
    }

    return (
        <div className="fixed top-3 right-3 z-[9999] animate-fadeInSlide">
            {phase === 'available' && (
                <div className="min-w-[300px] rounded-lg border border-sky-500/30 bg-[#1a1d23] px-4 py-3 shadow-2xl shadow-sky-500/10 backdrop-blur-sm">
                    <div className="mb-3 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <div className="h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.5)]" />
                                <span className="text-[12px] font-semibold text-sky-200">{tr("Update available")}</span>
                            </div>
                            <div className="mt-1 truncate text-[11px] text-zinc-400" title={tr(message)}>
                                {tr(versionLabel)}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setDismissed(true)}
                            className="text-[11px] text-zinc-500 transition-colors hover:text-zinc-300"
                        >
                            {tr("Later")}</button>
                    </div>
                    <button
                        type="button"
                        onClick={handleDownload}
                        disabled={actionPending}
                        className="h-8 w-full rounded-md bg-sky-600 text-[12px] font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {actionPending ? tr("Starting download...") : tr("Download update")}
                    </button>
                </div>
            )}

            {phase === 'downloading' && (
                <div className="min-w-[300px] rounded-lg border border-blue-500/30 bg-[#1a1d23] px-4 py-3 shadow-2xl shadow-blue-500/10 backdrop-blur-sm">
                    <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
                            <span className="text-[12px] font-medium text-blue-200">{tr("Downloading update")}</span>
                        </div>
                        <span className="font-mono text-[11px] text-blue-300 tabular-nums">{percent}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-blue-950/50">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300 ease-out"
                            style={{ width: `${percent}%` }}
                        />
                    </div>
                </div>
            )}

            {phase === 'ready' && (
                <div className="min-w-[300px] rounded-lg border border-emerald-500/30 bg-[#1a1d23] px-4 py-3 shadow-2xl shadow-emerald-500/10 backdrop-blur-sm">
                    <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                                <span className="text-[12px] font-semibold text-emerald-300">{tr("Update ready")}</span>
                            </div>
                            <div className="mt-1 truncate text-[11px] text-zinc-400" title={tr(message)}>
                                {tr(versionLabel)}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setDismissed(true)}
                                className="px-1.5 text-[11px] text-zinc-500 transition-colors hover:text-zinc-300"
                            >
                                {tr("Later")}</button>
                            <button
                                type="button"
                                onClick={handleRestart}
                                className="rounded-md bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white shadow-[0_0_12px_rgba(52,211,153,0.3)] transition-all duration-200 hover:bg-emerald-500 hover:shadow-[0_0_20px_rgba(52,211,153,0.5)]"
                            >
                                {tr("Install")}</button>
                        </div>
                    </div>
                </div>
            )}

            {phase === 'error' && (
                <div className="min-w-[300px] rounded-lg border border-red-500/30 bg-[#1a1d23] px-4 py-3 shadow-2xl shadow-red-500/10 backdrop-blur-sm">
                    <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-red-400" />
                        <span className="text-[12px] font-medium text-red-300">{tr("Update failed")}</span>
                        <span className="max-w-[170px] truncate text-[10px] text-red-500" title={tr(message)}>
                            {tr(message)}
                        </span>
                    </div>
                </div>
            )}

            <style>{`
        @keyframes fadeInSlide {
          from {
            opacity: 0;
            transform: translateY(-12px) translateX(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0) translateX(0);
          }
        }
        .animate-fadeInSlide {
          animation: fadeInSlide 0.3s ease-out;
        }
      `}</style>
        </div>
    );
}
