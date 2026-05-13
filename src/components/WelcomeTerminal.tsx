/**
 * WelcomeTerminal — MT5-style startup terminal with embedded login dialog.
 *
 * Shown instead of the old full-screen Login page.
 * Renders the trading interface behind (dimmed) and shows:
 *   1. A terminal console with scrolling startup log messages.
 *   2. A floating "Login to Trade Account" dialog over it.
 *
 * Once the user authenticates, the onLogin callback fires and this component
 * unmounts — the main platform takes over seamlessly.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { api } from '../services/api';
import { getStoredBrokerServer, loadBrokerServers, persistBrokerServer, resolveLoginBrokerTarget } from '../services/brokerServers';

interface WelcomeTerminalProps {
    onLogin: (accountId: string) => void;
}

interface LogLine {
    time: string;
    text: string;
    type: 'info' | 'ok' | 'warn' | 'err';
}

const now = () =>
    new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });

const STARTUP_SEQUENCE: { delay: number; text: string; type: LogLine['type'] }[] = [
    { delay: 0, text: 'RTX Terminal  —  Institutional Trading Environment', type: 'info' },
    { delay: 120, text: 'Build 1.0.0  (c) 2025 RTX Systems', type: 'info' },
    { delay: 280, text: '----------------------------------------------------', type: 'info' },
    { delay: 450, text: 'Initializing market data subsystem...', type: 'info' },
    { delay: 700, text: 'Loading symbol catalog...', type: 'info' },
    { delay: 950, text: 'Connecting to trading API', type: 'info' },
    { delay: 1300, text: 'FIX gateway handshake OK', type: 'ok' },
    { delay: 1550, text: 'WebSocket market feed: READY', type: 'ok' },
    { delay: 1800, text: 'Price aggregation engine: ONLINE', type: 'ok' },
    { delay: 2050, text: '----------------------------------------------------', type: 'info' },
    { delay: 2200, text: 'Please login to your trade account to continue.', type: 'warn' },
];

export function WelcomeTerminal({ onLogin }: WelcomeTerminalProps) {
    // ── Terminal log state ──────────────────────────────────────────────────
    const [lines, setLines] = useState<LogLine[]>([]);
    const logEndRef = useRef<HTMLDivElement>(null);

    // ── Login form state ────────────────────────────────────────────────────
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [server, setServer] = useState(() => getStoredBrokerServer());
    const [brokerServers, setBrokerServers] = useState<string[]>([]);
    const [rememberMe, setRememberMe] = useState(false);

    const addSavedAccount = useAppStore(s => s.addSavedAccount);
    const setActiveAccount = useAppStore(s => s.setActiveAccount);

    // Pre-fill remembered account ID only. Passwords must not be restored from storage.
    useEffect(() => {
        const savedUser = localStorage.getItem('rtx_saved_username');
        localStorage.removeItem('rtx_saved_password');
        if (savedUser) {
            setUsername(savedUser);
            setRememberMe(true);
        }
    }, []);

    useEffect(() => {
        let isMounted = true;
        loadBrokerServers()
            .then((servers) => {
                if (!isMounted || servers.length === 0) return;
                setBrokerServers(servers);
                setServer(current => servers.includes(current) ? current : current || servers[0]);
            })
            .catch((err) => console.warn('[WelcomeTerminal] Could not load broker servers:', err));
        return () => {
            isMounted = false;
        };
    }, []);

    // Run startup log sequence
    useEffect(() => {
        const timers: ReturnType<typeof setTimeout>[] = [];
        STARTUP_SEQUENCE.forEach(({ delay, text, type }) => {
            timers.push(
                setTimeout(() => {
                    setLines(prev => [...prev, { time: now(), text, type }]);
                }, delay)
            );
        });
        return () => timers.forEach(clearTimeout);
    }, []);

    // Auto-scroll log
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [lines]);

    // ── Login handler ───────────────────────────────────────────────────────
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const selectedServer = persistBrokerServer(server);
            const loginTarget = resolveLoginBrokerTarget(selectedServer);
            const data = await api.auth.login(username, password, {
                broker_id: loginTarget.broker_id,
                server: loginTarget.server,
            });
            const token = data.access_token;
            if (!token) throw new Error('No authentication token received');

            const accountId = data.account_login ?? username;

            // Persist account ID and tokens only; never persist the password.
            localStorage.setItem('rtx_last_login', String(accountId));
            localStorage.setItem('rtx_saved_username', String(accountId));
            localStorage.removeItem('rtx_saved_password');

            const { setToken, setRefreshToken } = await import('../api/client');
            setToken(token);
            if (data.refresh_token) setRefreshToken(data.refresh_token);
            if (data.expires_at) localStorage.setItem('token_expires_at', data.expires_at);

            // Update Zustand store
            useAppStore.getState().setAuthenticated(true, String(accountId), token, data.refresh_token);

            // Save to multi-account list
            const loginNum = parseInt(String(accountId), 10);
            if (!isNaN(loginNum)) {
                addSavedAccount({
                    login: loginNum,
                    name: data.user?.username || data.username || '',
                    server: loginTarget.server || data.broker_server || loginTarget.displayValue,
                    isLive: true,
                    lastUsed: Date.now(),
                });
                setActiveAccount(loginNum);
            }

            // Append success line to terminal
            setLines(prev => [
                ...prev,
                { time: now(), text: `Connected — Account ${accountId}  [ ${data.user?.username || data.username || username} ]`, type: 'ok' },
                { time: now(), text: 'Loading workspace...', type: 'info' },
            ]);

            // Short pause for user to see the "Connected" message, then hand off
            setTimeout(() => onLogin(String(accountId)), 600);
        } catch (err: any) {
            console.error('[WelcomeTerminal] Login error:', err);
            setError(err.message || 'Authentication failed');
            setLines(prev => [
                ...prev,
                { time: now(), text: `Login failed: ${err.message || 'Authentication error'}`, type: 'err' },
            ]);
        } finally {
            setLoading(false);
        }
    };

    // ── Colour helpers ──────────────────────────────────────────────────────
    const lineColor = (type: LogLine['type']) => {
        switch (type) {
            case 'ok': return '#22c55e';   // green-500
            case 'warn': return '#eab308';   // yellow-500
            case 'err': return '#ef4444';   // red-500
            default: return '#71717a';   // zinc-500
        }
    };

    // ── Render ──────────────────────────────────────────────────────────────
    return (
        /* Full-screen dark overlay */
        <div
            onContextMenu={e => e.stopPropagation()}
            onMouseDownCapture={e => {
                // Prevent any mousedown from leaking through to panels below
                // (which would trigger their right-click context menus via portals)
                const target = e.target as HTMLElement;
                if (!target.closest('[data-welcome-card]')) {
                    e.stopPropagation();
                }
            }}
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(9,9,11,0.92)',
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
                zIndex: 99999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: "'Consolas','Fira Mono','Menlo',monospace",
            }}
        >
            {/*
              ┌──────────────────────────────────────────────────────────────┐
              │  Two-column card: terminal log (left) + login form (right)  │
              └──────────────────────────────────────────────────────────────┘
            */}
            <div
                data-welcome-card
                style={{
                    display: 'flex',
                    gap: 0,
                    width: 'min(960px, 96vw)',
                    height: 'min(540px, 92vh)',
                    borderRadius: 8,
                    overflow: 'hidden',
                    boxShadow: '0 32px 64px rgba(0,0,0,0.7)',
                    border: '1px solid #222226',
                }}
            >
                {/* ── LEFT: Terminal Console ──────────────────────────────── */}
                <div
                    style={{
                        flex: 1,
                        background: '#0c0c10',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                    }}
                >
                    {/* Title bar */}
                    <div
                        style={{
                            padding: '8px 14px',
                            background: '#111114',
                            borderBottom: '1px solid #222226',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                        }}
                    >
                        <span
                            style={{
                                display: 'inline-block',
                                width: 10,
                                height: 10,
                                borderRadius: '50%',
                                background: '#22c55e',
                                boxShadow: '0 0 6px #22c55e',
                            }}
                        />
                        <span style={{ color: '#52525b', fontSize: 11, letterSpacing: '0.1em' }}>
                            RTX JOURNAL
                        </span>
                    </div>

                    {/* Log lines */}
                    <div
                        style={{
                            flex: 1,
                            overflowY: 'auto',
                            padding: '10px 14px',
                            fontSize: 11.5,
                            lineHeight: 1.7,
                        }}
                    >
                        {lines.map((line, i) => (
                            <div key={i} style={{ display: 'flex', gap: 10 }}>
                                <span style={{ color: '#3f3f46', minWidth: 60, flexShrink: 0 }}>
                                    {line.time}
                                </span>
                                <span style={{ color: lineColor(line.type) }}>{line.text}</span>
                            </div>
                        ))}
                        <div ref={logEndRef} />
                    </div>
                </div>

                {/* ── RIGHT: Login Dialog ─────────────────────────────────── */}
                <div
                    style={{
                        width: 320,
                        flexShrink: 0,
                        background: '#131316',
                        borderLeft: '1px solid #222226',
                        display: 'flex',
                        flexDirection: 'column',
                        padding: '32px 28px',
                        gap: 0,
                    }}
                >
                    {/* Logo & title */}
                    <div style={{ textAlign: 'center', marginBottom: 28 }}>
                        {/* RTX Logo — dark background version */}
                        <img
                            src="/logo.png"
                            alt="RTX"
                            style={{
                                width: 64,
                                height: 64,
                                borderRadius: 12,
                                margin: '0 auto 14px',
                                display: 'block',
                                objectFit: 'contain',
                                boxShadow: '0 0 20px rgba(109,192,74,0.20)',
                            }}
                        />
                        <p style={{ color: '#f4f4f5', fontSize: 16, fontWeight: 700, margin: 0, letterSpacing: '0.03em', fontFamily: 'system-ui, sans-serif' }}>
                            RTX Terminal
                        </p>
                        <p style={{ color: '#52525b', fontSize: 11, margin: '4px 0 0', fontFamily: 'system-ui, sans-serif' }}>
                            Login to Trade Account
                        </p>
                    </div>

                    {/* Error */}
                    {error && (
                        <div
                            style={{
                                marginBottom: 14,
                                padding: '8px 12px',
                                borderRadius: 6,
                                background: 'rgba(239,68,68,0.1)',
                                border: '1px solid rgba(239,68,68,0.25)',
                                color: '#f87171',
                                fontSize: 12,
                                fontFamily: 'system-ui, sans-serif',
                            }}
                        >
                            {error}
                        </div>
                    )}

                    {/* Form */}
                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                        <div>
                            <label style={labelStyle}>Account ID</label>
                            <input
                                type="text"
                                placeholder="Enter Account ID"
                                required
                                autoFocus
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                style={inputStyle}
                                onFocus={e => (e.target.style.borderColor = '#10b981')}
                                onBlur={e => (e.target.style.borderColor = '#3f3f46')}
                            />
                        </div>

                        <div>
                            <label style={labelStyle}>Password</label>
                            <input
                                type="password"
                                placeholder="Enter Password"
                                required
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                style={inputStyle}
                                onFocus={e => (e.target.style.borderColor = '#10b981')}
                                onBlur={e => (e.target.style.borderColor = '#3f3f46')}
                            />
                        </div>

                        <div>
                            <label style={labelStyle}>Server</label>
                            <input
                                type="text"
                                placeholder="Server"
                                required
                                value={server}
                                list="welcome-broker-servers"
                                onChange={e => setServer(e.target.value)}
                                style={inputStyle}
                                onFocus={e => (e.target.style.borderColor = '#10b981')}
                                onBlur={e => (e.target.style.borderColor = '#3f3f46')}
                            />
                            <datalist id="welcome-broker-servers">
                                {brokerServers.map(serverName => (
                                    <option key={serverName} value={serverName} />
                                ))}
                            </datalist>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0' }}>
                            <input
                                type="checkbox"
                                id="wtRemember"
                                checked={rememberMe}
                                onChange={e => setRememberMe(e.target.checked)}
                                style={{ accentColor: '#10b981', width: 14, height: 14, cursor: 'pointer' }}
                            />
                            <label
                                htmlFor="wtRemember"
                                style={{ color: '#71717a', fontSize: 12, cursor: 'pointer', fontFamily: 'system-ui, sans-serif' }}
                            >
                                Remember credentials
                            </label>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                marginTop: 8,
                                padding: '11px 0',
                                borderRadius: 7,
                                border: 'none',
                                background: loading
                                    ? '#064e3b'
                                    : 'linear-gradient(135deg,#059669,#10b981)',
                                color: '#fff',
                                fontWeight: 700,
                                fontSize: 13,
                                cursor: loading ? 'not-allowed' : 'pointer',
                                letterSpacing: '0.03em',
                                transition: 'opacity 0.2s',
                                opacity: loading ? 0.7 : 1,
                                fontFamily: 'system-ui, sans-serif',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 8,
                            }}
                        >
                            {loading ? (
                                <>
                                    <span
                                        style={{
                                            display: 'inline-block',
                                            width: 14,
                                            height: 14,
                                            border: '2px solid rgba(255,255,255,0.3)',
                                            borderTopColor: '#fff',
                                            borderRadius: '50%',
                                            animation: 'rtx-spin 0.7s linear infinite',
                                        }}
                                    />
                                    Connecting...
                                </>
                            ) : (
                                <>
                                    Login
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="5" y1="12" x2="19" y2="12" />
                                        <polyline points="12 5 19 12 12 19" />
                                    </svg>
                                </>
                            )}
                        </button>
                    </form>

                    {/* Footer */}
                    <div
                        style={{
                            marginTop: 'auto',
                            paddingTop: 20,
                            borderTop: '1px solid #222226',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                        }}
                    >
                        <span
                            style={{
                                display: 'inline-block',
                                width: 7,
                                height: 7,
                                borderRadius: '50%',
                                background: '#22c55e',
                                boxShadow: '0 0 4px #22c55e',
                            }}
                        />
                        <span style={{ color: '#52525b', fontSize: 11, fontFamily: 'system-ui,sans-serif' }}>
                            System Operational
                        </span>
                    </div>
                </div>
            </div>

            {/* Spinner keyframe injected once */}
            <style>{`
                @keyframes rtx-spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}

// ── Shared input styles ────────────────────────────────────────────────────
const labelStyle: React.CSSProperties = {
    display: 'block',
    color: '#52525b',
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.15em',
    marginBottom: 6,
    fontFamily: 'system-ui, sans-serif',
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '9px 12px',
    borderRadius: 6,
    border: '1px solid #3f3f46',
    background: '#0d0d11',
    color: '#f4f4f5',
    fontSize: 13,
    outline: 'none',
    transition: 'border-color 0.15s',
    fontFamily: 'system-ui, sans-serif',
};
