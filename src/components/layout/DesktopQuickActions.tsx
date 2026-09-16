import { useUiTranslation } from '../../hooks/useUiTranslation';
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Icon } from '../ui/Icon';
import { formatDesktopAccountBadge } from './desktopToolbarStatus';
import { brokerDisplayName } from '../../services/brokerDisplayName';

type QuickMenu = 'account' | null;

interface DesktopQuickActionsProps {
    accountId: string;
    accountName?: string;
    accountServer?: string;
    accountBrokerName?: string;
    savedAccountCount: number;
    onLogout: () => void;
}

const menuPosition = (anchor: React.RefObject<HTMLElement | null>, width: number): React.CSSProperties => {
    const rect = anchor.current?.getBoundingClientRect();
    const viewportWidth = typeof window === 'undefined' ? width + 16 : window.innerWidth;
    const menuWidth = Math.min(width, Math.max(0, viewportWidth - 16));
    const right = rect?.right ?? viewportWidth - 8;
    const top = (rect?.bottom ?? 54) + 4;
    return {
        top,
        left: Math.max(8, Math.min(right - menuWidth, viewportWidth - menuWidth - 8)),
        width: menuWidth,
        maxHeight: typeof window === 'undefined' ? undefined : Math.max(0, window.innerHeight - top - 8),
    };
};

export const DesktopSymbolSearchButton = () => {
    const tr = useUiTranslation();
    return (
        <button
            type="button"
            className="rtx-desktop-quick-button rtx-desktop-symbol-search"
            title={tr("Search Symbols")}
            aria-label={tr("Search Symbols")}
            onClick={() => window.dispatchEvent(new CustomEvent('openSymbolsDialog'))}
        >
            <Icon name="search" size={20} />
        </button>
    );
};

export const DesktopQuickActions: React.FC<DesktopQuickActionsProps> = ({
    accountId,
    accountName,
    accountServer,
    accountBrokerName,
    savedAccountCount,
    onLogout,
}) => {
    const tr = useUiTranslation();
    const [openMenu, setOpenMenu] = useState<QuickMenu>(null);
    const clusterRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const accountAnchorRef = useRef<HTMLButtonElement>(null);
    const accountBadge = formatDesktopAccountBadge(savedAccountCount);
    const brokerName = accountServer || accountBrokerName
        ? brokerDisplayName(accountServer || '', accountBrokerName)
        : '';


    useEffect(() => {
        if (!openMenu) return;

        const closeOnOutsideClick = (event: MouseEvent) => {
            const target = event.target as Node;
            if (clusterRef.current?.contains(target) || menuRef.current?.contains(target)) return;
            setOpenMenu(null);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setOpenMenu(null);
        };
        const closeOnViewportChange = () => setOpenMenu(null);

        document.addEventListener('mousedown', closeOnOutsideClick, true);
        window.addEventListener('keydown', closeOnEscape);
        window.addEventListener('resize', closeOnViewportChange);
        window.addEventListener('scroll', closeOnViewportChange, true);
        return () => {
            document.removeEventListener('mousedown', closeOnOutsideClick, true);
            window.removeEventListener('keydown', closeOnEscape);
            window.removeEventListener('resize', closeOnViewportChange);
            window.removeEventListener('scroll', closeOnViewportChange, true);
        };
    }, [openMenu]);

    const renderPortalMenu = (
        kind: Exclude<QuickMenu, null>,
        anchor: React.RefObject<HTMLButtonElement | null>,
        width: number,
        label: string,
        content: React.ReactNode,
    ) => openMenu === kind && ReactDOM.createPortal(
        <div
            ref={menuRef}
            className="rtx-desktop-quick-menu fixed z-[10000] py-1"
            style={menuPosition(anchor, width)}
            role="menu"
            aria-label={tr(label)}
        >
            {content}
        </div>,
        document.body,
    );

    return (
        <div
            ref={clusterRef}
            className="rtx-desktop-command-actions ml-auto flex h-full shrink-0 items-center"
            data-rtx-desktop-toolbar-cluster="right"
            role="toolbar"
            aria-label={tr("Desktop quick actions")}
        >
            <button
                ref={accountAnchorRef}
                type="button"
                className="rtx-desktop-quick-button rtx-desktop-account-button relative"
                title={tr("Account")}
                aria-label={tr("Account")}
                aria-haspopup="menu"
                aria-expanded={openMenu === 'account'}
                onClick={() => setOpenMenu(openMenu === 'account' ? null : 'account')}
            >
                <Icon name="user" size={14} />
                {accountBadge && (
                    <span
                        className="rtx-desktop-account-badge"
                        title={tr("{{value0}} saved trading account{{value1}}", { value0: savedAccountCount, value1: savedAccountCount === 1 ? '' : 's' })}
                    >
                        {accountBadge}
                    </span>
                )}
            </button>

            {renderPortalMenu('account', accountAnchorRef, 280, 'Account', (
                <>
                    <div className="rtx-desktop-quick-menu__account">
                        <Icon name="user" size="md" />
                        <div className="rtx-desktop-quick-menu__identity">
                            <div className="rtx-desktop-quick-menu__account-id">{accountId || tr('No active account')}</div>
                            {accountName && <div className="rtx-desktop-quick-menu__meta">{accountName}</div>}
                            {brokerName && <div className="rtx-desktop-quick-menu__meta">{brokerName}</div>}
                        </div>
                    </div>
                    <div className="rtx-desktop-quick-menu__separator" role="separator" />
                    <button
                        type="button"
                        role="menuitem"
                        className="rtx-desktop-quick-menu__item"
                        onClick={() => {
                            window.dispatchEvent(new CustomEvent('toggleAccountPanel'));
                            setOpenMenu(null);
                        }}
                    >
                        <Icon name="user-plus" size="sm" />
                        <span>{tr("Trading accounts")}</span>
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className="rtx-desktop-quick-menu__item rtx-desktop-quick-menu__item--danger"
                        onClick={() => { setOpenMenu(null); onLogout(); }}
                    >
                        <Icon name="log-out" size="sm" />
                        <span>{tr("Log out")}</span>
                    </button>
                </>
            ))}

        </div>
    );
};

export default DesktopQuickActions;
