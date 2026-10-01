import { useUiTranslation } from '../../hooks/useUiTranslation';
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, ChevronRight, ArrowRight, Building2, Shield, Globe, CheckCircle2, Copy, Loader2 } from 'lucide-react';
import { tradeApi } from '../../api/trade';
import { parseTokenExpiresAt } from '../../api/client';
import { BROKER_DISCOVERY_URL, normalizeBrokerServerUrl, updateDynamicUrls } from '../../config/api';
import {
    isDesktopBackendTarget,
    getRuntimeBrokerConfiguration,
    normalizeBrokerInfoForTarget,
    resolveBrokerBackendUrl,
    resolveBrokerExtApiUrl,
} from '../../config/backendTarget.js';
import { isBrokerSuspended, type BrokerDiscoveryItem } from '../../services/brokerDiscovery';
import { getCachedBrokerDirectory, loadAppBrokerDirectory } from '../../services/brokerDirectory';
import { persistBrokerSessionDiscovery } from '../../services/brokerSession';
import { useAppStore } from '../../store/useAppStore';
import type { BrokerServer } from '../../types/api';
import { CountryCombobox } from './CountryCombobox';
import './open-account-dialog.css';

// Palette cycling for broker avatar gradients
const GRADIENTS = [
    { from: '#1d4ed8', to: '#0e7490' },
    { from: '#059669', to: '#0d9488' },
    { from: '#7c3aed', to: '#4f46e5' },
    { from: '#d97706', to: '#b45309' },
    { from: '#dc2626', to: '#9f1239' },
    { from: '#0891b2', to: '#0369a1' },
    { from: '#6d28d9', to: '#7c3aed' },
    { from: '#065f46', to: '#047857' },
];

const initials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const getLogoUrl = (url?: string) => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
        return url;
    }
    const base = (BROKER_DISCOVERY_URL || '').replace(/\/$/, '');
    const path = url.startsWith('/') ? url : `/${url}`;
    return `${base}${path}`;
};

const BrokerAvatar: React.FC<{ broker: BrokerServer }> = ({ broker }) => {
    const [hasError, setHasError] = useState(false);
    
    if (broker.logo_url && !hasError) {
        return (
            <div className="rtx-open-account-dialog__logo">
                <img
                    src={getLogoUrl(broker.logo_url)}
                    alt=""
                    onError={() => setHasError(true)}
                />
            </div>
        );
    }
    
    return (
        <div className="rtx-open-account-dialog__avatar rtx-open-account-dialog__initials" aria-hidden="true">
            {initials(broker.broker_name)}
        </div>
    );
};

const DropdownBrokerLogo: React.FC<{ broker: BrokerServer; index: number }> = ({ broker, index }) => {
    const [hasError, setHasError] = useState(false);
    const grad = GRADIENTS[index % GRADIENTS.length];

    if (broker.logo_url && !hasError) {
        return (
            <div className="w-5 h-5 rounded bg-white flex items-center justify-center overflow-hidden flex-shrink-0 border border-white/10">
                <img
                    src={getLogoUrl(broker.logo_url)}
                    alt={broker.broker_name}
                    className="w-full h-full object-contain p-0.5"
                    onError={() => setHasError(true)}
                />
            </div>
        );
    }

    return (
        <div
            className="rtx-open-account-dialog__avatar w-5 h-5 rounded flex items-center justify-center text-white font-semibold text-[12px] flex-shrink-0"
            style={{ background: `linear-gradient(135deg, ${grad.from} 0%, ${grad.to} 100%)` }}
        >
            {initials(broker.broker_name)}
        </div>
    );
};

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

type CreatedAccount = {
    login?: number | string;
    api_key?: string;
    broker_id?: string;
    group?: string;
    balance?: number | string;
    currency?: string;
    leverage?: number | string;
    master_password?: string;
    investor_password?: string;
    server?: string;
};

type AccountType = 'demo' | 'real' | 'existing';

type AccountFormData = {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    country: string;
    currency: string;
    leverage: string;
};

const EMPTY_ACCOUNT_FORM: AccountFormData = {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    country: 'US',
    currency: 'USD',
    leverage: '100',
};

type CreatedAccountSummaryRow = {
    label: string;
    value: React.ReactNode;
    mono?: boolean;
    color?: string;
    size?: string;
    small?: boolean;
};

const buildBrokerApiV2BaseUrl = (value: string): string =>
    `${normalizeBrokerServerUrl(value).replace(/\/$/, '')}/api/v2`;

const getErrorMessage = (err: unknown, fallback: string): string =>
    err instanceof Error ? err.message : fallback;

const isSummaryRow = (row: CreatedAccountSummaryRow | false | null | undefined): row is CreatedAccountSummaryRow =>
    Boolean(row);

const isValidEmail = (value: string): boolean =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const mapDiscoveryBroker = (broker: BrokerDiscoveryItem, index: number): BrokerServer => ({
    ...broker,
    id: broker.id ?? broker.broker_id ?? index,
    broker_id: String(broker.broker_id || broker.id || '').trim(),
    broker_name: String(broker.broker_name || broker.name || broker.broker_id || broker.id || '').trim(),
    server: String(broker.server || broker.server_url || broker.backend_url || broker.broker_id || '').trim(),
    server_url: typeof broker.server_url === 'string' ? broker.server_url : undefined,
    backend_url: typeof broker.backend_url === 'string' ? broker.backend_url : undefined,
    market_api_url: typeof broker.market_api_url === 'string' ? broker.market_api_url : undefined,
    server_ip: typeof broker.server_ip === 'string' ? broker.server_ip : undefined,
    server_port: typeof broker.server_port === 'number' ? broker.server_port : undefined,
    ws_url: typeof broker.ws_url === 'string' ? broker.ws_url : undefined,
    feed_url: typeof broker.feed_url === 'string' ? broker.feed_url : undefined,
    feed_ws_url: typeof broker.feed_ws_url === 'string' ? broker.feed_ws_url : undefined,
    feed_status_url: typeof broker.feed_status_url === 'string' ? broker.feed_status_url : undefined,
    region: typeof broker.region === 'string' ? broker.region : undefined,
    logo_url: typeof broker.logo_url === 'string' ? broker.logo_url : undefined,
    enabled: broker.enabled !== false,
});

