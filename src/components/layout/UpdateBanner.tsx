/**
 * UpdateBanner — Multi-phase OTA update notification
 * 
 * Phase 1: Downloading — slim progress bar + percentage
 * Phase 2: Finalizing — simulated "Installing..." animation (~3s)
 * Phase 3: Ready — "Update Ready!" banner with Restart Now button
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { UpdateStatusPayload } from '../../types/trading';

type BannerPhase = 'idle' | 'downloading' | 'finalizing' | 'ready' | 'error';

export function UpdateBanner() {
    const [phase, setPhase] = useState<BannerPhase>('idle');
    const [percent, setPercent] = useState(0);
    const [message, setMessage] = useState('');
    const [finalizingPercent, setFinalizingPercent] = useState(0);
    const [dismissed, setDismissed] = useState(false);
    const finalizingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    // Listen to updater status from main process
    useEffect(() => {
        if (!window.electron?.updater) return;

        const cleanup = window.electron.updater.onStatus((data: UpdateStatusPayload) => {
            switch (data.status) {
                case 'checking':
                    // Don't show UI for routine checks
                    break;

                case 'available':
                    setPhase('downloading');
                    setPercent(0);
                    setMessage(data.message);
                    setDismissed(false);
                    break;

                case 'downloading':
                    setPhase('downloading');
                    setPercent(data.percent);
                    setMessage(data.message);
                    break;

                case 'downloaded':
                    // Transition to finalizing phase
                    setPhase('finalizing');
                    setFinalizingPercent(0);
                    setMessage('Installing update...');
                    break;

                case 'not-available':
                    setPhase('idle');
                    break;

                case 'error':
                    setPhase('error');
                    setMessage(data.message);
                    // Auto-dismiss error after 8 seconds
                    setTimeout(() => setPhase('idle'), 8000);
                    break;
            }
        });

        return cleanup;
    }, []);

    // Finalizing animation: simulate progress from 0-100% over ~3 seconds
    useEffect(() => {
        if (phase !== 'finalizing') {
            if (finalizingTimer.current) {
                clearInterval(finalizingTimer.current);
                finalizingTimer.current = null;
            }
            return;
        }

        let current = 0;
        finalizingTimer.current = setInterval(() => {
            current += 2; // 50 steps × 60ms = 3 seconds
            if (current >= 100) {
                current = 100;
                if (finalizingTimer.current) clearInterval(finalizingTimer.current);
                setPhase('ready');
                setMessage('Update ready to install');
            }
            setFinalizingPercent(current);
        }, 60);

        return () => {
            if (finalizingTimer.current) clearInterval(finalizingTimer.current);
        };
    }, [phase]);

    const handleRestart = useCallback(() => {
        if (window.electron?.updater) {
            window.electron.updater.installNow();
        }
    }, []);

    // Don't render if idle, dismissed, or not in Electron
    if (phase === 'idle' || dismissed || !window.electron?.updater) {
        return null;
    }

    return (
        <div className="fixed top-3 right-3 z-[9999] animate-fadeInSlide">
            {/* Phase 1: Downloading */}
            {phase === 'downloading' && (
                <div className="bg-[#1a1d23] border border-zinc-600/30 rounded-lg shadow-2xl shadow-blue-500/10 px-4 py-3 min-w-[280px] backdrop-blur-sm">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-zinc-500 animate-pulse" />
                            <span className="text-[12px] font-medium text-zinc-300">
                                Downloading update
                            </span>
                        </div>
                        <span className="text-[11px] text-blue-400 font-mono tabular-nums">
                            {percent}%
                        </span>
                    </div>
                    <div className="h-1.5 bg-blue-950/50 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-300 ease-out"
                            style={{ width: `${percent}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Phase 2: Finalizing */}
            {phase === 'finalizing' && (
                <div className="bg-[#1a1d23] border border-amber-500/30 rounded-lg shadow-2xl shadow-amber-500/10 px-4 py-3 min-w-[280px] backdrop-blur-sm">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                            <span className="text-[12px] font-medium text-amber-300">
                                Finalizing...
                            </span>
                        </div>
                        <span className="text-[11px] text-amber-400 font-mono tabular-nums">
                            {finalizingPercent}%
                        </span>
                    </div>
                    <div className="h-1.5 bg-amber-950/50 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all duration-300 ease-out"
                            style={{ width: `${finalizingPercent}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Phase 3: Ready */}
            {phase === 'ready' && (
                <div className="bg-[#1a1d23] border border-emerald-500/30 rounded-lg shadow-2xl shadow-emerald-500/10 px-4 py-3 min-w-[280px] backdrop-blur-sm">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                            <span className="text-[12px] font-medium text-emerald-300">
                                Update Ready!
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setDismissed(true)}
                                className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors px-1.5"
                            >
                                Later
                            </button>
                            <button
                                onClick={handleRestart}
                                className="text-[11px] font-semibold px-3 py-1 rounded-md
                  bg-emerald-600 hover:bg-emerald-500 text-white
                  shadow-[0_0_12px_rgba(52,211,153,0.3)] hover:shadow-[0_0_20px_rgba(52,211,153,0.5)]
                  transition-all duration-200"
                            >
                                Restart Now
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Error state */}
            {phase === 'error' && (
                <div className="bg-[#1a1d23] border border-red-500/30 rounded-lg shadow-2xl shadow-red-500/10 px-4 py-3 min-w-[280px] backdrop-blur-sm">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-400" />
                        <span className="text-[12px] font-medium text-red-300">
                            Update failed
                        </span>
                        <span className="text-[10px] text-red-500 truncate max-w-[160px]" title={message}>
                            {message}
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
