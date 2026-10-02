import { brokerDisplayName } from '../../services/brokerDisplayName';
import { useUiTranslation } from '../../hooks/useUiTranslation';
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
import { brokerV2Api } from '../../api/trade';
import { RTX5_API_URL, normalizeServerUrl } from '../../config/api';
import { getRuntimeDiscoveryBaseUrl, isDesktopBackendTarget } from '../../config/backendTarget.js';
import { buildBrokerDirectoryLogoUrl } from '../BrokerLogoImage';
import { getCachedBrokerDirectory, loadAppBrokerDirectory } from '../../services/brokerDirectory';
import { runAfterTerminalReady } from '../../startup/runAfterTerminalReady';
import { openWebTrader } from '../../services/webTrader';
import type { Broker, BrokerServer } from '../../types/api';
import type { BrokerDiscoveryItem } from '../../services/brokerDiscovery';

const LoginDialog = lazy(() => import('../LoginDialog').then(module => ({ default: module.LoginDialog })));
const OpenAccountDialog = openAccountFeature.Component;

type BrokerLogoInfo = {
    logoUrl: string;
    baseCandidates: string[];
    brokerName: string;
    brokerId?: string;
};

const normalizeNavigatorText = (value: unknown): string => String(value || '').trim();

const getStoredNavigatorValue = (key: string): string => {
    if (typeof window === 'undefined') return '';
    return normalizeNavigatorText(localStorage.getItem(key));
};

const normalizeLogoBaseUrl = (value: unknown): string => {
    const normalized = normalizeServerUrl(normalizeNavigatorText(value));
    return normalized.replace(/\/api\/v\d+\/?$/i, '').replace(/\/$/, '');
};

const extractHost = (value: unknown): string => {
    const raw = normalizeNavigatorText(value);
    if (!raw) return '';
    try {
        const withProto = raw.includes('://') ? raw : `https://${raw}`;
        return new URL(withProto).hostname.toLowerCase();
    } catch {
        return raw.toLowerCase();
    }
};

const resolveNavigatorLogoUrl = (url: string, baseCandidates: string[]): string => {
    const rawUrl = normalizeNavigatorText(url);
    if (!rawUrl) return '';
    if (/^(?:https?:|data:|blob:)/i.test(rawUrl) || rawUrl.startsWith('./')) {
        return rawUrl;
    }

    if (rawUrl.startsWith('/api/v1/brokers/')) {
        const discoveryBase = normalizeLogoBaseUrl(getRuntimeDiscoveryBaseUrl());
        if (discoveryBase) return `${discoveryBase}${rawUrl}`;
    }

    const base = [
        ...baseCandidates,
        getStoredNavigatorValue('server_url'),
        getStoredNavigatorValue('backend_url'),
        RTX5_API_URL,
    ].map(normalizeLogoBaseUrl).find(Boolean);
    if (!base) return rawUrl;

    const path = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
    return `${base}${path}`;
};

const matchesBrokerServer = (
    server: BrokerServer | BrokerDiscoveryItem,
    serverName: string,
): boolean => {
    const target = normalizeNavigatorText(serverName).toLowerCase();
    if (!target) return false;
    const targetTrimmed = target.replace(/\/+$/, '');
    const targetHost = extractHost(target);

    const candidates = [
        server.server,
        server.server_url,
        server.backend_url,
        server.market_api_url,
        server.broker_id,
        server.broker_name,
        (server as any).name,
        (server as any).domain_name,
        (server as any).server_domain,
    ].map(normalizeNavigatorText).filter(Boolean);

    for (const candidate of candidates) {
        const candLower = candidate.toLowerCase();
        const candTrimmed = candLower.replace(/\/+$/, '');
        if (target === candLower || targetTrimmed === candTrimmed) return true;

        const candHost = extractHost(candidate);
        if (targetHost && candHost && targetHost === candHost) return true;
    }

    return false;
};

