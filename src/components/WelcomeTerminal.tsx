/**
 * WelcomeTerminal renders the pre-authentication webterminal login overlay.
 * It keeps the active trading workspace visible behind the modal while the user
 * selects a broker and signs in.
 */

import React, { useCallback, useState, useEffect, useRef } from 'react';
import { ArrowRight, ChevronDown, Eye, EyeOff, Lock, User } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { authV2Api } from '../api/trade';
import { normalizeBrokerServerUrl, updateDynamicUrls, BROKER_DISCOVERY_URL, toLocalDevProxyUrl } from '../config/api';
import SplitText from './SplitText';
import {
    getBackendTarget,
    isDesktopBackendTarget,
    normalizeBrokerInfoForTarget,
    resolveBrokerBackendUrl,
    resolveBrokerExtApiUrl,
} from '../config/backendTarget.js';
import { extractBrokerDiscoveryList } from '../services/brokerDiscovery';
import { persistBrokerSessionDiscovery } from '../services/brokerSession';
import { resolveLoginHeroAsset, type LoginHeroAsset } from './welcomeHeroAssets';

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
    API_HOST?: string;
    API_HOST_EXT?: string;
    api_host?: string;
    api_host_ext?: string;
    public_backend_url?: string;
    public_ext_api_url?: string;
    web_backend_url?: string;
    web_ext_api_url?: string;
    services_url?: string;
    servicesUrl?: string;
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
const LOGIN_FIELD_BORDER = '#24424a';
const LOGIN_FIELD_FOCUS = '#35d8b2';
const LOGIN_TITLE_TEXT = 'Sign in to';
const LOGIN_TITLE_REVEAL_DELAY_MS = 90;
const LOGIN_TITLE_LOGO_INITIAL_DELAY_MS = LOGIN_TITLE_TEXT.replace(/\s/g, '').length * LOGIN_TITLE_REVEAL_DELAY_MS;
type LoginHeroFit = NonNullable<LoginHeroAsset['fit']>;
type LoginHeroImageStyle = React.CSSProperties & {
    '--rtx-login-hero-fit': LoginHeroFit;
    '--rtx-login-hero-position': string;
    '--rtx-login-hero-mobile-fit': LoginHeroFit;
    '--rtx-login-hero-mobile-position': string;
};
const RUNTIME_BROKER_URL_FIELDS = [
    'API_HOST',
    'API_HOST_EXT',
    'api_host',
    'api_host_ext',
    'public_backend_url',
    'public_ext_api_url',
    'web_backend_url',
    'web_ext_api_url',
    'services_url',
    'servicesUrl',
    'backend_url',
    'market_api_url',
    'server_url',
] as const satisfies readonly (keyof BrokerServerItem)[];

const normalizeComparableRuntimeUrl = (value: string | number | undefined): string => {
    const normalized = normalizeBrokerServerUrl(String(value || '').trim()).replace(/\/+$/, '');
    if (!normalized) return '';

    try {
        const parsed = new URL(normalized);
        parsed.pathname = '';
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString().replace(/\/+$/, '').toLowerCase();
    } catch {
        return normalized.toLowerCase();
    }
};

const getBrokerRuntimeUrls = (broker: BrokerServerItem): string[] =>
    RUNTIME_BROKER_URL_FIELDS
        .map(field => normalizeComparableRuntimeUrl(broker[field]))
        .filter((value): value is string => Boolean(value));

const findBrokerForRuntimeTarget = (brokers: BrokerServerItem[]): BrokerServerItem | undefined => {
    const runtimeTarget = normalizeComparableRuntimeUrl(getBackendTarget());
    if (!runtimeTarget) return undefined;

    return brokers.find(broker => getBrokerRuntimeUrls(broker).includes(runtimeTarget));
};

