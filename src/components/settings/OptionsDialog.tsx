import { useCallback, useEffect, useEffectEvent, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import { Icon, type IconName } from '../ui/Icon';
import { useSettingsStore, type SettingsState } from '../../store/useSettingsStore';
import { useThemeAppearanceStore } from '../../store/useThemeAppearanceStore';
import { useAppStore } from '../../store/useAppStore';
import { NotificationPreferences } from './NotificationPreferences';
import { ThemeAppearanceSettings } from './ThemeAppearanceSettings';
import { SettingsField, SettingsNotice, SettingsSection, SettingsToggle } from './OptionsControls';
import { NEUTRAL_TERMINAL_TITLE } from '../../services/brokerDisplayName';
import './options-dialog.css';

interface OptionsDialogProps { isOpen: boolean; onClose: () => void; }
type TabId = 'server' | 'charts' | 'trade' | 'automation' | 'events' | 'notifications' | 'email' | 'ftp' | 'community' | 'signals';
const TABS: { id: TabId; label: string; icon: IconName; title: string; description: string; group?: string; unavailable?: boolean }[] = [
    { id: 'server', label: 'Server', icon: 'server', title: 'Server & connection', description: 'Account details and terminal startup preferences.', group: 'Workspace' },
    { id: 'charts', label: 'Charts', icon: 'candlestick', title: 'Charts', description: 'Display preferences, drawing tools and chart history.' },
    { id: 'trade', label: 'Trade', icon: 'sliders-horizontal', title: 'Trading preferences', description: 'Default values and confirmation preferences for trading.' },
    { id: 'automation', label: 'Automation & Bots', icon: 'code', title: 'Automation & Bots', description: 'Strategy preferences and access to external resources.' },
    { id: 'events', label: 'Events', icon: 'activity', title: 'Events', description: 'Sound profiles for terminal and system events.', group: 'Communication', unavailable: true },
    { id: 'notifications', label: 'Notifications', icon: 'bell', title: 'Notifications', description: 'Choose which updates you receive and how they reach you.' },
    { id: 'email', label: 'Email', icon: 'mail', title: 'Email', description: 'Email delivery for alerts and terminal updates.', unavailable: true },
    { id: 'ftp', label: 'FTP', icon: 'hard-drive', title: 'Report publishing', description: 'Scheduled report delivery to an FTP server.', unavailable: true },
    { id: 'community', label: 'Community', icon: 'globe', title: 'RTX5 Community', description: 'Your connection to the community.', group: 'Services', unavailable: true },
    { id: 'signals', label: 'Signals', icon: 'wifi', title: 'RTX5 Signals Hub', description: 'Signal providers and subscription preferences.', unavailable: true },
];

export function OptionsDialog({ isOpen, onClose }: OptionsDialogProps) {
    const [activeTab, setActiveTab] = useState<TabId>('server');
    return isOpen ? <OpenOptionsDialog onClose={onClose} activeTab={activeTab} setActiveTab={setActiveTab} /> : null;
}

function OpenOptionsDialog({ onClose, activeTab, setActiveTab }: {
    onClose: () => void; activeTab: TabId; setActiveTab: (tab: TabId) => void;
}) {
    const tr = useUiTranslation();
    const settings = useSettingsStore();
    const themeAppearance = useThemeAppearanceStore();
    const [baseline, setBaseline] = useState<SettingsState>(() => useSettingsStore.getState().getSnapshot());
    const [themeBaseline, setThemeBaseline] = useState(() => useThemeAppearanceStore.getState().getSnapshot());
    const dialogRef = useRef<HTMLDivElement>(null);
    const currentTab = TABS.find((tab) => tab.id === activeTab)!;
    const dirty =
        JSON.stringify(settings.getSnapshot()) !== JSON.stringify(baseline) ||
        JSON.stringify(themeAppearance.getSnapshot()) !== JSON.stringify(themeBaseline);
    const handleCancel = useCallback(() => {
        useSettingsStore.getState().restoreSnapshot(baseline);
        if (JSON.stringify(useThemeAppearanceStore.getState().getSnapshot()) !== JSON.stringify(themeBaseline)) {
            useThemeAppearanceStore.getState().restoreSnapshot(themeBaseline);
        }
        onClose();
    }, [baseline, themeBaseline, onClose]);
    const handleApply = () => {
        setBaseline(settings.getSnapshot());
        setThemeBaseline(themeAppearance.getSnapshot());
    };
    const cancelFromKeyboard = useEffectEvent(handleCancel);
    useEffect(() => {
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialogRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault(); event.stopPropagation(); cancelFromKeyboard();
            }
            if (event.key !== 'Tab') return;
            const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
                ':is(button, input, select, [tabindex="0"]):not(:disabled)'
            ) ?? []).filter((element) => element.tabIndex >= 0 && !element.closest('[hidden]'));
            const first = elements[0]; const last = elements[elements.length - 1];
            if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
                event.preventDefault(); last?.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
                event.preventDefault(); first?.focus();
            }
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, []);
    const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        let next = index;
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % TABS.length;
        else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = TABS.length - 1;
        else return;
        event.preventDefault(); setActiveTab(TABS[next].id);
        dialogRef.current?.querySelector<HTMLButtonElement>(`#options-tab-${TABS[next].id}`)?.focus();
    };
    return createPortal(
        <div className="rtx-options-dialog-backdrop">
            <div className="rtx-options-dialog text-[14px] font-normal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="options-title" aria-describedby="options-description" onKeyDown={(event) => event.stopPropagation()}>
                <header className="options-header">
                    <span className="options-header-icon"><Icon name="settings" size={22} /></span>
                    <div className="options-header-copy"><h2 className="rtx-dialog-title" id="options-title">{tr('Options')}</h2><p id="options-description">{tr('Personalize your terminal workspace')}</p></div>
                    <button className="options-close" onClick={handleCancel} aria-label={tr('Close options')}><Icon name="x-close" size={18} /></button>
                </header>
                <div className="options-layout">
                    <aside className="options-sidebar">
                        <div role="tablist" aria-label={tr('Options categories')} aria-orientation="vertical" className="options-navigation">
                            {TABS.map((tab, index) => <div key={tab.id} role="presentation">
                                {tab.group && <div className="options-nav-group" role="presentation">{tr(tab.group)}</div>}
                                <button id={`options-tab-${tab.id}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`options-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} className="options-nav-item" onClick={() => setActiveTab(tab.id)} onKeyDown={(event) => handleTabKeyDown(event, index)}>
                                    <Icon name={tab.icon} size={17} /><span>{tr(tab.label)}</span>{tab.unavailable && <Icon name="lock" size={12} className="options-nav-lock" />}
                                </button>
                            </div>)}
                        </div>
                        <div className="options-sidebar-note"><Icon name="monitor" size={15} /><span>{tr('Terminal preferences')}</span></div>
                    </aside>
                    <div className="options-content" key={activeTab} id={`options-panel-${activeTab}`} role="tabpanel" aria-labelledby={`options-tab-${activeTab}`} tabIndex={0}>
                        <div className="options-page-heading"><h2>{tr(currentTab.title)}</h2><p>{tr(currentTab.description)}</p></div>
                        {activeTab === 'server' && <ServerTab />}
                        {activeTab === 'charts' && <ChartsTab />}
                        {activeTab === 'trade' && <TradeTab />}
                        {activeTab === 'automation' && <AutomationTab />}
                        {activeTab === 'notifications' && <NotificationPreferences />}
                        {currentTab.unavailable && <UnavailableTab tab={currentTab.id} icon={currentTab.icon} />}
                    </div>
                </div>
                <footer className="options-footer">
                    <div className="options-save-status text-[12px] font-normal" role="status"><Icon name={dirty ? 'info' : 'check-circle'} size={15} /><span>{tr(dirty ? 'Unapplied changes' : 'All changes applied')}</span></div>
                    <div className="options-footer-actions"><button className="options-button options-button--quiet" onClick={handleCancel}>{tr('Cancel')}</button><button className="options-button options-button--secondary" onClick={handleApply} disabled={!dirty}>{tr('Apply')}</button><button className="options-button options-button--primary" onClick={onClose}>{tr('OK')}</button></div>
                </footer>
            </div>
        </div>, document.body
    );
}

