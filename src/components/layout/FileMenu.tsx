import { saveWorkspaceFeature, printSetupFeature, printPreviewFeature, exitConfirmFeature, savePictureFeature, openAccountFeature } from '../../startup/terminalFeatures';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import './file-menu-desktop.css';
import { Icon } from '../ui/Icon';
import React, { Suspense, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { RetainedLazyFeature } from '../../startup/RetainedLazyFeature';
import { useAppStore } from '../../store/useAppStore';
import { chartPrinter, type PrintPreferences, type ChartPrintData } from '../../services/chartPrinter';
import {
    getActiveChartSource,
    type ResolvedActiveChartSource,
} from '../../services/activeChartSource';
import { useDockLayoutStore } from '../../store/useDockLayoutStore';
import { getTerminalShortcutHint } from '../../services/shortcutCatalog';
import {
    BUILTIN_WORKSPACE_PROFILE_NAMES,
    deleteWorkspaceProfile,
    listWorkspaceProfiles,
    restoreBuiltinWorkspaceProfile,
    restoreWorkspaceProfile,
    saveCurrentWorkspaceProfile,
    type WorkspaceProfileSummary,
} from '../../services/localWorkspaceProfiles';

const SaveWorkspaceDialog = saveWorkspaceFeature.Component;
const PrintSetupDialog = printSetupFeature.Component;
const PrintPreviewDialog = printPreviewFeature.Component;
const ExitConfirmDialog = exitConfirmFeature.Component;
const SavePictureDialog = savePictureFeature.Component;
const OpenAccountDialog = openAccountFeature.Component;

type ElectronRuntime = NonNullable<Window['electron']> & {
    app?: {
        quit?: () => void;
    };
};

export interface FileMenuProps {
    shortcutsOnly?: boolean;
    onSave?: (workspaceName?: string) => void;
    onSaveAsPicture?: () => void;
    onOpenDataFolder?: () => void;
    onPrint?: (chartData: ChartPrintData, preferences: PrintPreferences) => void | Promise<void>;
    onPrintPreview?: () => void;
    onPrintSetup?: () => void;
    onCloseActiveChart?: () => void;
    onChartRestored?: () => void;
    onProfileRestored?: (profileName: string) => void;
    onLoginTrade?: () => void;
    onLoginWebTrader?: () => void;
    accountId?: string;
    onLogout?: () => void;
    onDialogOpenChange?: (open: boolean) => void;
    onExit?: () => void;
    hasUnsavedChanges?: boolean;
}

export const FileMenu: React.FC<FileMenuProps> = ({
    shortcutsOnly = false,
    onSave,
    onSaveAsPicture,
    onOpenDataFolder,
    onPrint,
    onPrintPreview,
    onPrintSetup,
    onCloseActiveChart,
    onChartRestored,
    onProfileRestored,
    onLoginTrade,
    onLoginWebTrader,
    accountId,
    onLogout,
    onDialogOpenChange,
    onExit,
    hasUnsavedChanges = false
}) => {
    const tr = useUiTranslation();
    const { t } = useTranslation();
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [showSavePictureDialog, setShowSavePictureDialog] = useState(false);
    const [savePictureSource, setSavePictureSource] = useState<ResolvedActiveChartSource | null>(null);
    const [showPrintSetupDialog, setShowPrintSetupDialog] = useState(false);
    const [showPrintPreviewDialog, setShowPrintPreviewDialog] = useState(false);
    const [showExitDialog, setShowExitDialog] = useState(false);
    const [showOpenAccountDialog, setShowOpenAccountDialog] = useState(false);
    const [profilesOpen, setProfilesOpen] = useState(false);
    const [deleteSubmenuOpen, setDeleteSubmenuOpen] = useState(false);
    const [activeProfileName, setActiveProfileName] = useState(() => {
        try {
            return localStorage.getItem('rtx5_active_profile') || 'Default';
        } catch {
            return 'Default';
        }
    });
    const [workspaceProfiles, setWorkspaceProfiles] = useState<WorkspaceProfileSummary[]>([]);
    const recentlyClosedCharts = useDockLayoutStore(state => state.recentlyClosedCharts);
    const isDesktopShell = typeof window !== 'undefined' && Boolean(window.electron?.window);

    useEffect(() => {
        const refreshProfiles = () => {
            const effectiveAccount = accountId?.trim() || 'default';
            try {
                setWorkspaceProfiles(listWorkspaceProfiles(effectiveAccount));
            } catch (error) {
                console.warn('[FileMenu] Could not load workspace profiles:', error);
                setWorkspaceProfiles([]);
            }
        };

        const handleProfileRestored = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.name) {
                setActiveProfileName(detail.name);
            }
        };

        refreshProfiles();
        window.addEventListener('workspace:profile-saved', refreshProfiles);
        window.addEventListener('workspace:profile-restored', handleProfileRestored);
        return () => {
            window.removeEventListener('workspace:profile-saved', refreshProfiles);
            window.removeEventListener('workspace:profile-restored', handleProfileRestored);
        };
    }, [accountId]);

    useEffect(() => {
        onDialogOpenChange?.(
            showSaveDialog
            || showSavePictureDialog
            || showPrintSetupDialog
            || showPrintPreviewDialog
            || showExitDialog
            || showOpenAccountDialog,
        );
    }, [
        onDialogOpenChange,
        showExitDialog,
        showOpenAccountDialog,
        showPrintPreviewDialog,
        showPrintSetupDialog,
        showSaveDialog,
        showSavePictureDialog,
    ]);

    // Get current symbol and timeframe from store
    const selectedSymbol = useAppStore(state => state.selectedSymbol);
    const timeframe = useAppStore(state => state.timeframe);
    const isAuthenticated = useAppStore(state => state.isAuthenticated);

    // Print state
    const [printPreferences, setPrintPreferences] = useState<PrintPreferences | null>(null);
    const [chartPrintData, setChartPrintData] = useState<ChartPrintData | null>(null);
    const [printError, setPrintError] = useState<string | null>(null);
    const [preparingPrint, setPreparingPrint] = useState(false);
    const printRequest = useRef(0);
    useEffect(() => () => { printRequest.current += 1; }, []);

    const handleSave = () => {
        setShowSaveDialog(true);
    };

    const handleSaveAsPicture = () => {
        const source = getActiveChartSource();
        const canvas = source?.canvas ?? null;
        const container = source?.container ?? null;

        if (!canvas && !container) {
            console.warn('[FileMenu] No active chart canvas or container found for export');
            alert('No chart available to export. Please open a chart first.');
            return;
        }

        setSavePictureSource(source);
        setShowSavePictureDialog(true);
        onSaveAsPicture?.();
    };

    const handleOpenDataFolder = () => {
        onOpenDataFolder?.();
    };

    const handlePrint = async (chartData?: ChartPrintData, selectedPreferences?: PrintPreferences) => {
        const preferences = selectedPreferences || printPreferences || chartPrinter.getPreferences(accountId);
        const data = chartData || await chartPrinter.captureActiveChartData();
        if (onPrint) await onPrint(data, preferences);
        else await chartPrinter.printChart(data, preferences);
    };

    const handleDirectPrint = async () => {
        if (preparingPrint) return;
        setPreparingPrint(true);
        setPrintError(null);
        try { await handlePrint(); }
        catch (error) { setPrintError(error instanceof Error ? error.message : 'The chart could not be printed.'); }
        finally { setPreparingPrint(false); }
    };

    const handleCloseActiveChart = () => {
        if (onCloseActiveChart) {
            onCloseActiveChart();
            return;
        }
        useDockLayoutStore.getState().closeActiveChart(selectedSymbol);
    };

    const handleRestoreChart = (panelId: string) => {
        if (useDockLayoutStore.getState().restoreClosedChart(panelId)) {
            onChartRestored?.();
        }
    };

    const allProfileNames = Array.from(
        new Set([
            ...BUILTIN_WORKSPACE_PROFILE_NAMES,
            ...workspaceProfiles.map(p => p.name),
        ])
    );

    const customProfiles = workspaceProfiles.filter(
        p => !BUILTIN_WORKSPACE_PROFILE_NAMES.some(b => b.toLowerCase() === p.name.toLowerCase())
    );

    const handleRestoreProfile = (profileName: string) => {
        const effectiveAccount = accountId?.trim() || 'default';
        try {
            let result = restoreWorkspaceProfile({ accountId: effectiveAccount, profileName });
            if (result.status !== 'restored') {
                result = restoreBuiltinWorkspaceProfile(effectiveAccount, profileName);
            }
            if (result.status === 'restored') {
                setActiveProfileName(result.profile.name);
                try {
                    localStorage.setItem('rtx5_active_profile', result.profile.name);
                } catch {
                    // Profile restoration remains valid when persistent storage is unavailable.
                }
                onProfileRestored?.(result.profile.name);
                setProfilesOpen(false);
            }
        } catch (error) {
            console.error('[FileMenu] Failed to restore workspace profile:', error);
            window.alert(tr(error instanceof Error ? error.message : 'The workspace profile could not be restored.'));
        }
    };

    const handleNextProfile = () => {
        if (allProfileNames.length === 0) return;
        const currentIndex = allProfileNames.findIndex(
            name => name.toLowerCase() === activeProfileName.toLowerCase()
        );
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % allProfileNames.length : 0;
        handleRestoreProfile(allProfileNames[nextIndex]);
    };

    const handlePreviousProfile = () => {
        if (allProfileNames.length === 0) return;
        const currentIndex = allProfileNames.findIndex(
            name => name.toLowerCase() === activeProfileName.toLowerCase()
        );
        const prevIndex = currentIndex >= 0
            ? (currentIndex - 1 + allProfileNames.length) % allProfileNames.length
            : allProfileNames.length - 1;
        handleRestoreProfile(allProfileNames[prevIndex]);
    };

    const handleDeleteProfile = (profileNameToDelete: string) => {
        const effectiveAccount = accountId?.trim() || 'default';
        const deleted = deleteWorkspaceProfile({ accountId: effectiveAccount, profileName: profileNameToDelete });
        if (deleted) {
            setWorkspaceProfiles(listWorkspaceProfiles(effectiveAccount));
            if (activeProfileName.toLowerCase() === profileNameToDelete.toLowerCase()) {
                setActiveProfileName('Default');
                try {
                    localStorage.setItem('rtx5_active_profile', 'Default');
                } catch {
                    // The in-memory profile selection is still authoritative for this session.
                }
            }
        }
        setDeleteSubmenuOpen(false);
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'F5' && !e.altKey && !e.metaKey) {
                if (e.shiftKey && !e.ctrlKey) {
                    e.preventDefault();
                    handleNextProfile();
                } else if (e.ctrlKey && !e.shiftKey) {
                    e.preventDefault();
                    handlePreviousProfile();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [allProfileNames, activeProfileName, accountId]);

    const handlePrintPreview = async () => {
        const request = ++printRequest.current;
        onPrintPreview?.();
        setChartPrintData(null);
        setPrintError(null);
        setPrintPreferences(printPreferences || chartPrinter.getPreferences(accountId));
        setPreparingPrint(true);
        setShowPrintPreviewDialog(true);
        try {
            const data = await chartPrinter.captureActiveChartData();
            if (request === printRequest.current) setChartPrintData(data);
        } catch (error) {
            if (request === printRequest.current) setPrintError(error instanceof Error ? error.message : 'The chart could not be captured.');
        } finally {
            if (request === printRequest.current) setPreparingPrint(false);
        }
    };

    const handlePrintSetup = () => {
        onPrintSetup?.();
        setShowPrintSetupDialog(true);
    };

    // Keyboard actions use the same capture, error and dialog lifecycle as File.
    useEffect(() => {
        if (!shortcutsOnly) return;
        const preview = () => { void handlePrintPreview(); };
        const picture = () => handleSaveAsPicture();
        window.addEventListener('open-print-preview', preview);
        window.addEventListener('open-save-picture', picture);
        return () => {
            window.removeEventListener('open-print-preview', preview);
            window.removeEventListener('open-save-picture', picture);
        };
    });

    const handleExit = () => {
        if (hasUnsavedChanges) {
            setShowExitDialog(true);
        } else {
            performExit();
        }
    };

    const performExit = () => {
        onExit?.();

        const electronRuntime = window.electron as ElectronRuntime | undefined;
        if (electronRuntime) {
            electronRuntime.app?.quit?.();
            electronRuntime.ipcRenderer?.send?.('app-quit');
            return;
        }

        if (!onExit) {
            useAppStore.getState().logout?.();
        }
    };



    return (
        <>
            {!shortcutsOnly && <div className="rtx-file-menu rtx-menu-surface min-w-[268px] py-1">
                {(accountId || onLogout) && (
                    <>
                        <div
                            className="mx-1 flex min-h-[50px] items-center gap-2 rounded-sm px-2 py-1.5 text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151]"
                            aria-label={tr('Current trading account {{value0}}', { value0: accountId || '' }).trim()}
                            data-testid="file-menu-account-header"
                            role="presentation"
                        >
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400 [.rtx-advanced-view_&]:border-[#d6bbfb] [.rtx-advanced-view_&]:bg-[#f4f3ff] [.rtx-advanced-view_&]:text-[#6941C6]">
                                <Icon name="user" size="sm" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="text-[11px] font-normal text-zinc-500 [.rtx-advanced-view_&]:text-[#667085]">{tr("Current account")}</div>
                                <div className="truncate font-mono text-[13px] font-medium text-zinc-200 [.rtx-advanced-view_&]:text-[#101828]">{accountId || '---'}</div>
                            </div>
                            {onLogout && (
                                <button
                                    type="button"
                                    role="menuitem"
                                    aria-label={tr("Log Out")}
                                    title={tr("Log out of the current account")}
                                    onClick={onLogout}
                                    data-desktop-logout={isDesktopShell ? 'true' : undefined}
                                    className="rtx-file-menu__logout ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-rose-500/20 px-2 text-[12px] font-medium text-rose-400 hover:border-rose-500/35 hover:bg-rose-500/10 hover:text-rose-300 [.rtx-advanced-view_&]:border-[#fecdca] [.rtx-advanced-view_&]:text-[#b42318] [.rtx-advanced-view_&]:hover:bg-[#fef3f2] [.rtx-advanced-view_&]:hover:text-[#912018]"
                                >
                                    {!isDesktopShell && <Icon name="log-out" size="xs" />}
                                    <span>{tr("Log Out")}</span>
                                </button>
                            )}
                        </div>
                        <div className="rtx-menu-divider" role="separator"></div>
                    </>
                )}

                {/* New Chart was removed from this menu on web and desktop:
                    charts open from the symbol search, where symbols and their
                    groups are browsed and searched. */}

                {/* Open Deleted */}
                <div className="relative group/deleted px-1 [&:hover>div.submenu]:block">
                    <button
                        disabled={recentlyClosedCharts.length === 0}
                        className={`w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left ${recentlyClosedCharts.length > 0
                            ? 'text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default'
                            : 'text-zinc-600 [.rtx-advanced-view_&]:text-gray-400 cursor-not-allowed'}`}
                        title={recentlyClosedCharts.length > 0 ? tr("Restore a recently closed chart") : tr("No recently closed charts")}
                    >
                        <div className="w-4 flex items-center justify-center">
                            <Icon name="history" size="sm" />
                        </div>
                        <span className="flex-1">{t('menu.file.openDeleted')}</span>
                        {recentlyClosedCharts.length > 0 && <Icon name="chevron-right" size="xs" className="rtx-menu-icon--neutral" />}
                    </button>
                    {recentlyClosedCharts.length > 0 && (
                        <div className="rtx-menu-surface submenu absolute left-full top-0 -ml-1 hidden min-w-[190px] max-w-[280px] py-1 z-[101]">
                            {recentlyClosedCharts.map(panel => (
                                <button
                                    key={panel.id}
                                    type="button"
                                    onClick={() => handleRestoreChart(panel.id)}
                                    className="w-full flex min-h-[30px] items-center gap-2 px-3 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default"
                                    title={tr("Restore {{value0}}", { value0: panel.title || panel.props?.symbol || 'chart' })}
                                >
                                    <Icon name="candlestick" size="sm" className="rtx-menu-icon--neutral shrink-0" />
                                    <span className="truncate">{panel.title || String(panel.props?.symbol || 'Chart')}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Profiles submenu */}
                <div
                    className="relative group/profiles px-1"
                    onMouseEnter={() => setProfilesOpen(true)}
                    onMouseLeave={() => {
                        setProfilesOpen(false);
                        setDeleteSubmenuOpen(false);
                    }}
                >
                    <button
                        type="button"
                        onClick={() => setProfilesOpen(o => !o)}
                        className={`w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left cursor-default ${
                            profilesOpen
                                ? 'bg-[#2a2e39] [.rtx-advanced-view_&]:bg-[#f3f4f6] text-white [.rtx-advanced-view_&]:text-[#111827]'
                                : 'text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827]'
                        }`}
                        title={tr("Load profile configurations")}
                    >
                        <div className="rtx-menu-icon--neutral w-4 flex items-center justify-center">
                            <Icon name="layout" size="sm" />
                        </div>
                        <span className="flex-1">{t('menu.file.profiles')}</span>
                        <Icon name="chevron-right" size="xs" className="rtx-menu-icon--neutral" />
                    </button>
                    <div
                        className={`rtx-menu-surface submenu absolute left-full top-0 -ml-1 min-w-[200px] py-1 z-[101] ${
                            profilesOpen ? 'block' : 'hidden group-hover/profiles:block'
                        }`}
                    >
                        {/* Next */}
                        <button
                            type="button"
                            onClick={() => {
                                handleNextProfile();
                                setProfilesOpen(false);
                            }}
                            className="w-full flex min-h-[28px] items-center gap-2 px-3 py-1 text-[13px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default"
                            title={tr("Switch to next profile")}
                        >
                            <span className="w-3.5" />
                            <span className="flex-1">{tr("Next")}</span>
                            <span className="text-[11px] font-normal text-zinc-500 font-mono tracking-tight">{tr("Shift+F5")}</span>
                        </button>

                        {/* Previous */}
                        <button
                            type="button"
                            onClick={() => {
                                handlePreviousProfile();
                                setProfilesOpen(false);
                            }}
                            className="w-full flex min-h-[28px] items-center gap-2 px-3 py-1 text-[13px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default"
                            title={tr("Switch to previous profile")}
                        >
                            <span className="w-3.5" />
                            <span className="flex-1">{tr("Previous")}</span>
                            <span className="text-[11px] font-normal text-zinc-500 font-mono tracking-tight">{tr("Ctrl+F5")}</span>
                        </button>

                        {/* Save As... */}
                        <button
                            type="button"
                            onClick={() => {
                                setProfilesOpen(false);
                                setShowSaveDialog(true);
                            }}
                            className="w-full flex min-h-[28px] items-center gap-2 px-3 py-1 text-[13px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default"
                            title={tr("Save current workspace as a new profile")}
                        >
                            <span className="w-3.5" />
                            <span className="flex-1">{tr("Save As...")}</span>
                        </button>

                        {/* Delete submenu */}
                        <div
                            className="relative group/delete px-0"
                            onMouseEnter={() => customProfiles.length > 0 && setDeleteSubmenuOpen(true)}
                            onMouseLeave={() => setDeleteSubmenuOpen(false)}
                        >
                            <button
                                type="button"
                                disabled={customProfiles.length === 0}
                                onClick={() => customProfiles.length > 0 && setDeleteSubmenuOpen(o => !o)}
                                className={`w-full flex min-h-[28px] items-center gap-2 px-3 py-1 text-[13px] font-normal rounded-sm text-left ${
                                    customProfiles.length > 0
                                        ? 'text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default'
                                        : 'text-zinc-600 [.rtx-advanced-view_&]:text-gray-400 cursor-not-allowed'
                                }`}
                                title={customProfiles.length > 0 ? tr("Delete a custom profile") : tr("No custom profiles to delete")}
                            >
                                <span className="w-3.5" />
                                <span className="flex-1">{tr("Delete")}</span>
                                {customProfiles.length > 0 && <Icon name="chevron-right" size="xs" className="rtx-menu-icon--neutral" />}
                            </button>

                            {customProfiles.length > 0 && (
                                <div
                                    className={`rtx-menu-surface submenu absolute left-full top-0 -ml-1 min-w-[160px] py-1 z-[102] ${
                                        deleteSubmenuOpen ? 'block' : 'hidden group-hover/delete:block'
                                    }`}
                                >
                                    {customProfiles.map(p => (
                                        <button
                                            key={`delete-${p.id}`}
                                            type="button"
                                            onClick={() => handleDeleteProfile(p.name)}
                                            className="w-full flex min-h-[28px] items-center gap-2 px-3 py-1 text-[13px] font-normal rounded-sm text-left text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 [.rtx-advanced-view_&]:text-[#b42318] [.rtx-advanced-view_&]:hover:bg-[#fef3f2] cursor-default"
                                            title={tr("Delete profile {{value0}}", { value0: p.name })}
                                            aria-label={tr("Delete profile {{value0}}", { value0: p.name })}
                                        >
                                            <Icon name="x-close" size="xs" className="shrink-0" />
                                            <span className="truncate flex-1">{p.name}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="rtx-menu-divider" role="separator" />

                        {/* List of profiles (Built-in + Custom) */}
                        {allProfileNames.map(profileName => {
                            const isActive = profileName.toLowerCase() === activeProfileName.toLowerCase();
                            return (
                                <button
                                    key={profileName}
                                    type="button"
                                    onClick={() => handleRestoreProfile(profileName)}
                                    className={`w-full flex min-h-[28px] items-center gap-2 px-3 py-1 text-[13px] font-normal rounded-sm text-left cursor-default transition-colors duration-75 ${
                                        isActive
                                            ? 'text-emerald-400 [.rtx-advanced-view_&]:text-emerald-600 bg-emerald-500/10 [.rtx-advanced-view_&]:bg-emerald-50 font-medium'
                                            : 'text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827]'
                                    }`}
                                    title={tr("Restore workspace {{value0}}", { value0: profileName })}
                                >
                                    <span
                                        aria-hidden="true"
                                        className={`w-3.5 text-center font-bold text-[11px] flex-none ${
                                            isActive ? 'text-emerald-400 [.rtx-advanced-view_&]:text-emerald-600' : 'text-transparent'
                                        }`}
                                    >
                                        ✓
                                    </span>
                                    <span className="truncate flex-1">{profileName}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Close */}
                <button
                    onClick={handleCloseActiveChart}
                    className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title={tr("Close current chart")}
                >
                    <div className="rtx-menu-icon--neutral w-4 flex items-center justify-center">
                        <Icon name="x-close" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.close')}</span>
                    <span className="text-[12px] font-normal text-zinc-500 font-mono tracking-tighter">{getTerminalShortcutHint('file.close-chart')}</span>
                </button>

                <div className="rtx-menu-divider" role="separator"></div>

                {/* Save */}
                <button
                    onClick={handleSave}
                    className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title={tr("Save workspace configuration")}
                >
                    <div className="rtx-menu-icon--neutral w-4 flex items-center justify-center">
                        <Icon name="save" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.save')}</span>
                    <span className="text-[12px] font-normal text-zinc-500 font-mono tracking-tighter">{tr("Ctrl+S")}</span>
                </button>

                {/* Save As Picture */}
                <button
                    onClick={handleSaveAsPicture}
                    className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title={tr("Export chart as image")}
                >
                    <div className="rtx-menu-icon--neutral w-4 flex items-center justify-center">
                        <Icon name="image" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.saveAsPicture')}</span>
                    <span className="text-[12px] font-normal text-zinc-500 font-mono tracking-tighter">{getTerminalShortcutHint('file.save-picture')}</span>
                </button>

                <div className="rtx-menu-divider" role="separator"></div>

                {/* Open Data Folder */}
                <button
                    onClick={handleOpenDataFolder}
                    disabled={!onOpenDataFolder}
                    className={`w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left group ${onOpenDataFolder
                        ? 'text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default'
                        : 'text-zinc-600 [.rtx-advanced-view_&]:text-gray-400 cursor-not-allowed'}`}
                    title={onOpenDataFolder ? tr("Open application data directory") : tr("Available in the desktop app")}
                >
                    <div className="rtx-menu-icon--neutral w-4 flex items-center justify-center">
                        <Icon name="folder-open" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.openDataFolder')}</span>
                    {onOpenDataFolder && window.electron && (
                        <span className="text-[12px] font-normal text-zinc-500 font-mono tracking-tighter">{tr("Ctrl+Shift+D")}</span>
                    )}
                </button>

                <div className="rtx-menu-divider" role="separator"></div>

                {/* Print */}
                <button
                    onClick={() => { void handleDirectPrint(); }}
                    disabled={preparingPrint}
                    className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title={tr("Print chart")}
                >
                    <div className="rtx-menu-icon--neutral w-4 flex items-center justify-center">
                        <Icon name="print" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.print')}</span>
                    <span className="text-[12px] font-normal text-zinc-500 font-mono tracking-tighter">{tr("Ctrl+P")}</span>
                </button>

                {/* Print Preview */}
                <button
                    onClick={handlePrintPreview}
                    className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title={tr("Preview before printing")}
                >
                    <div className="rtx-menu-icon--neutral w-4 flex items-center justify-center">
                        <Icon name="file-text" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.printPreview')}</span>
                    <span className="text-[12px] font-normal text-zinc-500 font-mono tracking-tighter">{getTerminalShortcutHint('file.print-preview')}</span>
                </button>

                {/* Print Setup */}
                <button
                    onClick={handlePrintSetup}
                    className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title={tr("Configure print settings")}
                >
                    <div className="rtx-menu-icon--neutral w-4 flex items-center justify-center">
                        <Icon name="settings" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.printSetup')}</span>
                </button>

                <div className="rtx-menu-divider" role="separator"></div>

                {/* Open an Account */}
                <button
                    onClick={() => setShowOpenAccountDialog(true)}
                    className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                    title={tr("Register new trading account")}
                >
                    <div className="w-4 flex items-center justify-center">
                        <Icon name="user-plus" size="sm" className="text-blue-400" />
                    </div>
                    <span className="flex-1">{t('menu.file.openAccount')}</span>
                </button>

                {/* Login to Trade Account */}
                <button
                    onClick={onLoginTrade}
                    disabled={!onLoginTrade}
                    className={`w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left ${onLoginTrade
                        ? 'text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default'
                        : 'text-zinc-600 [.rtx-advanced-view_&]:text-gray-400 cursor-not-allowed'}`}
                    title={onLoginTrade ? tr("Connect to another trading account") : tr("Trade account login is unavailable")}
                >
                    <div className="w-4 flex items-center justify-center">
                        <Icon name="log-in" size="sm" className={onLoginTrade ? 'text-blue-400' : 'text-blue-400/50'} />
                    </div>
                    <span className="flex-1">{t('menu.file.loginTrade')}</span>
                </button>

                {/* Login to Web Trader */}
                <button
                    onClick={onLoginWebTrader}
                    disabled={!onLoginWebTrader}
                    className={`w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left ${onLoginWebTrader
                        ? 'text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default'
                        : 'text-zinc-600 [.rtx-advanced-view_&]:text-gray-400 cursor-not-allowed'}`}
                    title={onLoginWebTrader ? tr("Open this broker in Web Trader") : tr("Web Trader URL is not configured")}
                >
                    <div className="w-4 flex items-center justify-center">
                        <Icon name="globe" size="sm" />
                    </div>
                    <span className="flex-1">{t('menu.file.loginWeb')}</span>
                </button>

                {/* Login to RTX5.community */}
                <button
                    disabled
                    className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-600 [.rtx-advanced-view_&]:text-gray-400 cursor-not-allowed"
                    title={tr("RTX5 Community is not configured for this deployment")}
                >
                    <div className="w-4 flex items-center justify-center">
                        <Icon name="help-circle" size="sm" className="text-blue-500/50" />
                    </div>
                    <span className="flex-1">{t('menu.file.loginMql5')}</span>
                </button>

                {/* Exit */}
                {isAuthenticated && (
                    <>
                        <div className="rtx-menu-divider" role="separator"></div>
                        <button
                            onClick={handleExit}
                            className="w-full flex min-h-[30px] items-center gap-3 px-2 py-1.5 text-[14px] font-normal rounded-sm text-left text-zinc-300 [.rtx-advanced-view_&]:text-[#374151] hover:bg-[#2a2e39] [.rtx-advanced-view_&]:hover:bg-[#f3f4f6] hover:text-white [.rtx-advanced-view_&]:hover:text-[#111827] cursor-default group"
                            title={tr("Close application")}
                        >
                            <div className="w-4 flex items-center justify-center text-rose-400 group-hover:text-rose-300">
                                <Icon name="log-out" size="sm" />
                            </div>
                            <span className="flex-1">{t('menu.file.exit')}</span>
                        </button>
                    </>
                )}
            </div>}

            {/* Dialogs */}
            {showSaveDialog && (
                <Suspense fallback={null}>
                <SaveWorkspaceDialog
                    onConfirm={(workspaceName) => {
                        setShowSaveDialog(false);
                        if (workspaceName) {
                            setActiveProfileName(workspaceName);
                            try {
                                localStorage.setItem('rtx5_active_profile', workspaceName);
                            } catch {
                                // Saving the workspace can continue without persisting its active label.
                            }
                        }
                        onSave?.(workspaceName);
                    }}
                    onCancel={() => setShowSaveDialog(false)}
                    accountId={accountId || 'default'}
                />
                </Suspense>
            )}

            {showPrintSetupDialog && (
                <Suspense fallback={null}>
                <PrintSetupDialog
                    onConfirm={(preferences) => {
                        setShowPrintSetupDialog(false);
                        setPrintPreferences(preferences);
                        chartPrinter.setPreferences(preferences, accountId);
                    }}
                    onCancel={() => setShowPrintSetupDialog(false)}
                    accountId={accountId}
                />
                </Suspense>
            )}

            {showPrintPreviewDialog && (
                <Suspense fallback={null}>
                <PrintPreviewDialog
                    onPrint={(preferences) => handlePrint(chartPrintData || undefined, preferences)}
                    isLoading={preparingPrint}
                    error={printError || undefined}
                    onClose={() => { printRequest.current += 1; setPreparingPrint(false); setShowPrintPreviewDialog(false); }}
                    chartData={chartPrintData || undefined}
                    preferences={printPreferences || undefined}
                />
                </Suspense>
            )}

            {showSavePictureDialog && (
                <Suspense fallback={null}>
                <SavePictureDialog
                    isOpen={showSavePictureDialog}
                    onClose={() => {
                        setShowSavePictureDialog(false);
                        setSavePictureSource(null);
                    }}
                    chartCanvas={savePictureSource?.canvas ?? null}
                    chartContainer={savePictureSource?.container ?? null}
                    symbol={savePictureSource?.symbol || selectedSymbol || 'EURUSD'}
                    timeframe={savePictureSource?.timeframe || timeframe || '5m'}
                />
                </Suspense>
            )}

            {showExitDialog && (
                <Suspense fallback={null}>
                <ExitConfirmDialog
                    isOpen={showExitDialog}
                    changes={{
                        hasWorkspaceChanges: hasUnsavedChanges,
                        hasOpenTrades: false,
                        hasDraftOrders: false,
                        openTradesCount: 0,
                        draftOrdersCount: 0,
                        workspaceModified: hasUnsavedChanges,
                    }}
                    onConfirm={(saveWorkspace) => {
                        setShowExitDialog(false);
                        if (saveWorkspace && accountId?.trim()) {
                            try {
                                saveCurrentWorkspaceProfile({
                                    accountId,
                                    profileName: 'Default',
                                });
                            } catch (error) {
                                console.error('[FileMenu] Could not save workspace before exit:', error);
                                window.alert(tr(error instanceof Error
                                    ? error.message
                                    : 'The workspace could not be saved before exit.'));
                                return;
                            }
                        }
                        performExit();
                    }}
                    onCancel={() => setShowExitDialog(false)}
                />
                </Suspense>
            )}

            <RetainedLazyFeature active={showOpenAccountDialog}>
            <OpenAccountDialog
                isOpen={showOpenAccountDialog}
                onClose={() => setShowOpenAccountDialog(false)}
            />
            </RetainedLazyFeature>
        </>
    );
};
