import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Icon, type IconName } from '../ui/Icon';
import type { Command } from '../../types/commands';
import { drawingManager } from '../../services/drawingManager';
import { getActiveChartSource } from '../../services/activeChartSource';
import { STAMP_OPTIONS } from './stampOptions';
import {
    formatDesktopAccountBadge,
    resolveDesktopToolbarStatus,
    type DesktopFeedSnapshot,
    type DesktopTransportSecurity,
} from './desktopToolbarStatus';
import type { ConnectionState } from '../../store/useWebSocketStore';

type QuickMenu = 'view' | 'stamps' | 'account' | 'connection' | null;

interface DesktopQuickActionsProps {
    advancedViewEnabled: boolean;
    advancedFontSize: 'small' | 'normal' | 'large';
    focusChart: boolean;
    activeDrawingTool: string | null;
    crosshairEnabled: boolean;
    accountId: string;
    accountName?: string;
    accountServer?: string;
    savedAccountCount: number;
    symbol: string;
    connectionState: ConnectionState;
    transportSecurity: DesktopTransportSecurity;
    feedStatus: DesktopFeedSnapshot;
    dispatchCommand: (command: Command) => void;
    onSetAdvancedViewEnabled: (enabled: boolean) => void;
    onSetAdvancedFontSize: (fontSize: 'small' | 'normal' | 'large') => void;
    onSetFocusChart: (enabled: boolean) => void;
    onRefreshConnection: () => void;
    onLogout: () => void;
}

interface QuickTool {
    tool: 'cursor' | 'trendline' | 'hline' | 'vline' | 'channel' | 'fibonacci';
    label: string;
    icon: IconName;
}

const QUICK_DRAWING_TOOLS: readonly QuickTool[] = [
    { tool: 'cursor', label: 'Cursor', icon: 'cursor' },
    { tool: 'trendline', label: 'Trend Line', icon: 'trend-line' },
    { tool: 'hline', label: 'Horizontal Line', icon: 'h-line' },
    { tool: 'vline', label: 'Vertical Line', icon: 'v-line' },
    { tool: 'channel', label: 'Equidistant Channel', icon: 'channel' },
    { tool: 'fibonacci', label: 'Fibonacci Retracement', icon: 'fibonacci' },
] as const;

const menuPosition = (anchor: React.RefObject<HTMLElement | null>, width: number): React.CSSProperties => {
    const rect = anchor.current?.getBoundingClientRect();
    const viewportWidth = typeof window === 'undefined' ? width + 16 : window.innerWidth;
    const right = rect?.right ?? viewportWidth - 8;
    return {
        top: (rect?.bottom ?? 54) + 4,
        left: Math.max(8, Math.min(right - width, viewportWidth - width - 8)),
        width,
    };
};

const QuickButton = ({
    label,
    icon,
    active = false,
    onClick,
    className = '',
    children,
}: {
    label: string;
    icon?: IconName;
    active?: boolean;
    onClick?: () => void;
    className?: string;
    children?: React.ReactNode;
}) => (
    <button
        type="button"
        className={`rtx-desktop-quick-button ${className}`.trim()}
        title={label}
        aria-label={label}
        aria-pressed={active || undefined}
        onClick={onClick}
    >
        {icon && <Icon name={icon} size={14} />}
        {children}
    </button>
);