function ServerTab() {
    const tr = useUiTranslation();
    const server = useSettingsStore((state) => state.server);
    const update = useSettingsStore((state) => state.updateServerSettings);
    const accountId = useAppStore((state) => state.accountId);
    return <div className="options-stack">
        <SettingsSection title="Account details" action={<span className="options-badge">{tr('Read only')}</span>}>
            <div className="options-field-grid">
                <SettingsField label="Server" htmlFor="options-server"><input id="options-server" className="options-control" value={server.serverName || NEUTRAL_TERMINAL_TITLE} readOnly /></SettingsField>
                <SettingsField label="Login" htmlFor="options-login"><input id="options-login" className="options-control" value={accountId || tr('Guest')} readOnly /></SettingsField>
            </div>
            <div className="options-field"><label htmlFor="options-password">{tr('Password')}</label><div className="options-input-action"><input id="options-password" className="options-control" value="••••••••" readOnly /><button className="options-button options-button--secondary" disabled>{tr('Change')}</button></div><p className="options-field-hint">{tr('Password changes are not available in this window.')}</p></div>
        </SettingsSection>
        <SettingsSection title="Connection & startup">
            <SettingsToggle label="Enable proxy server" description="Use a proxy for the terminal connection." checked={server.proxyEnabled} onChange={(proxyEnabled) => update({ proxyEnabled })} />
            {server.proxyEnabled && <SettingsNotice>{tr('Proxy configuration is not available in this terminal.')}</SettingsNotice>}
            <SettingsToggle label="Keep personal settings and data at startup" description="Retain your saved workspace preferences between sessions." checked={server.keepPersonalSettings} onChange={(keepPersonalSettings) => update({ keepPersonalSettings })} />
            <SettingsToggle label="Enable news" checked={server.enableNews} onChange={(enableNews) => update({ enableNews })} />
        </SettingsSection>
    </div>;
}

