import { brokerDisplayName } from '../../services/brokerDisplayName';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import { useBrokerAccountSessionScope } from '../../hooks/useBrokerAccountSessionScope';
import { Icon } from '../ui/Icon';
import React, { lazy, useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore, type SavedAccount } from '../../store/useAppStore';
import { ArrowDownToLine, ArrowUpFromLine, FileCode } from 'lucide-react';
import { ContextMenu, type ContextMenuItemConfig } from '../ui/ContextMenu';
import { RetainedLazyFeature } from '../../startup/RetainedLazyFeature';
import { openAccountFeature } from '../../startup/terminalFeatures';
import { ChangePasswordDialog } from '../ChangePasswordDialog';
import { api } from '../../services/api';
import { getStoredBrokerServer } from '../../services/brokerServers';
import { useSavedAccountServerMigration } from '../../services/savedAccountServerMigration';
import { brokerV2Api } from '../../api/trade';
import { getRuntimeDiscoveryBaseUrl, isDesktopBackendTarget } from '../../config/backendTarget.js';
import { buildBrokerDirectoryLogoUrl, getConfiguredBrokerLogoUrl, isPlaceholderBrokerLogoUrl } from '../BrokerLogoImage';
import { getCachedBrokerDirectory, loadAppBrokerDirectory } from '../../services/brokerDirectory';
import { runAfterTerminalReady } from '../../startup/runAfterTerminalReady';
import { openWebTrader } from '../../services/webTrader';
import type { Broker, BrokerServer } from '../../types/api';
import type { BrokerDiscoveryItem } from '../../services/brokerDiscovery';
import { getSavedAccountServerIdentities, isSavedAccountInBrokerSession, normalizeSavedAccountServer } from '../../services/savedAccountScope';
import { getCommittedBrokerAccountSessionScope } from '../../services/brokerSession';
import { resolveDisplayAccountType, type TradingAccountType } from '../../services/tradingAccountType';
import './NavigatorPanel.css';

const LoginDialog = lazy(() => import('../LoginDialog').then(module => ({ default: module.LoginDialog })));
const OpenAccountDialog = openAccountFeature.Component;

type BrokerLogoInfo = {
    candidates: string[];
    brokerName: string;
};

type BrokerLogoTarget = { serverName: string; brokerId: string; serverUrl: string };
type StoredBrokerLogo = BrokerLogoTarget & { logoUrl: string; brokerName: string };

const brokerLogoKey = (target: BrokerLogoTarget) => JSON.stringify(target);

const normalizeNavigatorText = (value: unknown): string => String(value || '').trim();

const getStoredNavigatorValue = (key: string): string => {
    if (typeof window === 'undefined') return '';
    return normalizeNavigatorText(localStorage.getItem(key));
};

