import { useUiTranslation } from '../hooks/useUiTranslation';
/**
 * Account login dialog shared by the web and desktop terminals.
 */

import React, { useState, useEffect, useRef, useCallback, useId } from 'react';
import ReactDOM from 'react-dom';
import { useAppStore } from '../store/useAppStore';
import { authV2Api } from '../api/trade';
import { removeToken, setRefreshToken, setToken } from '../api/client';
import { normalizeBrokerServerUrl, updateDynamicUrls, toLocalDevProxyUrl } from '../config/api';
import {
    getBackendTarget,
    isConfiguredBrokerEndpoint,
    isDesktopBackendTarget,
    normalizeBrokerInfoForTarget,
    resolveBrokerBackendUrl,
    resolveBrokerExtApiUrl,
} from '../config/backendTarget.js';
import { extractBrokerDiscoveryList, getDirectoryBrokerServerUrl, isDirectoryBrokerSelectable } from '../services/brokerDiscovery';
import { loadAppBrokerDirectory } from '../services/brokerDirectory';
import { persistBrokerSessionDiscovery } from '../services/brokerSession';
import {
    applyBrokerChrome,
    loadBrokerPresentation,
    mergeBrokerPresentation,
} from '../services/brokerPresentation';
import { pickDiscoveryBroker, type BrokerServerItem } from './WelcomeTerminal';
import { User, X, ChevronDown, LockKeyhole, LoaderCircle, Server, AlertCircle } from 'lucide-react';
import '../styles/login-dialog.css';
import { useSavedLogin } from '../hooks/useSavedLogin';

interface LoginDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onLoginSuccess?: (accountId: string) => void;
    initialLogin?: string;
    initialServer?: string;
    reason?: 'trade';
    /** Prevent this broker-branded terminal from authenticating against another tenant. */
    lockedBrokerId?: string;
    /** Trusted policy display label; never used as the broker identity. */
    lockedBrokerDisplayName?: string;
}

const buildBrokerApiV2BaseUrl = (value: string): string => `${normalizeBrokerServerUrl(value).replace(/\/$/, '')}/api/v2`;

const isAbortError = (err: unknown): boolean =>
    err instanceof DOMException
        ? err.name === 'AbortError'
        : Boolean(err && typeof err === 'object' && 'name' in err && err.name === 'AbortError');

const getErrorMessage = (err: unknown, fallback: string): string =>
    err instanceof Error ? err.message : fallback;

const normalizeBrokerId = (value: unknown): string => String(value ?? '').trim().toLowerCase();

const buildLockedRuntimeBroker = (brokerId: string, displayName?: string): BrokerServerItem => {
    const backendUrl = getBackendTarget();
    return normalizeBrokerInfoForTarget({
        broker_id: brokerId,
        broker_name: displayName || brokerId,
        backend_url: backendUrl,
        market_api_url: backendUrl,
        server_url: backendUrl,
        logo_url: '',
    }) as BrokerServerItem;
};