function ChartsTab() {
    const tr = useUiTranslation();
    const charts = useSettingsStore((state) => state.charts);
    const update = useSettingsStore((state) => state.updateChartsSettings);
    return <div className="options-stack">
        <ThemeAppearanceSettings />
        <SettingsSection title="Trade display">
            <SettingsToggle label="Show trade history" description="Display previous trades on the chart." checked={charts.showTradeHistory} onChange={(showTradeHistory) => update({ showTradeHistory })} />
            <SettingsToggle label="Show trade levels" description="Display price levels for positions and orders." checked={charts.showTradeLevels} onChange={(showTradeLevels) => update({ showTradeLevels })} />
            <SettingsField label="Trade level dragging" htmlFor="options-dragging"><select id="options-dragging" className="options-control" value={charts.tradeLevelsDragging} onChange={(e) => update({ tradeLevelsDragging: e.target.value as 'enabled' | 'disabled' })}><option value="enabled">{tr('Enable dragging of trade levels')}</option><option value="disabled">{tr('Disable dragging')}</option></select></SettingsField>
        </SettingsSection>
        <SettingsSection title="Drawing tools">
            <SettingsToggle label="Show object properties after creation" checked={charts.showObjectPropertiesAfterCreation} onChange={(showObjectPropertiesAfterCreation) => update({ showObjectPropertiesAfterCreation })} />
            <SettingsToggle label="Select object after creation" checked={charts.selectObjectAfterCreation} onChange={(selectObjectAfterCreation) => update({ selectObjectAfterCreation })} />
            <SettingsField label="Magnet sensitivity" htmlFor="options-magnet"><select id="options-magnet" className="options-control" value={charts.magnetSensitivity} onChange={(e) => update({ magnetSensitivity: Number(e.target.value) })}>{[5, 10, 20].map((value) => <option key={value} value={value}>{value} {tr('pixels')}</option>)}</select></SettingsField>
        </SettingsSection>
        <SettingsSection title="Data & performance">
            <SettingsToggle label="Preload chart data for open positions and orders" checked={charts.preloadChartData} onChange={(preloadChartData) => update({ preloadChartData })} />
            <SettingsField label="Max bars in chart" htmlFor="options-bars"><select id="options-bars" className="options-control" value={charts.maxBarsInChart} onChange={(e) => update({ maxBarsInChart: e.target.value === 'unlimited' ? 'unlimited' : Number(e.target.value) })}><option value="100000">100,000</option><option value="unlimited">{tr('Unlimited')}</option></select></SettingsField>
        </SettingsSection>
    </div>;
}