const resolveNavigatorLogoUrl = (url: string, baseCandidates: string[]): string => {
    const rawUrl = normalizeNavigatorText(url);
    if (!rawUrl || isPlaceholderBrokerLogoUrl(rawUrl)) return '';
    if (/^(?:https?:|data:|blob:)/i.test(rawUrl)) {
        return rawUrl;
    }

    if (rawUrl.startsWith('/api/v1/brokers/')) {
        const discoveryBase = normalizeSavedAccountServer(getRuntimeDiscoveryBaseUrl());
        if (discoveryBase) return `${discoveryBase}${rawUrl}`;
        return '';
    }

    for (const base of baseCandidates) {
        if (!/^https?:\/\//i.test(base)) continue;
        try { return new URL(rawUrl, `${base.replace(/\/+$/, '')}/`).toString(); } catch { /* Try the next owned endpoint. */ }
    }
    return '';
};

const matchesBrokerServer = (
    server: BrokerServer | BrokerDiscoveryItem,
    target: BrokerLogoTarget,
): boolean => {
    const brokerId = normalizeNavigatorText(server.broker_id);
    // Broker IDs are opaque; hostnames, shared labels, ports and paths do not
    // establish ownership. A known ID and endpoint must both be compatible.
    if (target.brokerId && brokerId !== target.brokerId) return false;
    const endpoints = [server.server_url, server.backend_url, server.server]
        .map(normalizeNavigatorText).filter(value => /^https?:\/\//i.test(value))
        .map(normalizeSavedAccountServer);
    if (target.serverUrl && endpoints.length > 0) {
        return endpoints.includes(normalizeSavedAccountServer(target.serverUrl));
    }
    if (target.brokerId) return true;
    const identity = normalizeSavedAccountServer(target.serverName);
    return Boolean(identity) && [server.server, server.server_url, server.backend_url,
        server.broker_id, server.broker_name, 'name' in server ? server.name : '']
        .map(value => normalizeSavedAccountServer(normalizeNavigatorText(value))).includes(identity);
};

const buildBrokerLogoInfo = (
    target: BrokerLogoTarget,
    directoryBrokers: BrokerDiscoveryItem[],
    servers: BrokerServer[],
    brokers: Broker[],
    stored?: StoredBrokerLogo,
): BrokerLogoInfo => {
    const matches = [...directoryBrokers, ...servers].filter(server => matchesBrokerServer(server, target));
    const matchedIds = new Set(matches.map(server => normalizeNavigatorText(server.broker_id)).filter(Boolean));
    // An unbound legacy label shared by multiple brokers is ambiguous.
    const owned = !target.brokerId && matchedIds.size > 1 ? [] : matches;
    const brokerId = target.brokerId || normalizeNavigatorText(owned[0]?.broker_id);
    const broker = brokerId ? brokers.find(item => item.broker_id === brokerId) : undefined;
    const storedMatches = Boolean(stored && brokerId && brokerId === stored.brokerId
        && target.serverUrl && normalizeSavedAccountServer(target.serverUrl) === normalizeSavedAccountServer(stored.serverUrl));
    const bases = [target.serverUrl, ...owned.flatMap(source => [source.server_url || '', source.backend_url || ''])];
    const candidates: string[] = [];
    const add = (value: string, sourceBases = bases) => {
        const url = resolveNavigatorLogoUrl(value, sourceBases);
        if (url && !candidates.includes(url)) candidates.push(url);
    };
    add(getConfiguredBrokerLogoUrl(brokerId));
    owned.forEach(source => add(source.logo_url || '', [source.server_url || '', source.backend_url || '', ...bases]));
    add(broker?.logo_url || '');
    if (storedMatches) add(stored?.logoUrl || '');
    add(buildBrokerDirectoryLogoUrl(brokerId));
    return { candidates, brokerName: brokerDisplayName(target.serverName,
        ...owned.flatMap(source => [source.broker_name, 'name' in source ? source.name : '']),
        broker?.name, storedMatches ? stored?.brokerName : '', brokerId) };
};

export const NavigatorPanel: React.FC = () => {
    const tr = useUiTranslation();
    const accountId = useAppStore(state => state.accountId);
    const savedAccounts = useAppStore(state => state.savedAccounts);
    const removeSavedAccount = useAppStore(state => state.removeSavedAccount);
    const addSavedAccount = useAppStore(state => state.addSavedAccount);
    const isAuthenticated = useAppStore(state => state.isAuthenticated);
    const sessionScope = useBrokerAccountSessionScope();
    // One group per broker: accounts saved under the build fallback server key
    // join the broker's real key once its config is available (re-renders the
    // group labels with the broker-published server name as well).
    useSavedAccountServerMigration();
    // Capture aliases at committed login boundaries, not while another broker
    // is being selected. Same-login broker switches also change this scope.
    const { brokerScope, accountServerIdentities, storedBrokerLogo } = useMemo(() => {
        const scope = getCommittedBrokerAccountSessionScope();
        const stored: StoredBrokerLogo = {
            serverName: getStoredBrokerServer(),
            brokerId: getStoredNavigatorValue('broker_id') || getStoredNavigatorValue('rtx_broker_id'),
            serverUrl: getStoredNavigatorValue('server_url') || getStoredNavigatorValue('backend_url'),
            logoUrl: getStoredNavigatorValue('logo_url'),
            brokerName: getStoredNavigatorValue('broker_name'),
        };
        const storageMatches = !scope.authenticated || (stored.brokerId === scope.brokerId
            && normalizeSavedAccountServer(stored.serverUrl) === normalizeSavedAccountServer(scope.serverUrl));
        return {
            brokerScope: scope,
            accountServerIdentities: getSavedAccountServerIdentities(),
            storedBrokerLogo: storageMatches ? stored : undefined,
        };
    }, [sessionScope]);

    // Keep every saved account for future login; scope only the authenticated
    // tree and Favorites. Logged-out Favorites remain quick-login shortcuts.
    const visibleSavedAccounts = isAuthenticated ? savedAccounts.filter(account => (
        isSavedAccountInBrokerSession(account, brokerScope, accountServerIdentities)
    )) : [];
    const visibleAccounts = [...visibleSavedAccounts];
    // A validated session exists independently of its optional saved bookmark.
    // Restored/legacy accounts must not be presented as logged out. Never use
    // a same-login bookmark from an unproven broker to fill this row's name.
    const activeLogin = Number(accountId);
    if (isAuthenticated && brokerScope.authenticated && brokerScope.accountId === accountId
        && Number.isSafeInteger(activeLogin) && activeLogin > 0
        && !visibleAccounts.some(account => String(account.login) === accountId)) {
        visibleAccounts.push({
            login: activeLogin,
            name: '',
            server: brokerScope.serverUrl || brokerScope.brokerId,
            brokerId: brokerScope.brokerId,
            serverUrl: brokerScope.serverUrl,
        });
    }
    const favoriteAccounts = (isAuthenticated ? visibleSavedAccounts : savedAccounts).filter(account => account.isFavorite);
    const isAccountActive = useCallback((account: SavedAccount) => isAuthenticated
        && account.login.toString() === accountId
        && isSavedAccountInBrokerSession(account, brokerScope, accountServerIdentities),
    [isAuthenticated, accountId, brokerScope, accountServerIdentities]);
    const accountKey = (account: SavedAccount) => JSON.stringify([
        account.brokerId || '', account.serverUrl || '', account.server, account.login,
    ]);

    const [loginDialogOpen, setLoginDialogOpen] = useState(false);
    const [openAccountDialogOpen, setOpenAccountDialogOpen] = useState(false);
    const [selectedAccountForLogin, setSelectedAccountForLogin] = useState<SavedAccount | null>(null);
    const [changePasswordDialogOpen, setChangePasswordDialogOpen] = useState(false);
    const [selectedAccountForPassword, setSelectedAccountForPassword] = useState<SavedAccount | null>(null);
    const [switchingLogin] = useState<number | null>(null);
    const [brokerLogoState, setBrokerLogoState] = useState<{ scope: string; logos: Record<string, BrokerLogoInfo> }>({ scope: '', logos: {} });

    useEffect(() => {
        localStorage.removeItem('rtx_saved_password');
        localStorage.removeItem('mt5_credentials');
        localStorage.removeItem('mt5_auto_login');
    }, []);



    // Group accounts by server
    const servers = Array.from(new Set(visibleAccounts.map(a => a.server)));
    const getLogoTarget = (serverName: string, account?: SavedAccount): BrokerLogoTarget => {
        if (isAuthenticated && brokerScope.authenticated) {
            return { serverName, brokerId: brokerScope.brokerId, serverUrl: brokerScope.serverUrl };
        }
        if (account?.brokerId || account?.serverUrl) {
            return { serverName, brokerId: account.brokerId || '', serverUrl: account.serverUrl || '' };
        }
        if (storedBrokerLogo && accountServerIdentities.has(normalizeSavedAccountServer(serverName))) {
            return { serverName, brokerId: storedBrokerLogo.brokerId, serverUrl: storedBrokerLogo.serverUrl };
        }
        return { serverName, brokerId: '', serverUrl: /^https?:\/\//i.test(serverName) ? serverName : '' };
    };
    const placeholderServer = getStoredBrokerServer();
    const logoTargets = [...visibleAccounts, ...favoriteAccounts].map(account => getLogoTarget(account.server, account));
    if (servers.length === 0) logoTargets.push(getLogoTarget(placeholderServer));
    const serverLogoKey = JSON.stringify([...new Map(logoTargets.map(target => [brokerLogoKey(target), target])).values()]);
    const logoScopeKey = `${sessionScope}:${serverLogoKey}`;
    // Clear old broker images during render, before effects or pending
    // discovery responses have a chance to run.
    const brokerLogos = brokerLogoState.scope === logoScopeKey ? brokerLogoState.logos : {};
    const logoFor = (serverName: string, account?: SavedAccount) => {
        const target = getLogoTarget(serverName, account);
        return brokerLogos[brokerLogoKey(target)] || buildBrokerLogoInfo(target, getCachedBrokerDirectory() || [], [], [], storedBrokerLogo);
    };

    useEffect(() => {
        let active = true;
        const targets = JSON.parse(serverLogoKey) as BrokerLogoTarget[];
        const update = (directory: BrokerDiscoveryItem[], brokerServers: BrokerServer[], brokers: Broker[]) => {
            if (!active) return;
            const logos = Object.fromEntries(targets.map(target => [brokerLogoKey(target),
                buildBrokerLogoInfo(target, directory, brokerServers, brokers, storedBrokerLogo)]));
            setBrokerLogoState({ scope: logoScopeKey, logos });
        };
        update(getCachedBrokerDirectory() || [], [], []);

        const loadBrokerLogos = async () => {
            try {
                const cachedDirectory = getCachedBrokerDirectory() || [];
                const [brokerServers, brokersData] = await Promise.all([
                    brokerV2Api.getServers().catch(() => [] as BrokerServer[]),
                    brokerV2Api.getBrokers().catch(() => ({ brokers: [] as Broker[], count: 0 })),
                ]);
                if (!active) return;

                const brokers = brokersData?.brokers || [];
                update(cachedDirectory, brokerServers, brokers);

                if (cachedDirectory.length === 0) {
                    loadAppBrokerDirectory({ desktop: isDesktopBackendTarget() })
                        .then((directoryBrokers) => {
                            if (!active || !directoryBrokers?.length) return;
                            update(directoryBrokers, brokerServers, brokers);
                        })
                        .catch(() => undefined);
                }
            } catch (error) {
                console.error('[NavigatorPanel] Failed to load broker logos:', error);
            }
        };

        const cancelScheduledLogos = runAfterTerminalReady(() => { void loadBrokerLogos(); });

        return () => {
            active = false;
            cancelScheduledLogos();
        };
    }, [serverLogoKey, logoScopeKey, storedBrokerLogo]);

    const handleLoginToAccount = (acc?: SavedAccount) => {
        if (acc) {
            setSelectedAccountForLogin(acc);
            setLoginDialogOpen(true);
        } else if (typeof window !== 'undefined' && (window as Window & { __RTX_APP_ACTIVE__?: boolean }).__RTX_APP_ACTIVE__) {
            window.dispatchEvent(new CustomEvent('rtx:openTradeAuth'));
        } else {
            setSelectedAccountForLogin(null);
            setLoginDialogOpen(true);
        }
    };

    // Switch account: require interactive login unless this account is already active.
    const handleSwitchAccount = useCallback(async (acc: SavedAccount) => {
        if (isAccountActive(acc)) return;

        localStorage.setItem('rtx_saved_username', String(acc.login));
        localStorage.setItem('rtx_last_login', String(acc.login));
        localStorage.removeItem('rtx_saved_password');
        addSavedAccount({ ...acc, lastUsed: Date.now() });
        handleLoginToAccount(acc);
    }, [isAccountActive, addSavedAccount]);

    const openAccountMenuItem: ContextMenuItemConfig = {
        label: 'Open an Account',
        icon: <Icon name="plus" size="xs" />,
        shortcut: 'Insert',
        action: () => setOpenAccountDialogOpen(true),
    };

    const getAccountContextMenuItems = (acc: SavedAccount): ContextMenuItemConfig[] => [
        openAccountMenuItem,
        { divider: true },
        {
            label: 'Login to Trade Account',
            icon: <Icon name="user" size="xs" />,
            shortcut: 'Enter',
            action: () => handleLoginToAccount(acc)
        },
        {
            label: 'Login to Web Trader',
            icon: <Icon name="globe" size="xs" />,
            disabled: !isAccountActive(acc),
            action: async () => {
                const result = await openWebTrader();
                window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
                    detail: result.status === 'opened'
                        ? { message: `Opened ${result.brokerName} Web Trader.`, type: 'success' }
                        : { message: result.message, type: 'error' },
                }));
            },
        },
        { label: 'Login to RTX5.community', icon: <Icon name="zap" size="xs" />, disabled: true },
        { divider: true },
        {
            label: 'Change Password',
            icon: <Icon name="lock" size="xs" />,
            disabled: !isAccountActive(acc),
            action: () => {
                setSelectedAccountForPassword(acc);
                setChangePasswordDialogOpen(true);
            }
        },
        {
            label: 'Delete',
            icon: <Icon name="trash" size="xs" className="text-red-400" />,
            shortcut: 'Delete',
            action: () => {
                if (confirm(`Remove account ${acc.login} from saved list?`)) {
                    removeSavedAccount(acc.login, acc.server, acc);
                    // If deleting the currently active/authenticated account,
                    // log out so charts stop and show the placeholder
                    if (isAccountActive(acc)) {
                        api.auth.logout();
                    }
                }
            }
        },
        { divider: true },
        { label: 'Deposit', icon: <ArrowDownToLine size={12} />, disabled: true },
        { label: 'Withdrawal', icon: <ArrowUpFromLine size={12} />, disabled: true },
        { divider: true },
        {
            label: acc.isFavorite ? 'Remove from Favorites' : 'Add to Favorites',
            icon: <Icon name="star" size="xs" />,
            action: () => addSavedAccount({ ...acc, isFavorite: !acc.isFavorite }),
        },
    ];

    const getGeneralAccountContextMenuItems = () => [
        openAccountMenuItem,
        {
            label: 'Login to Trade Account',
            icon: <Icon name="user" size="xs" />,
            shortcut: 'Enter',
            action: () => handleLoginToAccount()
        },
    ];

    return (
        <div className="navigator-panel flex flex-col h-full bg-[#131316] text-zinc-100 select-none border-r border-zinc-700">
            <div className="navigator-panel__body flex-1 overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-zinc-700">
                {/* Accounts */}
                <ContextMenu key={`${sessionScope}:${isAuthenticated}:${accountId}`} items={getGeneralAccountContextMenuItems()} variant="theme">
                    <TreeItem label={tr("Accounts")} icon={<Icon name="user" size="sm" />} defaultOpen>
                        {servers.map((serverName, sIdx) => {
                            const accountsInServer = visibleAccounts.filter(a => a.server === serverName);
                            const logoInfo = logoFor(serverName, accountsInServer[0]);
                            const isLastServer = sIdx === servers.length - 1 && visibleAccounts.length > 0;
                            return (
                                <TreeItem
                                    key={serverName}
                                    label={brokerDisplayName(serverName, logoInfo.brokerName)}
                                    icon={<BrokerServerIcon serverName={serverName} logoInfo={logoInfo} />}
                                    defaultOpen
                                    isLast={isLastServer && visibleAccounts.length > 0}
                                >
                                    {accountsInServer.map((acc, aIdx) => {
                                        const isActive = isAccountActive(acc);
                                        const isLastAccount = aIdx === accountsInServer.length - 1;
                                        const isSwitching = switchingLogin === acc.login;
                                        // Only show name if it's different from login number
                                        const displayName = acc.name && acc.name !== acc.login.toString()
                                            ? `${acc.login}: ${acc.name}`
                                            : `${acc.login}`;
                                        return (
                                            <ContextMenu key={accountKey(acc)} items={getAccountContextMenuItems(acc)} variant="theme">
                                                <TreeItem
                                                    label={isSwitching ? tr("{{value0}} (switching...)", { value0: displayName }) : tr(displayName)}
                                                    icon={<AccountIcon isActive={isActive} accountType={resolveDisplayAccountType(acc)} />}
                                                    isLast={isLastAccount}
                                                    isFavorite={acc.isFavorite}
                                                    onItemClick={() => {
                                                        handleSwitchAccount(acc);
                                                    }}
                                                />
                                            </ContextMenu>
                                        );
                                    })}
                                </TreeItem>
                            );
                        })}

                        {/* Add Account Placeholder if empty */}
                        {visibleAccounts.length === 0 && (
                            <TreeItem
                                label={brokerDisplayName(placeholderServer, logoFor(placeholderServer).brokerName)}
                                icon={
                                    <BrokerServerIcon
                                        serverName={placeholderServer}
                                        logoInfo={logoFor(placeholderServer)}
                                        muted
                                    />
                                }
                                defaultOpen
                                isLast
                            >
                                <TreeItem
                                    label={tr("Click to login...")}
                                    icon={
                                        <svg width={14} height={14} viewBox="0 0 16 16" fill="none" className="inline-block flex-shrink-0">
                                            <circle cx="8" cy="5" r="3" fill="#71717a" stroke="none" />
                                            <path d="M2 14c0-3 2.5-5 6-5s6 2 6 5" fill="#71717a" stroke="none" />
                                        </svg>
                                    }
                                    isLast
                                    onItemClick={() => handleLoginToAccount()}
                                />
                            </TreeItem>
                        )}
                    </TreeItem>
                </ContextMenu>

                <section aria-label={tr('Favorites')}>
                    <TreeItem label={tr('Favorites')} icon={<Icon name="star" size="sm" className="text-amber-400" />} defaultOpen>
                        {favoriteAccounts.length === 0 ? (
                            <p className="px-5 py-2 text-[12px] text-[var(--text-secondary)]">{tr('No favorite accounts yet')}</p>
                        ) : favoriteAccounts.map((acc, index) => (
                            <ContextMenu key={`${sessionScope}:${accountKey(acc)}`} items={getAccountContextMenuItems(acc)} variant="theme">
                                <TreeItem
                                    label={`${acc.login}${acc.name && acc.name !== String(acc.login) ? `: ${acc.name}` : ''} · ${brokerDisplayName(acc.server, logoFor(acc.server, acc).brokerName)}`}
                                    icon={<AccountIcon isActive={isAccountActive(acc)} accountType={resolveDisplayAccountType(acc)} />}
                                    isFavorite
                                    isLast={index === favoriteAccounts.length - 1}
                                    onItemClick={() => {
                                        if (!isAccountActive(acc)) handleLoginToAccount(acc);
                                    }}
                                />
                            </ContextMenu>
                        ))}
                    </TreeItem>
                </section>

                {/* Indicators */}
                <TreeItem label={tr("Indicators")} icon={<Icon name="trending-up" size="sm" />} defaultOpen disabled>
                    <TreeItem label={tr("Trend")} icon={<Icon name="folder" size="sm" className="text-amber-300" />}>
                        <TreeItem label={tr("Moving Average")} icon={<Icon name="trending-up" size="sm" />} />
                        <TreeItem label={tr("Bollinger Bands")} icon={<Icon name="trending-up" size="sm" />} isLast />
                    </TreeItem>
                    <TreeItem label={tr("Oscillators")} icon={<Icon name="folder" size="sm" className="text-amber-300" />}>
                        <TreeItem label={tr("RSI")} icon={<Icon name="trending-up" size="sm" />} />
                        <TreeItem label={tr("MACD")} icon={<Icon name="trending-up" size="sm" />} />
                        <TreeItem label={tr("Stochastic")} icon={<Icon name="trending-up" size="sm" />} isLast />
                    </TreeItem>
                    <TreeItem label={tr("Volumes")} icon={<Icon name="folder" size="sm" className="text-amber-300" />} />
                    <TreeItem label={tr("Bill Williams")} icon={<Icon name="folder" size="sm" className="text-amber-300" />} isLast />
                </TreeItem>

                {/* Expert Advisors */}
                <TreeItem label={tr("Automated Strategies")} icon={<Icon name="bot" size="sm" className="text-zinc-400" />} disabled>
                    <TreeItem label={tr("Macd Sample")} icon={<Icon name="bot" size="sm" className="text-zinc-400" />} />
                    <TreeItem label={tr("Moving Average")} icon={<Icon name="bot" size="sm" className="text-zinc-400" />} />
                    <TreeItem label={tr("Examples")} icon={<Icon name="folder" size="sm" className="text-amber-300" />} isLast>
                        <TreeItem label={tr("Momentum")} icon={<Icon name="bot" size="sm" className="text-zinc-400" />} isLast />
                    </TreeItem>
                </TreeItem>

                {/* Scripts */}
                <TreeItem label={tr("Scripts")} icon={<FileCode size={14} className="text-zinc-400" />} disabled>
                    <TreeItem label={tr("CloseAllPositions")} icon={<FileCode size={14} className="text-zinc-400" />} />
                    <TreeItem label={tr("CalculateLotSize")} icon={<FileCode size={14} className="text-zinc-400" />} isLast />
                </TreeItem>

                {/* Services */}
                <TreeItem label={tr("Services")} icon={<Icon name="zap" size="sm" className="text-zinc-400" />} defaultOpen disabled>
                    <TreeItem label={tr("Market")} icon={<Icon name="box" size="sm" className="text-zinc-400" />} />
                    <TreeItem label={tr("Signals")} icon={<Icon name="signal" size="sm" className="text-zinc-400" />} />
                    <TreeItem label={tr("Virtual Hosting")} icon={<Icon name="globe" size="sm" className="text-zinc-400" />} isLast />
                </TreeItem>
            </div>

            <RetainedLazyFeature active={openAccountDialogOpen}>
                <OpenAccountDialog
                    isOpen={openAccountDialogOpen}
                    onClose={() => setOpenAccountDialogOpen(false)}
                />
            </RetainedLazyFeature>

            <RetainedLazyFeature active={loginDialogOpen}>
            <LoginDialog
                isOpen={loginDialogOpen}
                onClose={() => setLoginDialogOpen(false)}
                initialLogin={selectedAccountForLogin?.login.toString()}
                initialServer={selectedAccountForLogin?.server}
            />
            </RetainedLazyFeature>

            <ChangePasswordDialog
                isOpen={changePasswordDialogOpen}
                onClose={() => setChangePasswordDialogOpen(false)}
                accountLogin={selectedAccountForPassword?.login.toString()}
            />
        </div>
    );
};