const brokerMatchesLookup = (broker: BrokerServerItem, value: string | number | null | undefined): boolean => {
    const lookup = String(value || '').trim().toLowerCase();
    if (!lookup) return false;

    return [broker.broker_id, broker.server, broker.server_url]
        .map(candidate => String(candidate || '').trim().toLowerCase())
        .includes(lookup);
};

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

    const isDesktopBrokerSelection = isDesktopBackendTarget();
    const [brokerList, setBrokerList] = useState<BrokerServerItem[]>([]);
    const [selectedBroker, setSelectedBroker] = useState<BrokerServerItem | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [healthStatus, setHealthStatus] = useState<'checking' | 'online' | 'offline' | null>(null);
    const [brokerListStatus, setBrokerListStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const healthAbortRef = useRef<AbortController | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

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

    const runHealthCheck = useCallback(async (serverUrl: string) => {
        healthAbortRef.current?.abort();
        const controller = new AbortController();
        healthAbortRef.current = controller;

        setHealthStatus('checking');

        const timeoutId = setTimeout(() => {
            controller.abort();
        }, 3000);

        try {
            const cleanUrl = normalizeBrokerServerUrl(serverUrl).replace(/\/$/, '');
            const response = await fetch(toLocalDevProxyUrl(`${cleanUrl}/api/v2/time`), { signal: controller.signal });
            clearTimeout(timeoutId);
            setHealthStatus(response.ok ? 'online' : 'offline');
        } catch (err: unknown) {
            clearTimeout(timeoutId);
            if (!isAbortError(err)) {
                setHealthStatus('offline');
            }
        }
    }, []);

    const applySelectedBroker = useCallback((broker: BrokerServerItem) => {
        const normalizedBroker = normalizeBrokerInfoForTarget(broker) as BrokerServerItem;
        setSelectedBroker({
            ...broker,
            ...normalizedBroker,
            server_url: resolveBrokerBackendUrl(normalizedBroker),
        });
        setSearchQuery(broker.broker_name);
        runHealthCheck(resolveBrokerExtApiUrl(normalizedBroker));
    }, [runHealthCheck]);

    const handleSelectBroker = (broker: BrokerServerItem) => {
        if (!isDesktopBrokerSelection) return;
        applySelectedBroker(broker);
        setError(null);
        setDropdownOpen(false);
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

                const savedBrokerId = localStorage.getItem('broker_id') || localStorage.getItem('rtx_broker_id');
                const runtimeBroker = isDesktopBrokerSelection ? undefined : findBrokerForRuntimeTarget(data);
                const savedBroker = isDesktopBrokerSelection ? data.find(b => brokerMatchesLookup(b, savedBrokerId)) : undefined;
                const configuredBrokerId = DEFAULT_BROKER_ID;
                const configuredBroker = data.find(b => brokerMatchesLookup(b, configuredBrokerId));
                const selectedDiscoveryBroker = isDesktopBrokerSelection
                    ? savedBroker || configuredBroker || data[0]
                    : runtimeBroker || configuredBroker || data[0];

                if (selectedDiscoveryBroker) {
                    applySelectedBroker(selectedDiscoveryBroker);
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
    }, [applySelectedBroker, isDesktopBrokerSelection]);

    useEffect(() => {
        if (!dropdownOpen) return;

        const handleOutsideMouseDown = (event: MouseEvent) => {
            if (!dropdownRef.current || dropdownRef.current.contains(event.target as Node)) return;
            setDropdownOpen(false);
            if (selectedBroker) {
                setSearchQuery(selectedBroker.broker_name);
            }
        };

        document.addEventListener('mousedown', handleOutsideMouseDown);
        return () => document.removeEventListener('mousedown', handleOutsideMouseDown);
    }, [dropdownOpen, selectedBroker]);

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
    const filteredBrokers = brokerList.filter(broker => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return true;
        return String(broker.broker_name || '').toLowerCase().includes(query)
            || String(broker.broker_id || '').toLowerCase().includes(query)
            || String(broker.region || '').toLowerCase().includes(query);
    });
    const loginHeroAsset = resolveLoginHeroAsset(selectedBroker);
    const loginHeroVisualStyle: React.CSSProperties = {
        backgroundColor: '#020507',
    };
    const desktopHeroFit = loginHeroAsset.fit ?? 'cover';
    const desktopHeroPosition = loginHeroAsset.position ?? 'center center';
    const loginHeroImageStyle: LoginHeroImageStyle = {
        '--rtx-login-hero-fit': desktopHeroFit,
        '--rtx-login-hero-position': desktopHeroPosition,
        '--rtx-login-hero-mobile-fit': loginHeroAsset.mobileFit ?? desktopHeroFit,
        '--rtx-login-hero-mobile-position': loginHeroAsset.mobilePosition ?? desktopHeroPosition,
    };

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
                <aside className="rtx-login-visual" aria-hidden="true" style={loginHeroVisualStyle}>
                    <picture>
                        <source media="(max-width: 760px)" srcSet={loginHeroAsset.mobileSrc ?? loginHeroAsset.src} />
                        <img
                            src={loginHeroAsset.src}
                            alt=""
                            width={loginHeroAsset.width}
                            height={loginHeroAsset.height}
                            style={loginHeroImageStyle}
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
                                        text={LOGIN_TITLE_TEXT}
                                        className="rtx-login-title-text"
                                        delay={LOGIN_TITLE_REVEAL_DELAY_MS}
                                        duration={1.05}
                                        ease="power3.out"
                                        splitType="words, chars"
                                        from={{ opacity: 0, y: 18, filter: 'blur(5px)' }}
                                        to={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                                        threshold={0.05}
                                        rootMargin="0px"
                                        textAlign="left"
                                    />
                                    <SplitText
                                        tag="span"
                                        text="RTX 5"
                                        className="rtx-login-title-logo-reveal"
                                        delay={LOGIN_TITLE_REVEAL_DELAY_MS}
                                        initialDelay={LOGIN_TITLE_LOGO_INITIAL_DELAY_MS}
                                        duration={1.05}
                                        ease="power3.out"
                                        splitType="chars"
                                        from={{ opacity: 0, y: 18, filter: 'blur(5px)' }}
                                        to={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                                        threshold={0.05}
                                        rootMargin="0px"
                                        textAlign="left"
                                    >
                                        <img
                                            src="/brand/rtx5-logo.png"
                                            alt=""
                                            aria-hidden="true"
                                            className="rtx-login-title-logo"
                                            width={720}
                                            height={197}
                                            loading="eager"
                                            decoding="async"
                                            fetchPriority="high"
                                        />
                                    </SplitText>
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
                                            onFocus={e => {
                                                const shell = e.currentTarget.parentElement;
                                                if (!shell) return;
                                                shell.style.borderColor = LOGIN_FIELD_FOCUS;
                                                shell.style.boxShadow = '0 0 0 3px rgba(53, 216, 178, 0.12)';
                                            }}
                                            onBlur={e => {
                                                const shell = e.currentTarget.parentElement;
                                                if (!shell) return;
                                                shell.style.borderColor = LOGIN_FIELD_BORDER;
                                                shell.style.boxShadow = 'none';
                                            }}
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
                                            onFocus={e => {
                                                const shell = e.currentTarget.parentElement;
                                                if (!shell) return;
                                                shell.style.borderColor = LOGIN_FIELD_FOCUS;
                                                shell.style.boxShadow = '0 0 0 3px rgba(53, 216, 178, 0.12)';
                                            }}
                                            onBlur={e => {
                                                const shell = e.currentTarget.parentElement;
                                                if (!shell) return;
                                                shell.style.borderColor = LOGIN_FIELD_BORDER;
                                                shell.style.boxShadow = 'none';
                                            }}
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
                                    <div
                                        ref={isDesktopBrokerSelection ? dropdownRef : undefined}
                                        className={`rtx-broker-input-wrap ${isDesktopBrokerSelection ? 'is-selectable' : 'is-locked'}`}
                                    >
                                        {selectedBroker?.logo_url && (
                                            <img src={selectedBroker.logo_url} alt="" className="rtx-broker-logo" decoding="async" />
                                        )}
                                        <input
                                            id="rtxBrokerServer"
                                            name="brokerServer"
                                            type="text"
                                            placeholder={
                                                brokerListStatus === 'loading'
                                                    ? 'Resolving broker...'
                                                    : isDesktopBrokerSelection
                                                        ? 'Search broker...'
                                                        : 'Broker resolved from domain'
                                            }
                                            required
                                            autoComplete="organization"
                                            value={searchQuery}
                                            readOnly={!isDesktopBrokerSelection}
                                            aria-readonly={!isDesktopBrokerSelection}
                                            aria-haspopup={isDesktopBrokerSelection ? 'listbox' : undefined}
                                            aria-expanded={isDesktopBrokerSelection ? dropdownOpen : undefined}
                                            aria-controls={isDesktopBrokerSelection ? 'rtxBrokerServerMenu' : undefined}
                                            title={isDesktopBrokerSelection ? 'Choose broker server' : 'Broker server is resolved automatically from this domain'}
                                            onChange={e => {
                                                if (!isDesktopBrokerSelection) return;
                                                setSearchQuery(e.target.value);
                                                setDropdownOpen(true);
                                            }}
                                            onFocus={() => {
                                                if (isDesktopBrokerSelection) setDropdownOpen(true);
                                            }}
                                            onKeyDown={e => {
                                                if (!isDesktopBrokerSelection) return;
                                                if (e.key === 'Escape') {
                                                    setDropdownOpen(false);
                                                    if (selectedBroker) {
                                                        setSearchQuery(selectedBroker.broker_name);
                                                    }
                                                    return;
                                                }
                                                if (e.key === 'Enter' && dropdownOpen && filteredBrokers[0]) {
                                                    e.preventDefault();
                                                    handleSelectBroker(filteredBrokers[0]);
                                                }
                                            }}
                                            style={{
                                                ...inputStyle,
                                                paddingLeft: selectedBroker?.logo_url ? 42 : 16,
                                                paddingRight: isDesktopBrokerSelection ? 54 : 32,
                                                color: '#ffffff',
                                            }}
                                        />
                                        <div className="rtx-broker-input-state" aria-hidden="true">
                                            <span style={{ background: healthTone }} />
                                            {isDesktopBrokerSelection && (
                                                <ChevronDown
                                                    size={14}
                                                    strokeWidth={2.2}
                                                    className={dropdownOpen ? 'is-open' : undefined}
                                                />
                                            )}
                                        </div>
                                        {isDesktopBrokerSelection && dropdownOpen && (
                                            <div id="rtxBrokerServerMenu" className="rtx-broker-menu" role="listbox">
                                                {filteredBrokers.length === 0 ? (
                                                    <div className="rtx-broker-empty">No brokers found</div>
                                                ) : (
                                                    filteredBrokers.map(item => (
                                                        <button
                                                            key={item.broker_id}
                                                            type="button"
                                                            role="option"
                                                            aria-selected={selectedBroker?.broker_id === item.broker_id}
                                                            onMouseDown={event => {
                                                                event.preventDefault();
                                                                handleSelectBroker(item);
                                                            }}
                                                            className={`rtx-broker-option ${selectedBroker?.broker_id === item.broker_id ? 'is-selected' : ''}`}
                                                        >
                                                            <span>
                                                                {item.logo_url ? (
                                                                    <img src={item.logo_url} alt="" decoding="async" />
                                                                ) : (
                                                                    <i aria-hidden="true">B</i>
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
                    font-family: var(--font-login-sans, var(--font-sans));
                    animation: none;
                }

                .rtx-login-overlay button,
                .rtx-login-overlay input,
                .rtx-login-overlay label,
                .rtx-login-overlay select,
                .rtx-login-overlay textarea {
                    font-family: inherit;
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
                    object-fit: var(--rtx-login-hero-fit, cover);
                    object-position: var(--rtx-login-hero-position, center center);
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
                    cursor: default;
                }

                .rtx-broker-input-wrap input {
                    cursor: default;
                }

                .rtx-broker-input-wrap.is-selectable,
                .rtx-broker-input-wrap.is-selectable input {
                    cursor: text;
                }

                .rtx-broker-input-wrap.is-locked input {
                    color: #ffffff !important;
                    background: #101318;
                }

                .rtx-broker-input-wrap input::placeholder {
                    color: rgba(255, 255, 255, 0.65) !important;
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

                .rtx-broker-input-state svg {
                    color: #9aa6ad;
                    transition: transform 0.16s ease, color 0.16s ease;
                }

                .rtx-broker-input-state svg.is-open {
                    color: #d9fff5;
                    transform: rotate(180deg);
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
                        object-fit: var(--rtx-login-hero-mobile-fit, var(--rtx-login-hero-fit, cover));
                        object-position: var(--rtx-login-hero-mobile-position, var(--rtx-login-hero-position, center center));
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
                    height: 100dvh;
                    display: grid;
                    grid-template-columns: minmax(0, 63.2%) minmax(520px, 36.8%);
                    grid-template-rows: minmax(0, 1fr);
                    overflow: hidden;
                    background: #06080c;
                }

                .rtx-login-visual {
                    position: relative;
                    inset: auto;
                    min-width: 0;
                    min-height: 0;
                    height: 100%;
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
                    object-fit: var(--rtx-login-hero-fit, cover);
                    object-position: var(--rtx-login-hero-position, left center);
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
                    min-height: 0;
                    height: 100%;
                    display: flex;
                    align-items: flex-start;
                    justify-content: center;
                    overflow: hidden;
                    padding: clamp(42px, 7.5vh, 86px) clamp(54px, 5.25vw, 88px);
                    background:
                        linear-gradient(180deg, #10181c 0%, #0d1418 46%, #090f13 100%);
                    box-shadow:
                        inset 1px 0 0 rgba(53, 216, 178, 0.18),
                        inset 10px 0 24px rgba(0, 0, 0, 0.12);
                }

                .rtx-login-panel {
                    width: min(clamp(442px, 26.45vw, 508px), 100%);
                    min-width: 0;
                    margin-top: clamp(42px, 5vh, 48px);
                    padding: clamp(24px, 2.6vw, 32px);
                    border: 1px solid rgba(48, 106, 97, 0.36);
                    border-radius: 8px;
                    background:
                        linear-gradient(180deg, rgba(12, 24, 28, 0.86) 0%, rgba(8, 14, 19, 0.78) 100%);
                    box-shadow:
                        0 16px 34px rgba(0, 0, 0, 0.24),
                        inset 0 1px 0 rgba(255, 255, 255, 0.055),
                        inset 0 0 0 1px rgba(53, 216, 178, 0.035);
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
                    background: linear-gradient(90deg, rgba(53, 216, 178, 0.58), rgba(128, 195, 63, 0.28) 44%, transparent 100%);
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

                .rtx-login-title-logo-reveal .split-char {
                    display: inline-block;
                    line-height: 0;
                    vertical-align: middle;
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
                    border: 1px solid rgba(61, 119, 107, 0.48);
                    border-radius: 8px;
                    background:
                        linear-gradient(135deg, rgba(19, 35, 38, 0.94) 0%, rgba(10, 20, 24, 0.88) 54%, rgba(7, 12, 17, 0.97) 100%);
                    box-shadow:
                        0 12px 26px rgba(0, 0, 0, 0.22),
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
                        linear-gradient(90deg, rgba(53, 216, 178, 0.16), transparent 46%),
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
                        linear-gradient(145deg, rgba(30, 58, 58, 0.98), rgba(11, 22, 27, 0.98));
                    border: 1px solid rgba(69, 135, 121, 0.58);
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
                    background: color-mix(in srgb, currentColor 11%, rgba(8, 18, 21, 0.86));
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
                    border: 1px solid #24424a;
                    border-radius: 6px;
                    background:
                        linear-gradient(180deg, rgba(8, 20, 23, 0.78), rgba(7, 13, 18, 0.78));
                    color: #86a7a4;
                    box-shadow: none;
                    transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
                }

                .rtx-input-shell:focus-within {
                    border-color: #35d8b2;
                    background:
                        linear-gradient(180deg, rgba(10, 27, 29, 0.9), rgba(8, 17, 21, 0.9));
                    box-shadow:
                        0 0 0 2px rgba(53, 216, 178, 0.12);
                }

                .rtx-input-shell input {
                    min-width: 0;
                    flex: 1;
                    height: 48px;
                    min-height: 0 !important;
                    padding: 0 !important;
                    border-radius: 0 !important;
                    border: 0 !important;
                    background: transparent !important;
                    box-shadow: none !important;
                    outline: none !important;
                    color: #f4f5f7 !important;
                    caret-color: #35d8b2;
                    appearance: none;
                    -webkit-appearance: none;
                    color-scheme: dark;
                }

                .rtx-input-shell input::placeholder,
                .rtx-input-shell input::-webkit-input-placeholder,
                .rtx-input-shell input::-moz-placeholder,
                .rtx-input-shell input:-ms-input-placeholder,
                .rtx-broker-input-wrap input::placeholder,
                .rtx-broker-input-wrap input::-webkit-input-placeholder,
                .rtx-broker-input-wrap input::-moz-placeholder,
                .rtx-broker-input-wrap input:-ms-input-placeholder {
                    color: rgba(255, 255, 255, 0.48) !important;
                }

                .rtx-input-shell input:-webkit-autofill,
                .rtx-input-shell input:-webkit-autofill:hover,
                .rtx-input-shell input:-webkit-autofill:focus,
                .rtx-broker-input-wrap input:-webkit-autofill,
                .rtx-broker-input-wrap input:-webkit-autofill:hover,
                .rtx-broker-input-wrap input:-webkit-autofill:focus {
                    -webkit-text-fill-color: #f4f5f7 !important;
                    box-shadow: 0 0 0 1000px #0b1518 inset !important;
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
                    color: #86a7a4;
                    cursor: pointer;
                    flex: 0 0 auto;
                    transition: color 0.16s ease, background 0.16s ease;
                }

                .rtx-password-toggle:hover,
                .rtx-password-toggle:focus-visible {
                    color: #c8fff1;
                    background: rgba(53, 216, 178, 0.08);
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
                    cursor: default;
                }

                .rtx-broker-input-wrap input {
                    cursor: default;
                }

                .rtx-broker-input-wrap.is-selectable,
                .rtx-broker-input-wrap.is-selectable input {
                    cursor: text;
                }

                .rtx-broker-input-wrap.is-locked input {
                    color: #ffffff !important;
                    -webkit-text-fill-color: #ffffff !important;
                    border-color: #24424a !important;
                    background: rgba(8, 18, 20, 0.76) !important;
                    box-shadow: none !important;
                    outline: none !important;
                }

                .rtx-broker-input-wrap.is-locked input::placeholder {
                    color: rgba(255, 255, 255, 0.75) !important;
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
                    gap: 9px;
                    color: #8d94a0;
                    transform: translateY(-50%);
                    pointer-events: none;
                }

                .rtx-broker-input-state svg {
                    color: #9aa6ad;
                    transition: transform 0.16s ease, color 0.16s ease;
                }

                .rtx-broker-input-state svg.is-open {
                    color: #d9fff5;
                    transform: rotate(180deg);
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
                    background:
                        linear-gradient(180deg, rgba(95, 23, 33, 0.36), rgba(61, 18, 26, 0.28));
                    border: 1px solid rgba(248, 113, 113, 0.34);
                    color: #ff8585;
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
                    accent-color: #35d8b2;
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
                    border-radius: 6px;
                    background: linear-gradient(180deg, #54e39d 0%, #2fc58c 100%);
                    color: #02130e;
                    font-size: 16px;
                    font-weight: 850;
                    cursor: pointer;
                    box-shadow:
                        inset 0 1px 0 rgba(255, 255, 255, 0.26);
                    transition: transform 0.15s ease, background 0.15s ease, opacity 0.15s ease, box-shadow 0.15s ease;
                }

                .rtx-login-button:hover:not(:disabled) {
                    background: linear-gradient(180deg, #64efaa 0%, #25b97f 100%);
                    box-shadow:
                        inset 0 1px 0 rgba(255, 255, 255, 0.30);
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

                @media (max-width: 1040px) {
                    .rtx-login-overlay {
                        overflow-y: auto;
                    }

                    .rtx-login-stage {
                        min-height: 100dvh;
                        height: auto;
                        display: block;
                        overflow: visible;
                        background: #06080c;
                    }

                    .rtx-login-visual {
                        position: fixed;
                        inset: 0;
                        min-height: 100dvh;
                        height: 100dvh;
                    }

                    .rtx-login-visual img {
                        object-fit: var(--rtx-login-hero-mobile-fit, var(--rtx-login-hero-fit, cover));
                        object-position: var(--rtx-login-hero-mobile-position, var(--rtx-login-hero-position, left center));
                    }

                    .rtx-login-visual-shade {
                        background:
                            linear-gradient(180deg, rgba(5, 8, 12, 0.44) 0%, rgba(5, 8, 12, 0.7) 42%, rgba(5, 8, 12, 0.88) 100%),
                            linear-gradient(90deg, rgba(0, 0, 0, 0.16) 0%, rgba(0, 0, 0, 0.5) 100%);
                    }

                    .rtx-login-panel-wrap {
                        position: relative;
                        z-index: 1;
                        width: 100%;
                        min-height: 100dvh;
                        height: auto;
                        align-items: center;
                        align-items: safe center;
                        overflow-y: auto;
                        overflow-x: hidden;
                        padding:
                            max(24px, env(safe-area-inset-top))
                            max(16px, env(safe-area-inset-right))
                            max(24px, env(safe-area-inset-bottom))
                            max(16px, env(safe-area-inset-left));
                        border-left: 0;
                        background: transparent;
                        box-shadow: none;
                    }

                    .rtx-login-panel {
                        width: min(468px, 100%);
                        margin-top: 0;
                    }
                }

                @media (min-width: 901px) and (max-height: 820px) {
                    .rtx-login-panel-wrap {
                        align-items: center;
                        padding-top: clamp(20px, 3.25vh, 30px);
                        padding-bottom: clamp(20px, 3.25vh, 30px);
                    }

                    .rtx-login-panel {
                        margin-top: 0;
                        padding: 22px 24px;
                    }

                    .rtx-form-header {
                        margin-bottom: 13px;
                        padding-bottom: 14px;
                    }

                    .rtx-form-header h1 {
                        font-size: 27px;
                    }

                    .rtx-login-title-logo {
                        width: 124px;
                    }

                    .rtx-broker-strip {
                        min-height: 64px;
                        gap: 14px;
                        margin-bottom: 16px;
                        padding: 11px 14px;
                    }

                    .rtx-route-logo {
                        width: 38px;
                        height: 38px;
                    }

                    .rtx-route-logo img {
                        width: 24px;
                        height: 24px;
                    }

                    .rtx-route-copy {
                        gap: 4px;
                    }

                    .rtx-route-row strong {
                        font-size: 16px;
                    }

                    .rtx-broker-state {
                        min-height: 29px;
                        padding: 0 12px;
                        font-size: 12.5px;
                    }

                    .rtx-login-form {
                        gap: 12px;
                    }

                    .rtx-input-shell {
                        min-height: 44px;
                        padding: 0 13px;
                    }

                    .rtx-input-shell input {
                        height: 42px;
                    }

                    .rtx-login-button {
                        min-height: 45px;
                    }

                    .rtx-login-footer {
                        margin-top: 12px;
                        padding-top: 14px;
                    }
                }

                @media (min-width: 901px) and (max-height: 700px) {
                    .rtx-login-overlay {
                        overflow-y: auto;
                    }

                    .rtx-login-stage {
                        min-height: 100dvh;
                        height: auto;
                    }

                    .rtx-login-panel-wrap {
                        min-height: 100dvh;
                        height: auto;
                        overflow-y: auto;
                        padding-top: 16px;
                        padding-bottom: 16px;
                    }

                    .rtx-login-panel {
                        padding: 18px 22px;
                    }

                    .rtx-form-header {
                        margin-bottom: 11px;
                        padding-bottom: 12px;
                    }

                    .rtx-form-header h1 {
                        font-size: 25px;
                        gap: 10px;
                    }

                    .rtx-login-title-logo {
                        width: 112px;
                    }

                    .rtx-broker-strip {
                        min-height: 58px;
                        margin-bottom: 13px;
                        padding: 9px 12px;
                    }

                    .rtx-route-logo {
                        width: 34px;
                        height: 34px;
                    }

                    .rtx-route-logo img {
                        width: 22px;
                        height: 22px;
                    }

                    .rtx-summary-label {
                        font-size: 11px;
                    }

                    .rtx-route-row strong {
                        font-size: 15px;
                    }

                    .rtx-login-form {
                        gap: 10px;
                    }

                    .rtx-input-shell {
                        min-height: 41px;
                    }

                    .rtx-input-shell input {
                        height: 39px;
                    }

                    .rtx-login-button {
                        min-height: 42px;
                    }
                }

                @media (max-width: 900px) {
                    .rtx-login-overlay {
                        overflow: hidden;
                    }

                    .rtx-login-stage {
                        min-height: 100dvh;
                        height: 100dvh;
                        display: block;
                        overflow: hidden;
                        background: #06080c;
                    }

                    .rtx-login-visual {
                        position: fixed;
                        inset: 0;
                        min-height: 100dvh;
                        height: 100dvh;
                    }

                    .rtx-login-visual img {
                        object-fit: var(--rtx-login-hero-mobile-fit, var(--rtx-login-hero-fit, cover));
                        object-position: var(--rtx-login-hero-mobile-position, var(--rtx-login-hero-position, left center));
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
                        height: 100dvh;
                        align-items: center;
                        align-items: safe center;
                        overflow: hidden;
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
                        border: 1px solid rgba(48, 106, 97, 0.44);
                        border-radius: 8px;
                        background:
                            linear-gradient(180deg, rgba(12, 24, 28, 0.9) 0%, rgba(8, 14, 19, 0.84) 100%);
                        box-shadow:
                            0 16px 34px rgba(0, 0, 0, 0.34),
                            inset 0 1px 0 rgba(255, 255, 255, 0.055);
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

                @media (max-width: 900px) and (max-height: 720px) {
                    .rtx-login-panel-wrap {
                        padding:
                            max(16px, env(safe-area-inset-top))
                            max(12px, env(safe-area-inset-right))
                            max(16px, env(safe-area-inset-bottom))
                            max(12px, env(safe-area-inset-left));
                    }

                    .rtx-login-panel {
                        padding: 16px;
                    }

                    .rtx-form-header {
                        margin-bottom: 12px;
                        padding-bottom: 12px;
                    }

                    .rtx-form-header h1 {
                        gap: 8px;
                        font-size: 24px;
                    }

                    .rtx-login-title-logo {
                        width: 104px;
                    }

                    .rtx-broker-strip {
                        gap: 10px;
                        margin-bottom: 13px;
                        padding: 12px;
                    }

                    .rtx-route-logo {
                        width: 34px;
                        height: 34px;
                    }

                    .rtx-route-logo img {
                        width: 22px;
                        height: 22px;
                    }

                    .rtx-login-form {
                        gap: 10px;
                    }

                    .rtx-input-shell {
                        min-height: 42px;
                    }

                    .rtx-input-shell input {
                        height: 40px;
                    }

                    .rtx-login-button {
                        min-height: 42px;
                    }

                    .rtx-login-footer {
                        margin-top: 12px;
                        padding-top: 12px;
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
    color: '#a9c8c2',
    fontSize: 12,
    fontWeight: 720,
    letterSpacing: 0,
    marginBottom: 10,
    fontFamily: 'var(--font-login-sans, var(--font-sans))',
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: 50,
    padding: '0 16px',
    borderRadius: 6,
    border: '0',
    background: 'transparent',
    color: '#f4f4f5',
    fontSize: 15,
    outline: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    fontFamily: 'var(--font-login-sans, var(--font-sans))',
};
