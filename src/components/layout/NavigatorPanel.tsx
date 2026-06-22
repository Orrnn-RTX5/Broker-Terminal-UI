import { Icon } from '../ui/Icon';
import React, { useState, useEffect, useCallback } from 'react';
import { useAppStore, type SavedAccount } from '../../store/useAppStore';
import { FileCode } from 'lucide-react';
import { ContextMenu } from '../ui/ContextMenu';
import { LoginDialog } from '../LoginDialog';
import { ChangePasswordDialog } from '../ChangePasswordDialog';
import { api } from '../../services/api';
import { getStoredBrokerServer } from '../../services/brokerServers';
import { brokerV2Api } from '../../api/trade';
import { RTX5_API_URL, normalizeServerUrl } from '../../config/api';
import type { Broker, BrokerServer } from '../../types/api';

type BrokerLogoInfo = {
    logoUrl: string;
    baseCandidates: string[];
    brokerName: string;
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

const resolveNavigatorLogoUrl = (url: string, baseCandidates: string[]): string => {
    const rawUrl = normalizeNavigatorText(url);
    if (!rawUrl) return '';
    if (/^(?:https?:|data:|blob:)/i.test(rawUrl) || rawUrl.startsWith('./')) {
        return rawUrl;
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

const matchesBrokerServer = (server: BrokerServer, serverName: string): boolean => {
    const target = normalizeNavigatorText(serverName).toLowerCase();
    if (!target) return false;

    return [
        server.server,
        server.server_url,
        server.backend_url,
        server.market_api_url,
        server.broker_id,
        server.broker_name,
    ].some((value) => normalizeNavigatorText(value).toLowerCase() === target);
};

const matchesCurrentStoredBroker = (serverName: string): boolean => {
    const target = normalizeNavigatorText(serverName).toLowerCase();
    if (!target) return false;

    return [
        'rtx_broker_server',
        'server_url',
        'backend_url',
        'market_api_url',
        'broker_id',
        'rtx_broker_id',
        'broker_name',
    ].some((key) => getStoredNavigatorValue(key).toLowerCase() === target);
};

const getStoredBrokerLogoInfo = (serverName: string): BrokerLogoInfo | null => {
    const logoUrl = getStoredNavigatorValue('logo_url');
    if (!logoUrl || !matchesCurrentStoredBroker(serverName)) return null;

    return {
        logoUrl,
        brokerName: getStoredNavigatorValue('broker_name') || serverName,
        baseCandidates: [
            getStoredNavigatorValue('server_url'),
            getStoredNavigatorValue('backend_url'),
            getStoredNavigatorValue('market_api_url'),
        ],
    };
};

const buildBrokerLogoInfo = (
    serverName: string,
    servers: BrokerServer[],
    brokers: Broker[],
): BrokerLogoInfo | null => {
    const matchedServer = servers.find((server) => matchesBrokerServer(server, serverName));
    if (!matchedServer) return getStoredBrokerLogoInfo(serverName);

    const matchedBroker = matchedServer.broker_id
        ? brokers.find((broker) => broker.broker_id === matchedServer.broker_id)
        : undefined;
    const logoUrl = normalizeNavigatorText(matchedServer.logo_url) || normalizeNavigatorText(matchedBroker?.logo_url);
    if (!logoUrl) return getStoredBrokerLogoInfo(serverName);

    return {
        logoUrl,
        brokerName: normalizeNavigatorText(matchedServer.broker_name)
            || normalizeNavigatorText(matchedBroker?.name)
            || serverName,
        baseCandidates: [
            matchedServer.server_url || '',
            matchedServer.backend_url || '',
            matchedServer.market_api_url || '',
        ],
    };
};

export const NavigatorPanel: React.FC = () => {
    const accountId = useAppStore(state => state.accountId);
    const savedAccounts = useAppStore(state => state.savedAccounts);
    const removeSavedAccount = useAppStore(state => state.removeSavedAccount);
    const addSavedAccount = useAppStore(state => state.addSavedAccount);
    const isAuthenticated = useAppStore(state => state.isAuthenticated);

    const [loginDialogOpen, setLoginDialogOpen] = useState(false);
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
    const servers = Array.from(new Set(savedAccounts.map(a => a.server)));
    const serverNamesForLogos = servers.length > 0 ? servers : [getStoredBrokerServer()];
    const serverLogoKey = serverNamesForLogos.join('\u001f');

    useEffect(() => {
        let active = true;
        const serverNames = serverNamesForLogos.map(normalizeNavigatorText).filter(Boolean);

        setBrokerLogos((current) => {
            const next = { ...current };
            serverNames.forEach((serverName) => {
                const storedLogo = getStoredBrokerLogoInfo(serverName);
                if (storedLogo) next[serverName] = storedLogo;
            });
            return next;
        });

        const loadBrokerLogos = async () => {
            try {
                const [brokerServers, brokersData] = await Promise.all([
                    brokerV2Api.getServers().catch(() => []),
                    brokerV2Api.getBrokers().catch(() => ({ brokers: [], count: 0 })),
                ]);
                if (!active) return;

                const brokers = brokersData?.brokers || [];
                setBrokerLogos((current) => {
                    const next = { ...current };
                    serverNames.forEach((serverName) => {
                        const logoInfo = buildBrokerLogoInfo(serverName, brokerServers, brokers);
                        if (logoInfo) next[serverName] = logoInfo;
                    });
                    return next;
                });
            } catch (error) {
                console.error('[NavigatorPanel] Failed to load broker logos:', error);
            }
        };

        loadBrokerLogos();

        return () => {
            active = false;
        };
    }, [serverLogoKey]);

    const handleLoginToAccount = (acc?: SavedAccount) => {
        if (acc) {
            setSelectedAccountForLogin(acc);
        } else {
            setSelectedAccountForLogin(null);
        }
        setLoginDialogOpen(true);
    };

    // Switch account: require interactive login unless this account is already active.
    const handleSwitchAccount = useCallback(async (acc: SavedAccount) => {
        if (acc.login.toString() === accountId) return;

        localStorage.setItem('rtx_saved_username', String(acc.login));
        localStorage.setItem('rtx_last_login', String(acc.login));
        localStorage.removeItem('rtx_saved_password');
        addSavedAccount({ ...acc, lastUsed: Date.now() });
        handleLoginToAccount(acc);
    }, [accountId, addSavedAccount]);

    const getAccountContextMenuItems = (acc: SavedAccount) => [
        {
            label: 'Login to Trade Account',
            icon: <Icon name="user" size="xs" />,
            shortcut: 'Enter',
            action: () => handleLoginToAccount(acc)
        },
        { label: 'Login to Web Trader', icon: <Icon name="globe" size="xs" />, disabled: true },
        { label: 'Login to MQL5.community', icon: <Icon name="zap" size="xs" />, disabled: true },
        { divider: true },
        {
            label: 'Change Password',
            icon: <Icon name="lock" size="xs" />,
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
                    removeSavedAccount(acc.login);
                    // If deleting the currently active/authenticated account,
                    // log out so charts stop and show the placeholder
                    if (acc.login.toString() === accountId) {
                        api.auth.logout();
                    }
                }
            }
        },
        { divider: true },
        { label: 'Add to Favorites', icon: <Icon name="star" size="xs" />, disabled: true },
        { label: 'Register as Signal', icon: <Icon name="activity" size="xs" />, disabled: true },
        { label: 'Register a Virtual Server', icon: <Icon name="globe" size="xs" />, disabled: true },
    ];

    const getGeneralAccountContextMenuItems = () => [
        {
            label: 'Open an Account',
            icon: <Icon name="plus" size="xs" />,
            shortcut: 'Insert',
            action: () => handleLoginToAccount()
        },
        {
            label: 'Login to Trade Account',
            icon: <Icon name="user" size="xs" />,
            shortcut: 'Enter',
            action: () => handleLoginToAccount()
        },
    ];

    return (
        <div className="navigator-panel flex flex-col h-full bg-[#131316] text-zinc-300 select-none border-r border-zinc-700">
            <div className="navigator-panel__header px-2 py-1 bg-[#191a1e] border-b border-zinc-700 text-xs font-bold text-zinc-400 uppercase tracking-wider">
                Navigator
            </div>
            <div className="navigator-panel__body flex-1 overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-zinc-700">
                {/* Accounts */}
                <ContextMenu items={getGeneralAccountContextMenuItems()}>
                    <TreeItem label="Accounts" icon={<Icon name="user" size="sm" />} defaultOpen>
                        {servers.map((serverName, sIdx) => {
                            const accountsInServer = savedAccounts.filter(a => a.server === serverName);
                            const isLive = accountsInServer[0]?.isLive; // Restore original logic checking if the server represents live accounts
                            const isLastServer = sIdx === servers.length - 1 && savedAccounts.length > 0;
                            return (
                                <TreeItem
                                    key={serverName}
                                    label={serverName}
                                    icon={<BrokerServerIcon serverName={serverName} logoInfo={brokerLogos[serverName]} />}
                                    defaultOpen
                                    isLast={isLastServer && savedAccounts.length > 0}
                                >
                                    {accountsInServer.map((acc, aIdx) => {
                                        const isActive = acc.login.toString() === accountId;
                                        const isLastAccount = aIdx === accountsInServer.length - 1;
                                        const isSwitching = switchingLogin === acc.login;
                                        // Only show name if it's different from login number
                                        const displayName = acc.name && acc.name !== acc.login.toString()
                                            ? `${acc.login}: ${acc.name}`
                                            : `${acc.login}`;
                                        return (
                                            <ContextMenu key={acc.login} items={getAccountContextMenuItems(acc)}>
                                                <TreeItem
                                                    label={isSwitching ? `${displayName} (switching...)` : displayName}
                                                    icon={<AccountIcon isActive={isActive} isLive={isLive ?? false} />}
                                                    isLast={isLastAccount}
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
                        {savedAccounts.length === 0 && (
                            <TreeItem
                                label={getStoredBrokerServer()}
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
                                    label="Click to login..."
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

                {/* Indicators */}
                <TreeItem label="Indicators" icon={<Icon name="trending-up" size="sm" />} defaultOpen>
                    <TreeItem label="Trend" icon={<Icon name="folder" size="sm" className="text-amber-300" />}>
                        <TreeItem label="Moving Average" icon={<Icon name="trending-up" size="sm" />} />
                        <TreeItem label="Bollinger Bands" icon={<Icon name="trending-up" size="sm" />} isLast />
                    </TreeItem>
                    <TreeItem label="Oscillators" icon={<Icon name="folder" size="sm" className="text-amber-300" />}>
                        <TreeItem label="RSI" icon={<Icon name="trending-up" size="sm" />} />
                        <TreeItem label="MACD" icon={<Icon name="trending-up" size="sm" />} />
                        <TreeItem label="Stochastic" icon={<Icon name="trending-up" size="sm" />} isLast />
                    </TreeItem>
                    <TreeItem label="Volumes" icon={<Icon name="folder" size="sm" className="text-amber-300" />} />
                    <TreeItem label="Bill Williams" icon={<Icon name="folder" size="sm" className="text-amber-300" />} isLast />
                </TreeItem>

                {/* Expert Advisors */}
                <TreeItem label="Expert Advisors" icon={<Icon name="bot" size="sm" className="text-zinc-400" />}>
                    <TreeItem label="Macd Sample" icon={<Icon name="bot" size="sm" className="text-zinc-400" />} />
                    <TreeItem label="Moving Average" icon={<Icon name="bot" size="sm" className="text-zinc-400" />} />
                    <TreeItem label="Examples" icon={<Icon name="folder" size="sm" className="text-amber-300" />} isLast>
                        <TreeItem label="Momentum" icon={<Icon name="bot" size="sm" className="text-zinc-400" />} isLast />
                    </TreeItem>
                </TreeItem>

                {/* Scripts */}
                <TreeItem label="Scripts" icon={<FileCode size={14} className="text-zinc-400" />}>
                    <TreeItem label="CloseAllPositions" icon={<FileCode size={14} className="text-zinc-400" />} />
                    <TreeItem label="CalculateLotSize" icon={<FileCode size={14} className="text-zinc-400" />} isLast />
                </TreeItem>

                {/* Services */}
                <TreeItem label="Services" icon={<Icon name="zap" size="sm" className="text-zinc-400" />} defaultOpen>
                    <TreeItem label="Market" icon={<Icon name="box" size="sm" className="text-zinc-400" />} />
                    <TreeItem label="Signals" icon={<Icon name="signal" size="sm" className="text-zinc-400" />} />
                    <TreeItem label="Virtual Hosting" icon={<Icon name="globe" size="sm" className="text-zinc-400" />} isLast />
                </TreeItem>
            </div>

            <LoginDialog
                isOpen={loginDialogOpen}
                onClose={() => setLoginDialogOpen(false)}
                initialLogin={selectedAccountForLogin?.login.toString()}
                initialServer={selectedAccountForLogin?.server}
            />

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
    const [hasError, setHasError] = useState(false);
    const logoUrl = logoInfo?.logoUrl || '';

    useEffect(() => {
        setHasError(false);
    }, [serverName, logoUrl]);

    if (logoInfo && logoUrl && !hasError) {
        const logoSrc = resolveNavigatorLogoUrl(logoUrl, logoInfo.baseCandidates);
        if (logoSrc) {
            return (
                <img
                    src={logoSrc}
                    alt={`${logoInfo.brokerName || serverName} Logo`}
                    className={`inline-block h-[14px] w-[14px] flex-shrink-0 rounded-sm object-contain ${muted ? 'opacity-70' : ''}`}
                    onError={() => setHasError(true)}
                />
            );
        }
    }

    return <Icon name="server" size="sm" className={muted ? 'text-zinc-400' : 'text-amber-400'} />;
}

/** MT5-style account icon - person silhouette with color */
function AccountIcon({ isActive, isLive }: { isActive: boolean; isLive: boolean }) {
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
}: {
    label: string;
    icon: React.ReactNode;
    children?: React.ReactNode;
    defaultOpen?: boolean;
    isLast?: boolean;
    onItemClick?: () => void;
}) {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const hasChildren = React.Children.count(children) > 0;

    return (
        <div className="navigator-tree-item relative" style={{ paddingLeft: 12 }}>
            {/* Vertical dashed line connecting siblings - hidden for last item */}
            {!isLast && (
                <div
                    className="navigator-tree-item__line absolute top-0 left-[5px] w-px"
                    style={{
                        borderLeft: '1px dashed var(--navigator-tree-line, #555)',
                        height: '100%',
                    }}
                />
            )}
            {/* Short vertical line for last item (only to the branch point) */}
            {isLast && (
                <div
                    className="navigator-tree-item__line absolute top-0 left-[5px] w-px"
                    style={{
                        borderLeft: '1px dashed var(--navigator-tree-line, #555)',
                        height: '11px',
                    }}
                />
            )}

            {/* Horizontal connector line */}
            <div
                className="navigator-tree-item__line absolute left-[5px]"
                style={{
                    top: '11px',
                    width: '8px',
                    borderTop: '1px dashed var(--navigator-tree-line, #555)',
                }}
            />

            <div
                className="navigator-tree-item__row flex items-center gap-1.5 py-[1px] px-1 hover:bg-[#191a1e] cursor-pointer rounded-sm group select-none"
                onClick={() => {
                    if (hasChildren) {
                        setIsOpen(!isOpen);
                    } else if (onItemClick) {
                        onItemClick();
                    }
                }}
                onDoubleClick={() => hasChildren && setIsOpen(!isOpen)}
            >
                {hasChildren && (
                    <span className="navigator-tree-item__chevron text-zinc-500 group-hover:text-zinc-300 flex-shrink-0" style={{ marginLeft: -2 }}>
                        {isOpen ? <Icon name="chevron-down" size="xs" /> : <Icon name="chevron-right" size="xs" />}
                    </span>
                )}
                {!hasChildren && <span className="w-3 flex-shrink-0" />}
                <span className="navigator-tree-item__icon text-zinc-400 group-hover:text-zinc-200 flex-shrink-0">{icon}</span>
                <span className="navigator-tree-item__label text-[11px] font-medium text-zinc-300 group-hover:text-white truncate">{label}</span>
            </div>
            {isOpen && children && (
                <div className="relative">
                    {children}
                </div>
            )}
        </div>
    );
}