const matchesCurrentStoredBroker = (serverName: string): boolean => {
    const target = normalizeNavigatorText(serverName).toLowerCase();
    if (!target) return false;
    const targetTrimmed = target.replace(/\/+$/, '');
    const targetHost = extractHost(target);

    const keys = [
        'rtx_broker_server',
        'server_url',
        'backend_url',
        'market_api_url',
        'broker_id',
        'rtx_broker_id',
        'broker_name',
    ];

    for (const key of keys) {
        const val = getStoredNavigatorValue(key).toLowerCase();
        if (!val) continue;
        const valTrimmed = val.replace(/\/+$/, '');
        if (target === val || targetTrimmed === valTrimmed) return true;
        const valHost = extractHost(val);
        if (targetHost && valHost && targetHost === valHost) return true;
    }

    return false;
};

const getStoredBrokerLogoInfo = (serverName: string): BrokerLogoInfo | null => {
    if (!matchesCurrentStoredBroker(serverName)) return null;

    const storedLogoUrl = getStoredNavigatorValue('logo_url');
    const brokerId = getStoredNavigatorValue('broker_id')
        || getStoredNavigatorValue('rtx_broker_id');

    let logoUrl = storedLogoUrl;
    if (!logoUrl && brokerId) {
        logoUrl = buildBrokerDirectoryLogoUrl(brokerId);
    }

    return {
        logoUrl,
        brokerName: brokerDisplayName(serverName),
        brokerId,
        baseCandidates: [
            getStoredNavigatorValue('server_url'),
            getStoredNavigatorValue('backend_url'),
            getStoredNavigatorValue('market_api_url'),
        ],
    };
};

const buildBrokerLogoInfo = (
    serverName: string,
    directoryBrokers: BrokerDiscoveryItem[],
    servers: BrokerServer[],
    brokers: Broker[],
): BrokerLogoInfo | null => {
    const matchedDirectory = directoryBrokers.find((broker) => matchesBrokerServer(broker, serverName));
    const matchedServer = servers.find((server) => matchesBrokerServer(server, serverName));
    const matchedBroker = (matchedServer?.broker_id || matchedDirectory?.broker_id)
        ? brokers.find((broker) => broker.broker_id === (matchedServer?.broker_id || matchedDirectory?.broker_id))
        : undefined;

    const brokerId = normalizeNavigatorText(
        matchedDirectory?.broker_id
        || matchedServer?.broker_id
        || matchedBroker?.broker_id
    );

    const brokerName = brokerDisplayName(
        serverName,
        matchedDirectory?.broker_name,
        matchedDirectory?.name,
        matchedServer?.broker_name,
        matchedBroker?.name,
        brokerId,
    );

    let logoUrl = normalizeNavigatorText(matchedDirectory?.logo_url)
        || normalizeNavigatorText(matchedServer?.logo_url)
        || normalizeNavigatorText(matchedBroker?.logo_url);

    if (!logoUrl && brokerId) {
        logoUrl = buildBrokerDirectoryLogoUrl(brokerId);
    }

    if (!logoUrl && !brokerName && !matchedServer && !matchedDirectory) {
        return getStoredBrokerLogoInfo(serverName);
    }

    const baseCandidates = [
        matchedDirectory?.server_url || '',
        matchedDirectory?.backend_url || '',
        matchedDirectory?.market_api_url || '',
        matchedServer?.server_url || '',
        matchedServer?.backend_url || '',
        matchedServer?.market_api_url || '',
    ];

    return {
        logoUrl: logoUrl || getStoredNavigatorValue('logo_url'),
        brokerName,
        brokerId,
        baseCandidates,
    };
};

