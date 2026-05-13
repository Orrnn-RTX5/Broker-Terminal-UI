import { Icon } from '../ui/Icon';
import React, { useState, useEffect, useCallback } from 'react';
import { useAppStore, type SavedAccount } from '../../store/useAppStore';
import { FileCode } from 'lucide-react';
import { ContextMenu } from '../ui/ContextMenu';
import { LoginDialog } from '../LoginDialog';
import { ChangePasswordDialog } from '../ChangePasswordDialog';
import { api } from '../../services/api';

export const NavigatorPanel: React.FC = () => {
    const accountId = useAppStore(state => state.accountId);
    const savedAccounts = useAppStore(state => state.savedAccounts);
    const removeSavedAccount = useAppStore(state => state.removeSavedAccount);
    const addSavedAccount = useAppStore(state => state.addSavedAccount);
    const setActiveAccount = useAppStore(state => state.setActiveAccount);
    const setAuthenticated = useAppStore(state => state.setAuthenticated);

    const [loginDialogOpen, setLoginDialogOpen] = useState(false);
    const [selectedAccountForLogin, setSelectedAccountForLogin] = useState<SavedAccount | null>(null);
    const [changePasswordDialogOpen, setChangePasswordDialogOpen] = useState(false);
    const [selectedAccountForPassword, setSelectedAccountForPassword] = useState<SavedAccount | null>(null);
    const [switchingLogin, setSwitchingLogin] = useState<number | null>(null);

    // Auto-add active account to savedAccounts if not already present,
    // and fetch its real name from the backend APIs
    useEffect(() => {
        if (!accountId) return;
        const loginNum = parseInt(accountId, 10);
        if (isNaN(loginNum)) return;

        const existing = savedAccounts.find(a => a.login === loginNum);
        // Add if missing (with empty name first so it shows up immediately)
        if (!existing) {
            addSavedAccount({
                login: loginNum,
                name: '',
                server: 'FlexyMarkets-Server',
                isLive: true,
                lastUsed: Date.now(),
            });
        }

        // Fetch the real account name from account summary API
        if (!existing?.name) {
            api.account.getAccountSummary(loginNum)
                .then((data: any) => {
                    console.log('[Navigator] Account summary response:', data);
                    const accountName = data?.name || data?.account_name || data?.display_name || '';
                    if (accountName) {
                        addSavedAccount({
                            login: loginNum,
                            name: accountName,
                            server: 'FlexyMarkets-Server',
                            isLive: true,
                            lastUsed: Date.now(),
                        });
                    }
                })
                .catch((err) => {
                    console.debug('[Navigator] account summary not available:', err);
                });
        }
    }, [accountId]);

    // Group accounts by server
    const servers = Array.from(new Set(savedAccounts.map(a => a.server)));

    const handleLoginToAccount = (acc?: SavedAccount) => {
        if (acc) {
            setSelectedAccountForLogin(acc);
        } else {
            setSelectedAccountForLogin(null);
        }
        setLoginDialogOpen(true);
    };

    // Switch account: re-login silently with saved password → reload (no dialog popup)
    const handleSwitchAccount = useCallback(async (acc: SavedAccount) => {
        // Already active? Skip
        if (acc.login.toString() === accountId) return;

        // No saved password at all? Must open login dialog
        if (!acc.password) {
            handleLoginToAccount(acc);
            return;
        }

        setSwitchingLogin(acc.login);
        try {
            // 1. Logout old session (fire-and-forget)
            try { api.auth.logout(); } catch (_) { /* ignore */ }

            // 2. Re-login with saved credentials
            const password = atob(acc.password);
            const response = await api.auth.login(String(acc.login), password);

            if (response && response.access_token) {
                // 3. Store new credentials for session restore on reload
                localStorage.setItem('auth_token', response.access_token);
                if (response.refresh_token) localStorage.setItem('refresh_token', response.refresh_token);
                localStorage.setItem('rtx_saved_username', String(acc.login));
                localStorage.setItem('rtx_saved_password', acc.password);
                localStorage.setItem('rtx_last_login', String(acc.login));

                // 4. Update store then reload for clean switch
                setAuthenticated(true, String(acc.login), response.access_token, response.refresh_token);
                setActiveAccount(acc.login);

                console.log(`[Navigator] Switched to account ${acc.login} — reloading`);
                window.location.reload();
            } else {
                // Auth failed silently — just reload with saved creds, session restore will handle it
                localStorage.setItem('rtx_saved_username', String(acc.login));
                localStorage.setItem('rtx_saved_password', acc.password);
                localStorage.setItem('rtx_last_login', String(acc.login));
                console.warn(`[Navigator] Re-auth response missing token for ${acc.login}, reloading`);
                window.location.reload();
            }
        } catch (err: any) {
            // On error, still try to reload with saved creds — session restore will retry
            console.error(`[Navigator] Account switch error for ${acc.login}:`, err.message);
            localStorage.setItem('rtx_saved_username', String(acc.login));
            localStorage.setItem('rtx_saved_password', acc.password);
            localStorage.setItem('rtx_last_login', String(acc.login));
            window.location.reload();
        } finally {
            setSwitchingLogin(null);
        }
    }, [accountId, setActiveAccount, setAuthenticated]);

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
                                    icon={<Icon name="server" size="sm" className="text-amber-400" />}
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
                                label="FlexyMarkets-Server"
                                icon={<Icon name="server" size="sm" className="text-zinc-400" />}
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
            />

            <ChangePasswordDialog
                isOpen={changePasswordDialogOpen}
                onClose={() => setChangePasswordDialogOpen(false)}
                accountLogin={selectedAccountForPassword?.login.toString()}
            />
        </div>
    );
};

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