export const DesktopQuickActions: React.FC<DesktopQuickActionsProps> = ({
    advancedViewEnabled,
    advancedFontSize,
    focusChart,
    activeDrawingTool,
    crosshairEnabled,
    accountId,
    accountName,
    accountServer,
    savedAccountCount,
    symbol,
    connectionState,
    transportSecurity,
    feedStatus,
    dispatchCommand,
    onSetAdvancedViewEnabled,
    onSetAdvancedFontSize,
    onSetFocusChart,
    onRefreshConnection,
    onLogout,
}) => {
    const [openMenu, setOpenMenu] = useState<QuickMenu>(null);
    const clusterRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const viewAnchorRef = useRef<HTMLButtonElement>(null);
    const stampAnchorRef = useRef<HTMLButtonElement>(null);
    const accountAnchorRef = useRef<HTMLButtonElement>(null);
    const connectionAnchorRef = useRef<HTMLButtonElement>(null);
    const accountBadge = formatDesktopAccountBadge(savedAccountCount);
    const connection = resolveDesktopToolbarStatus({
        symbol,
        connectionState,
        transportSecurity,
        feed: feedStatus,
    });

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

    const selectTool = (tool: QuickTool['tool'], subtype?: string) => {
        dispatchCommand({ type: 'SELECT_TOOL', payload: { tool, subtype } } as Command);
    };

    const selectStamp = (subtype: string) => {
        dispatchCommand({ type: 'SELECT_TOOL', payload: { tool: 'stamp', subtype } } as Command);
        setOpenMenu(null);
    };

    const clearAllDrawings = () => {
        const targetContextId = getActiveChartSource()?.id;
        drawingManager.clearAllDrawings(true, targetContextId);
        dispatchCommand({
            type: 'SELECT_TOOL',
            payload: { tool: 'cursor', targetContextId },
        });
    };

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
            aria-label={label}
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
            aria-label="Desktop quick actions"
        >
            <QuickButton
                label="Search Symbols"
                icon="search"
                onClick={() => window.dispatchEvent(new CustomEvent('openSymbolsDialog'))}
            />

            <button
                ref={viewAnchorRef}
                type="button"
                className="rtx-desktop-quick-button"
                title="Advanced View Settings"
                aria-label="Advanced View Settings"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'view'}
                onClick={() => setOpenMenu(openMenu === 'view' ? null : 'view')}
            >
                <Icon name="grid" size={14} />
            </button>

            <QuickButton
                label="Crosshair"
                icon="crosshair"
                active={crosshairEnabled}
                onClick={() => dispatchCommand({ type: 'TOGGLE_CROSSHAIR', payload: {} })}
            />

            <span className="rtx-desktop-quick-divider" aria-hidden="true" />

            <div className="rtx-desktop-drawing-quick-group flex items-center" role="group" aria-label="Drawing tools">
                {QUICK_DRAWING_TOOLS.map((item) => (
                    <QuickButton
                        key={item.tool}
                        label={item.label}
                        icon={item.icon}
                        active={activeDrawingTool === item.tool}
                        onClick={() => selectTool(item.tool)}
                    />
                ))}
            </div>

            <span className="rtx-desktop-quick-divider" aria-hidden="true" />

            <div className="rtx-desktop-stamp-control flex items-center" role="group" aria-label="Stamp tools">
                <QuickButton
                    label="Thumbs Up Stamp"
                    icon="thumbs-up"
                    active={activeDrawingTool === 'stamp'}
                    className="rtx-desktop-quick-button--split-main"
                    onClick={() => selectStamp('thumbsUp')}
                />
                <button
                    ref={stampAnchorRef}
                    type="button"
                    className="rtx-desktop-quick-button rtx-desktop-quick-button--split-arrow"
                    title="Stamp Picker"
                    aria-label="Stamp Picker"
                    aria-haspopup="menu"
                    aria-expanded={openMenu === 'stamps'}
                    onClick={() => setOpenMenu(openMenu === 'stamps' ? null : 'stamps')}
                >
                    <Icon name="chevron-down" size={10} />
                </button>
            </div>

            <QuickButton label="Clear All Drawings" icon="trash" onClick={clearAllDrawings} />

            <span className="rtx-desktop-quick-divider" aria-hidden="true" />

            <button
                ref={accountAnchorRef}
                type="button"
                className="rtx-desktop-quick-button rtx-desktop-account-button relative"
                title="Account"
                aria-label="Account"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'account'}
                onClick={() => setOpenMenu(openMenu === 'account' ? null : 'account')}
            >
                <Icon name="user" size={14} />
                {accountBadge && (
                    <span
                        className="rtx-desktop-account-badge"
                        title={`${savedAccountCount} saved trading account${savedAccountCount === 1 ? '' : 's'}`}
                    >
                        {accountBadge}
                    </span>
                )}
            </button>

            <button
                ref={connectionAnchorRef}
                type="button"
                className="rtx-desktop-connection-button"
                aria-label={`Connection details: ${connection.summary}`}
                aria-haspopup="menu"
                aria-expanded={openMenu === 'connection'}
                title={connection.summary}
                onClick={() => setOpenMenu(openMenu === 'connection' ? null : 'connection')}
            >
                <span
                    className={`rtx-desktop-security-indicator is-${connection.securityTone}`}
                    aria-hidden="true"
                >
                    <Icon name="shield" size={14} />
                </span>
                <span
                    className={`rtx-desktop-ping-indicator is-${connection.feedState}`}
                    style={{ '--rtx-desktop-feed-level': `${connection.fillPercent}%` } as React.CSSProperties}
                    aria-hidden="true"
                >
                    <span className="rtx-desktop-ping-indicator__fill" />
                </span>
            </button>

            {renderPortalMenu('view', viewAnchorRef, 226, 'Advanced View Settings', (
                <>
                    <div className="rtx-desktop-quick-menu__heading">Appearance</div>
                    <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={!advancedViewEnabled}
                        className="rtx-desktop-quick-menu__item"
                        onClick={() => { onSetAdvancedViewEnabled(false); setOpenMenu(null); }}
                    >
                        <Icon name="palette" size="sm" />
                        <span>Dark Theme</span>
                        {!advancedViewEnabled && <Icon name="check" size="xs" className="ml-auto" />}
                    </button>
                    <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={advancedViewEnabled}
                        className="rtx-desktop-quick-menu__item"
                        onClick={() => { onSetAdvancedViewEnabled(true); setOpenMenu(null); }}
                    >
                        <Icon name="palette" size="sm" />
                        <span>Light Theme</span>
                        {advancedViewEnabled && <Icon name="check" size="xs" className="ml-auto" />}
                    </button>
                    <div className="rtx-desktop-quick-menu__separator" role="separator" />
                    <div className="rtx-desktop-quick-menu__heading">Font size</div>
                    {(['small', 'normal', 'large'] as const).map((fontSize) => (
                        <button
                            key={fontSize}
                            type="button"
                            role="menuitemradio"
                            aria-checked={advancedFontSize === fontSize}
                            className="rtx-desktop-quick-menu__item"
                            onClick={() => { onSetAdvancedFontSize(fontSize); setOpenMenu(null); }}
                        >
                            <Icon name="text" size="sm" />
                            <span>{fontSize.charAt(0).toUpperCase() + fontSize.slice(1)}</span>
                            {advancedFontSize === fontSize && <Icon name="check" size="xs" className="ml-auto" />}
                        </button>
                    ))}
                    <div className="rtx-desktop-quick-menu__separator" role="separator" />
                    <button
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={focusChart}
                        className="rtx-desktop-quick-menu__item"
                        onClick={() => { onSetFocusChart(!focusChart); setOpenMenu(null); }}
                    >
                        <Icon name="crosshair" size="sm" />
                        <span>Focus Chart</span>
                        {focusChart && <Icon name="check" size="xs" className="ml-auto" />}
                    </button>
                </>
            ))}

            {renderPortalMenu('stamps', stampAnchorRef, 210, 'Stamp Picker', STAMP_OPTIONS.map((stamp) => (
                <button
                    key={stamp.subtype}
                    type="button"
                    role="menuitem"
                    className="rtx-desktop-quick-menu__item"
                    onClick={() => selectStamp(stamp.subtype)}
                >
                    <Icon
                        name={stamp.icon}
                        size="sm"
                        className={stamp.subtype === 'buy' ? 'text-emerald-500' : stamp.subtype === 'sell' ? 'text-rose-500' : undefined}
                    />
                    <span>{stamp.label}</span>
                </button>
            )))}

            {renderPortalMenu('account', accountAnchorRef, 230, 'Account', (
                <>
                    <div className="rtx-desktop-quick-menu__account">
                        <Icon name="user" size="md" />
                        <div className="min-w-0">
                            <div className="rtx-desktop-quick-menu__heading">Current account</div>
                            <div className="truncate font-mono text-[13px]">{accountId || 'No active account'}</div>
                            {(accountName || accountServer) && (
                                <div className="truncate text-[11px] text-zinc-500">
                                    {[accountName, accountServer].filter(Boolean).join(' · ')}
                                </div>
                            )}
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
                        <span>Trading accounts</span>
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className="rtx-desktop-quick-menu__item rtx-desktop-quick-menu__item--danger"
                        onClick={() => { setOpenMenu(null); onLogout(); }}
                    >
                        <Icon name="log-out" size="sm" />
                        <span>Log out</span>
                    </button>
                </>
            ))}

            {renderPortalMenu('connection', connectionAnchorRef, 252, 'Connection', (
                <>
                    <div className="rtx-desktop-quick-menu__connection" role="status">
                        <span className={`rtx-desktop-security-indicator is-${connection.securityTone}`} aria-hidden="true">
                            <Icon name="shield" size={14} />
                        </span>
                        <div className="min-w-0">
                            <div className="rtx-desktop-quick-menu__heading">{connection.connectionLabel}</div>
                            <div className="truncate text-[12px]">{connection.feedLabel}</div>
                        </div>
                    </div>
                    <div className="rtx-desktop-quick-menu__separator" role="separator" />
                    <div className="rtx-desktop-quick-menu__detail">
                        <span>Symbol</span>
                        <strong>{symbol || 'None'}</strong>
                    </div>
                    <div className="rtx-desktop-quick-menu__detail">
                        <span>Transport</span>
                        <strong>{transportSecurity === 'secure' ? 'WSS secure' : transportSecurity === 'insecure' ? 'WS insecure' : 'Unknown'}</strong>
                    </div>
                    <button
                        type="button"
                        role="menuitem"
                        className="rtx-desktop-quick-menu__item"
                        onClick={() => {
                            setOpenMenu(null);
                            onRefreshConnection();
                        }}
                    >
                        <Icon name="refresh" size="sm" />
                        <span>Refresh connection</span>
                    </button>
                </>
            ))}
        </div>
    );
};

export default DesktopQuickActions;
