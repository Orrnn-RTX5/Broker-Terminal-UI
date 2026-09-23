import { useUiTranslation } from '../../hooks/useUiTranslation';
import { Icon } from '../ui/Icon';
import React, { useState, useEffect, useRef } from 'react';
import { useSettingsStore, type SettingsState } from '../../store/useSettingsStore';
import { useAppStore } from '../../store/useAppStore';
import { NotificationPreferences } from './NotificationPreferences';

interface OptionsDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

type TabId = 'server' | 'charts' | 'trade' | 'automation' | 'events' | 'notifications' | 'email' | 'ftp' | 'community' | 'signals';

export const OptionsDialog: React.FC<OptionsDialogProps> = ({ isOpen, onClose }) => {
    const tr = useUiTranslation();
    const [activeTab, setActiveTab] = useState<TabId>('server');
    const snapshotRef = useRef<SettingsState | null>(null);

    const getSnapshot = useSettingsStore((state) => state.getSnapshot);
    const restoreSnapshot = useSettingsStore((state) => state.restoreSnapshot);

    // Capture snapshot when dialog opens
    useEffect(() => {
        if (isOpen) {
            snapshotRef.current = getSnapshot();
        }
    }, [isOpen, getSnapshot]);

    // Handle Cancel - revert to snapshot
    const handleCancel = () => {
        if (snapshotRef.current) {
            restoreSnapshot(snapshotRef.current);
        }
        onClose();
    };

    // Handle OK - just close (settings already persisted)
    const handleOK = () => {
        onClose();
    };

    // Close on Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) handleCancel();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    if (!isOpen) return null;

    const tabs: { id: TabId; label: string }[] = [
        { id: 'server', label: 'Server' },
        { id: 'charts', label: 'Charts' },
        { id: 'trade', label: 'Trade' },
        { id: 'automation', label: 'Automation & Bots' },
        { id: 'events', label: 'Events' },
        { id: 'notifications', label: 'Notifications' },
        { id: 'email', label: 'Email' },
        { id: 'ftp', label: 'FTP' },
        { id: 'community', label: 'Community' },
        { id: 'signals', label: 'Signals' },
    ];

    return (
        <div className="rtx-options-dialog-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="rtx-options-dialog w-[800px] h-[600px] bg-[#252528] rounded-lg shadow-2xl border border-zinc-700 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="h-10 bg-[#131316] border-b border-zinc-700 flex items-center justify-between px-4 select-none">
                    <span className="rtx-dialog-title text-[20px] leading-7 font-semibold text-zinc-200">{tr("Options")}</span>
                    <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
                        <Icon name="x-close" size="md" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="bg-[#131316] border-b border-zinc-700 px-2 flex items-center gap-1 overflow-x-auto scrollbar-hide">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`px-3 py-2 text-[14px] border-b-2 transition-all whitespace-nowrap
                                ${activeTab === tab.id
                                    ? 'border-zinc-600 text-blue-400 font-semibold'
                                    : 'border-transparent text-zinc-400 font-normal hover:text-zinc-200 hover:bg-zinc-800/50'}`}
                        >
                            {tr(tab.label)}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 bg-[#252528]">
                    {activeTab === 'server' && <ServerTab />}
                    {activeTab === 'charts' && <ChartsTab />}
                    {activeTab === 'trade' && <TradeTab />}
                    {activeTab === 'automation' && <AutomationTab />}
                    {activeTab === 'events' && <PlaceholderTab icon={<Icon name="activity" size="xl" />} title={tr("Events")} desc="Configure sound notifications and system events." />}
                    {activeTab === 'notifications' && <NotificationPreferences />}
                    {activeTab === 'email' && <PlaceholderTab icon={<Icon name="mail" size="xl" />} title={tr("Email")} desc="SMTP server configuration for alerts." />}
                    {activeTab === 'ftp' && <PlaceholderTab icon={<Icon name="hard-drive" size="xl" />} title={tr("FTP")} desc="Automated report publishing settings." />}
                    {activeTab === 'community' && <PlaceholderTab icon={<Icon name="globe" size="xl" />} title={tr("RTX5 Community")} desc="Login to the proprietary RTX5 ecosystem." />}
                    {activeTab === 'signals' && <PlaceholderTab icon={<Icon name="wifi" size="xl" />} title={tr("RTX5 Signals Hub")} desc="Subscribe to institutional signal providers." />}
                </div>

                {/* Footer */}
                <div className="h-14 bg-[#131316] border-t border-zinc-700 flex items-center justify-end px-4 gap-3">
                    <button onClick={handleCancel} className="rounded px-4 py-1.5 text-[14px] font-normal text-zinc-300 transition-colors hover:bg-zinc-700">
                        {tr("Cancel")}</button>
                    <button onClick={handleOK} className="rounded bg-zinc-700 px-4 py-1.5 text-[14px] font-semibold text-white transition-colors hover:bg-zinc-600">
                        {tr("Apply")}</button>
                    <button onClick={handleOK} className="rounded bg-zinc-700 px-4 py-1.5 text-[14px] font-semibold text-white shadow-sm transition-colors hover:bg-zinc-600">
                        {tr("OK")}</button>
                </div>
            </div>
        </div>
    );
};

const ServerTab = () => {
    const tr = useUiTranslation();
    const server = useSettingsStore((state) => state.server);
    const updateServerSettings = useSettingsStore((state) => state.updateServerSettings);
    const accountId = useAppStore(state => state.accountId);

    return (
        <div className="space-y-6 text-[14px] font-normal text-zinc-300">
            <div className="grid grid-cols-[100px_1fr] gap-4 items-center">
                <label className="text-right text-zinc-400">{tr("Server:")}</label>
                <input
                    type="text"
                    value={server.serverName || "RTX 5 Web Terminal"}
                    readOnly
                    className="w-full bg-[#131316] border border-zinc-700 rounded px-2 py-1.5 outline-none cursor-not-allowed opacity-80 text-zinc-400"
                />

                <label className="text-right text-zinc-400">{tr("Login:")}</label>
                <input type="text" value={accountId || tr("Guest")} readOnly className="bg-[#131316] border border-zinc-700 rounded px-2 py-1.5 outline-none focus:border-zinc-600" />

                <label className="text-right text-zinc-400">{tr("Password:")}</label>
                <div className="flex gap-2">
                    <input type="text" value="********" readOnly className="flex-1 bg-[#131316] border border-zinc-700 rounded px-2 py-1.5 outline-none focus:border-zinc-600" />
                    <button className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-200">{tr("Change")}</button>
                </div>
            </div>

            <div className="ml-[116px] space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={server.proxyEnabled}
                        onChange={(e) => updateServerSettings({ proxyEnabled: e.target.checked })}
                        className="rounded bg-zinc-700 border-zinc-600 text-blue-500 focus:ring-0 focus:ring-offset-0"
                    />
                    <span>{tr("Enable proxy server")}</span>
                    <button className="ml-auto px-3 py-0.5 bg-zinc-800 border border-zinc-700 rounded hover:bg-zinc-700">{tr("Proxy...")}</button>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={server.keepPersonalSettings}
                        onChange={(e) => updateServerSettings({ keepPersonalSettings: e.target.checked })}
                        className="rounded bg-zinc-700 border-zinc-600 text-blue-500 focus:ring-0 focus:ring-offset-0"
                    />
                    <span>{tr("Keep personal settings and data at startup")}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={server.enableNews}
                        onChange={(e) => updateServerSettings({ enableNews: e.target.checked })}
                        className="rounded bg-zinc-700 border-zinc-600 text-blue-500 focus:ring-0 focus:ring-offset-0"
                    />
                    <span>{tr("Enable news")}</span>
                </label>
            </div>
        </div>
    );
};

const ChartsTab = () => {
    const tr = useUiTranslation();
    const charts = useSettingsStore((state) => state.charts);
    const updateChartsSettings = useSettingsStore((state) => state.updateChartsSettings);

    return (
        <div className="space-y-4 text-[14px] font-normal text-zinc-300">
            <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={charts.showTradeHistory}
                        onChange={(e) => updateChartsSettings({ showTradeHistory: e.target.checked })}
                        className="rounded bg-zinc-700 border-zinc-600 text-blue-500"
                    />
                    <span>{tr("Show trade history")}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={charts.showTradeLevels}
                        onChange={(e) => updateChartsSettings({ showTradeLevels: e.target.checked })}
                        className="rounded bg-zinc-700 border-zinc-600 text-blue-500"
                    />
                    <span>{tr("Show trade levels")}</span>
                </label>
                <div className="ml-6">
                    <select
                        value={charts.tradeLevelsDragging}
                        onChange={(e) => updateChartsSettings({ tradeLevelsDragging: e.target.value as 'enabled' | 'disabled' })}
                        className="w-full bg-[#131316] border border-zinc-700 rounded px-2 py-1"
                    >
                        <option value="enabled">{tr("Enable dragging of trade levels")}</option>
                        <option value="disabled">{tr("Disable dragging")}</option>
                    </select>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={charts.preloadChartData}
                        onChange={(e) => updateChartsSettings({ preloadChartData: e.target.checked })}
                        className="rounded bg-zinc-700 border-zinc-600 text-blue-500"
                    />
                    <span>{tr("Preload chart data for open positions and orders")}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={charts.showObjectPropertiesAfterCreation}
                        onChange={(e) => updateChartsSettings({ showObjectPropertiesAfterCreation: e.target.checked })}
                        className="rounded bg-zinc-700 border-zinc-600 text-blue-500"
                    />
                    <span>{tr("Show object properties after creation")}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={charts.selectObjectAfterCreation}
                        onChange={(e) => updateChartsSettings({ selectObjectAfterCreation: e.target.checked })}
                        className="rounded bg-zinc-700 border-zinc-600 text-blue-500"
                    />
                    <span>{tr("Select object after creation")}</span>
                </label>
            </div>

            <div className="grid grid-cols-[120px_1fr] gap-4 pt-4 border-t border-zinc-700/50">
                <label className="text-right text-zinc-400">{tr("Magnet sensitivity:")}</label>
                <select
                    value={charts.magnetSensitivity}
                    onChange={(e) => updateChartsSettings({ magnetSensitivity: parseInt(e.target.value) })}
                    className="w-20 bg-[#131316] border border-zinc-700 rounded px-2 py-1"
                >
                    <option value="5">5</option>
                    <option value="10">10</option>
                    <option value="20">20</option>
                </select>

                <label className="text-right text-zinc-400">{tr("Max bars in chart:")}</label>
                <select
                    value={charts.maxBarsInChart}
                    onChange={(e) => updateChartsSettings({ maxBarsInChart: e.target.value === 'unlimited' ? 'unlimited' : parseInt(e.target.value) })}
                    className="w-32 bg-[#131316] border border-zinc-700 rounded px-2 py-1"
                >
                    <option value="100000">100000</option>
                    <option value="unlimited">{tr("Unlimited")}</option>
                </select>
            </div>
        </div>
    );
};

const TradeTab = () => {
    const tr = useUiTranslation();
    const trade = useSettingsStore((state) => state.trade);
    const updateTradeSettings = useSettingsStore((state) => state.updateTradeSettings);
    const selectedSymbol = useAppStore((state) => state.selectedSymbol);

    return (
        <div className="space-y-5 text-[14px] font-normal text-zinc-300">
            <div className="grid grid-cols-[100px_1fr_1fr] gap-4 items-center">
                <label className="text-right text-zinc-400">{tr("Symbol:")}</label>
                <select
                    value={trade.defaultSymbolMode}
                    onChange={(e) => updateTradeSettings({ defaultSymbolMode: e.target.value as 'automatic' | 'last-used' })}
                    className="bg-[#131316] border border-zinc-700 rounded px-2 py-1.5 focus:border-zinc-600"
                >
                    <option value="automatic">{tr("Automatic")}</option>
                    <option value="last-used">{tr("Last Used")}</option>
                </select>
                <div className="text-zinc-500 italic">{selectedSymbol || 'EURUSD'}</div>

                <label className="text-right text-zinc-400">{tr("Volume:")}</label>
                <select
                    value={trade.defaultVolumeMode}
                    onChange={(e) => updateTradeSettings({ defaultVolumeMode: e.target.value as 'last-used' | 'default' })}
                    className="bg-[#131316] border border-zinc-700 rounded px-2 py-1.5 focus:border-zinc-600"
                >
                    <option value="last-used">{tr("Last Used")}</option>
                    <option value="default">{tr("Default")}</option>
                </select>
                <input
                    type="number"
                    value={trade.defaultVolume}
                    onChange={(e) => updateTradeSettings({ defaultVolume: parseFloat(e.target.value) || 0.01 })}
                    step="0.01"
                    min="0.01"
                    className="bg-[#131316] border border-zinc-700 rounded px-2 py-1.5 w-24"
                />

                <label className="text-right text-zinc-400">{tr("Deviation:")}</label>
                <select
                    value={trade.defaultDeviationMode}
                    onChange={(e) => updateTradeSettings({ defaultDeviationMode: e.target.value as 'last-used' | 'default' })}
                    className="bg-[#131316] border border-zinc-700 rounded px-2 py-1.5 focus:border-zinc-600"
                >
                    <option value="last-used">{tr("Last Used")}</option>
                    <option value="default">{tr("Default")}</option>
                </select>
                <input
                    type="number"
                    value={trade.defaultDeviation}
                    onChange={(e) => updateTradeSettings({ defaultDeviation: parseInt(e.target.value) || 0 })}
                    min="0"
                    className="bg-[#131316] border border-zinc-700 rounded px-2 py-1.5 w-24"
                />
            </div>

            <div className="pt-4 border-t border-zinc-700/50">
                <label className="flex items-center gap-2 cursor-pointer group">
                    <div className="relative">
                        <input
                            type="checkbox"
                            checked={trade.oneClickTrading}
                            onChange={(e) => updateTradeSettings({ oneClickTrading: e.target.checked })}
                            className="peer sr-only"
                        />
                        <div className="w-9 h-5 bg-zinc-700 rounded-full peer peer-checked:bg-blue-600 transition-colors"></div>
                        <div className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full peer-checked:translate-x-4 transition-transform"></div>
                    </div>
                    <span className="font-medium group-hover:text-white transition-colors">{tr("One Click Trading")}</span>
                </label>
                <p className="ml-11 mt-2 text-[12px] font-normal text-zinc-500">
                    {tr("Allows performing trade operations with a single mouse click without additional confirmation.")}</p>
            </div>
        </div>
    );
};

const AutomationTab = () => {
    const tr = useUiTranslation();
    const [newURL, setNewURL] = useState('');
    const automation = useSettingsStore((state) => state.automation);
    const updateAutomationSettings = useSettingsStore((state) => state.updateAutomationSettings);
    const addAllowedURL = useSettingsStore((state) => state.addAllowedURL);
    const removeAllowedURL = useSettingsStore((state) => state.removeAllowedURL);

    const handleAddURL = () => {
        if (newURL.trim() && newURL.startsWith('http')) {
            addAllowedURL(newURL.trim());
            setNewURL('');
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleAddURL();
        }
    };

    return (
        <div className="space-y-5 text-[14px] font-normal text-zinc-300">
            <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={automation.enableStrategies}
                        onChange={(e) => updateAutomationSettings({ enableStrategies: e.target.checked })}
                        className="rounded bg-zinc-700 border-zinc-600 text-blue-500"
                    />
                    <span className="font-medium text-zinc-200">{tr("Enable automated strategies")}</span>
                </label>
                <div className="ml-6 space-y-2 text-zinc-400">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={automation.disableOnAccountChange}
                            onChange={(e) => updateAutomationSettings({ disableOnAccountChange: e.target.checked })}
                            disabled={!automation.enableStrategies}
                            className="rounded bg-zinc-700 border-zinc-600 text-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <span>{tr("Disable strategies when the account has been changed")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={automation.disableOnProfileChange}
                            onChange={(e) => updateAutomationSettings({ disableOnProfileChange: e.target.checked })}
                            disabled={!automation.enableStrategies}
                            className="rounded bg-zinc-700 border-zinc-600 text-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <span>{tr("Disable strategies when the profile has been changed")}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={automation.disableOnChartChange}
                            onChange={(e) => updateAutomationSettings({ disableOnChartChange: e.target.checked })}
                            disabled={!automation.enableStrategies}
                            className="rounded bg-zinc-700 border-zinc-600 text-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <span>{tr("Disable strategies when the charts symbol or period has been changed")}</span>
                    </label>
                </div>
            </div>

            <div className="space-y-3 pt-4 border-t border-zinc-700/50">
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={automation.allowDLL}
                        onChange={(e) => updateAutomationSettings({ allowDLL: e.target.checked })}
                        className="rounded bg-zinc-700 border-zinc-600 text-blue-500"
                    />
                    <span className="flex items-center gap-2">
                        {tr("External library access (DLL)")}<Icon name="alert-triangle" size="xs" className="text-amber-500" />
                        <span className="text-zinc-500">{tr("(potentially dangerous, enable only for trusted applications)")}</span>
                    </span>
                </label>
            </div>

            <div className="space-y-2 pt-4 border-t border-zinc-700/50">
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={automation.allowWebRequest}
                        onChange={(e) => updateAutomationSettings({ allowWebRequest: e.target.checked })}
                        className="rounded bg-zinc-700 border-zinc-600 text-blue-500"
                    />
                    <span>{tr("Allow WebRequest for listed URL:")}</span>
                </label>
                <div className="border border-zinc-700 rounded bg-[#131316] h-32 overflow-y-auto">
                    {automation.allowedURLs.map((url, index) => (
                        <div key={index} className="flex items-center gap-2 px-2 py-1.5 border-b border-zinc-800 hover:bg-zinc-800/50 group">
                            <Icon name="globe" size="xs" className="text-blue-400" />
                            <span className="flex-1">{url}</span>
                            <button
                                onClick={() => removeAllowedURL(url)}
                                className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity"
                            >
                                <Icon name="trash" size="xs" />
                            </button>
                        </div>
                    ))}
                    <div className="flex items-center gap-2 px-2 py-1.5">
                        <span className="text-emerald-500 font-bold">+</span>
                        <input
                            type="text"
                            value={newURL}
                            onChange={(e) => setNewURL(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="https://api.example.com"
                            className="flex-1 bg-transparent outline-none text-zinc-300 placeholder:text-zinc-600"
                        />
                        {newURL && (
                            <button
                                onClick={handleAddURL}
                                className="text-[14px] font-normal text-emerald-500 hover:text-emerald-400"
                            >
                                {tr("ADD")}</button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

const PlaceholderTab = ({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) => { const tr = useUiTranslation(); return ((
    <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
        <div className="text-zinc-600">{icon}</div>
        <div>
            <h3 className="text-[14px] font-semibold text-zinc-300">{tr(title)}</h3>
            <p className="mx-auto max-w-xs text-[12px] font-normal text-zinc-500">{tr(desc)}</p>
        </div>
    </div>
)); };
