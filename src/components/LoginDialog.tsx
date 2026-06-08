/**
 * MT5-Style Login Dialog
 * Modal dialog for switching accounts / logging in
 * Matches the Flexy Market MT5 Login dialog styling
 */

import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useAppStore } from '../store/useAppStore';
import { authV2Api } from '../api/trade';
import { normalizeBrokerServerUrl, updateDynamicUrls, BROKER_DISCOVERY_URL } from '../config/api';
import {
    normalizeBrokerInfoForTarget,
    resolveBrokerBackendUrl,
    resolveBrokerExtApiUrl,
} from '../config/backendTarget.js';
import { extractBrokerDiscoveryList } from '../services/brokerDiscovery';
import { persistBrokerSessionDiscovery } from '../services/brokerSession';
import { User, X, HelpCircle, ChevronDown } from 'lucide-react';

interface BrokerServerItem {
    broker_id: string;
    broker_name: string;
    server?: string;
    server_ip?: string;
    server_port?: number;
    server_url?: string;
    backend_url?: string;
    market_api_url?: string;
    ws_url?: string;
    feed_url?: string;
    feed_ws_url?: string;
    feed_status_url?: string;
    logo_url: string;
    region?: string;
}

interface LoginDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onLoginSuccess?: (accountId: string) => void;
    initialLogin?: string;
    initialServer?: string;
}

const buildBrokerApiV2BaseUrl = (value: string): string => `${normalizeBrokerServerUrl(value).replace(/\/$/, '')}/api/v2`;
const brokerServersDiscoveryUrl = `${BROKER_DISCOVERY_URL}/api/v2/broker/servers`;
const DEFAULT_BROKER_ID = String(import.meta.env.VITE_BROKER_ID || 'testorrnn').trim();

const isAbortError = (err: unknown): boolean =>
    err instanceof DOMException
        ? err.name === 'AbortError'
        : Boolean(err && typeof err === 'object' && 'name' in err && err.name === 'AbortError');

const getErrorMessage = (err: unknown, fallback: string): string =>
    err instanceof Error ? err.message : fallback;

