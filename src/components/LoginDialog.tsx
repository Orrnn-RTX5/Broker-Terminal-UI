/**
 * MT5-Style Login Dialog
 * Modal dialog for switching accounts / logging in
 * Matches the Flexy Market MT5 Login dialog styling
 */

import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useAppStore } from '../store/useAppStore';
import { api } from '../services/api';
import { User, X, HelpCircle } from 'lucide-react';

interface LoginDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onLoginSuccess?: (accountId: string) => void;
    initialLogin?: string;
}

export function LoginDialog({ isOpen, onClose, onLoginSuccess, initialLogin = '' }: LoginDialogProps) {
    const [login, setLogin] = useState('');
    const [password, setPassword] = useState('');
    const [server, setServer] = useState('FlexyMarkets-Server');
    const [savePassword, setSavePassword] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const loginInputRef = useRef<HTMLInputElement>(null);

    // Pre-fill with current account or provided initial login
    useEffect(() => {
        if (isOpen) {
            const accountId = initialLogin || useAppStore.getState().accountId || '';
            setLogin(accountId);
            setPassword('');
            setError(null);
            setTimeout(() => loginInputRef.current?.select(), 100);
        }
    }, [isOpen, initialLogin]);

    // Handle ESC key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
        }
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const handleSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!login.trim() || !password.trim()) {
            setError('Login and password are required');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            // Logout current session (fire-and-forget)
            fetch('https://rtxbackend.tradecopier.org/api/logout', {
                method: 'POST',
                headers: { 'accept': '*/*', 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` },
            }).catch(() => { });

            // Login with new credentials
            const data = await api.auth.login(login.trim(), password);

            const token = data.access_token;
            if (!token) {
                throw new Error('No authentication token received');
            }

            const accountId = data.user?.id || login.trim();

            // Save credentials
            localStorage.setItem('rtx_last_login', String(accountId));
            localStorage.setItem('rtx_saved_username', login.trim());
            if (savePassword) {
                try { localStorage.setItem('rtx_saved_password', btoa(password)); } catch { }
            }

            // Set tokens
            const { setToken, setRefreshToken } = await import('../api/client');
            setToken(token);
            if (data.refresh_token) setRefreshToken(data.refresh_token);
            if (data.expires_at) localStorage.setItem('token_expires_at', data.expires_at);

            // Update store
            const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : undefined;
            useAppStore.getState().setAuthTokens(token, data.refresh_token, expiresAt);
            useAppStore.getState().setAuthenticated(true, String(accountId), token, data.refresh_token, expiresAt);

            // Save to saved accounts for Navigator panel
            const loginNum = parseInt(login.trim(), 10);
            if (!isNaN(loginNum)) {
                useAppStore.getState().addSavedAccount({
                    login: loginNum,
                    name: data.user?.username || '',
                    server: 'FlexyMarkets-Server',
                    isLive: true,
                    lastUsed: Date.now(),
                    password: savePassword ? btoa(password) : undefined,
                });
                useAppStore.getState().setActiveAccount(loginNum);
            }

            onClose();
            if (onLoginSuccess) {
                onLoginSuccess(String(accountId));
            } else {
                window.location.reload();
            }
        } catch (err: any) {
            console.error('[LoginDialog] Auth error:', err);
            setError(err.message || 'Authentication failed');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return ReactDOM.createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60" onClick={onClose} />

            {/* Dialog */}
            <div
                className="relative w-[420px] bg-[#2b2e3b] border border-[#555] rounded-lg shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Title Bar */}
                <div className="flex items-center justify-between bg-[#353847] px-3 py-2 border-b border-[#555]">
                    <div className="flex items-center gap-2">
                        <User size={16} className="text-blue-400" />
                        <span className="text-[13px] text-zinc-200 font-medium">Login</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <button className="p-1 hover:bg-white/10 rounded transition-colors" title="Help">
                            <HelpCircle size={14} className="text-zinc-400" />
                        </button>
                        <button onClick={onClose} className="p-1 hover:bg-red-500/80 rounded transition-colors" title="Close">
                            <X size={14} className="text-zinc-400 hover:text-white" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <form onSubmit={handleSubmit} className="px-5 py-4">
                    {/* Authorization Info */}
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-10 h-10 rounded-full bg-zinc-700/30 flex items-center justify-center flex-shrink-0">
                            <User size={22} className="text-blue-400" />
                        </div>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                            Authorization allows to get access to the trade account
                        </p>
                    </div>

                    {/* Login Field */}
                    <div className="flex items-center gap-3 mb-3">
                        <label className="text-[12px] text-zinc-400 w-20 text-right flex-shrink-0">Login:</label>
                        <input
                            ref={loginInputRef}
                            type="text"
                            value={login}
                            onChange={(e) => setLogin(e.target.value)}
                            className="flex-1 h-[28px] px-2 bg-[#1a1c26] border border-zinc-600/60 rounded text-[12px] text-zinc-100 font-mono outline-none focus:border-zinc-600 transition-colors"
                            placeholder="Account ID"
                            autoFocus
                        />
                    </div>

                    {/* Password Field */}
                    <div className="flex items-center gap-3 mb-3">
                        <label className="text-[12px] text-zinc-400 w-20 text-right flex-shrink-0">Password:</label>
                        <div className="flex-1 flex items-center gap-2">
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="flex-1 h-[28px] px-2 bg-[#1a1c26] border border-[#555] rounded text-[12px] text-zinc-100 font-mono outline-none focus:border-zinc-600 transition-colors"
                                placeholder="Password"
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                            />
                            <label className="flex items-center gap-1.5 cursor-pointer flex-shrink-0">
                                <input
                                    type="checkbox"
                                    checked={savePassword}
                                    onChange={(e) => setSavePassword(e.target.checked)}
                                    className="w-3.5 h-3.5 rounded border-zinc-500 bg-[#1a1c26] accent-blue-500"
                                />
                                <span className="text-[10px] text-zinc-400 whitespace-nowrap leading-tight">Save<br />password</span>
                            </label>
                        </div>
                    </div>

                    {/* Server Field */}
                    <div className="flex items-center gap-3 mb-4">
                        <label className="text-[12px] text-zinc-400 w-20 text-right flex-shrink-0">Server:</label>
                        <input
                            type="text"
                            value="FlexyMarkets-Server"
                            readOnly
                            className="flex-1 h-[28px] px-2 bg-[#1a1c26] border border-[#555] rounded text-[12px] text-zinc-100 outline-none transition-colors cursor-not-allowed opacity-80"
                        />
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="mb-3 px-2 py-1.5 bg-red-500/15 border border-red-500/30 rounded text-[11px] text-red-400">
                            {error}
                        </div>
                    )}

                    {/* Buttons */}
                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-6 h-[30px] bg-[#3a3e4f] hover:bg-[#4a4e5f] border border-[#555] rounded text-[12px] text-zinc-200 transition-colors disabled:opacity-50"
                        >
                            {loading ? 'Connecting...' : 'OK'}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={loading}
                            className="px-6 h-[30px] bg-[#3a3e4f] hover:bg-[#4a4e5f] border border-[#555] rounded text-[12px] text-zinc-200 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}
