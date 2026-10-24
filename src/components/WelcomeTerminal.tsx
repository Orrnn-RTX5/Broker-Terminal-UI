import { useUiTranslation } from '../hooks/useUiTranslation';
import { useDesktopStartupReady } from '../startup/useDesktopStartupReady';
import { useSavedLogin } from '../hooks/useSavedLogin';
import { getAuthenticatedAccountName } from '../utils/accountDisplayName';
import { resolveTradingAccountType } from '../services/tradingAccountType';
/**
 * WelcomeTerminal renders the lightweight pre-authentication webterminal.
 * Authenticated chart, data, and WebSocket modules are loaded separately.
 */

import React, { useCallback, useState, useEffect, useRef } from 'react';
import './WelcomeTerminal.css';
import { normalizeBrokerServerUrl, updateDynamicUrls, toLocalDevProxyUrl } from '../config/api';
import {
    getBackendTarget,
    isConfiguredBrokerEndpoint,
    getRuntimeConfiguredBrokerId,
    getRuntimeBrokerConfiguration,
    isDesktopBackendTarget,
    normalizeBrokerInfoForTarget,
    resolveBrokerBackendUrl,
    resolveBrokerExtApiUrl,
} from '../config/backendTarget.js';
import { filterBrokerDirectory, firstSelectableBroker, getDirectoryBrokerServerUrl, isDirectoryBrokerSelectable, isBrokerSuspended } from '../services/brokerDiscovery';
import { loadAppBrokerDirectory } from '../services/brokerDirectory';
import { resolveServerDisplayLabel, useKnownBrokerServerName } from '../services/brokerServerIdentity';
import {
    applyBrokerChrome,
    loadBrokerPresentation,
    mergeBrokerPresentation,
    normalizeBrokerThemeColor,
} from '../services/brokerPresentation';
import { resolveLoginHeroAsset, type LoginHeroAsset } from './welcomeHeroAssets';
import { BrokerLogoImage, buildBrokerDirectoryLogoUrl } from './BrokerLogoImage';
import { resolveLoginTitleBrandName } from './loginTitleBrand';
import {
    beginLoginPerformanceMeasurement,
    markAuthenticationAccepted,
    markAuthenticationRequestStarted,
    markPostAuthenticationPhase,
    scheduleAuthenticatedShellPaintMeasurement,
    waitForLoginFeedbackPaint,
} from '../startup/performanceBudget';
import {
    loadAuthenticatedLoginStoreRuntime,
    preloadLoginTransportRuntime,
} from '../startup/loginRuntime';
import {
    createAuthenticatedSessionHandoff,
    type AuthenticatedSessionHandoff,
} from '../startup/authenticatedSessionHandoff';

export interface BrokerServerItem {
    broker_id: string;
    broker_name: string;
    id?: string | number;
    name?: string;
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
    domain?: string;
    domains?: string[] | string;
    webterminal_domain?: string;
    web_terminal_domain?: string;
    webterminal_url?: string;
    web_terminal_url?: string;
    frontend_domain?: string;
    frontend_url?: string;
    client_domain?: string;
    client_url?: string;
    login_domain?: string;
    login_url?: string;
    admin_domain?: string;
    admin_url?: string;
    manager_domain?: string;
    manager_url?: string;
    logo_url: string;
    theme_color?: string;
    login_hero_url?: string;
    login_hero_mobile_url?: string;
    region?: string;
    [key: string]: unknown;
}

interface WelcomeTerminalProps {
    onLogin: (accountId: string, handoff: AuthenticatedSessionHandoff) => void;
    onPrepareTerminal?: () => Promise<unknown> | void;
    onPreloadTerminalPresentation?: () => Promise<unknown> | void;
}

const buildBrokerApiV2BaseUrl = (value: string): string => `${normalizeBrokerServerUrl(value).replace(/\/$/, '')}/api/v2`;
const RTX5_GREEN = '#80c33f';
const LOGIN_FIELD_BORDER = '#24424a';
const LOGIN_FIELD_FOCUS = '#35d8b2';
const LOGIN_FIELD_FOCUS_SHADOW = '0 0 0 3px rgba(53, 216, 178, 0.12)';
const ACCENT_LOGIN_FIELD_BORDER = '#1d3f68';
const ACCENT_LOGIN_FIELD_FOCUS = '#2f8cff';
const ACCENT_LOGIN_FIELD_FOCUS_SHADOW = '0 0 0 3px rgba(47, 140, 255, 0.16)';
const LOGIN_TITLE_TEXT = 'Sign in to';
const LOGIN_TITLE_ACCESSIBLE_LABEL = 'Sign in';
const BROKER_PRESENTATION_CACHE_KEY = 'rtx_broker_presentation_v1';
export const LAST_AUTHENTICATED_BROKER_ID_KEY = 'rtx_last_authenticated_broker_id';

interface BrokerPresentationCache {
    version: 1;
    brokerId: string;
    brokerName: string;
    logoUrl: string;
    region?: string;
    healthVerifiedAt?: number;
}

const BROKER_HEALTH_FRESH_MS = 24 * 60 * 60 * 1000;

const readBrokerPresentationCache = (brokerId: string): BrokerPresentationCache | null => {
    if (typeof window === 'undefined' || !brokerId) return null;
    try {
        const parsed = JSON.parse(localStorage.getItem(BROKER_PRESENTATION_CACHE_KEY) || 'null') as Partial<BrokerPresentationCache> | null;
        if (!parsed || parsed.version !== 1 || String(parsed.brokerId || '') !== brokerId) return null;
        return {
            version: 1,
            brokerId,
            brokerName: String(parsed.brokerName || brokerId),
            logoUrl: String(parsed.logoUrl || ''),
            region: parsed.region ? String(parsed.region) : undefined,
            healthVerifiedAt: Number.isFinite(Number(parsed.healthVerifiedAt))
                ? Number(parsed.healthVerifiedAt)
                : undefined,
        };
    } catch {
        return null;
    }
};

const writeBrokerPresentationCache = (broker: BrokerServerItem, healthVerifiedAt?: number): void => {
    if (typeof window === 'undefined' || !broker.broker_id) return;
    try {
        const existing = readBrokerPresentationCache(String(broker.broker_id));
        const cached: BrokerPresentationCache = {
            version: 1,
            brokerId: String(broker.broker_id),
            brokerName: String(broker.broker_name || broker.broker_id),
            logoUrl: String(broker.logo_url || existing?.logoUrl || ''),
            region: broker.region ? String(broker.region) : undefined,
            healthVerifiedAt: healthVerifiedAt ?? existing?.healthVerifiedAt,
        };
        localStorage.setItem(BROKER_PRESENTATION_CACHE_KEY, JSON.stringify(cached));
    } catch {
        // Storage can be unavailable in hardened browser contexts.
    }
};

const hasFreshBrokerHealth = (brokerId: string): boolean => {
    const verifiedAt = readBrokerPresentationCache(brokerId)?.healthVerifiedAt;
    return typeof verifiedAt === 'number' && Date.now() - verifiedAt <= BROKER_HEALTH_FRESH_MS;
};

