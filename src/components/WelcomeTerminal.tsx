/**
 * WelcomeTerminal renders the pre-authentication webterminal login overlay.
 * It keeps the active trading workspace visible behind the modal while the user
 * selects a broker and signs in.
 */

import React, { useState, useEffect, useRef } from 'react';
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

interface WelcomeTerminalProps {
    onLogin: (accountId: string) => void;
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

export function WelcomeTerminal({ onLogin }: WelcomeTerminalProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);

    const [brokerList, setBrokerList] = useState<BrokerServerItem[]>([]);
    const [selectedBroker, setSelectedBroker] = useState<BrokerServerItem | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [healthStatus, setHealthStatus] = useState<'checking' | 'online' | 'offline' | null>(null);
    const [brokerListStatus, setBrokerListStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const healthAbortRef = useRef<AbortController | null>(null);

    const addSavedAccount = useAppStore(s => s.addSavedAccount);
    const setActiveAccount = useAppStore(s => s.setActiveAccount);

    useEffect(() => {
        const savedUser = localStorage.getItem('rtx_saved_username');
        localStorage.removeItem('rtx_saved_password');
        if (savedUser) {
            setUsername(savedUser);
            setRememberMe(true);
        }
    }, []);

    useEffect(() => () => {
        healthAbortRef.current?.abort();
    }, []);

    const runHealthCheck = async (serverUrl: string) => {
        healthAbortRef.current?.abort();
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
            setHealthStatus(response.ok ? 'online' : 'offline');
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

    const filteredBrokers = brokerList.filter(b =>
        String(b.broker_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(b.broker_id || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(b.region || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    useEffect(() => {
        let isMounted = true;
        setBrokerListStatus('loading');

        fetch(brokerServersDiscoveryUrl)
            .then(res => res.json())
            .then((payload: unknown) => {
                if (!isMounted) return;
                const data = extractBrokerDiscoveryList(payload) as BrokerServerItem[];
                setBrokerList(data);
                setBrokerListStatus('ready');

                const savedBrokerId = localStorage.getItem('broker_id') || DEFAULT_BROKER_ID;
                const savedBroker = data.find(b => b.broker_id === savedBrokerId || b.server === savedBrokerId || b.server_url === savedBrokerId);
                if (savedBroker) {
                    setSelectedBroker({
                        ...savedBroker,
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
            .catch(err => {
                if (!isMounted) return;
                console.error('[WelcomeTerminal] Failed to fetch broker servers:', err);
                setBrokerListStatus('error');
                setHealthStatus('offline');
            });

        return () => {
            isMounted = false;
        };
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            if (!selectedBroker) {
                throw new Error('Please select a broker server.');
            }

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
                username,
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

            const accountId = data.account_login ?? username;

            localStorage.setItem('rtx_last_login', String(accountId));
            if (rememberMe) {
                localStorage.setItem('rtx_saved_username', String(accountId));
            } else {
                localStorage.removeItem('rtx_saved_username');
            }
            localStorage.removeItem('rtx_saved_password');

            const { setToken, setRefreshToken } = await import('../api/client');
            setToken(token);
            if (data.refresh_token) setRefreshToken(data.refresh_token);
            if (data.expires_at) localStorage.setItem('token_expires_at', String(data.expires_at));

            useAppStore.getState().setAuthenticated(true, String(accountId), token, data.refresh_token);

            const loginNum = parseInt(String(accountId), 10);
            if (!isNaN(loginNum)) {
                addSavedAccount({
                    login: loginNum,
                    name: data.user?.username || data.username || '',
                    server: submitBroker.broker_name || '',
                    isLive: true,
                    lastUsed: Date.now(),
                });
                setActiveAccount(loginNum);
            }

            setTimeout(() => {
                onLogin(String(accountId));
            }, 500);

        } catch (err: unknown) {
            const errorMessage = getErrorMessage(err, 'Authentication failed');
            if (errorMessage !== 'Please select a broker server.') {
                console.error('[WelcomeTerminal] Auth error:', err);
            }
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    const selectedBrokerName = selectedBroker?.broker_name || 'Select broker';
    const selectedBrokerHost = selectedBroker
        ? normalizeBrokerServerUrl(resolveBrokerBackendUrl(selectedBroker)).replace(/^https?:\/\//i, '').replace(/\/$/, '')
        : 'No server selected';

    const healthLabel =
        healthStatus === 'online' ? 'Online'
            : healthStatus === 'checking' ? 'Checking'
                : healthStatus === 'offline' ? 'Unavailable'
                    : brokerListStatus === 'loading' ? 'Loading'
                        : 'Select';

    const healthTone =
        healthStatus === 'online' ? '#10b981'
            : healthStatus === 'checking' ? '#f59e0b'
                : healthStatus === 'offline' ? '#ef4444'
                    : '#71717a';

    return (
        <div
            onContextMenu={e => e.stopPropagation()}
            onMouseDownCapture={e => {
                const target = e.target as HTMLElement;
                if (!target.closest('[data-welcome-card]')) {
                    e.stopPropagation();
                }
            }}
            className="rtx-login-overlay"
        >
            <section data-welcome-card className="rtx-login-shell" aria-label="RTX Terminal login">
                <header className="rtx-shell-bar">
                    <div className="rtx-window-control-group" aria-hidden="true">
                        <span className="rtx-window-dot rtx-dot-red" />
                        <span className="rtx-window-dot rtx-dot-yellow" />
                        <span className="rtx-window-dot rtx-dot-green" />
                    </div>
                    <span className="rtx-window-title">RTX 5 Web Terminal</span>
                    <span className="rtx-shell-health" style={{ color: healthTone }}>
                        <span style={{ background: healthTone, boxShadow: `0 0 10px ${healthTone}` }} />
                        {healthLabel}
                    </span>
                </header>

                <div className="rtx-login-body">
                    <header className="rtx-form-header">
                        <div className="rtx-brand-lockup">
                            <img src="/logo.png" alt="RTX" className="rtx-brand-logo" />
                            <div>
                                <p>RTX 5 Web Terminal</p>
                                <h1>Sign in to RTX Terminal</h1>
                            </div>
                        </div>
                    </header>

                    <div className="rtx-broker-strip">
                        <div className="rtx-route-row">
                            <div className="rtx-route-logo">
                                {selectedBroker?.logo_url ? (
                                    <img src={selectedBroker.logo_url} alt="" />
                                ) : (
                                    <span>{selectedBrokerName.slice(0, 1).toUpperCase()}</span>
                                )}
                            </div>
                            <div>
                                <span className="rtx-summary-label">Broker server</span>
                                <strong>{selectedBrokerName}</strong>
                                <small>{selectedBrokerHost}</small>
                            </div>
                        </div>
                        <span className="rtx-broker-state" style={{ color: healthTone }}>
                            <span style={{ background: healthTone, boxShadow: `0 0 8px ${healthTone}` }} />
                            {healthLabel}
                        </span>
                    </div>

                    {error && (
                        <div className="rtx-login-error" role="alert">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="rtx-login-form">
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
                                onFocus={e => (e.target.style.borderColor = '#14b8a6')}
                                onBlur={e => (e.target.style.borderColor = '#252932')}
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
                                onFocus={e => (e.target.style.borderColor = '#14b8a6')}
                                onBlur={e => (e.target.style.borderColor = '#252932')}
                            />
                        </div>

                        <div className="rtx-broker-field">
                            <label style={labelStyle}>Broker Server</label>
                            <div className="rtx-broker-input-wrap">
                                {selectedBroker?.logo_url && (
                                    <img src={selectedBroker.logo_url} alt="" className="rtx-broker-logo" />
                                )}
                                <input
                                    type="text"
                                    placeholder={brokerListStatus === 'loading' ? 'Loading brokers...' : 'Search broker...'}
                                    required
                                    value={searchQuery}
                                    onChange={e => {
                                        const value = e.target.value;
                                        setSearchQuery(value);
                                        if (selectedBroker && value.trim() !== selectedBroker.broker_name) {
                                            setSelectedBroker(null);
                                            setHealthStatus(null);
                                        }
                                        setDropdownOpen(true);
                                    }}
                                    onFocus={() => setDropdownOpen(true)}
                                    onBlur={() => {
                                        setTimeout(() => {
                                            setDropdownOpen(false);
                                            if (selectedBroker) {
                                                setSearchQuery(selectedBroker.broker_name);
                                            }
                                        }, 200);
                                    }}
                                    style={{
                                        ...inputStyle,
                                        paddingLeft: selectedBroker?.logo_url ? 38 : 12,
                                        paddingRight: 34,
                                    }}
                                />
                                <div className="rtx-broker-input-state" aria-hidden="true">
                                    <span style={{ background: healthTone, boxShadow: `0 0 8px ${healthTone}` }} />
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8b8b95" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{
                                        transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                        transition: 'transform 0.2s',
                                    }}>
                                        <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                </div>
                            </div>

                            {dropdownOpen && (
                                <div className="rtx-broker-menu">
                                    {filteredBrokers.length === 0 ? (
                                        <div className="rtx-broker-empty">
                                            {brokerListStatus === 'error' ? 'Broker discovery unavailable' : 'No brokers found'}
                                        </div>
                                    ) : (
                                        filteredBrokers.map(item => (
                                            <button
                                                type="button"
                                                key={item.broker_id}
                                                onMouseDown={() => handleSelectBroker(item)}
                                                className={selectedBroker?.broker_id === item.broker_id ? 'rtx-broker-option is-selected' : 'rtx-broker-option'}
                                            >
                                                <span>
                                                    {item.logo_url ? (
                                                        <img src={item.logo_url} alt="" />
                                                    ) : (
                                                        <i>{String(item.broker_name || 'B').slice(0, 1).toUpperCase()}</i>
                                                    )}
                                                    <strong>{item.broker_name}</strong>
                                                </span>
                                                {item.region && <em>{item.region}</em>}
                                            </button>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>

                        {healthStatus === 'offline' && (
                            <div className="rtx-inline-status is-offline">
                                Broker temporarily unavailable
                            </div>
                        )}

                        <div className="rtx-remember-row">
                            <input
                                type="checkbox"
                                id="wtRemember"
                                checked={rememberMe}
                                onChange={e => setRememberMe(e.target.checked)}
                            />
                            <label htmlFor="wtRemember">Remember account ID</label>
                        </div>

                        <button type="submit" disabled={loading} className="rtx-login-button">
                            {loading ? (
                                <>
                                    <span className="rtx-spinner" />
                                    Connecting
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

                    <footer className="rtx-login-footer">
                        <span style={{ background: healthStatus === 'offline' ? '#ef4444' : '#10b981' }} />
                        {healthStatus === 'offline' ? 'Server check failed' : 'System operational'}
                    </footer>
                </div>
            </section>

            <style>{`
                @keyframes rtx-spin {
                    to { transform: rotate(360deg); }
                }

                @keyframes rtx-login-enter {
                    from { opacity: 0; transform: translateY(8px) scale(0.99); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }

                .rtx-login-overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 99999;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                    background: rgba(5, 6, 9, 0.90);
                    backdrop-filter: blur(5px);
                    -webkit-backdrop-filter: blur(5px);
                    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                }

                .rtx-login-shell {
                    width: min(560px, 100%);
                    min-height: 0;
                    display: grid;
                    grid-template-rows: 36px minmax(0, 1fr);
                    overflow: hidden;
                    border: 1px solid #252932;
                    border-radius: 8px;
                    background: #111318;
                    box-shadow: 0 22px 58px rgba(0, 0, 0, 0.58);
                    animation: rtx-login-enter 180ms ease-out both;
                }

                .rtx-shell-bar {
                    min-width: 0;
                    height: 36px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 0 14px;
                    border-bottom: 1px solid #25272e;
                    background: #101116;
                    color: #8b8f9b;
                    font-size: 11px;
                    letter-spacing: 0;
                }

                .rtx-window-control-group {
                    display: inline-flex;
                    align-items: center;
                    gap: 7px;
                    flex: 0 0 auto;
                }

                .rtx-window-dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 999px;
                    opacity: 0.9;
                }

                .rtx-dot-red { background: #ef4444; }
                .rtx-dot-yellow { background: #f59e0b; }
                .rtx-dot-green { background: #10b981; }

                .rtx-window-title {
                    min-width: 0;
                    flex: 1;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .rtx-shell-health {
                    display: inline-flex;
                    align-items: center;
                    gap: 7px;
                    flex: 0 0 auto;
                    font-size: 11px;
                    font-weight: 750;
                }

                .rtx-shell-health span {
                    width: 7px;
                    height: 7px;
                    border-radius: 999px;
                    flex: 0 0 auto;
                }

                .rtx-login-body {
                    min-width: 0;
                    min-height: 0;
                    padding: 24px;
                    background: #111318;
                }

                .rtx-brand-lockup {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .rtx-brand-logo {
                    width: 44px;
                    height: 44px;
                    border-radius: 6px;
                    object-fit: contain;
                    background: #14171d;
                    border: 1px solid #292c34;
                }

                .rtx-brand-name {
                    margin: 0;
                    color: #f4f4f5;
                    font-size: 21px;
                    line-height: 1.15;
                    font-weight: 780;
                    letter-spacing: 0;
                }

                .rtx-brand-subtitle {
                    margin: 0 0 4px;
                    color: #7d828e;
                    font-size: 10px;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: 0.12em;
                }

                .rtx-broker-strip {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    margin-bottom: 18px;
                    padding: 12px;
                    border: 1px solid #252932;
                    border-radius: 7px;
                    background: #0c0e12;
                }

                .rtx-summary-label {
                    display: block;
                    margin-bottom: 4px;
                    color: #737987;
                    font-size: 9.5px;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: 0.1em;
                }

                .rtx-route-row {
                    display: flex;
                    align-items: center;
                    gap: 11px;
                    min-width: 0;
                }

                .rtx-route-logo {
                    width: 34px;
                    height: 34px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 6px;
                    background: #171a20;
                    border: 1px solid #2b2f38;
                    flex: 0 0 auto;
                    color: #a7abb5;
                    font-size: 13px;
                    font-weight: 800;
                }

                .rtx-route-logo img {
                    width: 22px;
                    height: 22px;
                    object-fit: contain;
                }

                .rtx-route-row div:last-child {
                    min-width: 0;
                }

                .rtx-route-row strong {
                    display: block;
                    color: #f3f4f6;
                    font-size: 13.5px;
                    font-weight: 760;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .rtx-route-row small {
                    display: block;
                    margin-top: 3px;
                    color: #838895;
                    font-size: 11.5px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .rtx-broker-state {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    flex: 0 0 auto;
                    min-height: 28px;
                    padding: 0 9px;
                    border: 1px solid #252932;
                    border-radius: 6px;
                    background: #13161c;
                    font-size: 11.5px;
                    font-weight: 760;
                }

                .rtx-broker-state span {
                    width: 7px;
                    height: 7px;
                    border-radius: 999px;
                    flex: 0 0 auto;
                }

                .rtx-form-header {
                    margin-bottom: 18px;
                }

                .rtx-form-header p {
                    margin: 0 0 3px;
                    color: #7d828e;
                    font-size: 10px;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: 0.12em;
                }

                .rtx-form-header h1 {
                    margin: 0;
                    color: #f4f4f5;
                    font-size: 21px;
                    line-height: 1.2;
                    font-weight: 760;
                    letter-spacing: 0;
                }

                .rtx-login-error {
                    margin-bottom: 14px;
                    padding: 8px 10px;
                    border-radius: 6px;
                    background: rgba(239, 68, 68, 0.10);
                    border: 1px solid rgba(239, 68, 68, 0.25);
                    color: #f87171;
                    font-size: 12px;
                    line-height: 1.35;
                }

                .rtx-login-form {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .rtx-broker-field {
                    position: relative;
                }

                .rtx-broker-input-wrap {
                    position: relative;
                }

                .rtx-broker-logo {
                    position: absolute;
                    left: 10px;
                    top: 50%;
                    width: 18px;
                    height: 18px;
                    border-radius: 4px;
                    object-fit: contain;
                    transform: translateY(-50%);
                    z-index: 2;
                }

                .rtx-broker-input-state {
                    position: absolute;
                    right: 10px;
                    top: 50%;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    transform: translateY(-50%);
                    pointer-events: none;
                }

                .rtx-broker-input-state span,
                .rtx-login-footer span {
                    width: 7px;
                    height: 7px;
                    border-radius: 999px;
                    flex: 0 0 auto;
                }

                .rtx-broker-menu {
                    position: absolute;
                    left: 0;
                    right: 0;
                    top: 100%;
                    margin-top: 5px;
                    max-height: 192px;
                    overflow-y: auto;
                    z-index: 10;
                    padding: 4px;
                    border: 1px solid #30343d;
                    border-radius: 7px;
                    background: #171a20;
                    box-shadow: 0 18px 34px rgba(0, 0, 0, 0.46);
                }

                .rtx-broker-empty {
                    padding: 10px 11px;
                    color: #8b8b95;
                    font-size: 12px;
                }

                .rtx-broker-option {
                    width: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 10px;
                    min-height: 36px;
                    padding: 6px 8px;
                    border: 0;
                    border-radius: 5px;
                    background: transparent;
                    color: #e6e6ea;
                    cursor: pointer;
                    text-align: left;
                }

                .rtx-broker-option:hover,
                .rtx-broker-option.is-selected {
                    background: #21252d;
                }

                .rtx-broker-option span {
                    display: flex;
                    align-items: center;
                    gap: 9px;
                    min-width: 0;
                }

                .rtx-broker-option img,
                .rtx-broker-option i {
                    width: 20px;
                    height: 20px;
                    border-radius: 4px;
                    flex: 0 0 auto;
                }

                .rtx-broker-option i {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(255, 255, 255, 0.06);
                    color: #8b8b95;
                    font-style: normal;
                    font-size: 10px;
                }

                .rtx-broker-option strong {
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    font-size: 12.5px;
                    font-weight: 650;
                }

                .rtx-broker-option em {
                    color: #14b8a6;
                    font-style: normal;
                    font-size: 9px;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                }

                .rtx-inline-status {
                    min-height: 28px;
                    display: flex;
                    align-items: center;
                    padding: 0 10px;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 650;
                }

                .rtx-inline-status.is-offline {
                    color: #f87171;
                    background: rgba(239, 68, 68, 0.10);
                    border: 1px solid rgba(239, 68, 68, 0.22);
                }

                .rtx-remember-row {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-top: 2px;
                }

                .rtx-remember-row input {
                    width: 14px;
                    height: 14px;
                    margin: 0;
                    cursor: pointer;
                    accent-color: #14b8a6;
                }

                .rtx-remember-row label {
                    color: #868690;
                    font-size: 12px;
                    cursor: pointer;
                }

                .rtx-login-button {
                    min-height: 42px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    margin-top: 4px;
                    border: 0;
                    border-radius: 6px;
                    background: #14b8a6;
                    color: #04110f;
                    font-size: 13px;
                    font-weight: 800;
                    cursor: pointer;
                    transition: transform 0.15s ease, background 0.15s ease, opacity 0.15s ease;
                }

                .rtx-login-button:hover:not(:disabled) {
                    background: #2dd4bf;
                    transform: translateY(-1px);
                }

                .rtx-login-button:disabled {
                    opacity: 0.65;
                    cursor: not-allowed;
                }

                .rtx-spinner {
                    width: 14px;
                    height: 14px;
                    border: 2px solid rgba(4, 17, 15, 0.25);
                    border-top-color: #04110f;
                    border-radius: 50%;
                    animation: rtx-spin 0.7s linear infinite;
                }

                .rtx-login-footer {
                    display: flex;
                    align-items: center;
                    gap: 7px;
                    margin-top: 16px;
                    padding-top: 14px;
                    border-top: 1px solid #252932;
                    color: #767680;
                    font-size: 11.5px;
                }

                @media (max-width: 760px) {
                    .rtx-login-overlay {
                        align-items: flex-start;
                        padding: 14px;
                        overflow-y: auto;
                    }

                    .rtx-login-shell {
                        width: 100%;
                        min-height: 0;
                    }
                }

                @media (max-width: 520px) {
                    .rtx-login-overlay {
                        padding: 12px;
                    }

                    .rtx-shell-bar {
                        padding: 0 12px;
                    }

                    .rtx-shell-health {
                        display: none;
                    }

                    .rtx-login-body {
                        padding: 18px;
                    }

                    .rtx-brand-logo {
                        width: 40px;
                        height: 40px;
                    }

                    .rtx-brand-name {
                        font-size: 20px;
                    }

                    .rtx-form-header {
                        margin-bottom: 16px;
                    }

                    .rtx-broker-strip {
                        align-items: flex-start;
                        flex-direction: column;
                    }

                    .rtx-login-form {
                        gap: 11px;
                    }

                    .rtx-login-footer {
                        margin-top: 14px;
                        padding-top: 14px;
                    }
                }
            `}</style>
        </div>
    );
}

const labelStyle: React.CSSProperties = {
    display: 'block',
    color: '#737987',
    fontSize: 9.5,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: 6,
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 6,
    border: '1px solid #252932',
    background: '#0b0d11',
    color: '#f4f4f5',
    fontSize: 13,
    outline: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};
