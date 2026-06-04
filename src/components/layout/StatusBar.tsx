import { useState, useEffect } from 'react';
import { Icon } from '../ui/Icon';
import { ConnectionStatus } from '../ConnectionStatus';
import type { UpdateStatusPayload } from '../../types/trading';

interface StatusBarProps {
    wsRef?: React.RefObject<WebSocket | null>;
    reconnectCallback?: () => void;
}

export function StatusBar({ wsRef, reconnectCallback }: StatusBarProps) {
    const appVersion = window.electron?.appVersion || '1.0.0';
    const [updateLabel, setUpdateLabel] = useState('');

    useEffect(() => {
        if (!window.electron?.updater) return;

        const cleanup = window.electron.updater.onStatus((data: UpdateStatusPayload) => {
            switch (data.status) {
                case 'checking':
                    setUpdateLabel('Checking...');
                    break;
                case 'downloading':
                    setUpdateLabel(`Updating ${data.percent}%`);
                    break;
                case 'downloaded':
                    setUpdateLabel('Update ready');
                    break;
                case 'not-available':
                    setUpdateLabel('');
                    break;
                case 'error':
                    setUpdateLabel('');
                    break;
                default:
                    break;
            }
        });

        return cleanup;
    }, []);

    return (
        <div className="bg-[#e1e1e1] border-t border-zinc-400 h-6 flex items-center justify-between px-2 text-[11px] font-sans text-black select-none z-50">
            <div className="text-zinc-600 font-medium">
                For Help, press F1
            </div>
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 border-r border-zinc-400 pr-4">
                    <Icon name="server" size="xs" className="text-zinc-500" />
                    <span className="font-medium text-black">RTX 5 Web Terminal</span>
                </div>
                {/* Connection Status Indicator (Live) */}
                {wsRef && (
                    <ConnectionStatus wsRef={wsRef} reconnectCallback={reconnectCallback} />
                )}
                {/* Version & Update Status */}
                <div className="flex items-center gap-1.5 border-l border-zinc-400 pl-4">
                    {updateLabel && (
                        <span className="text-blue-600 font-medium text-[10px]">
                            {updateLabel}
                        </span>
                    )}
                    <span className="text-zinc-500 font-mono text-[10px]">
                        v{appVersion}
                    </span>
                </div>
            </div>
        </div>
    );
}