export function LoginDialog({
    isOpen,
    onClose,
    onLoginSuccess,
    initialLogin = '',
    initialServer,
    reason,
    lockedBrokerId,
    lockedBrokerDisplayName,
}: LoginDialogProps) {
    const tr = useUiTranslation();
    const dialogId = useId();
    const tradeLogin = reason === 'trade';
    const isDesktop = isDesktopBackendTarget();
    const [directoryLoading, setDirectoryLoading] = useState(false);
    const submittingRef = useRef(false);
    const [brokerList, setBrokerList] = useState<BrokerServerItem[]>([]);
    const [selectedBroker, setSelectedBroker] = useState<BrokerServerItem | null>(null);
    const { login, password, setLogin, setPassword, savePassword, setSavePassword, available: passwordSavingAvailable, restoring, storageError, persistPassword } = useSavedLogin(
        isOpen,
        initialLogin || useAppStore.getState().accountId || '',
        selectedBroker ? {
            brokerId: selectedBroker.broker_id,
            serverUrl: isDesktop ? getDirectoryBrokerServerUrl(selectedBroker) : resolveBrokerExtApiUrl(selectedBroker),
        } : null,
    );
    const [searchQuery, setSearchQuery] = useState('');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [healthStatus, setHealthStatus] = useState<'checking' | 'online' | 'offline' | null>(null);
    const healthAbortRef = useRef<AbortController | null>(null);
    const presentationAbortRef = useRef<AbortController | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const loginInputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        const previousFocus = document.activeElement as HTMLElement | null;
        return () => { previousFocus?.focus(); };
    }, [isOpen]);
    const loginRequestGenerationRef = useRef(0);
    const isMountedRef = useRef(true);
    const isOpenRef = useRef(isOpen);
    const lockedBrokerKey = normalizeBrokerId(lockedBrokerId);

    isOpenRef.current = isOpen;

    const invalidatePendingLogin = useCallback(() => {
        loginRequestGenerationRef.current += 1;
    }, []);

    const closeDialog = useCallback(() => {
        invalidatePendingLogin();
        setLoading(false);
        onClose();
    }, [invalidatePendingLogin, onClose]);

    // Pre-fill with current account or provided initial login
    useEffect(() => {
        if (!isOpen) invalidatePendingLogin();
        if (isOpen) {
            setError(null);
            setSearchQuery('');
            setTimeout(() => loginInputRef.current?.select(), 100);
        }
    }, [isOpen, initialLogin, invalidatePendingLogin]);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            invalidatePendingLogin();
        };
    }, [invalidatePendingLogin]);

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
            const healthUrl = `${cleanUrl}${isDesktop ? '/health' : '/api/v2/time'}`;
            if (!isConfiguredBrokerEndpoint(healthUrl)) throw new Error('Broker health URL does not match this deployment.');
            const response = await fetch(toLocalDevProxyUrl(healthUrl), {
                signal: controller.signal, redirect: 'error', credentials: 'omit',
            });
            clearTimeout(timeoutId);
            if (healthAbortRef.current !== controller || controller.signal.aborted) return;
            if (response.ok) {
                setHealthStatus('online');
            } else {
                setHealthStatus('offline');
            }
        } catch (err: unknown) {
            clearTimeout(timeoutId);
            if (healthAbortRef.current === controller && (!isAbortError(err) || controller.signal.aborted)) {
                setHealthStatus('offline');
            }
        }
    };

    const handleSelectBroker = (item: BrokerServerItem) => {
        if (submittingRef.current || (isDesktop && !isDirectoryBrokerSelectable(item))) return;
        setError(null);
        if (lockedBrokerKey && normalizeBrokerId(item.broker_id) !== lockedBrokerKey) return;
        const normalizedBroker = normalizeBrokerInfoForTarget(item) as BrokerServerItem;
        const normalizedServerUrl = isDesktop ? getDirectoryBrokerServerUrl(item) : resolveBrokerBackendUrl(normalizedBroker);
        if (isDesktop && (selectedBroker?.broker_id !== item.broker_id || getDirectoryBrokerServerUrl(selectedBroker) !== normalizedServerUrl)) setPassword('');
        const nextBroker = {
            ...normalizedBroker,
            server_url: normalizedServerUrl,
            ...(isDesktop ? { backend_url: normalizedServerUrl, market_api_url: normalizedServerUrl } : {}),
        };
        setSelectedBroker(nextBroker);
        setSearchQuery(item.broker_name);
        setDropdownOpen(false);
        runHealthCheck(normalizedServerUrl);
        if (!isDesktop) return;

        applyBrokerChrome({
            brokerId: nextBroker.broker_id,
            brokerName: nextBroker.broker_name,
            logoUrl: nextBroker.logo_url,
            themeColor: nextBroker.theme_color,
        });
        presentationAbortRef.current?.abort();
        const controller = new AbortController();
        presentationAbortRef.current = controller;
        void loadBrokerPresentation({
            broker_id: nextBroker.broker_id,
            server_url: normalizedServerUrl,
        }, controller.signal).then((presentation) => {
            if (!presentation || controller.signal.aborted) return;
            const presentationBroker = mergeBrokerPresentation(nextBroker, presentation) as BrokerServerItem;
            setSelectedBroker(current => {
                if (!current || current.broker_id !== presentationBroker.broker_id) return current;
                return presentationBroker;
            });
            applyBrokerChrome({
                brokerId: presentationBroker.broker_id,
                brokerName: presentationBroker.broker_name,
                logoUrl: presentationBroker.logo_url,
                themeColor: presentationBroker.theme_color,
            });
        }).catch(() => undefined);
    };

    // Fetch broker servers from API
    useEffect(() => {
        if (!isOpen) return;
        let isMounted = true;
        setDirectoryLoading(true);
        const lockedFallback = lockedBrokerKey
            ? buildLockedRuntimeBroker(String(lockedBrokerId), lockedBrokerDisplayName)
            : null;
        if (lockedFallback) {
            setBrokerList([lockedFallback]);
            setSelectedBroker(lockedFallback);
            setSearchQuery(lockedFallback.broker_name);
            setDropdownOpen(false);
            runHealthCheck(resolveBrokerExtApiUrl(lockedFallback));
        }
        loadAppBrokerDirectory({ forceRefresh: true, desktop: isDesktop })
            .then((payload: unknown) => {
                if (!isMounted) return;
                const discovered = extractBrokerDiscoveryList(payload) as BrokerServerItem[];
                const data = lockedBrokerKey
                    ? discovered.filter(item => normalizeBrokerId(item.broker_id) === lockedBrokerKey)
                    : discovered;
                if (lockedBrokerKey && lockedBrokerDisplayName) {
                    data.forEach((item) => { item.broker_name = lockedBrokerDisplayName; });
                }
                if (lockedBrokerKey && data.length === 0 && lockedFallback) data.push(lockedFallback);
                setBrokerList(data);

                const savedBrokerId = lockedBrokerId || initialServer || localStorage.getItem('broker_id') || localStorage.getItem('rtx_broker_id') || '';
                const selectedDiscoveryBroker = pickDiscoveryBroker(data, {
                    isDesktopBrokerSelection: isDesktopBackendTarget(),
                    savedBrokerId,
                });
                if (selectedDiscoveryBroker) {
                    handleSelectBroker(selectedDiscoveryBroker);
                }
            })
            .catch(() => {
                if (isMounted) setError('Broker servers are unavailable. Please reopen this dialog to retry.');
            })
            .finally(() => { if (isMounted) setDirectoryLoading(false); });
        return () => { isMounted = false; healthAbortRef.current?.abort(); presentationAbortRef.current?.abort(); };
    }, [isOpen, initialServer, lockedBrokerDisplayName, lockedBrokerId, lockedBrokerKey]);

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
                closeDialog();
            }
        };
        if (isOpen) document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, closeDialog, dropdownOpen, selectedBroker]);

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
        if (submittingRef.current) return;
        if (restoring) return;
        if (isDesktop && (directoryLoading || !isDirectoryBrokerSelectable(selectedBroker) || healthStatus !== 'online')) {
            setError('Select an available broker server and wait for the server check.');
            return;
        }
        if (!login.trim() || !password.trim()) {
            setError('Login and password are required');
            return;
        }
        if (!selectedBroker) {
            setError('Please select a broker server');
            return;
        }
        if (lockedBrokerKey && normalizeBrokerId(selectedBroker.broker_id) !== lockedBrokerKey) {
            setError('This terminal only accepts accounts for its configured broker.');
            return;
        }

        submittingRef.current = true;
        setLoading(true);
        setError(null);
        const requestGeneration = ++loginRequestGenerationRef.current;
        const isCurrentRequest = () => (
            requestGeneration === loginRequestGenerationRef.current
            && isMountedRef.current
            && isOpenRef.current
        );

        try {
            // Save selected broker details before login so the request targets the broker backend.
            const submitBroker = normalizeBrokerInfoForTarget(selectedBroker) as BrokerServerItem;
            const brokerServerUrl = isDesktop ? getDirectoryBrokerServerUrl(selectedBroker) : resolveBrokerBackendUrl(submitBroker);
            const brokerExtApiUrl = isDesktop ? brokerServerUrl : resolveBrokerExtApiUrl(submitBroker);
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
                persistSession: false,
            });
            if (!isCurrentRequest()) return;

            if (lockedBrokerKey && data.broker_id && normalizeBrokerId(data.broker_id) !== lockedBrokerKey) {
                removeToken();
                useAppStore.getState().logout();
                throw new Error('The account belongs to a different broker.');
            }

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
                theme_color: submitBroker.theme_color,
            });
            updateDynamicUrls();

            const accountId = data.account_login ?? login.trim();

            try {
                await persistPassword({ brokerId: submitBroker.broker_id, serverUrl: brokerExtApiUrl }, String(accountId), password);
            } catch {
                throw new Error('Unable to save the password. Turn off Save password to log in without saving it.');
            }
            if (!isCurrentRequest()) return;

            localStorage.setItem('rtx_last_login', String(accountId));
            localStorage.setItem('rtx_saved_username', String(accountId));
            localStorage.removeItem('rtx_saved_password');

            setToken(token);
            if (data.refresh_token) {
                setRefreshToken(data.refresh_token);
                sessionStorage.removeItem('refresh_token');
            } else {
                localStorage.removeItem('refresh_token');
                sessionStorage.removeItem('refresh_token');
            }

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
                sessionStorage.removeItem('token_expires_at');
            } else {
                localStorage.removeItem('token_expires_at');
                sessionStorage.removeItem('token_expires_at');
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
            }
        } catch (err: unknown) {
            if (!isCurrentRequest()) return;
            console.error('[LoginDialog] Auth error:', err);
            setError(getErrorMessage(err, 'Authentication failed'));
        } finally {
            submittingRef.current = false;
            if (isCurrentRequest()) setLoading(false);
        }
    };

    if (!isOpen) return null;

    const serverStatusLabel = directoryLoading
        ? 'Loading broker servers...'
        : healthStatus === 'checking' ? 'Checking server...'
            : healthStatus === 'online' ? 'Server online'
                : healthStatus === 'offline' ? 'Server unavailable' : null;

    return ReactDOM.createPortal(
        <div className="rtx-login-layer">
            <div className="rtx-login-backdrop" onClick={closeDialog} />

            {/* Dialog */}
            <div
                role="dialog"
                ref={dialogRef}
                aria-modal="true"
                aria-labelledby={`${dialogId}-title`}
                aria-describedby={`${dialogId}-description`}
                className="rtx-login-dialog rtx-login-dialog--polished"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={event => {
                    if (event.key !== 'Tab') return;
                    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') || []);
                    const first = controls[0];
                    const last = controls[controls.length - 1];
                    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
                }}
            >
                <header className="rtx-login-header">
                    <div className="rtx-login-heading">
                        <div className="rtx-login-mark" aria-hidden="true">
                            <User size={20} strokeWidth={2} />
                        </div>
                        <div>
                            <h2 id={`${dialogId}-title`} className="rtx-dialog-title rtx-login-title">{tr(tradeLogin ? "Log in to trade" : "Login")}</h2>
                            {!tradeLogin && <p id={`${dialogId}-description`} className="rtx-login-description">{tr("Access your trading account.")}</p>}
                        </div>
                    </div>
                    <button type="button" onClick={closeDialog} className="rtx-login-close" aria-label={tr("Close")} title={tr("Close")}>
                        <X size={16} aria-hidden="true" />
                    </button>
                </header>

                <form onSubmit={handleSubmit} className="rtx-login-form" aria-busy={loading}>
                    {tradeLogin && <p id={`${dialogId}-description`} className="rtx-login-description rtx-login-trade-notice">{tr("Log in to your trading account to place an order. You can continue viewing charts and prices without logging in. No order has been placed.")}</p>}

                    {isDesktop && (
                        <div className="rtx-login-field">
                            <div className="rtx-login-field-heading">
                                <label htmlFor={`${dialogId}-server`} className="rtx-login-label text-[14px] leading-5 font-medium">{tr("Server")}</label>
                                {serverStatusLabel && <span role="status" className="rtx-login-status" data-status={directoryLoading ? 'checking' : healthStatus}>{tr(serverStatusLabel)}</span>}
                            </div>
                            <div className="rtx-login-control">
                                <Server size={17} className="rtx-login-field-icon" aria-hidden="true" />
                                <select
                                    id={`${dialogId}-server`}
                                    value={selectedBroker?.broker_id || ''}
                                    disabled={loading || directoryLoading}
                                    onChange={event => {
                                        const broker = brokerList.find(item => item.broker_id === event.target.value);
                                        if (broker) handleSelectBroker(broker);
                                    }}
                                    className="rtx-login-input rtx-login-select"
                                >
                                    <option value="" disabled>{tr(directoryLoading ? "Loading broker servers..." : "Select broker server")}</option>
                                    {brokerList.map(broker => (
                                        <option key={broker.broker_id} value={broker.broker_id} disabled={!isDirectoryBrokerSelectable(broker)}>
                                            {broker.broker_name}{!isDirectoryBrokerSelectable(broker) ? ` (${tr("Unavailable")})` : ''}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown size={16} className="rtx-login-select-chevron" aria-hidden="true" />
                            </div>
                        </div>
                    )}

                    {/* Login Field */}
                    <div className="rtx-login-field">
                        <label htmlFor={`${dialogId}-account`} className="rtx-login-label text-[14px] leading-5 font-medium">{tr("Account ID")}</label>
                        <div className="rtx-login-control">
                            <User size={17} className="rtx-login-field-icon" aria-hidden="true" />
                            <input
                                id={`${dialogId}-account`}
                                name="username"
                                autoComplete="username"
                                autoCapitalize="none"
                                spellCheck={false}
                                disabled={loading || (isDesktop && (directoryLoading || healthStatus !== 'online'))}
                                ref={loginInputRef}
                                type="text"
                                value={login}
                                onChange={(e) => setLogin(e.target.value)}
                                className="rtx-login-input"
                                placeholder={tr("Account ID")}
                                autoFocus
                            />
                        </div>
                    </div>

                    {/* Password Field */}
                    <div className="rtx-login-field">
                        <label htmlFor={`${dialogId}-password`} className="rtx-login-label text-[14px] leading-5 font-medium">{tr("Password")}</label>
                        <div className="rtx-login-control">
                            <LockKeyhole size={17} className="rtx-login-field-icon" aria-hidden="true" />
                            <input
                                id={`${dialogId}-password`}
                                name="account-key"
                                autoComplete="off"
                                spellCheck={false}
                                autoCorrect="off"
                                autoCapitalize="none"
                                disabled={loading || (isDesktop && (directoryLoading || healthStatus !== 'online'))}
                                type="text"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="rtx-login-input rtx-secret-input"
                                placeholder={tr("Password")}
                            />
                        </div>
                    </div>

                    {/* Server / Broker Dropdown */}
                    {!isDesktop && <div className="rtx-login-field">
                        <div className="rtx-login-field-heading">
                            <label htmlFor={`${dialogId}-server`} className="rtx-login-label text-[14px] leading-5 font-medium">{tr("Server")}</label>
                            {serverStatusLabel && <span role="status" className="rtx-login-status" data-status={directoryLoading ? 'checking' : healthStatus}>{tr(serverStatusLabel)}</span>}
                        </div>
                        <div ref={dropdownRef}>
                            <div className="rtx-login-control">
                                {selectedBroker?.logo_url ? (
                                    <img
                                        src={selectedBroker.logo_url}
                                        alt=""
                                        className="rtx-login-broker-logo"
                                    />
                                ) : <Server size={17} className="rtx-login-field-icon" aria-hidden="true" />}
                                <input
                                    id={`${dialogId}-server`}
                                    type="text"
                                    autoComplete="off"
                                    disabled={loading || directoryLoading}
                                    value={searchQuery}
                                    onChange={(e) => {
                                        if (lockedBrokerKey) return;
                                        setSearchQuery(e.target.value);
                                        setDropdownOpen(true);
                                    }}
                                    onFocus={() => { if (!lockedBrokerKey) setDropdownOpen(true); }}
                                    readOnly={Boolean(lockedBrokerKey)}
                                    className="rtx-login-input rtx-login-server-input"
                                    placeholder={tr("Search broker...")}
                                    aria-label="Broker server"
                                    aria-readonly={Boolean(lockedBrokerKey)}
                                />
                                {!lockedBrokerKey && <ChevronDown size={16} className={`rtx-login-select-chevron ${dropdownOpen ? 'rotate-180' : ''}`} aria-hidden="true" />}
                            </div>

                            {/* Dropdown panel */}
                            {dropdownOpen && !lockedBrokerKey && (
                                <div className="rtx-login-brokers">
                                    {filteredBrokers.length === 0 ? (
                                        <div className="rtx-login-brokers-empty">{tr("No brokers found")}</div>
                                    ) : (
                                        filteredBrokers.map(item => (
                                            <button
                                                key={item.broker_id}
                                                type="button"
                                                onClick={() => handleSelectBroker(item)}
                                                disabled={loading}
                                                className="rtx-login-broker-option"
                                                data-selected={selectedBroker?.broker_id === item.broker_id}
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
                                                    <span className="rtx-login-broker-region">
                                                        {item.region}
                                                    </span>
                                                )}
                                            </button>
                                        ))
                                    )}
                                </div>
                            )}

                            {healthStatus === 'offline' && (
                                <div className="rtx-login-offline">
                                    <AlertCircle size={14} aria-hidden="true" />
                                    <span>{tr("Broker temporarily unavailable")}</span>
                                </div>
                            )}
                        </div>
                    </div>}

                    <label className="rtx-login-save-password">
                        <input
                            type="checkbox"
                            name="savePassword"
                            checked={savePassword}
                            onChange={event => setSavePassword(event.target.checked)}
                            disabled={loading || restoring || !passwordSavingAvailable}
                        />
                        <span>{tr("Save password")}</span>
                    </label>
                    {!passwordSavingAvailable && <p className="rtx-login-storage-note">{tr("Password saving is unavailable on this device.")}</p>}
                    {storageError && <p role="status" className="rtx-login-storage-note">{tr(storageError)}</p>}

                    {/* Error */}
                    {error && (
                        <div role="alert" className="rtx-login-error">
                            <AlertCircle size={17} aria-hidden="true" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Buttons */}
                    <div className="rtx-login-actions">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={loading}
                            className="rtx-login-button rtx-login-button--secondary"
                        >
                            {tr(tradeLogin ? "Continue viewing" : "Cancel")}
                        </button>
                        <button
                            type="submit"
                            disabled={loading || restoring || (isDesktop && (directoryLoading || !selectedBroker || healthStatus !== 'online'))}
                            className="rtx-login-button rtx-login-button--primary"
                        >
                            {loading ? <LoaderCircle size={16} className="rtx-login-spinner" aria-hidden="true" /> : null}
                            {tr(loading ? "Connecting..." : "Log in")}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}