const buildDesktopBrokerPreview = (
    configuredRuntimeBroker: BrokerServerItem | null,
): BrokerServerItem | null => {
    if (typeof window === 'undefined') return configuredRuntimeBroker;

    const savedBrokerId = String(
        localStorage.getItem('broker_id') || localStorage.getItem('rtx_broker_id') || '',
    ).trim();
    const lastAuthenticatedBrokerId = String(
        localStorage.getItem(LAST_AUTHENTICATED_BROKER_ID_KEY) || '',
    ).trim();
    if (!savedBrokerId || savedBrokerId !== lastAuthenticatedBrokerId) return configuredRuntimeBroker;

    const cachedPresentation = readBrokerPresentationCache(savedBrokerId);
    const configuredBroker = configuredRuntimeBroker?.broker_id === savedBrokerId
        ? configuredRuntimeBroker
        : null;
    return {
        ...(configuredBroker || {}),
        broker_id: savedBrokerId,
        broker_name: cachedPresentation?.brokerName
            || String(localStorage.getItem('broker_name') || '').trim()
            || configuredBroker?.broker_name
            || savedBrokerId,
        server: savedBrokerId,
        server_url: configuredBroker?.server_url || '',
        logo_url: cachedPresentation?.logoUrl
            || String(localStorage.getItem('logo_url') || '').trim()
            || configuredBroker?.logo_url
            || buildBrokerDirectoryLogoUrl(savedBrokerId),
        region: cachedPresentation?.region || configuredBroker?.region,
        theme_color: normalizeBrokerThemeColor(localStorage.getItem('broker_theme_color'))
            || configuredBroker?.theme_color,
    };
};

type LoginIconName = 'arrow-right' | 'chevron-down' | 'eye' | 'eye-off' | 'lock' | 'maximize' | 'minus' | 'user' | 'x';