const availableDirectoryBrokers = (rows: BrokerDiscoveryItem[]): BrokerServer[] => rows
    .filter(broker => !isBrokerSuspended(broker))
    .map(mapDiscoveryBroker)
    .filter(broker => Boolean(broker.broker_id && broker.broker_name));

export const OpenAccountDialog: React.FC<Props> = ({ isOpen, onClose }) => {
    const tr = useUiTranslation();
    const isDesktopShell = typeof window !== 'undefined' && Boolean(window.electron?.window);
    const [step, setStep] = useState(0);
    const [brokers, setBrokers] = useState<BrokerServer[]>(() => availableDirectoryBrokers(getCachedBrokerDirectory() || []));
    const [loadingBrokers, setLoadingBrokers] = useState(() => getCachedBrokerDirectory() === null);
    const [selected, setSelected] = useState<string>(() => brokers[0] ? String(brokers[0].id) : '');
    const [directoryError, setDirectoryError] = useState('');
    const [directoryAttempt, setDirectoryAttempt] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [accountType, setAccountType] = useState<AccountType>('demo');

    // "Connect existing" sub-form state
    const [existingLogin, setExistingLogin] = useState('');
    const [existingPassword, setExistingPassword] = useState('');
    const [existingServerSearch, setExistingServerSearch] = useState('');
    const [existingServerDropOpen, setExistingServerDropOpen] = useState(false);
    const [existingBroker, setExistingBroker] = useState<BrokerServer | null>(null);
    const [formData, setFormData] = useState<AccountFormData>(EMPTY_ACCOUNT_FORM);
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [createdAccount, setCreatedAccount] = useState<CreatedAccount | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [createError, setCreateError] = useState('');
    const [validationError, setValidationError] = useState('');

    useEffect(() => {
        if (!isOpen) return;

        let active = true;
        setStep(0);
        setSearchQuery('');
        setAccountType('demo');
        setExistingLogin('');
        setExistingPassword('');
        setExistingServerSearch('');
        setExistingServerDropOpen(false);
        setExistingBroker(null);
        setFormData(EMPTY_ACCOUNT_FORM);
        setTermsAccepted(false);
        setCreatedAccount(null);
        setCreateError('');
        setValidationError('');
        setDirectoryError('');
        const cached = getCachedBrokerDirectory();
        const applyDirectory = (rows: BrokerDiscoveryItem[]) => {
            const mapped = availableDirectoryBrokers(rows);
            setBrokers(mapped);
            setSelected(mapped[0] ? String(mapped[0].id) : '');
        };
        applyDirectory(cached || []);
        setLoadingBrokers(cached === null);
        loadAppBrokerDirectory({ desktop: isDesktopBackendTarget() })
            .then(rows => { if (active) applyDirectory(rows); })
            .catch(err => {
                console.warn('[OpenAccountDialog] Could not load brokers:', err);
                if (active) setDirectoryError('Broker servers are unavailable. Please try again.');
            })
            .finally(() => { if (active) setLoadingBrokers(false); });

        return () => {
            active = false;
        };
    }, [isOpen, directoryAttempt]);

    if (!isOpen) return null;

    const filteredBrokers = searchQuery.trim()
        ? brokers.filter(b =>
            String(b.broker_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
            String(b.server || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
            String(b.broker_id || '').toLowerCase().includes(searchQuery.toLowerCase())
        )
        : brokers;
    const existingFilteredBrokers = existingServerSearch.trim()
        ? brokers.filter(broker =>
            String(broker.broker_name || '').toLowerCase().includes(existingServerSearch.toLowerCase()) ||
            String(broker.server || '').toLowerCase().includes(existingServerSearch.toLowerCase()) ||
            String(broker.broker_id || '').toLowerCase().includes(existingServerSearch.toLowerCase())
        )
        : brokers;

    const selectedBroker = brokers.find(b => String(b.id) === selected);
    const runtimeConfiguration = isDesktopBackendTarget() ? null : getRuntimeBrokerConfiguration();
    const termsUrl = runtimeConfiguration?.valid ? runtimeConfiguration.brokerTermsUrl : '';

    const resolveSelectedBrokerRouting = (broker: BrokerServer | undefined = selectedBroker) => {
        if (!broker) throw new Error('Please select a broker server.');
        const normalizedBroker = normalizeBrokerInfoForTarget(broker);
        const submitBroker: BrokerServer = {
            ...broker,
            ...normalizedBroker,
            id: broker.id,
            broker_id: String(normalizedBroker.broker_id || broker.broker_id),
            broker_name: broker.broker_name,
            server: String(normalizedBroker.broker_server || normalizedBroker.server_url || broker.server),
        };
        const brokerServerUrl = resolveBrokerBackendUrl(submitBroker);
        const brokerExtApiUrl = resolveBrokerExtApiUrl(submitBroker);
        if (!brokerExtApiUrl) throw new Error('The selected broker does not provide an API endpoint.');
        return { submitBroker, brokerServerUrl, brokerExtApiUrl };
    };

    const closeDialog = () => {
        setExistingPassword('');
        setCreateError('');
        setValidationError('');
        onClose();
    };

    const connectExistingAccount = async () => {
        const normalizedLogin = existingLogin.trim();
        if (!/^\d+$/.test(normalizedLogin) || Number(normalizedLogin) <= 0) {
            throw new Error('Enter a valid positive account ID.');
        }
        if (!existingPassword) throw new Error('Password is required.');

        const { submitBroker, brokerServerUrl, brokerExtApiUrl } = resolveSelectedBrokerRouting(existingBroker || selectedBroker);
        const data = await tradeApi.auth.login({
            username: normalizedLogin,
            password: existingPassword,
            broker_id: submitBroker.broker_id,
        }, {
            baseUrl: buildBrokerApiV2BaseUrl(brokerExtApiUrl),
            skipDynamicUrl: true,
        });

        const token = data.access_token || data.token;
        if (!token) throw new Error('No authentication token received.');
        const accountId = String(data.account_login ?? normalizedLogin);
        const loginNumber = Number.parseInt(accountId, 10);
        if (!Number.isFinite(loginNumber) || loginNumber <= 0) {
            throw new Error('The broker did not return a valid account login.');
        }

        persistBrokerSessionDiscovery({
            ...submitBroker,
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

        const expiresAt = parseTokenExpiresAt(data.expires_at) ?? undefined;
        const store = useAppStore.getState();
        store.setAuthTokens(token, data.refresh_token, expiresAt);
        store.setAuthenticated(true, accountId, token, data.refresh_token, expiresAt, {
            login: loginNumber,
            name: data.user?.username || data.username || '',
            server: submitBroker.broker_name || submitBroker.broker_id,
            isLive: true,
            lastUsed: Date.now(),
        });
        localStorage.setItem('rtx_last_login', accountId);
        localStorage.setItem('rtx_saved_username', accountId);
        localStorage.removeItem('rtx_saved_password');
        closeDialog();
    };

    const createDemoAccount = async () => {
        const { submitBroker, brokerExtApiUrl } = resolveSelectedBrokerRouting();
        const request = {
            name: `${formData.firstName.trim()} ${formData.lastName.trim()}`,
            email: formData.email.trim(),
            phone: formData.phone.trim() || undefined,
            country: formData.country,
            currency: formData.currency,
            leverage: Number.parseInt(formData.leverage, 10),
        };
        const response = await tradeApi.account.create(request, {
            baseUrl: buildBrokerApiV2BaseUrl(brokerExtApiUrl),
            skipDynamicUrl: true,
        });
        const responseRecord = response as unknown as Record<string, unknown>;
        const accountRecord = responseRecord?.account && typeof responseRecord.account === 'object'
            ? responseRecord.account as CreatedAccount
            : response as CreatedAccount;
        if (!accountRecord?.login) {
            throw new Error('The broker did not return the new demo account login.');
        }
        setCreatedAccount({
            ...accountRecord,
            broker_id: accountRecord.broker_id || submitBroker.broker_id,
        });
        setStep(4);
    };

    const handleNext = async () => {
        setValidationError('');
        setCreateError('');

        if (step === 0) {
            if (!selectedBroker) {
                setValidationError('Please select a broker server.');
                return;
            }
            setStep(1);
            return;
        }

        if (step === 1 && accountType === 'existing') {
            try {
                setIsCreating(true);
                await connectExistingAccount();
            } catch (err: unknown) {
                setValidationError(getErrorMessage(err, 'Authentication failed'));
            } finally {
                setIsCreating(false);
            }
            return;
        }

        if (step === 1) {
            setStep(2);
            return;
        }

        if (step === 2 && accountType === 'real') {
            closeDialog();
            return;
        }

        if (step === 2) {
            if (!formData.firstName.trim() || !formData.lastName.trim()) {
                setValidationError('First name and last name are required.');
                return;
            }
            if (!isValidEmail(formData.email)) {
                setValidationError('Enter a valid email address.');
                return;
            }
            if (isDesktopShell && !formData.country) {
                setValidationError('Select a country from the list.');
                return;
            }
            setStep(3);
            return;
        }

        if (step === 3) {
            if (!Number.isFinite(Number(formData.leverage)) || Number(formData.leverage) <= 0) {
                setValidationError('Select a valid leverage.');
                return;
            }
            if (!termsAccepted) {
                setValidationError('Accept the terms and data protection policy to continue.');
                return;
            }
            try {
                setIsCreating(true);
                await createDemoAccount();
            } catch (err: unknown) {
                setCreateError(getErrorMessage(err, 'Failed to create demo account'));
            } finally {
                setIsCreating(false);
            }
            return;
        }

        closeDialog();
    };

    const handleBack = () => { if (step > 0) setStep(step - 1); };

    // ─── Step 0: Broker Selection ───────────────────────────────────────────────
    const renderStep0 = () => (
        <div className="rtx-open-account-dialog__broker-step">
            {/* Search bar */}
            <div className="rtx-open-account-dialog__search">
                <Search aria-hidden="true" />
                <input
                    type="text"
                    aria-label={tr("Search brokers")}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder={tr("Search broker name or server address…")}
                />
            </div>

            {/* Section header */}
            <div className="rtx-open-account-dialog__list-heading">
                <span>
                    {tr("Available Brokers")}</span>
                <span className="rtx-open-account-dialog__count" aria-live="polite">
                    {loadingBrokers ? '…' : filteredBrokers.length}
                </span>
            </div>

            {/* Broker list */}
            <div className="rtx-open-account-dialog__broker-list" aria-busy={loadingBrokers}>
                {loadingBrokers ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-[14px] font-normal text-zinc-600">
                        <Loader2 className="w-6 h-6 animate-spin opacity-50" />
                        <p>{tr("Loading brokers…")}</p>
                    </div>
                ) : directoryError ? (
                    <div className="py-6 text-center text-[14px] font-normal text-zinc-500">
                        <p role="alert">{tr(directoryError)}</p>
                        <button
                            type="button"
                            className="mt-3 rounded-md border border-[var(--border-primary)] px-4 py-2 text-[var(--text-primary)] hover:bg-[var(--bg-quaternary)]"
                            onClick={() => setDirectoryAttempt(attempt => attempt + 1)}
                        >
                            {tr('Retry')}
                        </button>
                    </div>
                ) : filteredBrokers.length === 0 ? (
                    <div className="py-10 text-center text-[14px] font-normal text-zinc-600">
                        <Globe className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p>{tr("No brokers found")}</p>
                    </div>
                ) : (
                    filteredBrokers.map(broker => {
                        const isSelected = selected === String(broker.id);
                        return (
                            <button
                                type="button"
                                key={broker.id}
                                aria-pressed={isSelected}
                                onClick={() => setSelected(String(broker.id))}
                                onDoubleClick={handleNext}
                                data-selected={isSelected}
                                className="rtx-open-account-dialog__broker rtx-open-account-dialog__broker-row"
                            >
                                {/* Avatar */}
                                <BrokerAvatar broker={broker} />

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="rtx-open-account-dialog__broker-name truncate">
                                            {broker.broker_name}
                                        </span>
                                        {broker.region && (
                                            <span
                                                className="rtx-open-account-dialog__badge px-1.5 py-0.5 rounded-full text-[12px] font-medium flex-shrink-0"
                                                style={{ background: '#232838', color: '#a5b4fc' }}
                                            >
                                                {broker.region}
                                            </span>
                                        )}
                                    </div>
                                    <div className="rtx-open-account-dialog__broker-id flex items-center gap-2 mt-0.5">
                                        <span className="truncate">{broker.broker_id}</span>
                                    </div>
                                </div>

                                {isSelected
                                    ? <CheckCircle2 className="rtx-open-account-dialog__selected-icon" aria-hidden="true" />
                                    : <ChevronRight className="rtx-open-account-dialog__row-chevron" aria-hidden="true" />}
                            </button>
                        );
                    })
                )}
            </div>

            {selectedBroker && !isDesktopShell && (
                <div className="rtx-open-account-dialog__selection" role="status">
                    <span>{tr("Selected broker")}</span>
                    <strong title={selectedBroker.broker_name}>{selectedBroker.broker_name}</strong>
                </div>
            )}
        </div>
    );

    // ─── Step 1: Account Type ───────────────────────────────────────────────────
    const renderStep1 = () => (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col p-5">
            <div className="flex flex-col gap-6 pt-2">
                <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="flex items-center h-5">
                        <input aria-label={tr("Demo account")} type="radio" checked={accountType === 'demo'} onChange={() => { setAccountType('demo'); setValidationError(''); }} className="w-4 h-4 accent-indigo-500" />
                    </div>
                    <div>
                        <div className="text-[14px] leading-5 font-medium text-zinc-200 transition-colors group-hover:text-white">{tr("Open a demo account to trade virtual money without risk")}</div>
                        <div className="rtx-reading-text mt-1 text-[16px] font-normal leading-6 text-zinc-500">{tr("A demo account allows you to learn trading on stock exchanges and test your strategies without risking real money.")}</div>
                    </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="flex items-center h-5">
                        <input aria-label={tr("Real account")} type="radio" checked={accountType === 'real'} onChange={() => { setAccountType('real'); setValidationError(''); }} className="w-4 h-4 accent-indigo-500" />
                    </div>
                    <div>
                        <div className="text-[14px] leading-5 font-medium text-zinc-200 transition-colors group-hover:text-white">{tr("Open a real account for live trading")}</div>
                        <div className="rtx-reading-text mt-1 text-[16px] font-normal leading-6 text-zinc-500">{tr("A real account requires additional proof of identity. You will need to provide copies of identification documents.")}</div>
                    </div>
                </label>

                <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="flex items-center h-5">
                        <input aria-label={tr("Existing account")} type="radio" checked={accountType === 'existing'} onChange={() => { setAccountType('existing'); setExistingBroker(selectedBroker || null); setValidationError(''); }} className="w-4 h-4 accent-indigo-500" />
                    </div>
                    <div className="w-full">
                        <div className="text-[14px] leading-5 font-medium text-zinc-200 transition-colors group-hover:text-white">{tr("Connect with an existing trade account")}</div>
                        {accountType === 'existing' && (
                            <div className="mt-3 flex flex-col gap-2">
                                <div className="flex items-center gap-3">
                                    <span className="w-16 flex-shrink-0 text-right text-[14px] leading-5 font-medium text-zinc-400">{tr("Login:")}</span>
                                    <input
                                        aria-label={tr("Existing account ID")}
                                        inputMode="numeric"
                                        autoComplete="username"
                                        type="text"
                                        value={existingLogin}
                                        onChange={e => setExistingLogin(e.target.value)}
                                        className="flex-1 rounded border border-zinc-700 bg-transparent px-2 py-1 text-[14px] font-normal text-white outline-none focus:border-indigo-500"
                                        placeholder={tr("Account ID")}
                                    />
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="w-16 flex-shrink-0 text-right text-[14px] leading-5 font-medium text-zinc-400">{tr("Password:")}</span>
                                    <input
                                        aria-label={tr("Existing account password")}
                                        autoComplete="off"
                                        spellCheck={false}
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        type="text"
                                        value={existingPassword}
                                        onChange={e => setExistingPassword(e.target.value)}
                                        className="rtx-secret-input flex-1 rounded border border-zinc-700 bg-transparent px-2 py-1 text-[14px] font-normal text-white outline-none focus:border-indigo-500"
                                        placeholder={tr("Password")}
                                    />
                                </div>
                                {/* Server dropdown with search */}
                                <div className="flex items-start gap-3">
                                    <span className="mt-1.5 w-16 flex-shrink-0 text-right text-[14px] leading-5 font-medium text-zinc-400">{tr("Server:")}</span>
                                    <div className="flex-1 relative">
                                        <button
                                            type="button"
                                            onClick={() => setExistingServerDropOpen(o => !o)}
                                            className="rtx-open-account-dialog__server-trigger flex h-[32px] w-full items-center justify-between gap-2 rounded border border-zinc-700 bg-[#1a1c23] px-2 text-left text-[14px] font-normal outline-none focus:border-indigo-500"
                                        >
                                            <div className="flex items-center gap-2 truncate flex-1">
                                                {existingBroker ? (
                                                    <>
                                                        <DropdownBrokerLogo broker={existingBroker} index={0} />
                                                        <span className="truncate text-zinc-300">
                                                            {existingBroker.broker_name} <span className="font-mono text-[14px] font-normal text-zinc-600">({existingBroker.broker_id})</span>
                                                        </span>
                                                    </>
                                                ) : (
                                                    <span className="text-zinc-600">{tr("Select server…")}</span>
                                                )}
                                            </div>
                                            <ChevronRight className={`w-3 h-3 text-zinc-500 flex-shrink-0 transition-transform ${existingServerDropOpen ? 'rotate-90' : ''}`} />
                                        </button>
                                        {existingServerDropOpen && (
                                            <div className="rtx-open-account-dialog__menu absolute z-50 left-0 right-0 top-full mt-1 bg-[#1e2030] border border-zinc-600/60 rounded shadow-xl max-h-[200px] flex flex-col">
                                                <div className="px-2 pt-2 pb-1 border-b border-zinc-700/50">
                                                    <input
                                                        autoFocus
                                                        type="text"
                                                        value={existingServerSearch}
                                                        onChange={e => setExistingServerSearch(e.target.value)}
                                                        placeholder={tr("Search broker or server…")}
                                                        className="h-[24px] w-full rounded border border-zinc-600/40 bg-[#131520] px-2 text-[14px] font-normal text-zinc-200 outline-none placeholder:text-zinc-600"
                                                        onClick={e => e.stopPropagation()}
                                                    />
                                                </div>
                                                <div className="overflow-y-auto flex-1">
                                                    {existingFilteredBrokers.map((b, idx) => (
                                                        <button
                                                            key={b.id}
                                                            type="button"
                                                            onClick={() => { setExistingBroker(b); setExistingServerDropOpen(false); setExistingServerSearch(''); }}
                                                            data-selected={existingBroker?.id === b.id}
                                                            className={`rtx-open-account-dialog__broker flex w-full items-center gap-2 px-3 py-1.5 text-left text-[14px] transition-colors hover:bg-zinc-700/60 ${existingBroker?.id === b.id ? 'bg-zinc-700/40 font-semibold text-white' : 'font-normal text-zinc-300'}`}
                                                        >
                                                            <DropdownBrokerLogo broker={b} index={idx} />
                                                            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                                                                <span className="truncate">{b.broker_name}</span>
                                                                <span className="truncate font-mono text-[14px] font-normal text-zinc-500">{b.broker_id}</span>
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </label>
            </div>
        </div>
    );

    // ─── Step 2: Personal Details ───────────────────────────────────────────────
    const renderDesktopDetails = () => (
        <div className="rtx-account-body">
            <div className="rtx-account-fields">
                {([
                    ['firstName', 'First name', 'given-name', 'text'],
                    ['lastName', 'Last name', 'family-name', 'text'],
                    ['email', 'Email', 'email', 'email'],
                    ['phone', 'Mobile phone', 'tel', 'tel'],
                ] as const).map(([field, label, autoComplete, type]) => (
                    <label className="rtx-account-field" key={field}>
                        <span>{tr(label)}{field === 'phone' && <small>{tr("Optional")}</small>}</span>
                        <input
                            aria-label={tr(label)}
                            autoComplete={autoComplete}
                            type={type}
                            required={field !== 'phone'}
                            value={formData[field]}
                            onChange={event => {
                                setFormData(current => ({ ...current, [field]: event.target.value }));
                                setValidationError('');
                            }}
                        />
                    </label>
                ))}
                <CountryCombobox
                    className="rtx-account-field--wide"
                    value={formData.country}
                    onChange={country => {
                        setFormData(current => ({ ...current, country }));
                        setValidationError('');
                    }}
                    error={validationError === 'Select a country from the list.' ? tr(validationError) : undefined}
                />
            </div>
            <p className="rtx-account-note">{tr("These details are used to open your demo account.")}</p>
        </div>
    );

    const renderDesktopSettings = () => (
        <div className="rtx-account-body">
            <div className="rtx-account-fields">
                <label className="rtx-account-field">
                    <span>{tr("Currency")}</span>
                    <select aria-label={tr("Currency")} value={formData.currency} onChange={event => setFormData(current => ({ ...current, currency: event.target.value }))}>
                        <option value="USD">USD — US Dollar</option>
                        <option value="EUR">EUR — Euro</option>
                    </select>
                </label>
                <label className="rtx-account-field">
                    <span>{tr("Leverage")}</span>
                    <select aria-label={tr("Leverage")} value={formData.leverage} onChange={event => setFormData(current => ({ ...current, leverage: event.target.value }))}>
                        <option value="100">1:100</option>
                        <option value="200">1:200</option>
                        <option value="500">1:500</option>
                    </select>
                </label>
            </div>
            <div className="rtx-account-consent">
                <label>
                    <input
                        aria-label={tr("Accept account terms")}
                        type="checkbox"
                        checked={termsAccepted}
                        onChange={event => { setTermsAccepted(event.target.checked); setValidationError(''); }}
                    />
                    <span>{tr("I agree with the terms and conditions for opening an account and the data protection policy")}</span>
                </label>
                {termsUrl && <a href={termsUrl} target="_blank" rel="noopener noreferrer">{tr("Terms and data protection policy")}</a>}
            </div>
            {createError && <div role="alert" className="rtx-account-error">{tr(createError)}</div>}
        </div>
    );

    const renderStep2 = () => accountType === 'real' ? (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col p-6">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-5">
                <div className="rtx-section-title mb-3 flex items-center gap-2 text-[16px] leading-6 font-semibold text-amber-300">
                    <Shield className="h-4 w-4" />
                    {tr("Identity verification is required")}</div>
                <p className="rtx-reading-text text-[16px] font-normal leading-6 text-zinc-300">
                    {selectedBroker?.broker_name || 'The selected broker'} {tr(" must complete identity checks and approve a live trading agreement before opening a real account.")}</p>
                <p className="mt-3 rtx-reading-text text-[16px] font-normal leading-6 text-zinc-500">
                    {tr("This terminal will not create or fund a real account automatically. Contact the broker through its verified customer-support or onboarding channel.")}</p>
            </div>
        </div>
    ) : isDesktopShell ? renderDesktopDetails() : (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col p-5">
            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    <span className="w-24 flex-shrink-0 text-right text-[14px] leading-5 font-medium text-zinc-400">{tr("First name:")}</span>
                    <input aria-label={tr("First name")} autoComplete="given-name" type="text" value={formData.firstName} onChange={e => setFormData(s => ({ ...s, firstName: e.target.value }))} className="flex-1 rounded border border-indigo-500 bg-transparent px-2 py-1.5 text-[14px] font-normal text-white outline-none" />
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-24 flex-shrink-0 text-right text-[14px] leading-5 font-medium text-zinc-400">{tr("Last name:")}</span>
                    <input aria-label={tr("Last name")} autoComplete="family-name" type="text" value={formData.lastName} onChange={e => setFormData(s => ({ ...s, lastName: e.target.value }))} className="flex-1 rounded border border-zinc-700 bg-transparent px-2 py-1.5 text-[14px] font-normal text-white outline-none focus:border-indigo-500" />
                </div>
                <div className="h-2" />
                <div className="flex items-center gap-2">
                    <span className="w-24 flex-shrink-0 text-right text-[14px] leading-5 font-medium text-zinc-400">{tr("Email:")}</span>
                    <input aria-label={tr("Email")} autoComplete="email" type="email" value={formData.email} onChange={e => setFormData(s => ({ ...s, email: e.target.value }))} className="flex-1 rounded border border-zinc-700 bg-transparent px-2 py-1.5 text-[14px] font-normal text-white outline-none focus:border-indigo-500" />
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-24 flex-shrink-0 text-right text-[14px] leading-5 font-medium text-zinc-400">{tr("Mobile Phone:")}</span>
                    <input aria-label={tr("Mobile phone")} autoComplete="tel" type="tel" value={formData.phone} onChange={e => setFormData(s => ({ ...s, phone: e.target.value }))} className="flex-1 rounded border border-zinc-700 bg-transparent px-2 py-1.5 text-[14px] font-normal text-white outline-none focus:border-indigo-500" />
                </div>
                <div className="h-2" />
                <div className="flex items-center gap-2 w-1/2 pr-2 mt-2">
                    <span className="w-24 flex-shrink-0 text-right text-[14px] leading-5 font-medium text-zinc-400">{tr("Country:")}</span>
                    <select aria-label={tr("Country")} value={formData.country} onChange={e => setFormData(s => ({ ...s, country: e.target.value }))} className="flex-1 rounded border border-zinc-700 bg-[#1a1c23] px-2 py-1.5 text-[14px] font-normal text-zinc-300 outline-none">
                        <option value="US">{tr("United States (US)")}</option>
                        <option value="IN">{tr("India (IN)")}</option>
                    </select>
                </div>
                <div className="pl-[104px] pt-4">
                    <p className="text-[14px] font-normal leading-tight text-zinc-500">
                        {tr("Personal details are used for opening a trade account and are not passed to any third parties.")}<br />
                        {tr("The information is handled securely and confidentially.")}</p>
                </div>
            </div>
        </div>
    );

    // ─── Step 3: Account Settings ───────────────────────────────────────────────
    const renderStep3 = () => isDesktopShell ? renderDesktopSettings() : (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col p-5">
            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 flex-1">
                        <span className="w-24 flex-shrink-0 text-right text-[14px] leading-5 font-medium text-zinc-400">{tr("Currency:")}</span>
                        <select aria-label={tr("Currency")} value={formData.currency} onChange={e => setFormData(s => ({ ...s, currency: e.target.value }))} className="flex-1 rounded border border-zinc-700 bg-[#1a1c23] px-2 py-1.5 text-[14px] font-normal text-zinc-300 outline-none">
                            <option value="USD">{tr("USD")}</option>
                            <option value="EUR">{tr("EUR")}</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-2 flex-1">
                        <span className="w-16 flex-shrink-0 text-right text-[14px] leading-5 font-medium text-zinc-400">{tr("Leverage:")}</span>
                        <select aria-label={tr("Leverage")} value={formData.leverage} onChange={e => setFormData(s => ({ ...s, leverage: e.target.value }))} className="flex-1 rounded border border-zinc-700 bg-[#1a1c23] px-2 py-1.5 text-[14px] font-normal text-zinc-300 outline-none">
                            <option value="100">1:100</option>
                            <option value="200">1:200</option>
                            <option value="500">1:500</option>
                        </select>
                    </div>
                </div>
                <div className="h-4" />
                <div className="flex items-start gap-2 pl-[104px]">
                    <input aria-label={tr("Accept account terms")} type="checkbox" className="mt-0.5 accent-indigo-500 w-3 h-3" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} />
                    <div>
                        <span className="block text-[14px] font-normal text-zinc-300">{tr("I agree with the terms and conditions for opening an account and the data protection policy")}</span>
                        {termsUrl && <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block text-[14px] font-normal text-indigo-400 hover:text-indigo-300">{tr("Terms and data protection policy")}</a>}
                    </div>
                </div>
                {createError && (
                    <div role="alert" className="mt-2 rounded border border-red-500/20 bg-red-500/10 p-2 pl-[104px] text-[14px] font-normal text-red-400">
                        {tr(createError)}
                    </div>
                )}
            </div>
        </div>
    );

    // ─── Step 4: Success ────────────────────────────────────────────────────────
    const renderStep4 = () => {
        if (!createdAccount) return null;
        return (
            <div className="flex-1 overflow-y-auto flex flex-col p-6 items-center">
                <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4 border border-emerald-500/20">
                    <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                </div>
                <h3 className="rtx-section-title text-white font-semibold text-[16px] leading-6 mb-1">{tr("Registration Complete")}</h3>
                <p className="mb-6 text-center text-[14px] font-normal text-zinc-400">{tr("Your demo account has been successfully created.")}<br />{tr("Save any credentials returned by the broker.")}</p>
                <div className="rtx-open-account-dialog__surface w-full bg-[#1a1c23] border border-zinc-700/50 rounded-xl p-5 flex flex-col gap-3">
                    {[
                        { label: 'Login (Account)', value: createdAccount.login, mono: true, color: 'text-emerald-400', size: 'text-[16px]' },
                        createdAccount.master_password && { label: 'Master Password', value: createdAccount.master_password, mono: true },
                        createdAccount.investor_password && { label: 'Investor Password', value: createdAccount.investor_password, mono: true },
                        createdAccount.api_key && { label: 'API Key', value: createdAccount.api_key, mono: true, small: true },
                        { label: 'Broker / Server', value: selectedBroker?.broker_name || createdAccount.broker_id || 'Broker' },
                        createdAccount.group && { label: 'Group', value: createdAccount.group },
                        createdAccount.balance !== undefined && { label: 'Balance', value: `${createdAccount.balance} ${createdAccount.currency || formData.currency}`, color: 'text-emerald-400' },
                        { label: 'Leverage', value: `1:${createdAccount.leverage || formData.leverage}` },
                    ].filter(isSummaryRow).map((row) => (
                        <div key={row.label} className="flex justify-between items-center pb-3 border-b border-zinc-800/80 last:border-0 last:pb-0">
                            <span className="text-[14px] font-normal uppercase tracking-wider text-zinc-500">{tr(row.label)}</span>
                            <div className="flex items-center gap-2">
                                <span className={`${row.color || 'text-zinc-200'} ${row.mono ? 'font-mono' : ''} ${row.size || 'text-[14px]'} ${row.small ? 'max-w-[200px] truncate' : ''} font-normal`}>{String(row.value)}</span>
                                {row.mono && (
                                    <button onClick={() => navigator.clipboard.writeText(String(row.value))} className="text-zinc-500 hover:text-white transition-colors">
                                        <Copy className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="mt-5 flex w-full items-start gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-center text-[14px] font-normal leading-relaxed text-yellow-500/90">
                    <Shield className="w-4 h-4 flex-shrink-0 mt-0.5 opacity-80" />
                    <span className="text-left">{tr("Keep these credentials private. You can save your password on this device when logging in.")}</span>
                </div>
            </div>
        );
    };

    const getHeader = () => {
        if (step === 0) return { title: 'Open an Account', sub: 'Select a broker to get started' };
        if (step === 1) return { title: 'Open an account', sub: 'Trade real or virtual money and gain experience' };
        if (step === 2 && accountType === 'real') return { title: 'Real Account Application', sub: 'Complete identity verification with your broker' };
        if (step === 2) return { title: 'Demo Account Details', sub: 'Enter the account holder information' };
        if (step === 3) return { title: 'Demo Account Settings', sub: 'Configure currency and leverage for your new account' };
        return { title: 'Registration Successful', sub: 'Your new account details' };
    };

    const header = getHeader();
    const desktopSteps = accountType === 'existing'
        ? ['Broker', 'Account type']
        : accountType === 'real' ? ['Broker', 'Account type', 'Verification']
            : ['Broker', 'Account type', 'Details', 'Settings'];
    const isStepValid = step === 0 ? Boolean(selectedBroker) && !loadingBrokers : true;
    const actionLabel = isCreating
        ? accountType === 'existing' ? 'Connecting...' : 'Creating...'
        : step === 1 && accountType === 'existing' ? 'Connect'
            : step === 2 && accountType === 'real' ? 'Done'
                : step < 3 ? 'Next >'
                    : step === 3 ? 'Create Demo Account'
                        : 'Finish';

    return createPortal(
        <div
            className="rtx-open-account-backdrop fixed inset-0 z-[9999] flex items-center justify-center"
            onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) closeDialog(); }}
            onMouseDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="rtx-open-account-title"
                aria-describedby="rtx-open-account-description"
                data-step={step}
                className={`rtx-open-account-dialog ${isDesktopShell ? 'rtx-open-account-dialog--desktop' : ''} relative flex flex-col overflow-hidden`}
            >
                {/* Header */}
                <div className="rtx-open-account-dialog__header flex shrink-0 items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                        {step === 0 && (
                            <div className="rtx-open-account-dialog__header-icon flex items-center justify-center" aria-hidden="true">
                                <Building2 className="w-4 h-4 text-white" />
                            </div>
                        )}
                        <div className="min-w-0">
                            <h2 id="rtx-open-account-title" className="rtx-dialog-title break-words text-[20px] leading-7 font-semibold text-white tracking-tight">
                                {isDesktopShell ? tr(header.title) : step > 0 ? tr("Open an Account: {{value0}}", { value0: selectedBroker?.broker_name || tr('Broker') }) : tr(header.title)}
                            </h2>
                            <p id="rtx-open-account-description" className="mt-0.5 text-[14px] font-normal text-zinc-500">{isDesktopShell && step > 0 ? selectedBroker?.broker_name : tr(step > 0 ? header.title : header.sub)}</p>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        <button type="button" onClick={closeDialog} className="rtx-open-account-dialog__close" aria-label={tr("Close")} title={tr("Close")}>
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                {isDesktopShell && step < 4 && (
                    <ol className="rtx-account-progress" aria-label={tr("Account setup progress")}>
                        {desktopSteps.map((label, index) => (
                            <li key={label} aria-current={index === step ? 'step' : undefined} data-complete={index < step}>
                                <span className="rtx-account-progress__number" aria-hidden="true">{index < step ? <CheckCircle2 /> : index + 1}</span>
                                <span>{tr(label)}</span>
                            </li>
                        ))}
                    </ol>
                )}

                {step === 0 && renderStep0()}
                {step === 1 && renderStep1()}
                {step === 2 && renderStep2()}
                {step === 3 && renderStep3()}
                {step === 4 && renderStep4()}

                {/* Footer */}
                {isDesktopShell ? (
                    <div className="rtx-account-footer">
                        {validationError && validationError !== 'Select a country from the list.' && <p role="alert" className="rtx-account-error">{tr(validationError)}</p>}
                        <div className="rtx-account-footer__actions">
                            {step > 0 && step < 4
                                ? <button type="button" disabled={isCreating} onClick={handleBack}>{tr("Back")}</button>
                                : <span />}
                            <div>
                                <button type="button" disabled={isCreating} onClick={closeDialog}>{tr("Cancel")}</button>
                                <button type="button" onClick={handleNext} disabled={!isStepValid || isCreating} className="rtx-account-primary">
                                    {isCreating && <Loader2 className="animate-spin" aria-hidden="true" />}
                                    {tr(actionLabel === 'Next >' ? 'Next' : actionLabel)}
                                    {!isCreating && actionLabel === 'Next >' && <ArrowRight aria-hidden="true" />}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : <div className="rtx-open-account-dialog__footer">
                    <div className="rtx-open-account-dialog__footer-hint">
                        {validationError ? <span role="alert" className="text-red-400">{tr(validationError)}</span> : (
                            <span className="text-zinc-600">{step === 0 ? tr("Double-click to proceed immediately") : ''}</span>
                        )}
                    </div>
                    <div className="rtx-open-account-dialog__footer-actions">
                        {step > 0 && step < 4 && (
                            <button
                                onClick={handleBack}
                                className="rounded-lg px-5 py-2 text-[14px] leading-5 font-medium text-zinc-300 transition-all hover:text-white hover:brightness-110"
                                style={{ background: '#232733', border: '1px solid #323845' }}
                            >
                                {tr("< Back")}</button>
                        )}
                        <button
                            onClick={closeDialog}
                            className="ml-1 rounded-lg px-5 py-2 text-[14px] leading-5 font-medium text-zinc-300 transition-all hover:text-white hover:brightness-110"
                            style={{ background: '#232733', border: '1px solid #323845' }}
                        >
                            {tr("Cancel")}</button>
                        <button
                            type="button"
                            onClick={handleNext}
                            disabled={!isStepValid || isCreating}
                            className="rtx-open-account-dialog__primary"
                        >
                            {isCreating && <Loader2 className="animate-spin" aria-hidden="true" />}
                            {tr(actionLabel === 'Next >' ? 'Next' : actionLabel)}
                            {!isCreating && actionLabel === 'Next >' && <ArrowRight aria-hidden="true" />}
                        </button>
                    </div>
                </div>}
            </div>
        </div>,
        document.body
    );
};

export default OpenAccountDialog;
