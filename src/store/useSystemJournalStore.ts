import { create } from 'zustand';
import { playSystemSound } from '../utils/audio';

export interface JournalLogEntry {
    id: string;
    code: number;
    code_text: string;
    type: number;
    type_text: string;
    datetime: number;   // Unix timestamp (seconds)
    source: string;
    message: string;
}

// Neutral journal texts (white-label: no vendor brand). The login and welcome
// sounds key off these exact messages.
export const JOURNAL_WELCOME_MESSAGE = 'Welcome to the terminal';
export const JOURNAL_LOGIN_MESSAGE_PREFIX = 'Login as account ';
export const formatJournalLoginMessage = (accountId: string | number): string => `${JOURNAL_LOGIN_MESSAGE_PREFIX}${accountId}`;

const playJournalSoundAfterPaint = (type: 'login' | 'welcome') => {
    const play = () => playSystemSound(type);
    if (typeof window === 'undefined') return;

    if (typeof window.requestAnimationFrame === 'function' && document.visibilityState === 'visible') {
        window.requestAnimationFrame(() => window.setTimeout(play, 0));
        return;
    }

    window.setTimeout(play, 0);
};

interface SystemJournalState {
    logs: JournalLogEntry[];
    addLog: (type_text: string, message: string, source?: string) => void;
    clearLogs: () => void;
}

export const useSystemJournalStore = create<SystemJournalState>((set) => ({
    logs: [
        {
            id: `startup-${Date.now()}`,
            code: 0,
            code_text: 'OK',
            type: 2,
            type_text: 'System',
            datetime: Math.floor(Date.now() / 1000),
            source: 'Terminal',
            message: JOURNAL_WELCOME_MESSAGE,
        }
    ],

    addLog: (type_text, message, source = 'Terminal') => set((state) => {
        const now = Math.floor(Date.now() / 1000);

        // System Audio Triggers
        if (message.startsWith(JOURNAL_LOGIN_MESSAGE_PREFIX)) {
            playJournalSoundAfterPaint('login');
        } else if (message === JOURNAL_WELCOME_MESSAGE) {
            playJournalSoundAfterPaint('welcome');
        }

        // Deduplication: prevent identical messages from spamming the journal within 1 second
        // This resolves duplicate logs caused by React StrictMode double-mounting components.
        if (state.logs.length > 0) {
            const lastLog = state.logs[0];
            if (lastLog.message === message && lastLog.type_text === type_text && (now - lastLog.datetime) <= 1) {
                return state; // Ignore duplicate
            }
        }

        // Map type text to type number for the UI colors
        const typeMap: Record<string, number> = {
            'Config': 1,
            'System': 2,
            'Network': 3,
            'History': 4,
            'User': 5,
            'Trade': 6,
            'API': 7,
            'Notify': 8,
            'All': 0
        };

        const newLog: JournalLogEntry = {
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            code: 0,
            code_text: 'OK',
            type: typeMap[type_text] || 2,
            type_text,
            datetime: now,
            source,
            message,
        };

        // Keep max 1000 logs in memory to prevent performance issues
        const newLogs = [newLog, ...state.logs].slice(0, 1000);
        return { logs: newLogs };
    }),

    clearLogs: () => set({ logs: [] }),
}));
