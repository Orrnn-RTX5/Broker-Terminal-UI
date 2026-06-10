/**
 * WelcomeTerminal renders the pre-authentication webterminal login overlay.
 * It keeps the active trading workspace visible behind the modal while the user
 * selects a broker and signs in.
 */

import React, { useState, useEffect, useRef } from 'react';
import { ArrowRight, ChevronDown, Eye, EyeOff, Lock, User } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { authV2Api } from '../api/trade';
import { normalizeBrokerServerUrl, updateDynamicUrls, BROKER_DISCOVERY_URL } from '../config/api';
import SplitText from './SplitText';
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
const RTX5_GREEN = '#80c33f';
const RTX5_GREEN_DARK = '#6fb334';

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
    const [showPassword, setShowPassword] = useState(false);
    const [rememberMe, setRememberMe] = useState(false);

    const [brokerList, setBrokerList] = useState<BrokerServerItem[]>([]);
    const [selectedBroker, setSelectedBroker] = useState<BrokerServerItem | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [healthStatus, setHealthStatus] = useState<'checking' | 'online' | 'offline' | null>(null);
    const [brokerListStatus, setBrokerListStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const brokerInputRef = useRef<HTMLInputElement | null>(null);
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

    const closeBrokerDropdown = () => {
        setDropdownOpen(false);
        if (selectedBroker) {
            setSearchQuery(selectedBroker.broker_name);
        }
    };

    const handleBrokerInputMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        const input = brokerInputRef.current;
        if (!input) return;

        const isFocused = document.activeElement === input;
        if (isFocused) {
            e.preventDefault();
            if (dropdownOpen) {
                closeBrokerDropdown();
            } else {
                setDropdownOpen(true);
            }
            return;
        }

        if (e.target !== input) {
            e.preventDefault();
            input.focus();
            setDropdownOpen(true);
        }
    };

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
    const healthLabel =
        healthStatus === 'online' ? 'Online'
            : healthStatus === 'checking' ? 'Checking'
                : healthStatus === 'offline' ? 'Unavailable'
                    : brokerListStatus === 'loading' ? 'Loading'
                        : 'Select';

    const healthTone =
        healthStatus === 'online' ? RTX5_GREEN
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
            <div className="rtx-login-stage">
                <aside className="rtx-login-visual" aria-hidden="true">
                    <picture>
                        <source media="(max-width: 760px)" srcSet="/login/trading-desk-hero-mobile.webp" />
                        <img
                            src="/login/trading-desk-hero.webp"
                            alt=""
                            width={2048}
                            height={1152}
                            loading="eager"
                            decoding="async"
                            fetchPriority="high"
                        />
                    </picture>
                    <div className="rtx-login-visual-shade" />
                </aside>

                <main className="rtx-login-panel-wrap">
                    <section data-welcome-card className="rtx-login-panel" aria-label="RTX Terminal login">
                        <div className="rtx-login-body">
                            <header className="rtx-form-header">
                                <h1 className="rtx-login-title">
                                    <SplitText
                                        tag="span"
                                        text="Sign in to"
                                        className="rtx-login-title-text"
                                        delay={90}
                                        duration={1.05}
                                        ease="power3.out"
                                        splitType="words, chars"
                                        from={{ opacity: 0, y: 18, filter: 'blur(5px)' }}
                                        to={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                                        threshold={0.05}
                                        rootMargin="0px"
                                        textAlign="left"
                                    />
                                    <img
                                        src="/brand/rtx5-logo.png"
                                        alt="RTX 5"
                                        className="rtx-login-title-logo"
                                        width={720}
                                        height={197}
                                        loading="eager"
                                        decoding="async"
                                        fetchPriority="high"
                                    />
                                </h1>
                            </header>

                            <div className="rtx-broker-strip">
                                <div className="rtx-route-row">
                                    <div className="rtx-route-logo">
                                        {selectedBroker?.logo_url ? (
                                            <img src={selectedBroker.logo_url} alt="" decoding="async" />
                                        ) : (
                                            <span>{selectedBrokerName.slice(0, 1).toUpperCase()}</span>
                                        )}
                                    </div>
                                    <div className="rtx-route-copy">
                                        <span className="rtx-summary-label">Broker Server</span>
                                        <strong>{selectedBrokerName}</strong>
                                    </div>
                                </div>
                                <span className="rtx-broker-state" style={{ color: healthTone }}>
                                    <span style={{ background: healthTone }} />
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
                                    <label htmlFor="rtxAccountId" style={labelStyle}>Account ID</label>
                                    <div className="rtx-input-shell">
                                        <User size={18} strokeWidth={1.8} aria-hidden="true" />
                                        <input
                                            id="rtxAccountId"
                                            name="accountId"
                                            type="text"
                                            placeholder="Enter Account ID"
                                            required
                                            autoFocus
                                            autoComplete="username"
                                            value={username}
                                            onChange={e => setUsername(e.target.value)}
                                            style={inputStyle}
                                            onFocus={e => (e.currentTarget.parentElement!.style.borderColor = RTX5_GREEN)}
                                            onBlur={e => (e.currentTarget.parentElement!.style.borderColor = '#2b303a')}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label htmlFor="rtxPassword" style={labelStyle}>Password</label>
                                    <div className="rtx-input-shell">
                                        <Lock size={18} strokeWidth={1.8} aria-hidden="true" />
                                        <input
                                            id="rtxPassword"
                                            name="password"
                                            type={showPassword ? 'text' : 'password'}
                                            placeholder="Enter Password"
                                            required
                                            autoComplete="current-password"
                                            value={password}
                                            onChange={e => setPassword(e.target.value)}
                                            style={inputStyle}
                                            onFocus={e => (e.currentTarget.parentElement!.style.borderColor = RTX5_GREEN)}
                                            onBlur={e => (e.currentTarget.parentElement!.style.borderColor = '#2b303a')}
                                        />
                                        <button
                                            type="button"
                                            className="rtx-password-toggle"
                                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                                            aria-pressed={showPassword}
                                            onMouseDown={e => e.preventDefault()}
                                            onClick={() => setShowPassword(value => !value)}
                                        >
                                            {showPassword ? (
                                                <EyeOff size={18} strokeWidth={1.8} aria-hidden="true" className="rtx-field-end-icon" />
                                            ) : (
                                                <Eye size={18} strokeWidth={1.8} aria-hidden="true" className="rtx-field-end-icon" />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                <div className="rtx-broker-field">
                                    <label htmlFor="rtxBrokerServer" style={labelStyle}>Broker Server</label>
                                    <div className="rtx-broker-input-wrap" onMouseDown={handleBrokerInputMouseDown}>
                                        {selectedBroker?.logo_url && (
                                            <img src={selectedBroker.logo_url} alt="" className="rtx-broker-logo" decoding="async" />
                                        )}
                                        <input
                                            id="rtxBrokerServer"
                                            name="brokerServer"
                                            ref={brokerInputRef}
                                            type="text"
                                            placeholder={brokerListStatus === 'loading' ? 'Loading brokers...' : 'Search broker...'}
                                            required
                                            autoComplete="organization"
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
                                                    closeBrokerDropdown();
                                                }, 200);
                                            }}
                                            style={{
                                                ...inputStyle,
                                                paddingLeft: selectedBroker?.logo_url ? 42 : 16,
                                                paddingRight: 44,
                                                cursor: 'pointer',
                                            }}
                                        />
                                        <div className="rtx-broker-input-state" aria-hidden="true">
                                            <span style={{ background: healthTone }} />
                                            <ChevronDown size={16} strokeWidth={1.8} style={{
                                                transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                                transition: 'transform 0.2s',
                                            }} />
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
                                                                <img src={item.logo_url} alt="" loading="lazy" decoding="async" />
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
                                        name="rememberAccountId"
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
                                            <ArrowRight size={18} strokeWidth={2.2} aria-hidden="true" />
                                        </>
                                    )}
                                </button>
                            </form>

                        </div>
                    </section>
                </main>
            </div>

            <style>{`
                @keyframes rtx-spin {
                    to { transform: rotate(360deg); }
                }

                @keyframes rtx-login-page-enter {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                @keyframes rtx-login-enter {
                    from { opacity: 0; transform: translateY(14px) scale(0.985); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }

                @keyframes rtx-visual-settle {
                    from { transform: scale(1.035); }
                    to { transform: scale(1); }
                }

                .rtx-login-overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 99999;
                    display: block;
                    overflow: hidden;
                    min-height: 100dvh;
                    background: #050608;
                    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    animation: none;
                }

                .rtx-login-stage {
                    position: relative;
                    min-height: 100%;
                    display: flex;
                    justify-content: flex-end;
                    background: #050608;
                }

                .rtx-login-visual {
                    position: absolute;
                    inset: 0;
                    overflow: hidden;
                    background: #07080b;
                }

                .rtx-login-visual picture,
                .rtx-login-visual img {
                    display: block;
                    width: 100%;
                    height: 100%;
                }

                .rtx-login-visual img {
                    object-fit: cover;
                    object-position: center center;
                    filter: saturate(0.86) contrast(1.02) brightness(0.78);
                    animation: rtx-visual-settle 900ms ease-out both;
                }

                .rtx-login-visual-shade {
                    position: absolute;
                    inset: 0;
                    background:
                        linear-gradient(90deg, rgba(5, 6, 8, 0.08) 0%, rgba(5, 6, 8, 0.36) 46%, rgba(5, 6, 8, 0.76) 100%),
                        linear-gradient(180deg, rgba(5, 6, 8, 0.16) 0%, rgba(5, 6, 8, 0.08) 42%, rgba(5, 6, 8, 0.48) 100%);
                    pointer-events: none;
                }

                .rtx-login-panel-wrap {
                    position: relative;
                    z-index: 1;
                    min-width: 0;
                    width: min(620px, 43vw);
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: clamp(24px, 3vw, 72px);
                    background: rgba(5, 6, 8, 0.18);
                }

                .rtx-login-shell {
                    width: min(520px, 100%);
                    min-height: 0;
                    display: grid;
                    grid-template-rows: 36px minmax(0, 1fr);
                    overflow: hidden;
                    border: 1px solid #2b3039;
                    border-radius: 8px;
                    background: #111318;
                    box-shadow: 0 24px 58px rgba(0, 0, 0, 0.42);
                    animation: rtx-login-enter 320ms cubic-bezier(0.16, 1, 0.3, 1) both;
                }

                .rtx-shell-bar {
                    min-width: 0;
                    height: 36px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 0 14px;
                    border-bottom: 1px solid #25272e;
                    background: #101216;
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
                .rtx-dot-green { background: #80c33f; }

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
                    padding: 26px;
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
                    transition: border-color 0.18s ease, background 0.18s ease;
                }

                .rtx-summary-label {
                    display: block;
                    margin-bottom: 0;
                    color: #737987;
                    font-size: 9.5px;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: 0.1em;
                    line-height: 1.2;
                }

                .rtx-route-row {
                    display: flex;
                    align-items: center;
                    gap: 11px;
                    flex: 1 1 auto;
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

                .rtx-route-copy {
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    gap: 4px;
                    flex: 1 1 auto;
                    min-width: 0;
                }

                .rtx-route-row strong {
                    display: block;
                    color: #f3f4f6;
                    font-size: 13.5px;
                    font-weight: 760;
                    line-height: 1.18;
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
                    align-self: center;
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
                    cursor: pointer;
                }

                .rtx-broker-input-wrap input {
                    cursor: pointer;
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

                .rtx-broker-input-state span {
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
                    color: #80c33f;
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
                    accent-color: #80c33f;
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
                    background: #80c33f;
                    color: #04110f;
                    font-size: 13px;
                    font-weight: 800;
                    cursor: pointer;
                    transition: transform 0.15s ease, background 0.15s ease, opacity 0.15s ease, box-shadow 0.15s ease;
                }

                .rtx-login-button:hover:not(:disabled) {
                    background: #8bd24a;
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

                @media (max-width: 900px) {
                    .rtx-login-stage {
                        justify-content: center;
                    }

                    .rtx-login-overlay {
                        overflow-y: auto;
                    }

                    .rtx-login-visual {
                        min-height: 100%;
                    }

                    .rtx-login-visual img {
                        object-position: center center;
                    }

                    .rtx-login-visual-shade {
                        background:
                            linear-gradient(180deg, rgba(5, 6, 8, 0.42) 0%, rgba(5, 6, 8, 0.58) 48%, rgba(5, 6, 8, 0.82) 100%),
                            linear-gradient(90deg, rgba(5, 6, 8, 0.2) 0%, rgba(5, 6, 8, 0.4) 100%);
                    }

                    .rtx-login-panel-wrap {
                        width: 100%;
                        min-height: 100vh;
                        padding: 18px;
                        align-items: center;
                        background: transparent;
                    }

                    .rtx-login-shell {
                        width: 100%;
                        min-height: 0;
                    }
                }

                @media (max-width: 520px) {
                    .rtx-login-panel-wrap {
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

                .rtx-login-stage {
                    min-height: 100dvh;
                    display: grid;
                    grid-template-columns: minmax(0, 63.2%) minmax(520px, 36.8%);
                    background: #06080c;
                }

                .rtx-login-visual {
                    position: relative;
                    inset: auto;
                    min-width: 0;
                    min-height: 100dvh;
                    overflow: hidden;
                    background: #020407;
                }

                .rtx-login-visual picture,
                .rtx-login-visual img {
                    display: block;
                    width: 100%;
                    height: 100%;
                }

                .rtx-login-visual img {
                    object-fit: cover;
                    object-position: left center;
                    filter: saturate(0.94) contrast(1.05) brightness(0.82);
                    animation: none;
                }

                .rtx-login-visual-shade {
                    position: absolute;
                    inset: 0;
                    background:
                        linear-gradient(90deg, rgba(0, 0, 0, 0.02) 0%, rgba(0, 0, 0, 0.08) 48%, rgba(0, 0, 0, 0.86) 100%),
                        linear-gradient(180deg, rgba(2, 5, 9, 0.18) 0%, rgba(2, 5, 9, 0.02) 44%, rgba(0, 0, 0, 0.38) 100%);
                    pointer-events: none;
                }

                .rtx-login-panel-wrap {
                    position: relative;
                    z-index: 1;
                    min-width: 0;
                    width: auto;
                    min-height: 100dvh;
                    display: flex;
                    align-items: flex-start;
                    justify-content: center;
                    padding: clamp(42px, 7.5vh, 86px) clamp(54px, 5.25vw, 88px);
                    background:
                        radial-gradient(circle at 86% 18%, rgba(255, 255, 255, 0.035), transparent 34%),
                        linear-gradient(180deg, #12161d 0%, #11151b 47%, #0d1117 100%);
                    box-shadow: inset 1px 0 0 rgba(128, 195, 63, 0.14);
                }

                .rtx-login-panel {
                    width: min(clamp(442px, 26.45vw, 508px), 100%);
                    min-width: 0;
                    margin-top: clamp(42px, 5vh, 48px);
                    color: #f4f6f8;
                    contain: layout paint;
                    animation: none;
                }

                .rtx-wordmark {
                    display: flex;
                    align-items: baseline;
                    gap: 10px;
                    margin: 0 0 8px;
                    color: #f5f7fb;
                    font-size: clamp(38px, 3.2vw, 48px);
                    font-weight: 900;
                    line-height: 0.9;
                    letter-spacing: 0;
                }

                .rtx-wordmark strong {
                    color: #80c33f;
                    font: inherit;
                }

                .rtx-login-body {
                    min-width: 0;
                    min-height: 0;
                    padding: 0;
                    background: transparent;
                }

                .rtx-form-header {
                    position: relative;
                    margin-bottom: 16px;
                    padding-bottom: 18px;
                    border-bottom: 0;
                }

                .rtx-form-header::after {
                    content: '';
                    position: absolute;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    height: 1px;
                    background: linear-gradient(90deg, rgba(128, 195, 63, 0.46), rgba(148, 163, 184, 0.18) 42%, transparent 100%);
                }

                .rtx-form-header h1 {
                    margin: 0;
                    display: flex;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 12px;
                    color: #f5f6f8;
                    font-size: 29px;
                    line-height: 1.08;
                    font-weight: 860;
                    letter-spacing: 0;
                    text-shadow: 0 10px 26px rgba(0, 0, 0, 0.36);
                }

                .rtx-login-title-text {
                    color: inherit;
                    font: inherit;
                    line-height: 1.18;
                    letter-spacing: inherit;
                    flex: 0 0 auto;
                    max-width: 100%;
                    overflow: visible !important;
                    padding-bottom: 0.12em;
                    margin-bottom: -0.12em;
                }

                .rtx-login-title-text .split-word,
                .rtx-login-title-text .split-char {
                    display: inline-block;
                    line-height: 1.18;
                    vertical-align: top;
                    overflow: visible;
                }

                .rtx-login-title-logo {
                    width: 136px;
                    height: auto;
                    display: inline-block;
                    object-fit: contain;
                    filter: drop-shadow(0 10px 18px rgba(128, 195, 63, 0.12));
                }

                .rtx-broker-strip {
                    position: relative;
                    overflow: hidden;
                    box-sizing: border-box;
                    height: auto;
                    min-height: 74px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 18px;
                    margin-bottom: 26px;
                    padding: 14px 17px;
                    border: 1px solid rgba(83, 94, 111, 0.48);
                    border-radius: 8px;
                    background:
                        linear-gradient(135deg, rgba(25, 31, 42, 0.94) 0%, rgba(13, 18, 27, 0.84) 54%, rgba(9, 13, 20, 0.96) 100%);
                    box-shadow:
                        0 20px 44px rgba(0, 0, 0, 0.28),
                        inset 0 1px 0 rgba(255, 255, 255, 0.06),
                        inset 0 -1px 0 rgba(0, 0, 0, 0.28);
                    transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
                }

                .rtx-broker-strip::before {
                    content: '';
                    position: absolute;
                    inset: 0;
                    border-radius: inherit;
                    background:
                        linear-gradient(90deg, rgba(128, 195, 63, 0.13), transparent 42%),
                        linear-gradient(180deg, rgba(255, 255, 255, 0.055), transparent 48%);
                    pointer-events: none;
                }

                .rtx-broker-strip > * {
                    position: relative;
                    z-index: 1;
                }

                .rtx-route-row {
                    display: flex;
                    align-items: center;
                    gap: 15px;
                    flex: 1 1 auto;
                    min-width: 0;
                }

                .rtx-route-copy {
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    gap: 6px;
                    flex: 1 1 auto;
                    min-width: 0;
                }

                .rtx-route-logo {
                    width: 42px;
                    height: 42px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 8px;
                    background:
                        linear-gradient(145deg, rgba(35, 43, 58, 0.98), rgba(16, 22, 33, 0.98));
                    border: 1px solid rgba(92, 105, 124, 0.58);
                    flex: 0 0 auto;
                    color: #a7abb5;
                    font-size: 13px;
                    font-weight: 800;
                    box-shadow:
                        0 12px 22px rgba(0, 0, 0, 0.24),
                        inset 0 1px 0 rgba(255, 255, 255, 0.08);
                }

                .rtx-route-logo img {
                    width: 27px;
                    height: 27px;
                    object-fit: contain;
                }

                .rtx-summary-label {
                    display: block;
                    margin-bottom: 0;
                    color: #aab1bd;
                    font-size: 11.5px;
                    font-weight: 780;
                    text-transform: none;
                    letter-spacing: 0;
                    line-height: 1.15;
                }

                .rtx-route-row strong {
                    display: block;
                    color: #f7f8fa;
                    font-size: 17px;
                    font-weight: 840;
                    line-height: 1.16;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .rtx-route-row small {
                    display: block;
                    margin-top: 8px;
                    color: #a8afba;
                    font-size: 14px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .rtx-broker-state {
                    display: inline-flex;
                    align-items: center;
                    gap: 9px;
                    flex: 0 0 auto;
                    align-self: center;
                    min-height: 32px;
                    padding: 0 14px;
                    border: 1px solid color-mix(in srgb, currentColor 30%, #2c333e);
                    border-radius: 8px;
                    background: color-mix(in srgb, currentColor 10%, rgba(16, 21, 29, 0.82));
                    box-shadow:
                        inset 0 1px 0 rgba(255, 255, 255, 0.05),
                        0 10px 24px rgba(0, 0, 0, 0.22);
                    font-size: 13px;
                    font-weight: 820;
                }

                .rtx-broker-state span,
                .rtx-broker-input-state span {
                    width: 8px;
                    height: 8px;
                    border-radius: 999px;
                    flex: 0 0 auto;
                    box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 14%, transparent);
                }

                .rtx-login-error {
                    margin-bottom: 18px;
                    padding: 10px 12px;
                    border-radius: 4px;
                    background: rgba(239, 68, 68, 0.10);
                    border: 1px solid rgba(239, 68, 68, 0.28);
                    color: #f87171;
                    font-size: 13px;
                    line-height: 1.35;
                }

                .rtx-login-form {
                    display: flex;
                    flex-direction: column;
                    gap: 18px;
                }

                .rtx-input-shell {
                    min-height: 50px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 0 14px;
                    border: 1px solid #2b303a;
                    border-radius: 4px;
                    background: rgba(12, 16, 22, 0.62);
                    color: #858c98;
                    transition: border-color 0.16s ease, background 0.16s ease;
                }

                .rtx-input-shell:focus-within {
                    background: rgba(14, 19, 26, 0.84);
                }

                .rtx-input-shell input {
                    min-width: 0;
                    flex: 1;
                    height: 48px;
                    padding: 0 !important;
                    border: 0 !important;
                    background: transparent !important;
                    color: #f4f5f7 !important;
                    caret-color: #80c33f;
                    appearance: none;
                    color-scheme: dark;
                }

                .rtx-input-shell input:-webkit-autofill,
                .rtx-input-shell input:-webkit-autofill:hover,
                .rtx-input-shell input:-webkit-autofill:focus,
                .rtx-broker-input-wrap input:-webkit-autofill,
                .rtx-broker-input-wrap input:-webkit-autofill:hover,
                .rtx-broker-input-wrap input:-webkit-autofill:focus {
                    -webkit-text-fill-color: #f4f5f7 !important;
                    box-shadow: 0 0 0 1000px #0d1117 inset !important;
                    border-color: transparent !important;
                    transition: background-color 99999s ease-out 0s !important;
                }

                .rtx-password-toggle {
                    margin-left: auto;
                    width: 30px;
                    height: 30px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0;
                    border: 0;
                    border-radius: 6px;
                    background: transparent;
                    color: #7d8490;
                    cursor: pointer;
                    flex: 0 0 auto;
                    transition: color 0.16s ease, background 0.16s ease;
                }

                .rtx-password-toggle:hover,
                .rtx-password-toggle:focus-visible {
                    color: #c8d1df;
                    background: rgba(255, 255, 255, 0.055);
                    outline: none;
                }

                .rtx-field-end-icon {
                    display: block;
                    color: currentColor;
                }

                .rtx-broker-field {
                    position: relative;
                }

                .rtx-broker-input-wrap {
                    position: relative;
                    cursor: pointer;
                }

                .rtx-broker-input-wrap input {
                    cursor: pointer;
                }

                .rtx-broker-logo {
                    position: absolute;
                    left: 13px;
                    top: 50%;
                    width: 22px;
                    height: 22px;
                    border-radius: 5px;
                    object-fit: contain;
                    transform: translateY(-50%);
                    z-index: 2;
                }

                .rtx-broker-input-state {
                    position: absolute;
                    right: 14px;
                    top: 50%;
                    display: flex;
                    align-items: center;
                    gap: 11px;
                    color: #8d94a0;
                    transform: translateY(-50%);
                    pointer-events: none;
                }

                .rtx-broker-menu {
                    position: absolute;
                    left: 0;
                    right: 0;
                    top: 100%;
                    margin-top: 6px;
                    max-height: 210px;
                    overflow-y: auto;
                    z-index: 10;
                    padding: 5px;
                    border: 1px solid #343b47;
                    border-radius: 5px;
                    background: #171c24;
                    box-shadow: 0 18px 34px rgba(0, 0, 0, 0.46);
                }

                .rtx-broker-empty {
                    padding: 11px 12px;
                    color: #9aa0aa;
                    font-size: 13px;
                }

                .rtx-broker-option {
                    width: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 10px;
                    min-height: 40px;
                    padding: 7px 9px;
                    border: 0;
                    border-radius: 4px;
                    background: transparent;
                    color: #e8eaed;
                    cursor: pointer;
                    text-align: left;
                }

                .rtx-broker-option:hover,
                .rtx-broker-option.is-selected {
                    background: #222832;
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
                    color: #80c33f;
                    font-style: normal;
                    font-size: 9px;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                }

                .rtx-inline-status {
                    min-height: 34px;
                    display: flex;
                    align-items: center;
                    padding: 0 12px;
                    border-radius: 4px;
                    font-size: 13px;
                    font-weight: 650;
                }

                .rtx-inline-status.is-offline {
                    background: rgba(239, 68, 68, 0.09);
                    border: 1px solid rgba(239, 68, 68, 0.24);
                    color: #f87171;
                }

                .rtx-remember-row {
                    display: flex;
                    align-items: center;
                    gap: 11px;
                    margin-top: -2px;
                }

                .rtx-remember-row input {
                    width: 20px;
                    height: 20px;
                    margin: 0;
                    cursor: pointer;
                    accent-color: #80c33f;
                }

                .rtx-remember-row label {
                    color: #a4aab4;
                    font-size: 14px;
                    cursor: pointer;
                }

                .rtx-login-button {
                    min-height: 51px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 28px;
                    margin-top: 2px;
                    border: 0;
                    border-radius: 4px;
                    background: linear-gradient(180deg, #8bd24a 0%, #80c33f 100%);
                    color: #03120f;
                    font-size: 16px;
                    font-weight: 850;
                    cursor: pointer;
                    transition: transform 0.15s ease, background 0.15s ease, opacity 0.15s ease, box-shadow 0.15s ease;
                }

                .rtx-login-button:hover:not(:disabled) {
                    background: linear-gradient(180deg, #94db55 0%, #72b936 100%);
                    transform: translateY(-1px);
                }

                .rtx-login-button:disabled {
                    opacity: 0.65;
                    cursor: not-allowed;
                }

                .rtx-spinner {
                    width: 16px;
                    height: 16px;
                    border: 2px solid rgba(3, 18, 15, 0.25);
                    border-top-color: rgba(3, 18, 15, 0.88);
                    border-radius: 999px;
                    animation: rtx-spin 720ms linear infinite;
                }

                .rtx-login-footer {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    margin-top: 17px;
                    padding-top: 25px;
                    border-top: 1px solid rgba(95, 103, 118, 0.24);
                    color: #a6adb7;
                    font-size: 14px;
                }

                @media (max-width: 1180px) {
                    .rtx-login-stage {
                        grid-template-columns: minmax(0, 55%) minmax(490px, 45%);
                    }

                    .rtx-login-panel-wrap {
                        padding-left: 44px;
                        padding-right: 44px;
                    }
                }

                @media (max-width: 900px) {
                    .rtx-login-overlay {
                        overflow-y: auto;
                    }

                    .rtx-login-stage {
                        min-height: 100dvh;
                        display: block;
                        background: #06080c;
                    }

                    .rtx-login-visual {
                        position: fixed;
                        inset: 0;
                        min-height: 100dvh;
                    }

                    .rtx-login-visual img {
                        object-position: left center;
                    }

                    .rtx-login-visual-shade {
                        background:
                            linear-gradient(180deg, rgba(5, 8, 12, 0.5) 0%, rgba(5, 8, 12, 0.74) 44%, rgba(5, 8, 12, 0.9) 100%),
                            linear-gradient(90deg, rgba(0, 0, 0, 0.18) 0%, rgba(0, 0, 0, 0.54) 100%);
                    }

                    .rtx-login-panel-wrap {
                        position: relative;
                        z-index: 1;
                        width: 100%;
                        min-height: 100dvh;
                        align-items: center;
                        align-items: safe center;
                        padding:
                            max(28px, env(safe-area-inset-top))
                            max(18px, env(safe-area-inset-right))
                            max(28px, env(safe-area-inset-bottom))
                            max(18px, env(safe-area-inset-left));
                        border-left: 0;
                        background: transparent;
                        box-shadow: none;
                    }

                    .rtx-login-panel {
                        width: min(442px, 100%);
                        margin-top: 0;
                        padding: 24px 18px;
                        border: 1px solid rgba(61, 70, 84, 0.72);
                        border-radius: 8px;
                        background: rgba(13, 17, 23, 0.88);
                    }

                }

                @media (max-width: 520px) {
                    .rtx-login-panel-wrap {
                        padding: 18px 12px;
                    }

                    .rtx-login-panel {
                        padding: 18px;
                    }

                    .rtx-wordmark {
                        font-size: 34px;
                    }

                    .rtx-form-header {
                        margin-bottom: 18px;
                        padding-bottom: 18px;
                    }

                    .rtx-form-header h1 {
                        gap: 10px;
                        font-size: 27px;
                        line-height: 1.14;
                    }

                    .rtx-login-title-logo {
                        width: 118px;
                    }

                    .rtx-broker-strip {
                        height: auto;
                        min-height: 0;
                        align-items: flex-start;
                        flex-direction: column;
                        gap: 13px;
                        margin-bottom: 20px;
                        padding: 15px;
                    }

                    .rtx-route-row {
                        width: 100%;
                    }

                    .rtx-broker-state {
                        align-self: flex-start;
                    }

                    .rtx-broker-menu {
                        max-height: min(44vh, 210px);
                    }

                    .rtx-login-form {
                        gap: 18px;
                    }

                    .rtx-remember-row input {
                        width: 16px;
                        height: 16px;
                    }

                    .rtx-login-footer {
                        margin-top: 15px;
                        padding-top: 18px;
                    }
                }

                @media (max-width: 380px) {
                    .rtx-login-panel-wrap {
                        padding:
                            max(16px, env(safe-area-inset-top))
                            max(10px, env(safe-area-inset-right))
                            max(16px, env(safe-area-inset-bottom))
                            max(10px, env(safe-area-inset-left));
                    }

                    .rtx-login-panel {
                        padding: 16px;
                    }

                    .rtx-form-header h1 {
                        gap: 8px;
                        font-size: 25px;
                    }

                    .rtx-login-title-logo {
                        width: 108px;
                    }

                    .rtx-broker-strip {
                        padding: 13px;
                    }

                    .rtx-route-logo {
                        width: 38px;
                        height: 38px;
                    }

                    .rtx-route-row strong {
                        font-size: 16px;
                    }

                    .rtx-route-row small {
                        font-size: 13px;
                    }

                    .rtx-broker-state {
                        min-height: 32px;
                        padding: 0 12px;
                        font-size: 12.5px;
                    }
                }

                @media (prefers-reduced-motion: reduce) {
                    .rtx-login-overlay,
                    .rtx-login-shell,
                    .rtx-login-panel,
                    .rtx-login-visual img,
                    .rtx-spinner {
                        animation: none !important;
                    }

                    .rtx-login-button,
                    .rtx-broker-strip {
                        transition: none !important;
                    }
                }
            `}</style>
        </div>
    );
}

const labelStyle: React.CSSProperties = {
    display: 'block',
    color: '#a0a6b0',
    fontSize: 12,
    fontWeight: 720,
    letterSpacing: 0,
    marginBottom: 10,
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: 50,
    padding: '0 16px',
    borderRadius: 4,
    border: '1px solid #2b303a',
    background: 'rgba(12, 16, 22, 0.62)',
    color: '#f4f4f5',
    fontSize: 15,
    outline: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};