function TradeTab() {
    const tr = useUiTranslation();
    const trade = useSettingsStore((state) => state.trade);
    const update = useSettingsStore((state) => state.updateTradeSettings);
    const selectedSymbol = useAppStore((state) => state.selectedSymbol);
    return <div className="options-stack">
        <SettingsSection title="Order defaults" description="Choose the preferred starting values for an order.">
            <SettingsField label="Symbol" htmlFor="options-symbol"><div className="options-input-action"><select id="options-symbol" className="options-control" value={trade.defaultSymbolMode} onChange={(e) => update({ defaultSymbolMode: e.target.value as 'automatic' | 'last-used' })}><option value="automatic">{tr('Automatic')}</option><option value="last-used">{tr('Last Used')}</option></select><span className="options-symbol-badge">{selectedSymbol || 'EURUSD'}</span></div></SettingsField>
            <div className="options-field-grid">
                <SettingsField label="Volume" htmlFor="options-volume-mode"><select id="options-volume-mode" className="options-control" value={trade.defaultVolumeMode} onChange={(e) => update({ defaultVolumeMode: e.target.value as 'last-used' | 'default' })}><option value="last-used">{tr('Last Used')}</option><option value="default">{tr('Default')}</option></select></SettingsField>
                <SettingsField label="Default volume (lots)" htmlFor="options-volume"><input id="options-volume" className="options-control" type="number" min="0.01" step="0.01" value={trade.defaultVolume} onChange={(e) => update({ defaultVolume: parseFloat(e.target.value) || 0.01 })} /></SettingsField>
                <SettingsField label="Deviation" htmlFor="options-deviation-mode"><select id="options-deviation-mode" className="options-control" value={trade.defaultDeviationMode} onChange={(e) => update({ defaultDeviationMode: e.target.value as 'last-used' | 'default' })}><option value="last-used">{tr('Last Used')}</option><option value="default">{tr('Default')}</option></select></SettingsField>
                <SettingsField label="Default deviation (points)" htmlFor="options-deviation"><input id="options-deviation" className="options-control" type="number" min="0" value={trade.defaultDeviation} onChange={(e) => update({ defaultDeviation: parseInt(e.target.value) || 0 })} /></SettingsField>
            </div>
        </SettingsSection>
        <SettingsSection title="Trade confirmation"><SettingsToggle label="One Click Trading" description="Allows trade operations with a single click without an additional confirmation." checked={trade.oneClickTrading} onChange={(oneClickTrading) => update({ oneClickTrading })} /></SettingsSection>
    </div>;
}