export const NavigatorPanel: React.FC = () => {
    const tr = useUiTranslation();
    const accountId = useAppStore(state => state.accountId);
    const savedAccounts = useAppStore(state => state.savedAccounts);
    const removeSavedAccount = useAppStore(state => state.removeSavedAccount);
    const addSavedAccount = useAppStore(state => state.addSavedAccount);
    const isAuthenticated = useAppStore(state => state.isAuthenticated);

    // Saved accounts persist across logout for quick re-login, but the tree
    // must not present them as an active session. Once the user logs out the
    // Navigator returns to its logged-out placeholder ("Click to login...").
    const visibleAccounts = isAuthenticated ? savedAccounts : [];
    const favoriteAccounts = savedAccounts.filter(account => account.isFavorite);
    const isAccountActive = (account: SavedAccount) => isAuthenticated
        && account.login.toString() === accountId
        && account.server === getStoredBrokerServer();

    const [loginDialogOpen, setLoginDialogOpen] = useState(false);
    const [openAccountDialogOpen, setOpenAccountDialogOpen] = useState(false);
    const [selectedAccountForLogin, setSelectedAccountForLogin] = useState<SavedAccount | null>(null);
    const [changePasswordDialogOpen, setChangePasswordDialogOpen] = useState(false);
    const [selectedAccountForPassword, setSelectedAccountForPassword] = useState<SavedAccount | null>(null);
    const [switchingLogin] = useState<number | null>(null);
    const [brokerLogos, setBrokerLogos] = useState<Record<string, BrokerLogoInfo>>({});

    useEffect(() => {
        localStorage.removeItem('rtx_saved_password');
        localStorage.removeItem('mt5_credentials');
        localStorage.removeItem('mt5_auto_login');
    }, []);



    // Group accounts by server
    const servers = Array.from(new Set(visibleAccounts.map(a => a.server)));
    const serverNamesForLogos = servers.length > 0 ? servers : [getStoredBrokerServer()];
    const serverLogoKey = serverNamesForLogos.join('\u001f');

    useEffect(() => {
        let active = true;
        const serverNames = serverNamesForLogos.map(normalizeNavigatorText).filter(Boolean);

        setBrokerLogos((current) => {
            const next = { ...current };
            const cachedDirectory = getCachedBrokerDirectory() || [];
            serverNames.forEach((serverName) => {
                const logoInfo = buildBrokerLogoInfo(serverName, cachedDirectory, [], []);
                if (logoInfo) next[serverName] = logoInfo;
            });
            return next;
        });

        const loadBrokerLogos = async () => {
            try {
                const cachedDirectory = getCachedBrokerDirectory() || [];
                const [brokerServers, brokersData] = await Promise.all([
                    brokerV2Api.getServers().catch(() => [] as BrokerServer[]),
                    brokerV2Api.getBrokers().catch(() => ({ brokers: [] as Broker[], count: 0 })),
                ]);
                if (!active) return;

                const brokers = brokersData?.brokers || [];
                setBrokerLogos((current) => {
                    const next = { ...current };
                    serverNames.forEach((serverName) => {
                        const logoInfo = buildBrokerLogoInfo(serverName, cachedDirectory, brokerServers, brokers);
                        if (logoInfo) next[serverName] = logoInfo;
                    });
                    return next;
                });

                if (cachedDirectory.length === 0) {
                    loadAppBrokerDirectory({ desktop: isDesktopBackendTarget() })
                        .then((directoryBrokers) => {
                            if (!active || !directoryBrokers?.length) return;
                            setBrokerLogos((current) => {
                                const next = { ...current };
                                serverNames.forEach((serverName) => {
                                    const logoInfo = buildBrokerLogoInfo(serverName, directoryBrokers, brokerServers, brokers);
                                    if (logoInfo) next[serverName] = logoInfo;
                                });
                                return next;
                            });
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
    }, [serverLogoKey]);

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
        if (isAuthenticated && acc.login.toString() === accountId && acc.server === getStoredBrokerServer()) return;

        localStorage.setItem('rtx_saved_username', String(acc.login));
        localStorage.setItem('rtx_last_login', String(acc.login));
        localStorage.removeItem('rtx_saved_password');
        addSavedAccount({ ...acc, lastUsed: Date.now() });
        handleLoginToAccount(acc);
    }, [accountId, isAuthenticated, addSavedAccount]);

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
                    removeSavedAccount(acc.login, acc.server);
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
                <ContextMenu key={`${isAuthenticated}:${accountId}`} items={getGeneralAccountContextMenuItems()} variant="theme">
                    <TreeItem label={tr("Accounts")} icon={<Icon name="user" size="sm" />} defaultOpen>
                        {servers.map((serverName, sIdx) => {
                            const accountsInServer = visibleAccounts.filter(a => a.server === serverName);
                            const isLive = accountsInServer[0]?.isLive; // Restore original logic checking if the server represents live accounts
                            const isLastServer = sIdx === servers.length - 1 && visibleAccounts.length > 0;
                            return (
                                <TreeItem
                                    key={serverName}
                                    label={brokerDisplayName(serverName, brokerLogos[serverName]?.brokerName)}
                                    icon={<BrokerServerIcon serverName={serverName} logoInfo={brokerLogos[serverName]} />}
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
                                            <ContextMenu key={acc.login} items={getAccountContextMenuItems(acc)} variant="theme">
                                                <TreeItem
                                                    label={isSwitching ? tr("{{value0}} (switching...)", { value0: displayName }) : tr(displayName)}
                                                    icon={<AccountIcon isActive={isActive} isLive={isLive ?? false} />}
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
                                label={brokerDisplayName(getStoredBrokerServer(), brokerLogos[getStoredBrokerServer()]?.brokerName)}
                                icon={
                                    <BrokerServerIcon
                                        serverName={getStoredBrokerServer()}
                                        logoInfo={brokerLogos[getStoredBrokerServer()]}
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
                            <ContextMenu key={`${acc.server}:${acc.login}`} items={getAccountContextMenuItems(acc)} variant="theme">
                                <TreeItem
                                    label={`${acc.login}${acc.name && acc.name !== String(acc.login) ? `: ${acc.name}` : ''} · ${brokerDisplayName(acc.server, brokerLogos[acc.server]?.brokerName)}`}
                                    icon={<AccountIcon isActive={isAccountActive(acc)} isLive={acc.isLive} />}
                                    isFavorite
                                    isLast={index === favoriteAccounts.length - 1}
                                    onItemClick={() => handleLoginToAccount(acc)}
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
    const [candidateIndex, setCandidateIndex] = useState(0);

    const candidates = useMemo(() => {
        const list: string[] = [];
        const add = (url: unknown) => {
            const raw = normalizeNavigatorText(url);
            if (raw && !list.includes(raw)) list.push(raw);
        };

        if (logoInfo?.logoUrl) {
            const resolved = resolveNavigatorLogoUrl(logoInfo.logoUrl, logoInfo.baseCandidates);
            add(resolved);
        }

        const brokerId = logoInfo?.brokerId;
        if (brokerId) {
            add(buildBrokerDirectoryLogoUrl(brokerId));
        }

        if (matchesCurrentStoredBroker(serverName)) {
            add(getStoredNavigatorValue('logo_url'));
        }

        return list;
    }, [serverName, logoInfo]);

    useEffect(() => {
        setCandidateIndex(0);
    }, [serverName, candidates.join('\n')]);

    const currentSrc = candidates[candidateIndex];

    if (currentSrc) {
        return (
            <img
                key={currentSrc}
                src={currentSrc}
                alt={`${logoInfo?.brokerName || serverName} Logo`}
                className={`inline-block h-[14px] w-[14px] flex-shrink-0 rounded-sm object-contain ${muted ? 'opacity-70' : ''}`}
                onError={() => setCandidateIndex(prev => prev + 1)}
            />
        );
    }

    return <Icon name="server" size="sm" className={muted ? 'text-zinc-400' : 'text-amber-400'} />;
}

/** MT5-style account icon - person silhouette with color */
function AccountIcon({ isActive }: { isActive: boolean; isLive: boolean }) {
    const color = '#fbbf24'; // always yellow for both real and demo
    return (
        <svg width={14} height={14} viewBox="0 0 16 16" fill="none" className={`inline-block flex-shrink-0 ${isActive ? 'opacity-100' : 'opacity-60'}`}>
            <circle cx="8" cy="5" r="3" fill={color} stroke="none" />
            <path d="M2 14c0-3 2.5-5 6-5s6 2 6 5" fill={color} stroke="none" />
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
