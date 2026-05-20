/**
 * MT5-Style Login Dialog
 * Modal dialog for switching accounts / logging in
 * Matches the Flexy Market MT5 Login dialog styling
 */

import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useAppStore } from '../store/useAppStore';
import { api } from '../services/api';
import { API_V2_BASE_URL } from '../config/api';
import { brokerV2Api } from '../api/trade';
import type { BrokerServer } from '../types/api';
import { getStoredBrokerServer, persistBrokerServer } from '../services/brokerServers';
import { User, X, HelpCircle, ChevronDown } from 'lucide-react';

interface LoginDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onLoginSuccess?: (accountId: string) => void;
    initialLogin?: string;
    initialServer?: string;
}

export function LoginDialog({ isOpen, onClose, onLoginSuccess, initialLogin = '', initialServer }: LoginDialogProps) {
    const [login, setLogin] = useState('');
    const [password, setPassword] = useState('');
    const [brokers, setBrokers] = useState<BrokerServer[]>([]);
    const [selectedBroker, setSelectedBroker] = useState<BrokerServer | null>(null);
    const [brokerSearch, setBrokerSearch] = useState('');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const loginInputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Pre-fill with current account or provided initial login
    useEffect(() => {
        if (isOpen) {
            const accountId = initialLogin || useAppStore.getState().accountId || '';
            setLogin(accountId);
            setPassword('');
            setError(null);
            setBrokerSearch('');
            setTimeout(() => loginInputRef.current?.select(), 100);
        }
    }, [isOpen, initialLogin, initialServer]);

    // Fetch broker servers from API
    useEffect(() => {
        if (!isOpen) return;
        let isMounted = true;
        brokerV2Api.getServers()
            .then((servers) => {
                if (!isMounted) return;
                const enabled = servers.filter(s => s.enabled !== false);
                setBrokers(enabled);
                // Try to restore previously used broker
                const storedServer = getStoredBrokerServer();
                const match = enabled.find(s => s.server === storedServer || s.broker_id === storedServer);
                const defaultBroker = enabled.find(s => s.broker_id === 'broker_3') ?? enabled[0] ?? null;
                setSelectedBroker(match ?? defaultBroker);
            })
            .catch((err) => console.warn('[LoginDialog] Could not load broker servers:', err));
        return () => { isMounted = false; };
    }, [isOpen]);

    // Close dropdown on outside click
    useEffect(() => {
        if (!dropdownOpen) return;
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [dropdownOpen]);

    // Handle ESC key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (dropdownOpen) { setDropdownOpen(false); return; }
                onClose();
            }
        };
        if (isOpen) document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose, dropdownOpen]);

    const filteredBrokers = brokerSearch.trim()
        ? brokers.filter(b =>
            b.broker_name.toLowerCase().includes(brokerSearch.toLowerCase()) ||
            b.server.toLowerCase().includes(brokerSearch.toLowerCase()) ||
            b.broker_id.toLowerCase().includes(brokerSearch.toLowerCase())
        )
        : brokers;

    const handleSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!login.trim() || !password.trim()) {
            setError('Login and password are required');
            return;
        }
        if (!selectedBroker) {
            setError('Please select a broker server');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            // Logout current session (fire-and-forget)
            fetch(`${API_V2_BASE_URL}/auth/logout`, {
                method: 'POST',
                headers: { 'accept': '*/*', 'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}` },
            }).catch(() => { });

            // Persist broker selection
            persistBrokerServer(selectedBroker.server);

            const data = await api.auth.login(login.trim(), password, {
                broker_id: selectedBroker.broker_id,
                server: selectedBroker.server,
            });

            const token = data.access_token;
            if (!token) throw new Error('No authentication token received');

            const accountId = data.account_login ?? login.trim();

            localStorage.setItem('rtx_last_login', String(accountId));
            localStorage.setItem('rtx_saved_username', String(accountId));
            localStorage.removeItem('rtx_saved_password');

            const { setToken, setRefreshToken } = await import('../api/client');
            setToken(token);
            if (data.refresh_token) setRefreshToken(data.refresh_token);
            if (data.expires_at) localStorage.setItem('token_expires_at', data.expires_at);

            const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : undefined;
            useAppStore.getState().setAuthTokens(token, data.refresh_token, expiresAt);
            useAppStore.getState().setAuthenticated(true, String(accountId), token, data.refresh_token, expiresAt);

            const loginNum = parseInt(String(accountId), 10);
            if (!isNaN(loginNum)) {
                useAppStore.getState().addSavedAccount({
                    login: loginNum,
                    name: data.user?.username || data.username || '',
                    server: selectedBroker.server,
                    isLive: true,
                    lastUsed: Date.now(),
                });
                useAppStore.getState().setActiveAccount(loginNum);
            }

            onClose();
            if (onLoginSuccess) {
                onLoginSuccess(String(accountId));
            } else {
                if (!isNaN(loginNum)) {
                    const { bootstrapApp } = await import('../services/bootstrapApp');
                    bootstrapApp(loginNum).catch(() => window.location.reload());
                } else {
                    window.location.reload();
                }
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
                className="rtx-login-dialog relative w-[420px] bg-[#2b2e3b] border border-[#555] rounded-lg shadow-2xl"
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
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="flex-1 h-[28px] px-2 bg-[#1a1c26] border border-[#555] rounded text-[12px] text-zinc-100 font-mono outline-none focus:border-zinc-600 transition-colors"
                            placeholder="Password"
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                        />
                    </div>

                    {/* Server / Broker Dropdown */}
                    <div className="flex items-start gap-3 mb-4">
                        <label className="text-[12px] text-zinc-400 w-20 text-right flex-shrink-0 mt-1.5">Server:</label>
                        <div className="flex-1 relative" ref={dropdownRef}>
                            {/* Trigger button */}
                            <button
                                type="button"
                                onClick={() => setDropdownOpen(o => !o)}
                                className="w-full h-[28px] px-2 bg-[#1a1c26] border border-[#555] rounded text-[12px] text-zinc-100 outline-none focus:border-zinc-600 transition-colors flex items-center justify-between gap-1 text-left"
                            >
                                <span className="truncate flex-1">
                                    {selectedBroker
                                        ? <><span className="text-zinc-200">{selectedBroker.broker_name}</span><span className="text-zinc-500 ml-1">({selectedBroker.server})</span></>
                                        : <span className="text-zinc-500">Select broker server…</span>
                                    }
                                </span>
                                <ChevronDown size={12} className={`text-zinc-400 flex-shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {/* Dropdown panel */}
                            {dropdownOpen && (
                                <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-[#1e2030] border border-zinc-600/60 rounded shadow-xl max-h-[240px] flex flex-col">
                                    {/* Search */}
                                    <div className="px-2 pt-2 pb-1 border-b border-zinc-700/50">
                                        <input
                                            autoFocus
                                            type="text"
                                            value={brokerSearch}
                                            onChange={e => setBrokerSearch(e.target.value)}
                                            placeholder="Search broker…"
                                            className="w-full h-[24px] px-2 bg-[#131520] border border-zinc-600/40 rounded text-[11px] text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
                                            onClick={e => e.stopPropagation()}
                                        />
                                    </div>
                                    {/* List */}
                                    <div className="overflow-y-auto flex-1">
                                        {filteredBrokers.length === 0 ? (
                                            <div className="py-4 text-center text-zinc-600 text-[11px]">No brokers found</div>
                                        ) : (
                                            filteredBrokers.map(b => (
                                                <button
                                                    key={b.id}
                                                    type="button"
                                                    onClick={() => { setSelectedBroker(b); setDropdownOpen(false); setBrokerSearch(''); }}
                                                    className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-zinc-700/60 transition-colors flex flex-col gap-0.5 ${selectedBroker?.id === b.id ? 'bg-zinc-700/40 text-white' : 'text-zinc-300'}`}
                                                >
                                                    <span className="font-medium truncate">{b.broker_name}</span>
                                                    <span className="text-zinc-500 text-[10px] font-mono truncate">{b.server}</span>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
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