export function LoginDialog({ isOpen, onClose, onLoginSuccess, initialLogin = '', initialServer }: LoginDialogProps) {
    const [login, setLogin] = useState('');
    const [password, setPassword] = useState('');
    const [brokerList, setBrokerList] = useState<BrokerServerItem[]>([]);
    const [selectedBroker, setSelectedBroker] = useState<BrokerServerItem | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [healthStatus, setHealthStatus] = useState<'checking' | 'online' | 'offline' | null>(null);
    const healthAbortRef = useRef<AbortController | null>(null);
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
            setSearchQuery('');
            setTimeout(() => loginInputRef.current?.select(), 100);
        }
    }, [isOpen, initialLogin]);

    const runHealthCheck = async (serverUrl: string) => {
        if (healthAbortRef.current) {
            healthAbortRef.current.abort();
        }
        const controller = new AbortController();
        healthAbortRef.current = controller;

        setHealthStatus('checking');

        const timeoutId = setTimeout(() => {
            controller.abort();
        }, 3000);

        try {
            const cleanUrl = normalizeBrokerServerUrl(serverUrl).replace(/\/$/, '');
            const response = await fetch(`${cleanUrl}/health`, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (response.ok) {
                setHealthStatus('online');
            } else {
                setHealthStatus('offline');
            }
        } catch (err: unknown) {
            clearTimeout(timeoutId);
            if (!isAbortError(err)) {
                setHealthStatus('offline');
            }
        }
    };

    const handleSelectBroker = (item: BrokerServerItem) => {
        const normalizedBroker = normalizeBrokerInfoForTarget(item) as BrokerServerItem;
        const normalizedServerUrl = resolveBrokerBackendUrl(normalizedBroker);
        setSelectedBroker({
            ...normalizedBroker,
            server_url: normalizedServerUrl,
        });
        setSearchQuery(item.broker_name);
        setDropdownOpen(false);
        runHealthCheck(normalizedServerUrl);
    };

    // Fetch broker servers from API
    useEffect(() => {
        if (!isOpen) return;
        let isMounted = true;
        fetch(brokerServersDiscoveryUrl)
            .then(res => res.json())
            .then((payload: unknown) => {
                if (!isMounted) return;
                const data = extractBrokerDiscoveryList(payload) as BrokerServerItem[];
                setBrokerList(data);

                // Try to restore previously used broker or initialServer, or fallback to 'testorrnn'
                const savedBrokerId = initialServer || localStorage.getItem('broker_id') || DEFAULT_BROKER_ID;
                const savedBroker = data.find(b => b.broker_id === savedBrokerId || b.server === savedBrokerId || b.server_url === savedBrokerId);
                if (savedBroker) {
                    setSelectedBroker({
                        ...(normalizeBrokerInfoForTarget(savedBroker) as BrokerServerItem),
                        server_url: resolveBrokerBackendUrl(savedBroker),
                    });
                    setSearchQuery(savedBroker.broker_name);
                    runHealthCheck(resolveBrokerExtApiUrl(savedBroker));
                } else if (data.length > 0) {
                    setSelectedBroker({
                        ...(normalizeBrokerInfoForTarget(data[0]) as BrokerServerItem),
                        server_url: resolveBrokerBackendUrl(data[0]),
                    });
                    setSearchQuery(data[0].broker_name);
                    runHealthCheck(resolveBrokerExtApiUrl(data[0]));
                }
            })
            .catch((err) => console.warn('[LoginDialog] Could not load broker servers:', err));
        return () => { isMounted = false; };
    }, [isOpen, initialServer]);

    // Close dropdown on outside click
    useEffect(() => {
        if (!dropdownOpen) return;
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
                if (selectedBroker) {
                    setSearchQuery(selectedBroker.broker_name);
                }
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [dropdownOpen, selectedBroker]);

    // Handle ESC key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (dropdownOpen) {
                    setDropdownOpen(false);
                    if (selectedBroker) {
                        setSearchQuery(selectedBroker.broker_name);
                    }
                    return;
                }
                onClose();
            }
        };
        if (isOpen) document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose, dropdownOpen, selectedBroker]);

    // Clean up health probe abort ref on unmount
    useEffect(() => {
        return () => {
            if (healthAbortRef.current) {
                healthAbortRef.current.abort();
            }
        };
    }, []);

    const filteredBrokers = brokerList.filter(b =>
        String(b.broker_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(b.broker_id || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(b.region || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

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
            // Save selected broker details before login so the request targets the broker backend.
            const submitBroker = normalizeBrokerInfoForTarget(selectedBroker) as BrokerServerItem;
            const brokerServerUrl = resolveBrokerBackendUrl(submitBroker);
            const brokerExtApiUrl = resolveBrokerExtApiUrl(submitBroker);
            persistBrokerSessionDiscovery({
                ...submitBroker,
                broker_id: submitBroker.broker_id,
                backend_url: brokerServerUrl,
                market_api_url: brokerExtApiUrl,
                server_url: brokerServerUrl,
            });
            updateDynamicUrls();

            const data = await authV2Api.login({
                username: login.trim(),
                password,
                broker_id: submitBroker.broker_id,
            }, {
                baseUrl: buildBrokerApiV2BaseUrl(brokerExtApiUrl),
                skipDynamicUrl: true,
            });

            const token = data.access_token || data.token;
            if (!token) throw new Error('No authentication token received');

            persistBrokerSessionDiscovery({
                ...data,
                access_token: token,
                broker_id: data.broker_id || submitBroker.broker_id,
                backend_url: data.backend_url || brokerServerUrl,
                market_api_url: data.market_api_url || brokerExtApiUrl,
                server_url: data.server_url || data.broker_server || brokerServerUrl,
                ws_url: data.ws_url || submitBroker.ws_url,
                feed_url: data.feed_url || submitBroker.feed_url || submitBroker.feed_ws_url,
                feed_ws_url: data.feed_ws_url || submitBroker.feed_ws_url,
                feed_status_url: data.feed_status_url || submitBroker.feed_status_url,
                logo_url: submitBroker.logo_url,
            });
            updateDynamicUrls();

            const accountId = data.account_login ?? login.trim();

            localStorage.setItem('rtx_last_login', String(accountId));
            localStorage.setItem('rtx_saved_username', String(accountId));
            localStorage.removeItem('rtx_saved_password');

            const { setToken, setRefreshToken } = await import('../api/client');
            setToken(token);
            if (data.refresh_token) setRefreshToken(data.refresh_token);

            let expiresAt: number | undefined = undefined;
            if (data.expires_at) {
                if (typeof data.expires_at === 'number') {
                    expiresAt = data.expires_at < 100000000000 ? data.expires_at * 1000 : data.expires_at;
                } else if (/^\d+$/.test(data.expires_at)) {
                    const num = parseInt(data.expires_at, 10);
                    expiresAt = num < 100000000000 ? num * 1000 : num;
                } else {
                    expiresAt = Date.parse(data.expires_at);
                }
                localStorage.setItem('token_expires_at', String(expiresAt));
            }

            useAppStore.getState().setAuthTokens(token, data.refresh_token, expiresAt);
            useAppStore.getState().setAuthenticated(true, String(accountId), token, data.refresh_token, expiresAt);

            const loginNum = parseInt(String(accountId), 10);
            if (!isNaN(loginNum)) {
                useAppStore.getState().addSavedAccount({
                    login: loginNum,
                    name: data.user?.username || data.username || '',
                    server: submitBroker.broker_name || '',
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
        } catch (err: unknown) {
            console.error('[LoginDialog] Auth error:', err);
            setError(getErrorMessage(err, 'Authentication failed'));
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
                className="rtx-login-dialog relative w-[420px] bg-[#2b2e3b] border border-[#555] rounded-lg shadow-2xl overflow-visible"
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
                            <div className="flex items-center w-full h-[28px] bg-[#1a1c26] border border-[#555] rounded text-[12px] text-zinc-100 focus-within:border-zinc-600 transition-colors relative">
                                {selectedBroker?.logo_url && (
                                    <img
                                        src={selectedBroker.logo_url}
                                        alt=""
                                        className="absolute left-2 top-1/2 -translate-y-1/2 w-[16px] h-[16px] rounded object-contain z-10"
                                    />
                                )}
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => {
                                        setSearchQuery(e.target.value);
                                        setDropdownOpen(true);
                                    }}
                                    onFocus={() => setDropdownOpen(true)}
                                    className="flex-1 h-full bg-transparent text-[12px] text-zinc-100 outline-none border-none"
                                    style={{
                                        paddingLeft: selectedBroker?.logo_url ? '28px' : '8px',
                                        paddingRight: '32px',
                                    }}
                                    placeholder="Search broker..."
                                />
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
                                    {healthStatus === 'checking' && (
                                        <span className="w-2 h-2 rounded-full bg-yellow-500 shadow-[0_0_6px_#eab308]" />
                                    )}
                                    {healthStatus === 'online' && (
                                        <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_#22c55e]" />
                                    )}
                                    {healthStatus === 'offline' && (
                                        <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_6px_#ef4444]" />
                                    )}
                                    <ChevronDown size={12} className={`text-zinc-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                                </div>
                            </div>

                            {/* Dropdown panel */}
                            {dropdownOpen && (
                                <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-[#1e2030] border border-zinc-600/60 rounded shadow-xl max-h-[180px] overflow-y-auto flex flex-col font-sans">
                                    {filteredBrokers.length === 0 ? (
                                        <div className="py-3 px-3 text-zinc-500 text-[11px]">No brokers found</div>
                                    ) : (
                                        filteredBrokers.map(item => (
                                            <button
                                                key={item.broker_id}
                                                type="button"
                                                onMouseDown={() => handleSelectBroker(item)}
                                                className={`w-full text-left px-3 py-2 text-[11px] hover:bg-zinc-700/60 transition-colors flex items-center justify-between gap-2 ${selectedBroker?.broker_id === item.broker_id ? 'bg-zinc-700/40 text-white font-semibold' : 'text-zinc-300'}`}
                                            >
                                                <div className="flex items-center gap-2 truncate">
                                                    {item.logo_url ? (
                                                        <img
                                                            src={item.logo_url}
                                                            alt=""
                                                            className="w-[16px] h-[16px] rounded object-contain flex-shrink-0"
                                                        />
                                                    ) : (
                                                        <div className="w-[16px] h-[16px] rounded bg-white/5 flex items-center justify-center text-[10px] text-zinc-500 flex-shrink-0">
                                                            B
                                                        </div>
                                                    )}
                                                    <span className="truncate">{item.broker_name}</span>
                                                </div>
                                                {item.region && (
                                                    <span className="text-[9px] text-green-400 bg-green-500/10 border border-green-500/20 px-1 py-0.5 rounded font-bold uppercase flex-shrink-0">
                                                        {item.region}
                                                    </span>
                                                )}
                                            </button>
                                        ))
                                    )}
                                </div>
                            )}

                            {healthStatus === 'offline' && (
                                <div className="mt-1.5 text-red-400 text-[11px] flex items-center gap-1">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                        <line x1="12" y1="9" x2="12" y2="13" />
                                        <line x1="12" y1="17" x2="12.01" y2="17" />
                                    </svg>
                                    <span>Broker temporarily unavailable</span>
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