const LoginIcon = ({
    name,
    size = 18,
    strokeWidth = 1.8,
    className,
}: {
    name: LoginIconName;
    size?: number;
    strokeWidth?: number;
    className?: string;
}) => {
    const paths: Record<LoginIconName, React.ReactNode> = {
        'arrow-right': <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
        'chevron-down': <path d="m6 9 6 6 6-6" />,
        eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></>,
        'eye-off': <><path d="m3 3 18 18" /><path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.8" /><path d="M6.2 6.2A17 17 0 0 0 2 12s3.5 6 10 6c1 0 1.9-.1 2.7-.4" /></>,
        lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
        maximize: <><path d="M8 3H3v5" /><path d="m3 3 6 6" /><path d="M16 21h5v-5" /><path d="m21 21-6-6" /></>,
        minus: <path d="M5 12h14" />,
        user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
        x: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
    };

    return (
        <svg
            aria-hidden="true"
            className={className}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            {paths[name]}
        </svg>
    );
};
type LoginHeroFit = NonNullable<LoginHeroAsset['fit']>;
type LoginHeroImageStyle = React.CSSProperties & {
    '--rtx-login-hero-fit': LoginHeroFit;
    '--rtx-login-hero-position': string;
    '--rtx-login-hero-mobile-fit': LoginHeroFit;
    '--rtx-login-hero-mobile-position': string;
};
type LoginOverlayStyle = React.CSSProperties & {
    '--rtx-broker-accent': string;
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

const BROKER_IDENTITY_DOMAIN_FIELDS = [
    'domain',
    'domains',
    'webterminal_domain',
    'web_terminal_domain',
    'webterminal_url',
    'web_terminal_url',
    'frontend_domain',
    'frontend_url',
    'client_domain',
    'client_url',
    'login_domain',
    'login_url',
    'admin_domain',
    'admin_url',
    'manager_domain',
    'manager_url',
] as const satisfies readonly (keyof BrokerServerItem)[];

const normalizeComparableRuntimeUrl = (value: unknown): string => {
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

export const findBrokerForRuntimeTarget = (brokers: BrokerServerItem[]): BrokerServerItem | undefined => {
    const runtimeTarget = normalizeComparableRuntimeUrl(getBackendTarget());
    if (!runtimeTarget) return undefined;

    return brokers.find(broker => getBrokerRuntimeUrls(broker).includes(runtimeTarget));
};

const normalizeComparableHostname = (value: unknown): string => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';

    const candidate = raw.startsWith('//') || /^[a-z][a-z\d+.-]*:\/\//i.test(raw)
        ? raw
        : `https://${raw}`;

    try {
        return new URL(candidate).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
        return raw
            .replace(/^[a-z][a-z\d+.-]*:\/\//i, '')
            .replace(/^\/+/, '')
            .split(/[/?#:]/)[0]
            .replace(/^www\./i, '')
            .toLowerCase();
    }
};

const normalizeIdentityHostnames = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value.flatMap(item => normalizeIdentityHostnames(item));
    }

    return String(value || '')
        .split(',')
        .map(item => normalizeComparableHostname(item))
        .filter((item): item is string => Boolean(item));
};

const getBrokerIdentityHostnames = (broker: BrokerServerItem): string[] =>
    BROKER_IDENTITY_DOMAIN_FIELDS
        .flatMap(field => normalizeIdentityHostnames(broker[field]));

const getRuntimeHostname = (): string => {
    if (typeof window === 'undefined') return '';
    return normalizeComparableHostname(window.location?.hostname || '');
};

export const findBrokerForRuntimeDomain = (
    brokers: BrokerServerItem[],
    runtimeHostname = getRuntimeHostname()
): BrokerServerItem | undefined => {
    const hostname = normalizeComparableHostname(runtimeHostname);
    if (!hostname) return undefined;

    return brokers.find(broker => getBrokerIdentityHostnames(broker).includes(hostname));
};

export const findBrokerForWebRuntime = (
    brokers: BrokerServerItem[],
    runtimeHostname = getRuntimeHostname()
): BrokerServerItem | undefined => {
    if (!isDesktopBackendTarget()) {
        const configuration = getRuntimeBrokerConfiguration();
        if (!configuration.valid) return undefined;
        return brokers.find(broker => broker.broker_id === configuration.brokerId);
    }
    return findBrokerForRuntimeTarget(brokers) || findBrokerForRuntimeDomain(brokers, runtimeHostname);
};

const normalizeLegacyBrokerLookup = (value: unknown): string => {
    const raw = String(value ?? '').trim().replace(/\/+$/, '');
    try {
        // URL hosts are case-insensitive; paths remain case-sensitive.
        return new URL(raw).toString().replace(/\/+$/, '');
    } catch {
        return raw.toLowerCase();
    }
};

const findBrokerForLookup = (
    brokers: BrokerServerItem[],
    value: string | number | null | undefined,
): BrokerServerItem | undefined => {
    const lookup = String(value ?? '').trim();
    if (!lookup) return undefined;
    const exactBroker = brokers.find(broker => String(broker.broker_id ?? '').trim() === lookup);
    if (exactBroker) return exactBroker;

    // Preserve old saved server handles/URLs only when they identify one row.
    // A shared gateway cannot identify a registered broker or restore its login.
    const legacyLookup = normalizeLegacyBrokerLookup(lookup);
    const legacyMatches = brokers.filter(broker => [broker.server, broker.server_url]
        .some(candidate => candidate && normalizeLegacyBrokerLookup(candidate) === legacyLookup));
    return legacyMatches.length === 1 ? legacyMatches[0] : undefined;
};

const isLoopbackDirectoryBroker = (broker: BrokerServerItem): boolean => {
    const serverUrl = getDirectoryBrokerServerUrl(broker);
    if (!serverUrl) return false;

    try {
        const hostname = new URL(serverUrl).hostname.toLowerCase();
        return hostname === 'localhost'
            || hostname.endsWith('.localhost')
            || hostname === '::1'
            || hostname.startsWith('127.')
            || hostname.endsWith('.local')
            || hostname.endsWith('.local.test');
    } catch {
        return false;
    }
};

export const buildConfiguredRuntimeBroker = (): BrokerServerItem | undefined => {
    const configuration = getRuntimeBrokerConfiguration();
    const brokerId = String(getRuntimeConfiguredBrokerId() || '').trim();
    const backendUrl = String(getBackendTarget() || '').trim();
    if (!configuration.valid || !brokerId || !backendUrl) return undefined;
    const cachedPresentation = readBrokerPresentationCache(brokerId);
    const configuredBrokerName = configuration.brokerName || configuration.defaultMt5Server;
    const storedBrokerId = typeof window === 'undefined'
        ? ''
        : String(localStorage.getItem('broker_id') || localStorage.getItem('rtx_broker_id') || '').trim();
    const storedLogoUrl = typeof window !== 'undefined' && storedBrokerId === brokerId
        ? String(localStorage.getItem('logo_url') || '').trim()
        : '';

    return {
        broker_id: brokerId,
        broker_name: configuredBrokerName || cachedPresentation?.brokerName || brokerId,
        server: configuration.defaultMt5Server,
        server_url: backendUrl,
        backend_url: backendUrl,
        market_api_url: backendUrl,
        logo_url: configuration.brokerLogoUrl || buildBrokerDirectoryLogoUrl(brokerId) || cachedPresentation?.logoUrl || storedLogoUrl,
        region: cachedPresentation?.region,
    };
};

export const pickDiscoveryBroker = (
    brokers: BrokerServerItem[],
    options: {
        isDesktopBrokerSelection?: boolean;
        savedBrokerId?: string | null;
        lastAuthenticatedBrokerId?: string | null;
    } = {}
): BrokerServerItem | undefined => {
    const isDesktop = Boolean(options.isDesktopBrokerSelection);
    if (!isDesktop && !getRuntimeBrokerConfiguration().valid) return undefined;
    if (isDesktop) brokers = brokers.filter(isDirectoryBrokerSelectable);
    const savedBroker = findBrokerForLookup(brokers, options.savedBrokerId);
    const authenticatedSavedBroker = savedBroker
        && findBrokerForLookup(brokers, options.lastAuthenticatedBrokerId) === savedBroker
        ? savedBroker
        : undefined;
    const configuredBrokerId = getRuntimeConfiguredBrokerId();
    const configuredBroker = isDesktop
        ? findBrokerForLookup(brokers, configuredBrokerId)
        : brokers.find(broker => broker.broker_id === configuredBrokerId);
    const configuredRuntimeBroker = buildConfiguredRuntimeBroker();

    // A browser deployment owns its broker. A login saved on this same local
    // origin must not replace a newly configured broker when discovery loads.
    // Desktop deliberately keeps its user-selected, authenticated broker.
    // Suspended brokers stay visible in the directory but are never auto-picked.
    const activeAuthenticatedSavedBroker = isBrokerSuspended(authenticatedSavedBroker) ? undefined : authenticatedSavedBroker;
    const activeConfiguredBroker = isBrokerSuspended(configuredBroker) ? undefined : configuredBroker;
    const selectableBroker = firstSelectableBroker(brokers);
    // Shared directories can include local development fixtures. Keep them in
    // the desktop menu, but do not make a loopback endpoint the first launch
    // target when a real broker is available. A deliberately saved/configured
    // local broker remains respected above.
    const desktopDefaultBroker = brokers.find(broker => !isLoopbackDirectoryBroker(broker)) || selectableBroker;
    return isDesktop
        ? activeAuthenticatedSavedBroker || activeConfiguredBroker || desktopDefaultBroker
        : activeConfiguredBroker || configuredRuntimeBroker;
};

const isAbortError = (err: unknown): boolean =>
    err instanceof DOMException
        ? err.name === 'AbortError'
        : Boolean(err && typeof err === 'object' && 'name' in err && err.name === 'AbortError');

const getErrorMessage = (err: unknown, fallback: string): string =>
    err instanceof Error ? err.message : fallback;

const schedulePostLoginBookkeeping = (task: () => void): void => {
    const run = () => {
        try {
            task();
        } catch (error) {
            console.warn('[WelcomeTerminal] Deferred login bookkeeping failed:', error);
        }
    };

    if (typeof window.requestAnimationFrame === 'function' && document.visibilityState === 'visible') {
        window.requestAnimationFrame(() => window.setTimeout(run, 0));
        return;
    }

    window.setTimeout(run, 0);
};

export function WelcomeTerminal({
    onLogin,
    onPrepareTerminal,
    onPreloadTerminalPresentation,
}: WelcomeTerminalProps) {
    const tr = useUiTranslation();
    // Re-render broker labels when the broker-published server name arrives
    // (it replaces the build fallback label of the configured broker).
    useKnownBrokerServerName();
    useDesktopStartupReady();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [initialUsername] = useState(() => localStorage.getItem('rtx_saved_username') || '');
    const [showPassword, setShowPassword] = useState(false);
    const [rememberMe, setRememberMe] = useState(() => Boolean(localStorage.getItem('rtx_saved_username')));

    const isDesktopBrokerSelection = isDesktopBackendTarget();
    const [configuredRuntimeBroker] = useState<BrokerServerItem | null>(() => {
        const broker = buildConfiguredRuntimeBroker();
        if (!broker) return null;
        const normalizedBroker = normalizeBrokerInfoForTarget(broker) as BrokerServerItem;
        return {
            ...broker,
            ...normalizedBroker,
            server_url: resolveBrokerBackendUrl(normalizedBroker),
        };
    });
    const [startupBroker] = useState<BrokerServerItem | null>(() => (
        isDesktopBrokerSelection
            ? buildDesktopBrokerPreview(configuredRuntimeBroker)
            : configuredRuntimeBroker
    ));
    const [brokerList, setBrokerList] = useState<BrokerServerItem[]>(() => (
        !isDesktopBrokerSelection && configuredRuntimeBroker ? [configuredRuntimeBroker] : []
    ));
    const [selectedBroker, setSelectedBroker] = useState<BrokerServerItem | null>(startupBroker);
    const { login: username, password, setLogin: setUsername, setPassword, savePassword, setSavePassword, available: passwordSavingAvailable, restoring, storageError, persistPassword } = useSavedLogin(
        true,
        initialUsername,
        selectedBroker ? {
            brokerId: selectedBroker.broker_id,
            serverUrl: isDesktopBrokerSelection ? selectedBroker.server_url! : resolveBrokerExtApiUrl(selectedBroker),
        } : null,
    );
    const selectedBrokerRef = useRef(selectedBroker);
    const [searchQuery, setSearchQuery] = useState(startupBroker?.broker_name || '');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [healthStatus, setHealthStatus] = useState<'checking' | 'online' | 'offline' | null>(() => {
        if (isDesktopBrokerSelection || !configuredRuntimeBroker) return null;
        return hasFreshBrokerHealth(configuredRuntimeBroker.broker_id) ? 'online' : 'checking';
    });
    const [brokerListStatus, setBrokerListStatus] = useState<'loading' | 'ready' | 'error'>(() => (
        !isDesktopBrokerSelection && configuredRuntimeBroker ? 'ready' : 'loading'
    ));
    const [directoryAttempt, setDirectoryAttempt] = useState(0);
    const healthAbortRef = useRef<AbortController | null>(null);
    const presentationAbortRef = useRef<AbortController | null>(null);
    const verifiedBrokerTargetRef = useRef('');
    const submittingRef = useRef(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        localStorage.removeItem('rtx_saved_password');
    }, []);

    useEffect(() => {
        let cancelled = false;
        let firstFrameId = 0;
        let paintedFrameId = 0;
        let timeoutId: number | undefined;
        let idleId: number | undefined;
        const idleWindow = window as Window & {
            requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
            cancelIdleCallback?: (handle: number) => void;
        };

        const warmLoginPath = () => {
            if (cancelled) return;
            void preloadLoginTransportRuntime().catch(() => undefined);
            // Fetch and evaluate the authenticated viewport only after the real
            // login form has painted and the browser reports idle time. This
            // keeps first paint light while removing the large App-module wait
            // from the eventual successful-login critical path.
            try {
                void Promise.resolve(onPrepareTerminal?.()).catch(() => undefined);
                void Promise.resolve(onPreloadTerminalPresentation?.()).catch(() => undefined);
            } catch {
                // Warmup is best-effort; submit retains the retryable load path.
            }
        };

        // Present the real React form for a full frame before submit-only code
        // is eligible for idle evaluation. This keeps both the static-shell FCP
        // and the interactive form's first paint free of the transport graph.
        firstFrameId = window.requestAnimationFrame(() => {
            paintedFrameId = window.requestAnimationFrame(() => {
                if (cancelled) return;
                if (typeof idleWindow.requestIdleCallback === 'function') {
                    idleId = idleWindow.requestIdleCallback(warmLoginPath, { timeout: 1_500 });
                    return;
                }
                timeoutId = window.setTimeout(warmLoginPath, 0);
            });
        });

        return () => {
            cancelled = true;
            window.cancelAnimationFrame(firstFrameId);
            window.cancelAnimationFrame(paintedFrameId);
            if (timeoutId !== undefined) window.clearTimeout(timeoutId);
            if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
        };
    }, [onPrepareTerminal, onPreloadTerminalPresentation]);

    useEffect(() => () => {
        healthAbortRef.current?.abort();
        presentationAbortRef.current?.abort();
    }, []);

    const warmLoginTransport = useCallback(() => {
        void preloadLoginTransportRuntime().catch(() => undefined);
    }, []);

    const warmLoginPath = useCallback(() => {
        warmLoginTransport();
        try {
            void Promise.resolve(onPrepareTerminal?.()).catch(() => undefined);
            void Promise.resolve(onPreloadTerminalPresentation?.()).catch(() => undefined);
        } catch {
            // Submit retries any warmup that did not complete.
        }
    }, [onPrepareTerminal, onPreloadTerminalPresentation, warmLoginTransport]);

    const runHealthCheck = useCallback(async (serverUrl: string, broker: BrokerServerItem) => {
        healthAbortRef.current?.abort();
        const controller = new AbortController();
        healthAbortRef.current = controller;

        verifiedBrokerTargetRef.current = '';
        if (isDesktopBrokerSelection || !hasFreshBrokerHealth(broker.broker_id)) {
            setHealthStatus('checking');
        }

        let timedOut = false;
        const timeoutId = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, 8000);

        try {
            const cleanUrl = normalizeBrokerServerUrl(serverUrl).replace(/\/$/, '');
            const healthPath = isDesktopBrokerSelection ? '/health' : '/api/v2/time';
            const healthUrl = `${cleanUrl}${healthPath}`;
            if (!isConfiguredBrokerEndpoint(healthUrl)) throw new Error('Broker health URL does not match this deployment.');
            const response = await fetch(toLocalDevProxyUrl(healthUrl), {
                signal: controller.signal, cache: 'no-store', redirect: 'error', credentials: 'omit',
            });
            if (healthAbortRef.current !== controller || controller.signal.aborted) return;
            setHealthStatus(response.ok ? 'online' : 'offline');
            if (response.ok) {
                verifiedBrokerTargetRef.current = `${broker.broker_id}|${cleanUrl}`;
                writeBrokerPresentationCache(broker, Date.now());
            }
        } catch (err: unknown) {
            if (healthAbortRef.current === controller && (timedOut || !isAbortError(err))) {
                setHealthStatus('offline');
            }
        } finally {
            clearTimeout(timeoutId);
        }
    }, [isDesktopBrokerSelection]);

    const hydrateBrokerPresentation = useCallback(async (broker: BrokerServerItem, serverUrl: string) => {
        presentationAbortRef.current?.abort();
        const controller = new AbortController();
        presentationAbortRef.current = controller;
        const timeoutId = setTimeout(() => controller.abort(), 5_000);

        try {
            const presentation = await loadBrokerPresentation({
                broker_id: broker.broker_id,
                server_url: serverUrl,
            }, controller.signal);
            if (!presentation || controller.signal.aborted || presentationAbortRef.current !== controller) return;

            const currentBroker = selectedBrokerRef.current;
            if (!currentBroker || currentBroker.broker_id !== broker.broker_id || currentBroker.server_url !== serverUrl) return;

            const presentationBroker = mergeBrokerPresentation(currentBroker, presentation) as BrokerServerItem;
            if (presentationBroker === currentBroker) return;

            selectedBrokerRef.current = presentationBroker;
            setSelectedBroker(presentationBroker);
            setSearchQuery(current => (
                current === currentBroker.broker_name || current === presentationBroker.broker_name
                    ? presentationBroker.broker_name
                    : current
            ));
            writeBrokerPresentationCache(presentationBroker);
        } catch {
            // The directory logo/name remain usable when an older broker does
            // not expose the optional branding endpoint.
        } finally {
            clearTimeout(timeoutId);
        }
    }, []);

    const applySelectedBroker = useCallback((broker: BrokerServerItem) => {
        const normalizedBroker = normalizeBrokerInfoForTarget(broker) as BrokerServerItem;
        const serverUrl = isDesktopBrokerSelection ? getDirectoryBrokerServerUrl(broker) : resolveBrokerBackendUrl(normalizedBroker);
        const nextBroker = {
            ...broker,
            ...normalizedBroker,
            server_url: serverUrl,
            ...(isDesktopBrokerSelection ? { backend_url: serverUrl, market_api_url: serverUrl } : {}),
        };
        if (isDesktopBrokerSelection && (selectedBrokerRef.current?.broker_id !== broker.broker_id || selectedBrokerRef.current?.server_url !== serverUrl)) {
            setPassword('');
        }
        selectedBrokerRef.current = nextBroker;
        setSelectedBroker(nextBroker);
        setSearchQuery(broker.broker_name);
        writeBrokerPresentationCache(broker);
        void runHealthCheck(isDesktopBrokerSelection ? serverUrl : resolveBrokerExtApiUrl(normalizedBroker), nextBroker);
        if (isDesktopBrokerSelection) {
            void hydrateBrokerPresentation(nextBroker, serverUrl);
        }
    }, [hydrateBrokerPresentation, isDesktopBrokerSelection, runHealthCheck]);

    const handleSelectBroker = (broker: BrokerServerItem) => {
        if (!isDesktopBrokerSelection || submittingRef.current || !isDirectoryBrokerSelectable(broker)) return;
        applySelectedBroker(broker);
        setError(null);
        setDropdownOpen(false);
    };

    useEffect(() => {
        let isMounted = true;
        if (isDesktopBrokerSelection || !configuredRuntimeBroker) setBrokerListStatus('loading');

        // Sign-in always verifies the current directory; account tools can then
        // reuse this successful response instead of repeating the network wait.
        loadAppBrokerDirectory({ forceRefresh: true, desktop: isDesktopBrokerSelection })
            .then(rows => rows as BrokerServerItem[])
            .then((data) => {
                if (!isMounted) return;
                setBrokerList(data);
                setBrokerListStatus('ready');

                const savedBrokerId = localStorage.getItem('broker_id') || localStorage.getItem('rtx_broker_id');
                const selectedDiscoveryBroker = pickDiscoveryBroker(data, {
                    isDesktopBrokerSelection,
                    savedBrokerId,
                    lastAuthenticatedBrokerId: localStorage.getItem(LAST_AUTHENTICATED_BROKER_ID_KEY),
                });

                if (selectedDiscoveryBroker) {
                    applySelectedBroker(selectedDiscoveryBroker);
                } else if (isDesktopBrokerSelection) {
                    selectedBrokerRef.current = null;
                    setSelectedBroker(null);
                    setSearchQuery('');
                    setHealthStatus(null);
                    verifiedBrokerTargetRef.current = '';
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
    }, [applySelectedBroker, configuredRuntimeBroker, isDesktopBrokerSelection, directoryAttempt]);

    useEffect(() => {
        if (!isDesktopBrokerSelection) return;
        applyBrokerChrome({
            brokerId: selectedBroker?.broker_id,
            brokerName: selectedBroker?.broker_name,
            logoUrl: selectedBroker?.logo_url,
            themeColor: normalizeBrokerThemeColor(selectedBroker?.theme_color),
            updateLoginTitle: true,
        });
    }, [isDesktopBrokerSelection, selectedBroker]);

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
        if (submittingRef.current) return;
        if (restoring) return;
        submittingRef.current = true;
        beginLoginPerformanceMeasurement();
        setLoading(true);
        setError(null);
        const feedbackPaintPromise = waitForLoginFeedbackPaint();

        try {
            if (!selectedBroker) {
                throw new Error('Please select a broker server.');
            }

            if (isDesktopBrokerSelection && (
                brokerListStatus !== 'ready'
                || searchQuery !== selectedBroker.broker_name
                || !isDirectoryBrokerSelectable(selectedBroker)
                || !brokerList.some(broker => broker.broker_id === selectedBroker.broker_id && getDirectoryBrokerServerUrl(broker) === selectedBroker.server_url && isDirectoryBrokerSelectable(broker))
                || verifiedBrokerTargetRef.current !== `${selectedBroker.broker_id}|${selectedBroker.server_url}`
            )) {
                throw new Error('Select an available broker and wait for the server check before logging in.');
            }

            const submitBroker = normalizeBrokerInfoForTarget(selectedBroker) as BrokerServerItem;
            const brokerServerUrl = isDesktopBrokerSelection ? selectedBroker.server_url! : resolveBrokerBackendUrl(submitBroker);
            const brokerExtApiUrl = isDesktopBrokerSelection ? brokerServerUrl : resolveBrokerExtApiUrl(submitBroker);
            const {
                authV2Api,
                persistBrokerSessionDiscovery,
            } = await preloadLoginTransportRuntime();

            markAuthenticationRequestStarted();
            const authenticationPromise = authV2Api.login({
                username,
                password,
                broker_id: submitBroker.broker_id,
            }, {
                baseUrl: buildBrokerApiV2BaseUrl(brokerExtApiUrl),
                skipDynamicUrl: true,
            });

            // Dispatch the small, critical authentication request before a
            // cold App/CSS preload can compete for bandwidth and main-thread
            // evaluation. The large terminal graph still loads concurrently
            // while the broker processes the login request.
            const terminalReadyPromise = feedbackPaintPromise
                .then(() => onPrepareTerminal?.());
            void terminalReadyPromise.catch(() => undefined);
            void onPreloadTerminalPresentation?.();

            const data = await authenticationPromise;

            const token = data.access_token || data.token;
            if (!token) throw new Error('No authentication token received');
            markAuthenticationAccepted();

            // Start the authenticated store import as soon as the broker accepts
            // the login. Secure password storage and the pending-feedback paint
            // can finish concurrently instead of delaying that import.
            const loginStoreRuntimePromise = loadAuthenticatedLoginStoreRuntime();
            void loginStoreRuntimePromise.catch(() => undefined);
            try {
                await persistPassword({ brokerId: submitBroker.broker_id, serverUrl: brokerExtApiUrl }, String(data.account_login ?? username.trim()), password);
            } catch {
                throw new Error('Unable to save the password. Turn off Save password to log in without saving it.');
            }
            await feedbackPaintPromise;

            persistBrokerSessionDiscovery({
                ...data,
                access_token: token,
                broker_id: data.broker_id || submitBroker.broker_id,
                broker_name: submitBroker.broker_name,
                backend_url: isDesktopBrokerSelection ? brokerServerUrl : data.backend_url || brokerServerUrl,
                market_api_url: isDesktopBrokerSelection ? brokerExtApiUrl : data.market_api_url || brokerExtApiUrl,
                server_url: isDesktopBrokerSelection ? brokerServerUrl : data.server_url || data.broker_server || brokerServerUrl,
                ws_url: data.ws_url || submitBroker.ws_url,
                feed_url: data.feed_url || submitBroker.feed_url || submitBroker.feed_ws_url,
                feed_ws_url: data.feed_ws_url || submitBroker.feed_ws_url,
                feed_status_url: data.feed_status_url || submitBroker.feed_status_url,
                logo_url: data.logo_url?.trim() || submitBroker.logo_url,
                theme_color: submitBroker.theme_color,
            }, { notifySessionChange: false });
            localStorage.setItem(
                LAST_AUTHENTICATED_BROKER_ID_KEY,
                String(data.broker_id || submitBroker.broker_id),
            );
            updateDynamicUrls();
            markPostAuthenticationPhase('auth-session-persist');

            const accountId = data.account_login ?? username;
            const sessionHandoff = createAuthenticatedSessionHandoff({
                accountId,
                token,
                expiresAt: data.expires_at,
            });
            if (!sessionHandoff) throw new Error('Authentication session handoff is invalid');

            if (data.expires_at) localStorage.setItem('token_expires_at', String(data.expires_at));

            const { useAppStore } = await loginStoreRuntimePromise;
            markPostAuthenticationPhase('auth-store-runtime');
            const appStore = useAppStore.getState();
            const loginNum = parseInt(String(accountId), 10);
            const tradingAccountType = resolveTradingAccountType(data);
            const loginStoreModule = await loginStoreRuntimePromise;
            loginStoreModule.rememberAccountSession?.({
                brokerId: data.broker_id || submitBroker.broker_id,
                serverUrl: isDesktopBrokerSelection ? brokerServerUrl : (data.server_url || data.broker_server || brokerServerUrl || brokerExtApiUrl),
                login: String(accountId),
                authToken: token,
                refreshToken: data.refresh_token,
                expiresAt: sessionHandoff.expiresAt ?? undefined,
                password,
            });
            appStore.setAuthenticated(
                true,
                String(accountId),
                token,
                data.refresh_token,
                sessionHandoff.expiresAt ?? undefined,
                !isNaN(loginNum) ? {
                    login: loginNum,
                    name: getAuthenticatedAccountName(data),
                    server: submitBroker.broker_name || '',
                    ...(tradingAccountType ? { accountType: tradingAccountType, isLive: tradingAccountType === 'real' } : {}),
                    lastUsed: Date.now(),
                } : undefined,
            );
            markPostAuthenticationPhase('auth-store-commit');

            // The terminal module was prepared while the broker request was in
            // flight. Keep the real login UI mounted until both authentication
            // and preparation finish, then cross to a complete viewport.
            await terminalReadyPromise;
            markPostAuthenticationPhase('auth-terminal-ready');
            onLogin(String(accountId), sessionHandoff);
            markPostAuthenticationPhase('auth-handoff');
            scheduleAuthenticatedShellPaintMeasurement();

            // These values are useful on the next visit but are not required
            // to render or connect the authenticated viewport. Keep their
            // synchronous storage writes out of the first terminal paint.
            schedulePostLoginBookkeeping(() => {
                localStorage.setItem('rtx_last_login', String(accountId));
                if (rememberMe) {
                    localStorage.setItem('rtx_saved_username', String(accountId));
                } else {
                    localStorage.removeItem('rtx_saved_username');
                }
                localStorage.removeItem('rtx_saved_password');
            });

        } catch (err: unknown) {
            const errorMessage = getErrorMessage(err, 'Authentication failed');
            if (errorMessage !== 'Please select a broker server.') {
                console.error('[WelcomeTerminal] Auth error:', err);
            }
            setError(errorMessage);
        } finally {
            submittingRef.current = false;
            setLoading(false);
        }
    };

    const selectedBrokerName = selectedBroker?.broker_name || 'Select broker';
    const desktopLoginReady = brokerListStatus === 'ready' && selectedBroker && healthStatus === 'online'
        && searchQuery === selectedBroker.broker_name
        && verifiedBrokerTargetRef.current === `${selectedBroker.broker_id}|${selectedBroker.server_url}`;
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
    const filteredBrokers = filterBrokerDirectory(brokerList, searchQuery, selectedBroker);
    const loginHeroAsset = resolveLoginHeroAsset(selectedBroker);
    const isAccentLoginTheme = loginHeroAsset.theme === 'accent';
    const selectedBrokerThemeColor = normalizeBrokerThemeColor(selectedBroker?.theme_color);
    const loginOverlayClassName = [
        'rtx-login-overlay',
        isAccentLoginTheme ? 'rtx-login-overlay--accent' : '',
        isDesktopBrokerSelection && selectedBroker ? 'rtx-login-overlay--broker-selected' : '',
    ].filter(Boolean).join(' ');
    const loginFieldBlurBorder = isAccentLoginTheme ? ACCENT_LOGIN_FIELD_BORDER : LOGIN_FIELD_BORDER;
    const loginFieldFocus = isAccentLoginTheme ? ACCENT_LOGIN_FIELD_FOCUS : LOGIN_FIELD_FOCUS;
    const loginFieldFocusShadow = isAccentLoginTheme
        ? ACCENT_LOGIN_FIELD_FOCUS_SHADOW
        : LOGIN_FIELD_FOCUS_SHADOW;
    const brokerStatusTone = isAccentLoginTheme && healthStatus === 'online'
        ? ACCENT_LOGIN_FIELD_FOCUS
        : healthTone;
    const activeLabelStyle = isAccentLoginTheme ? accentLabelStyle : labelStyle;
    const loginHeroVisualStyle: React.CSSProperties = {
        backgroundColor: '#020507',
    };
    const loginOverlayStyle: LoginOverlayStyle = {
        '--rtx-broker-accent': selectedBrokerThemeColor || (isAccentLoginTheme ? ACCENT_LOGIN_FIELD_FOCUS : LOGIN_FIELD_FOCUS),
    };
    const desktopHeroFit = loginHeroAsset.fit ?? 'cover';
    const desktopHeroPosition = loginHeroAsset.position ?? 'center center';
    const loginHeroImageStyle: LoginHeroImageStyle = {
        '--rtx-login-hero-fit': desktopHeroFit,
        '--rtx-login-hero-position': desktopHeroPosition,
        '--rtx-login-hero-mobile-fit': loginHeroAsset.mobileFit ?? desktopHeroFit,
        '--rtx-login-hero-mobile-position': loginHeroAsset.mobilePosition ?? desktopHeroPosition,
    };
    const hasElectronWindowControls = typeof window !== 'undefined' && Boolean(window.electron?.window);
    const handleWindowControl = (
        event: React.MouseEvent<HTMLButtonElement>,
        action: 'close' | 'minimize' | 'maximize',
    ) => {
        event.preventDefault();
        event.stopPropagation();
        window.electron?.window?.[action]?.();
    };

    return (
        <div
            onContextMenu={e => e.stopPropagation()}
            onMouseDownCapture={e => {
                const target = e.target as HTMLElement;
                if (!target.closest('[data-welcome-card], [data-window-controls]')) {
                    e.stopPropagation();
                }
            }}
            className={loginOverlayClassName}
            style={loginOverlayStyle}
            data-broker-id={selectedBroker?.broker_id || undefined}
            data-broker-presentation={isDesktopBrokerSelection && selectedBroker ? 'selected' : 'default'}
        >
            {hasElectronWindowControls && (
                <div className="rtx-login-window-controls" data-window-controls role="toolbar" aria-label={tr("Window controls")}>
                    <button
                        type="button"
                        className="rtx-login-window-control is-close"
                        aria-label={tr("Close")}
                        title={tr("Close")}
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => handleWindowControl(e, 'close')}
                    >
                        <LoginIcon name="x" size={14} strokeWidth={2.2} />
                    </button>
                    <button
                        type="button"
                        className="rtx-login-window-control is-minimize"
                        aria-label={tr("Minimize")}
                        title={tr("Minimize")}
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => handleWindowControl(e, 'minimize')}
                    >
                        <LoginIcon name="minus" size={15} strokeWidth={2.3} />
                    </button>
                    <button
                        type="button"
                        className="rtx-login-window-control is-maximize"
                        aria-label={tr("Maximize")}
                        title={tr("Maximize")}
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => handleWindowControl(e, 'maximize')}
                    >
                        <LoginIcon name="maximize" size={13} strokeWidth={2.1} />
                    </button>
                </div>
            )}
            <div className="rtx-login-stage">
                <aside className="rtx-login-visual" aria-hidden="true" style={loginHeroVisualStyle} data-broker-id={selectedBroker?.broker_id || undefined}>
                    <picture>
                        <source media="(max-width: 760px)" srcSet={loginHeroAsset.mobileSrc ?? loginHeroAsset.src} />
                        <img
                            src={loginHeroAsset.src}
                            alt=""
                            width={loginHeroAsset.width}
                            height={loginHeroAsset.height}
                            style={loginHeroImageStyle}
                            loading="eager"
                            decoding="sync"
                            fetchPriority="high"
                        />
                    </picture>
                    <div className="rtx-login-visual-shade" />
                    {isDesktopBrokerSelection && selectedBroker && (
                        <div key={selectedBroker.broker_id} className="rtx-login-broker-identity">
                            <div className="rtx-login-broker-identity-logo">
                                <BrokerLogoImage
                                    broker={selectedBroker}
                                    fallback={<span>{selectedBrokerName.slice(0, 1).toUpperCase()}</span>}
                                />
                            </div>
                            <div className="rtx-login-broker-identity-copy">
                                <span>{tr("Desktop terminal")}</span>
                                <strong>{selectedBrokerName}</strong>
                            </div>
                        </div>
                    )}
                </aside>

                <main className="rtx-login-panel-wrap">
                    <section data-welcome-card className="rtx-login-panel" aria-label={tr("Terminal login")}>
                        <div className="rtx-login-body">
                            <header className="rtx-form-header">
                                <h1 className="rtx-login-title" aria-label={LOGIN_TITLE_ACCESSIBLE_LABEL}>
                                    <span className="rtx-login-title-text">{LOGIN_TITLE_TEXT}</span>
                                    {/* Broker logo from the broker config / directory; the broker
                                        name (or neutral 'Broker') when no logo loads. Never a vendor mark. */}
                                    <span className="rtx-login-title-logo-reveal" data-rtx-login-title-brand>
                                        <BrokerLogoImage
                                            broker={selectedBroker}
                                            appFallbackUrl=""
                                            className="rtx-login-title-logo rtx-login-title-logo--broker"
                                            fallback={<span className="rtx-login-title-brand">{resolveLoginTitleBrandName(selectedBroker?.broker_name)}</span>}
                                        />
                                    </span>
                                </h1>
                            </header>

                            <div className="rtx-broker-strip">
                                <div className="rtx-route-row">
                                    <div className="rtx-route-logo">
                                        <BrokerLogoImage
                                            broker={selectedBroker}
                                            fallback={<span>{selectedBrokerName.slice(0, 1).toUpperCase()}</span>}
                                        />
                                    </div>
                                    <div className="rtx-route-copy">
                                        <span className="rtx-summary-label">{tr("Broker Server")}</span>
                                        <strong>{selectedBrokerName}</strong>
                                    </div>
                                </div>
                                <span className="rtx-broker-state" style={{ color: brokerStatusTone }}>
                                    <span style={{ background: brokerStatusTone }} />
                                    {healthLabel}
                                </span>
                            </div>

                            {error && (
                                <div className="rtx-login-error" role="alert">
                                    {error}
                                </div>
                            )}

                            <form
                                onSubmit={handleSubmit}
                                onPointerEnter={warmLoginPath}
                                onPointerDownCapture={warmLoginPath}
                                onInputCapture={warmLoginPath}
                                onFocusCapture={warmLoginTransport}
                                className="rtx-login-form"
                                aria-busy={loading}
                                data-rtx-login-form
                                data-login-submit-pending={loading ? 'true' : 'false'}
                            >
                                <div>
                                    <label htmlFor="rtxAccountId" style={activeLabelStyle}>{tr("Account ID")}</label>
                                    <div className="rtx-input-shell">
                                        <LoginIcon name="user" />
                                        <input
                                            id="rtxAccountId"
                                            name="accountId"
                                            type="text"
                                            placeholder={tr("Enter Account ID")}
                                            required
                                            autoFocus
                                            autoComplete="username"
                                            value={username}
                                            disabled={loading || (isDesktopBrokerSelection && !desktopLoginReady)}
                                            onChange={e => setUsername(e.target.value)}
                                            style={inputStyle}
                                            onFocus={e => {
                                                const shell = e.currentTarget.parentElement;
                                                if (!shell) return;
                                                shell.style.borderColor = loginFieldFocus;
                                                shell.style.boxShadow = loginFieldFocusShadow;
                                            }}
                                            onBlur={e => {
                                                const shell = e.currentTarget.parentElement;
                                                if (!shell) return;
                                                shell.style.borderColor = loginFieldBlurBorder;
                                                shell.style.boxShadow = 'none';
                                            }}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label htmlFor="rtxPassword" style={activeLabelStyle}>{tr("Password")}</label>
                                    <div className="rtx-input-shell">
                                        <LoginIcon name="lock" />
                                        <input
                                            id="rtxPassword"
                                            name="account-key"
                                            type="text"
                                            className={showPassword ? undefined : 'rtx-secret-input'}
                                            placeholder={tr("Enter Password")}
                                            required
                                            autoComplete="off"
                                            spellCheck={false}
                                            autoCorrect="off"
                                            autoCapitalize="none"
                                            value={password}
                                            disabled={loading || (isDesktopBrokerSelection && !desktopLoginReady)}
                                            onChange={e => setPassword(e.target.value)}
                                            style={inputStyle}
                                            onFocus={e => {
                                                const shell = e.currentTarget.parentElement;
                                                if (!shell) return;
                                                shell.style.borderColor = loginFieldFocus;
                                                shell.style.boxShadow = loginFieldFocusShadow;
                                            }}
                                            onBlur={e => {
                                                const shell = e.currentTarget.parentElement;
                                                if (!shell) return;
                                                shell.style.borderColor = loginFieldBlurBorder;
                                                shell.style.boxShadow = 'none';
                                            }}
                                        />
                                        <button
                                            type="button"
                                            className="rtx-password-toggle"
                                            aria-label={showPassword ? tr("Hide password") : tr("Show password")}
                                            aria-pressed={showPassword}
                                            onMouseDown={e => e.preventDefault()}
                                            onClick={() => setShowPassword(value => !value)}
                                        >
                                            {showPassword ? (
                                                <LoginIcon name="eye-off" className="rtx-field-end-icon" />
                                            ) : (
                                                <LoginIcon name="eye" className="rtx-field-end-icon" />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                <div className="rtx-broker-field">
                                    <label htmlFor="rtxBrokerServer" style={activeLabelStyle}>{tr("Broker Server")}</label>
                                    <div
                                        ref={isDesktopBrokerSelection ? dropdownRef : undefined}
                                        className={`rtx-broker-input-wrap ${isDesktopBrokerSelection ? 'is-selectable' : 'is-locked'}`}
                                    >
                                        {selectedBroker && (
                                            <BrokerLogoImage broker={selectedBroker} className="rtx-broker-logo" />
                                        )}
                                        <input
                                            id="rtxBrokerServer"
                                            name="brokerServer"
                                            type="text"
                                            placeholder={
                                                brokerListStatus === 'loading' ? tr("Resolving broker...") : isDesktopBrokerSelection ? tr("Search broker...") : tr("Broker resolved from domain")
                                            }
                                            required
                                            autoComplete="organization"
                                            value={searchQuery}
                                            disabled={loading}
                                            readOnly={!isDesktopBrokerSelection}
                                            role={isDesktopBrokerSelection ? 'combobox' : undefined}
                                            aria-readonly={!isDesktopBrokerSelection}
                                            aria-haspopup={isDesktopBrokerSelection ? 'listbox' : undefined}
                                            aria-expanded={isDesktopBrokerSelection ? dropdownOpen : undefined}
                                            aria-controls={isDesktopBrokerSelection ? 'rtxBrokerServerMenu' : undefined}
                                            title={isDesktopBrokerSelection ? tr("Choose broker server") : tr("Broker server is resolved automatically from this domain")}
                                            onChange={e => {
                                                if (!isDesktopBrokerSelection) return;
                                                setSearchQuery(e.target.value);
                                                setDropdownOpen(true);
                                            }}
                                            onFocus={() => {
                                                if (isDesktopBrokerSelection) setDropdownOpen(true);
                                            }}
                                            onClick={() => {
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
                                                if (e.key === 'Enter' && dropdownOpen) {
                                                    e.preventDefault();
                                                    const selectableBroker = filteredBrokers.find(isDirectoryBrokerSelectable);
                                                    if (!selectableBroker) return;
                                                    handleSelectBroker(selectableBroker);
                                                }
                                            }}
                                            style={{
                                                ...inputStyle,
                                                paddingLeft: selectedBroker ? 42 : 16,
                                                paddingRight: isDesktopBrokerSelection ? 54 : 32,
                                                color: '#ffffff',
                                            }}
                                        />
                                        <div className="rtx-broker-input-state" aria-hidden="true">
                                            <span style={{ background: brokerStatusTone }} />
                                            {isDesktopBrokerSelection && (
                                                <LoginIcon
                                                    name="chevron-down"
                                                    size={14}
                                                    strokeWidth={2.2}
                                                    className={dropdownOpen ? 'is-open' : undefined}
                                                />
                                            )}
                                        </div>
                                        {isDesktopBrokerSelection && dropdownOpen && (
                                            <div id="rtxBrokerServerMenu" className="rtx-broker-menu" role="listbox">
                                                {brokerListStatus !== 'ready' || filteredBrokers.length === 0 ? (
                                                    <div className="rtx-broker-empty">{tr(brokerListStatus === 'loading' ? 'Loading broker servers...' : brokerListStatus === 'error' ? 'Broker list unavailable' : 'No brokers found')}</div>
                                                ) : (
                                                    filteredBrokers.map(item => {
                                                        const suspended = isBrokerSuspended(item);
                                                        const unavailable = !isDirectoryBrokerSelectable(item);
                                                        return (
                                                            <button
                                                                key={item.broker_id}
                                                                type="button"
                                                                role="option"
                                                                aria-selected={selectedBroker?.broker_id === item.broker_id}
                                                                aria-disabled={unavailable || undefined}
                                                                disabled={unavailable || loading}
                                                                title={suspended ? tr("{{value0}} is suspended", { value0: item.broker_name }) : undefined}
                                                                onMouseDown={event => event.preventDefault()}
                                                                onClick={() => handleSelectBroker(item)}
                                                                className={`rtx-broker-option ${selectedBroker?.broker_id === item.broker_id ? 'is-selected' : ''}`}
                                                            >
                                                                <span>
                                                                    <BrokerLogoImage
                                                                        broker={item}
                                                                        fallback={<i aria-hidden="true">B</i>}
                                                                    />
                                                                    <strong>{resolveServerDisplayLabel(item.broker_name)}</strong>
                                                                </span>
                                                                {suspended ? <em>{tr("Suspended")}</em> : unavailable ? <em>{tr("Unavailable")}</em> : item.region ? <em>{item.region}</em> : null}
                                                            </button>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {isDesktopBrokerSelection && (brokerListStatus !== 'ready' || !selectedBroker) ? (
                                    <div className="rtx-inline-status" role="status">
                                        {tr(brokerListStatus === 'loading' ? 'Loading broker servers...' : brokerListStatus === 'error' ? 'Broker list unavailable. Please try again.' : 'No available broker servers.')}
                                        {brokerListStatus !== 'loading' && (
                                            <button type="button" className="rtx-broker-retry" onClick={() => setDirectoryAttempt(attempt => attempt + 1)}>
                                                {tr("Retry")}
                                            </button>
                                        )}
                                    </div>
                                ) : healthStatus === 'offline' && (
                                    <div className="rtx-inline-status is-offline" role="status">
                                        {tr("Broker temporarily unavailable")}
                                        {isDesktopBrokerSelection && selectedBroker && (
                                            <button type="button" className="rtx-broker-retry" disabled={loading} onClick={() => void runHealthCheck(selectedBroker.server_url!, selectedBroker)}>
                                                {tr("Retry")}
                                            </button>
                                        )}
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
                                    <label htmlFor="wtRemember">{tr("Remember account ID")}</label>
                                </div>

                                <div className="rtx-remember-row">
                                    <input
                                        type="checkbox"
                                        id="wtSavePassword"
                                        name="savePassword"
                                        checked={savePassword}
                                        onChange={event => setSavePassword(event.target.checked)}
                                        disabled={loading || restoring || !passwordSavingAvailable}
                                    />
                                    <label htmlFor="wtSavePassword">{tr("Save password")}</label>
                                </div>
                                {storageError && <div className="rtx-inline-status" role="status">{tr(storageError)}</div>}

                                <button
                                    type="submit"
                                    disabled={loading || restoring || (isDesktopBrokerSelection && !desktopLoginReady)}
                                    aria-busy={loading}
                                    className="rtx-login-button"
                                    data-rtx-login-submit
                                    data-rtx-login-feedback={loading ? 'true' : undefined}
                                >
                                    <>
                                        {tr("Login")}<LoginIcon name="arrow-right" strokeWidth={2.2} />
                                    </>
                                </button>
                            </form>

                        </div>
                    </section>
                </main>
            </div>
        </div>
    );
}

const labelStyle: React.CSSProperties = {
    display: 'block',
    color: '#a9c8c2',
    fontSize: 14,
    fontWeight: 'var(--rtx-font-weight-control, 400)',
    lineHeight: '20px',
    letterSpacing: 0,
    marginBottom: 10,
    fontFamily: 'var(--font-login-sans, var(--font-sans))',
};

const accentLabelStyle: React.CSSProperties = {
    ...labelStyle,
    color: '#b8cdf0',
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
    fontSize: 14,
    fontWeight: 'var(--rtx-font-weight-body, 400)',
    lineHeight: '20px',
    outline: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    fontFamily: 'var(--font-login-sans, var(--font-sans))',
};