function BrokerServerIcon({
    serverName,
    logoInfo,
    muted = false,
}: {
    serverName: string;
    logoInfo?: BrokerLogoInfo;
    muted?: boolean;
}) {
    const candidates = logoInfo?.candidates || [];

    const candidateSignature = JSON.stringify([serverName, candidates]);
    const [attempt, setAttempt] = useState({ signature: candidateSignature, index: 0 });
    // Derive resets during render so a pending effect cannot overwrite a fast image failure.
    const candidateIndex = attempt.signature === candidateSignature ? attempt.index : 0;

    const currentSrc = candidates[candidateIndex];

    if (currentSrc) {
        return (
            <img
                key={currentSrc}
                src={currentSrc}
                alt={`${logoInfo?.brokerName || serverName} Logo`}
                className={`inline-block h-[14px] w-[14px] flex-shrink-0 rounded-sm object-contain ${muted ? 'opacity-70' : ''}`}
                onError={() => setAttempt({ signature: candidateSignature, index: candidateIndex + 1 })}
            />
        );
    }

    return <Icon name="server" size="sm" className="text-zinc-400" />;
}

/** MT5-style account icon - person silhouette with color */
function AccountIcon({ isActive, accountType }: { isActive: boolean; accountType?: TradingAccountType }) {
    const tr = useUiTranslation();
    const label = accountType === 'demo' ? tr('Demo account') : accountType === 'real' ? tr('Real account')
        : accountType === 'contest' ? tr('Contest account') : tr('Account type unavailable');
    return (
        <svg width={14} height={14} viewBox="0 0 16 16" fill="none" role="img" aria-label={label}
            data-account-type={accountType || 'unknown'} data-active={isActive}
            className="navigator-account-icon inline-block flex-shrink-0">
            <title>{label}</title>
            <circle cx="8" cy="5" r="3" fill="currentColor" stroke="none" />
            <path d="M2 14c0-3 2.5-5 6-5s6 2 6 5" fill="currentColor" stroke="none" />
        </svg>
    );
}

