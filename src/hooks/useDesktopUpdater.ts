import { useCallback, useEffect, useState } from 'react';
import type { UpdateStatusPayload } from '../types/trading';

/** Shared desktop update action for the View menu and browser status chrome. */
export function useDesktopUpdater() {
    const hasUpdater = Boolean(window.electron?.updater?.isSupported);
    const [updatePhase, setUpdatePhase] = useState<UpdateStatusPayload['status'] | 'idle'>('idle');
    const [updateLabel, setUpdateLabel] = useState('Check updates');
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
        const updater = window.electron?.updater;
        if (!updater?.isSupported || actionPending) return;
        if (updatePhase === 'checking' || updatePhase === 'downloading') return;
        setActionPending(true);
        try {
            if (updatePhase === 'downloaded') {
                updater.installNow();
                return;
            }
            const result = updatePhase === 'available'
                ? await updater.downloadNow()
                : await updater.checkForUpdates();
            if (!result.ok) throw new Error('Update action failed');
        } catch {
            setUpdatePhase('error');
            setUpdateLabel('Retry update');
        } finally {
            setActionPending(false);
        }
    }, [actionPending, updatePhase]);

    const updateButtonDisabled = actionPending || updatePhase === 'checking' || updatePhase === 'downloading';
    return { hasUpdater, updatePhase, updateLabel, updateButtonDisabled: !hasUpdater || updateButtonDisabled, handleUpdateClick };
}