function AutomationTab() {
    const tr = useUiTranslation();
    const [newURL, setNewURL] = useState('');
    const [urlError, setUrlError] = useState('');
    const automation = useSettingsStore((state) => state.automation);
    const update = useSettingsStore((state) => state.updateAutomationSettings);
    const addURL = useSettingsStore((state) => state.addAllowedURL);
    const removeURL = useSettingsStore((state) => state.removeAllowedURL);
    const handleAddURL = () => {
        const value = newURL.trim();
        try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol'); }
        catch { setUrlError('Enter a valid HTTP or HTTPS URL.'); return; }
        if (automation.allowedURLs.includes(value)) { setUrlError('This URL is already in the list.'); return; }
        addURL(value); setNewURL(''); setUrlError('');
    };
    return <div className="options-stack">
        <SettingsSection title="Automated strategies">
            <SettingsToggle label="Enable automated strategies" checked={automation.enableStrategies} onChange={(enableStrategies) => update({ enableStrategies })} />
            <div className="options-dependent-settings">
                <SettingsToggle label="Disable strategies when the account has been changed" disabled={!automation.enableStrategies} checked={automation.disableOnAccountChange} onChange={(disableOnAccountChange) => update({ disableOnAccountChange })} />
                <SettingsToggle label="Disable strategies when the profile has been changed" disabled={!automation.enableStrategies} checked={automation.disableOnProfileChange} onChange={(disableOnProfileChange) => update({ disableOnProfileChange })} />
                <SettingsToggle label="Disable strategies when the charts symbol or period has been changed" disabled={!automation.enableStrategies} checked={automation.disableOnChartChange} onChange={(disableOnChartChange) => update({ disableOnChartChange })} />
            </div>
        </SettingsSection>
        <SettingsSection title="External access">
            <SettingsToggle label="External library access (DLL)" description="Potentially dangerous. Enable only for trusted applications." checked={automation.allowDLL} onChange={(allowDLL) => update({ allowDLL })} />
            <SettingsToggle label="Allow WebRequest for listed URL:" description="Manage the addresses your automated strategies may access." checked={automation.allowWebRequest} onChange={(allowWebRequest) => update({ allowWebRequest })} />
            <div className="options-url-list" aria-label={tr('Allowed URLs')}>
                {automation.allowedURLs.length === 0 && <p className="options-empty-list">{tr('No URLs added yet.')}</p>}
                {automation.allowedURLs.map((url, index) => <div className="options-url-row" key={`${url}-${index}`}><Icon name="globe" size={15} /><span>{url}</span><button className="options-icon-button" onClick={() => removeURL(url)} aria-label={`${tr('Remove')} ${url}`}><Icon name="trash" size={15} /></button></div>)}
            </div>
            <SettingsField label="Allowed URL" htmlFor="options-new-url"><div className="options-input-action"><input id="options-new-url" className="options-control" type="url" placeholder="https://api.example.com" value={newURL} aria-invalid={!!urlError} aria-describedby={urlError ? 'options-url-error' : undefined} onChange={(e) => { setNewURL(e.target.value); setUrlError(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddURL(); } }} /><button className="options-button options-button--secondary" disabled={!newURL.trim()} onClick={handleAddURL}><Icon name="plus" size={14} />{tr('Add URL')}</button></div></SettingsField>
            {urlError && <p className="options-error" id="options-url-error" role="alert">{tr(urlError)}</p>}
        </SettingsSection>
    </div>;
}

const UNAVAILABLE_CONTENT: Partial<Record<TabId, { title: string; description: string; features: string[] }>> = {
    events: { title: 'Event sound profiles', description: 'Custom event sounds are not available in this terminal. You can manage notification sounds in Notifications.', features: ['Connection & system events', 'Custom sound profiles', 'Event playback preferences'] },
    email: { title: 'Email delivery', description: 'Email configuration is not available in this terminal.', features: ['SMTP server configuration', 'Sender & recipient details', 'Email alert delivery'] },
    ftp: { title: 'Automated report publishing', description: 'FTP publishing is not available in this terminal.', features: ['FTP server connection', 'Report destination', 'Publishing schedule'] },
    community: { title: 'Connect with the community', description: 'Community accounts are not available in this terminal.', features: ['Community account', 'Shared resources', 'Account preferences'] },
    signals: { title: 'Signal subscriptions', description: 'Signal subscriptions are not available in this terminal.', features: ['Signal providers', 'Subscription management', 'Signal preferences'] },
};
function UnavailableTab({ tab, icon }: { tab: TabId; icon: IconName }) {
    const tr = useUiTranslation(); const content = UNAVAILABLE_CONTENT[tab]!;
    return <section className="options-unavailable"><div className="options-unavailable-icon"><Icon name={icon} size={28} /></div><span className="options-badge"><Icon name="lock" size={12} />{tr('Not available')}</span><h3>{tr(content.title)}</h3><p>{tr(content.description)}</p><div className="options-feature-list">{content.features.map((feature) => <div key={feature}><Icon name="lock" size={14} /><span>{tr(feature)}</span></div>)}</div></section>;
}