function TreeItem({
    label,
    icon,
    children,
    defaultOpen = false,
    isLast = false,
    onItemClick,
    onContextMenu,
    isFavorite = false,
    disabled = false,
}: {
    label: string;
    icon: React.ReactNode;
    children?: React.ReactNode;
    defaultOpen?: boolean;
    isLast?: boolean;
    onItemClick?: () => void;
    onContextMenu?: React.MouseEventHandler<HTMLDivElement>;
    isFavorite?: boolean;
    disabled?: boolean;
}) {
    const tr = useUiTranslation();
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const hasChildren = React.Children.count(children) > 0;
    const isExpandable = hasChildren && !disabled;

    return (
        <div className="navigator-tree-item relative" style={{ paddingLeft: 12 }}>
            {/* Vertical solid line connecting siblings - hidden for last item */}
            {!isLast && (
                <div
                    className="navigator-tree-item__line absolute top-0 left-[5px] w-px"
                    style={{
                        borderLeft: '1px solid var(--navigator-tree-line, #555)',
                        height: '100%',
                    }}
                />
            )}
            {/* Short vertical line for last item (only to the branch point) */}
            {isLast && (
                <div
                    className="navigator-tree-item__line absolute top-0 left-[5px] w-px"
                    style={{
                        borderLeft: '1px solid var(--navigator-tree-line, #555)',
                        height: '15px',
                    }}
                />
            )}

            {/* Horizontal connector line */}
            <div
                className="navigator-tree-item__line absolute left-[5px]"
                style={{
                    top: '15px',
                    width: '8px',
                    borderTop: '1px solid var(--navigator-tree-line, #555)',
                }}
            />

            <div
                className={`navigator-tree-item__row flex min-h-[30px] items-center gap-1.5 px-1 rounded-sm select-none ${disabled
                    ? 'navigator-tree-item__row--disabled cursor-not-allowed text-zinc-600'
                    : 'group cursor-pointer hover:bg-[#222226]'
                    }`}
                aria-disabled={disabled || undefined}
                onContextMenu={disabled ? undefined : onContextMenu}
                aria-label={disabled ? tr("{{value0}}, currently unavailable", { value0: label }) : undefined}
                title={disabled ? tr("{{value0}} is currently unavailable", { value0: label }) : undefined}
                onClick={disabled ? undefined : () => {
                    if (hasChildren) {
                        setIsOpen(!isOpen);
                    } else if (onItemClick) {
                        onItemClick();
                    }
                }}
                onDoubleClick={disabled || !hasChildren ? undefined : () => setIsOpen(!isOpen)}
            >
                {isExpandable && (
                    <span className="navigator-tree-item__chevron text-zinc-400 group-hover:text-zinc-100 flex-shrink-0" style={{ marginLeft: -2 }}>
                        {isOpen ? <Icon name="chevron-down" size="xs" /> : <Icon name="chevron-right" size="xs" />}
                    </span>
                )}
                {!isExpandable && <span className="w-3 flex-shrink-0" />}
                <span className={`navigator-tree-item__icon flex-shrink-0 ${disabled ? 'text-zinc-600' : 'text-zinc-300 group-hover:text-zinc-100'}`}>{icon}</span>
                <span className={`navigator-tree-item__label truncate text-[14px] font-normal ${disabled ? 'text-zinc-500' : 'text-zinc-100 group-hover:text-white'}`}>{label}</span>
                {isFavorite && (
                    <span className="ml-auto mr-1 flex-shrink-0" title={tr('Favorite account')} aria-label={tr('Favorite account')}>
                        <Icon name="star" size="xs" className="text-amber-400" />
                    </span>
                )}
                {disabled && (
                    <span className="navigator-tree-item__lock ml-auto mr-1 flex-shrink-0 text-zinc-500" aria-hidden="true">
                        <Icon name="lock" size="xs" />
                    </span>
                )}
            </div>
            {!disabled && isOpen && children && (
                <div className="relative">
                    {children}
                </div>
            )}
        </div>
    );
}
