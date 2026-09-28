import { lockedTerminalTool } from '../../../config/terminalToolAvailability';
import { useUiTranslation } from '../../../hooks/useUiTranslation';
import { getTerminalShortcutHint, runTerminalShortcutAction } from '../../../services/shortcutCatalog';
import { Icon } from '../../../components/ui/Icon';
import type { IconName } from '../../../components/ui/iconRegistry';

export function ToolboxTab() {
    const tr = useUiTranslation();
    const tools: Array<{
        category: string;
        items: Array<{
            name: string;
            shortcutId?: Parameters<typeof runTerminalShortcutAction>[0];
            icon: string;
            disabled?: boolean;
            unavailableReason?: string;
        }>;
    }> = [
        {
            category: 'Trading',
            items: [
                { name: 'New Order', shortcutId: 'tools.new-order', icon: 'plus' },
                { name: 'Depth of Market', shortcutId: 'view.depth-of-market', icon: 'box' },
                { name: 'One Click Trading', shortcutId: 'trading.toggle-one-click', icon: 'mouse-pointer' },
                { name: 'Order History', shortcutId: 'trading.order-history', icon: 'history' },
            ]
        },
        {
            category: 'View',
            items: [
                { name: 'Market Watch', shortcutId: 'view.market-watch', icon: 'monitor' },
                { name: 'Data Window', shortcutId: 'view.data-window', icon: 'database' },
                { name: 'Navigator', shortcutId: 'view.navigator', icon: 'compass' },
                { name: 'Terminal', shortcutId: 'view.terminal', icon: 'terminal' },
                { name: 'Strategy Tester', icon: 'activity', ...lockedTerminalTool('strategyTester') },
                { name: 'Toolbox', shortcutId: 'view.toolbox', icon: 'tool' },
            ]
        },
        {
            category: 'Charts',
            items: [
                { name: 'Bar Chart', shortcutId: 'charts.bar-chart', icon: 'bar-chart' },
                { name: 'Candlesticks', shortcutId: 'charts.candlestick', icon: 'candlestick' },
                { name: 'Line Chart', shortcutId: 'charts.line-chart', icon: 'line-chart' },
                { name: 'Area Chart', shortcutId: 'charts.area-chart', icon: 'area-chart' },
                { name: 'Indicators', shortcutId: 'charts.indicator-list', icon: 'line-chart' },
                { name: 'Objects', shortcutId: 'charts.object-list', icon: 'square' },
            ]
        },
        {
            category: 'Tools',
            items: [
                { name: 'History Center', shortcutId: 'tools.history-center', icon: 'database' },
                { name: 'Global Variables', icon: 'globe', ...lockedTerminalTool('globalVariables') },
                { name: 'MetaEditor', icon: 'code', ...lockedTerminalTool('scriptEditor') },
                { name: 'Options', shortcutId: 'tools.options', icon: 'settings' },
            ]
        },
        {
            category: 'Window',
            items: [
                { name: 'Tile Windows', shortcutId: 'window.tile', icon: 'grid' },
                { name: 'Cascade', shortcutId: 'window.cascade', icon: 'layers' },
                { name: 'Tile Horizontally', shortcutId: 'window.tile-horizontal', icon: 'layout' },
                { name: 'Tile Vertically', shortcutId: 'window.tile-vertical', icon: 'layout' },
            ]
        },
        {
            category: 'Help',
            items: [
                { name: 'Help Topics', shortcutId: 'help.shortcuts', icon: 'help-circle' },
                { name: 'Documentation', icon: 'book-open', disabled: true, unavailableReason: 'Documentation is not configured for this deployment' },
                { name: 'Market', icon: 'trending-up', ...lockedTerminalTool('marketplace') },
                { name: 'Signals', icon: 'signal', ...lockedTerminalTool('signalsHub') },
            ]
        },
    ];

    return (
        <div className="h-full w-full overflow-auto bg-[#131316] p-2 sm:p-4">
            <div className="grid gap-3 min-w-0" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
                {tools.map((section) => (
                    <div key={section.category} className="space-y-2 min-w-0">
                        <h3 className="text-[12px] font-normal text-zinc-400 uppercase tracking-wider border-b border-zinc-700 pb-1 mb-2 truncate">
                            {tr(section.category)}
                        </h3>
                        <div className="space-y-1">
                            {section.items.map((item) => (
                                <button
                                    key={item.name}
                                    disabled={item.disabled}
                                    aria-disabled={item.disabled || undefined}
                                    aria-description={tr(item.unavailableReason)}
                                    className={`w-full flex items-center justify-between px-2 py-1.5 text-[14px] font-normal rounded transition-colors text-left min-w-0 ${item.disabled ? 'text-zinc-400 cursor-not-allowed' : 'text-zinc-300 hover:bg-zinc-700/50 group'}`}
                                    onClick={() => {
                                        if (!item.disabled && item.shortcutId) runTerminalShortcutAction(item.shortcutId);
                                    }}
                                    title={tr(item.unavailableReason || item.name)}
                                >
                                    <span className="flex items-center gap-2 min-w-0 overflow-hidden">
                                        <Icon name={item.icon as IconName} size="xs" className="text-zinc-500 group-hover:text-zinc-300 flex-shrink-0" />
                                        <span className="group-hover:text-white truncate">{tr(item.name)}</span>
                                    </span>
                                    {item.disabled ? (
                                        <span className="ml-2 flex-shrink-0" aria-hidden="true"><Icon name="lock" size="xs" /></span>
                                    ) : item.shortcutId && getTerminalShortcutHint(item.shortcutId) && (
                                        <span className="text-[12px] font-normal text-zinc-600 font-mono flex-shrink-0 ml-2">{getTerminalShortcutHint(item.shortcutId)}</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
