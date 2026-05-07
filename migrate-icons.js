// Icon migration script - converts lucide-react imports to unified Icon component
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

// Map lucide-react names to registry names
const iconMap = {
    Play: 'play', Pause: 'stop', Settings: 'settings', Settings2: 'settings',
    Bell: 'bell', BellRing: 'bell', User: 'user', Users: 'user',
    Save: 'save', Printer: 'print', Camera: 'camera', Download: 'download',
    Upload: 'upload', Plus: 'plus', PlusSquare: 'plus-circle', PlusCircle: 'plus-circle',
    Minus: 'minus', MinusCircle: 'minus', X: 'x-close', XCircle: 'x-close',
    Check: 'check', CheckCircle: 'check-circle', CheckCircle2: 'check-circle',
    Layers: 'layers', Layout: 'layout', LayoutGrid: 'grid', LayoutList: 'layout-list',
    LayoutTemplate: 'layout-template', Filter: 'filter', SortAsc: 'sort', SortDesc: 'sort',
    RefreshCw: 'refresh', RefreshCcw: 'refresh', RotateCcw: 'refresh', RotateCw: 'refresh',
    Copy: 'copy', Trash: 'trash', Trash2: 'trash', Edit: 'edit', Edit2: 'edit', Edit3: 'edit',
    Pencil: 'edit', Eye: 'eye', EyeOff: 'eye-off', Lock: 'lock', Unlock: 'unlock',
    Search: 'search', ZoomIn: 'zoom-in', ZoomOut: 'zoom-out',
    ChevronDown: 'chevron-down', ChevronRight: 'chevron-right', ChevronLeft: 'chevron-left', ChevronUp: 'chevron-up',
    ArrowUp: 'arrow-up', ArrowDown: 'arrow-down', ArrowLeft: 'arrow-left', ArrowRight: 'arrow-right',
    ArrowUpRight: 'move-up-right', ArrowUpDown: 'sort',
    MoreVertical: 'more-vertical', MoreHorizontal: 'more-vertical',
    Briefcase: 'briefcase', Image: 'image', FileText: 'file-text', File: 'file',
    Folder: 'folder', FolderOpen: 'folder-open', Code: 'code', Code2: 'code',
    Terminal: 'terminal', Cpu: 'cpu', Database: 'database', HardDrive: 'hard-drive',
    Globe: 'globe', Globe2: 'globe', Server: 'server', Shield: 'shield', ShieldCheck: 'shield',
    Smartphone: 'smartphone', Mail: 'mail', Wifi: 'wifi', WifiOff: 'disconnected',
    CreditCard: 'credit-card', Monitor: 'monitor', Box: 'box', Package: 'box',
    LogIn: 'log-in', LogOut: 'log-out', UserPlus: 'user-plus',
    TrendingUp: 'trending-up', TrendingDown: 'trending-down', Activity: 'activity',
    BarChart: 'bar-chart', BarChart2: 'bar-chart-2', BarChart3: 'bar-chart-3', BarChart4: 'bar-chart-2',
    PieChart: 'pie-chart', LineChart: 'line-chart', CandlestickChart: 'candlestick',
    Signal: 'signal', Zap: 'zap', Clock: 'clock', Clock1: 'clock', Timer: 'clock',
    History: 'history', Calendar: 'calendar', CalendarDays: 'calendar',
    Newspaper: 'newspaper', BookOpen: 'book-open', Book: 'book-open', Bot: 'bot',
    Building: 'building', Building2: 'building', ThumbsUp: 'thumbs-up', ThumbsDown: 'thumbs-down',
    AlertTriangle: 'alert-triangle', AlertCircle: 'error', Info: 'info', HelpCircle: 'help-circle',
    ExternalLink: 'move-up-right', Link: 'move-up-right', Share: 'export', Share2: 'export',
    Hash: 'grid-3x3', Grid: 'grid-3x3', Grid2: 'grid-3x3', Grid3x3: 'grid-3x3',
    Table: 'grid-3x3', Table2: 'grid-3x3', List: 'layout-list',
    Move: 'cursor', Crosshair: 'crosshair', Target: 'crosshair',
    Maximize: 'grid', Maximize2: 'grid', Minimize: 'minus', Minimize2: 'minus',
    Send: 'export', PlayCircle: 'play', StopCircle: 'stop', PauseCircle: 'stop',
    Circle: 'connected', CircleDot: 'connected', Disc: 'connected', Radio: 'signal',
    Volume: 'volume', Volume1: 'volume', Volume2: 'volume', VolumeX: 'volume',
    MessageSquare: 'callout', MessageCircle: 'callout', Cloud: 'globe',
    CloudUpload: 'upload', CloudDownload: 'download', Laptop: 'monitor',
    ShoppingBag: 'box', ShoppingCart: 'box', Brain: 'cpu', GraduationCap: 'help-circle',
    Award: 'check-circle', Crown: 'check-circle', Star: 'check-circle', Heart: 'check-circle',
    Bookmark: 'save', Tag: 'filter', Palette: 'palette', Pipette: 'palette', Paintbrush: 'paintbrush',
    Eraser: 'x-close', Ruler: 'ruler',
    AlignLeft: 'layout', AlignCenter: 'layout', AlignRight: 'layout',
    AlignHorizontalJustifyCenter: 'layout', AlignVerticalJustifyCenter: 'layout',
    Sliders: 'settings', SlidersHorizontal: 'settings',
    Power: 'play', Plug: 'connected', PlugZap: 'connected', Unplug: 'disconnected',
    BatteryCharging: 'zap', Battery: 'bar-chart-2', Gauge: 'activity', Thermometer: 'activity',
    Navigation: 'cursor', Compass: 'crosshair', Map: 'globe', MapPin: 'globe',
    Sun: 'settings', Moon: 'settings', Flame: 'zap', Sparkles: 'zap', Wand: 'zap', Wand2: 'zap',
    MoveDown: 'arrow-down', MoveUp: 'arrow-up', MoveRight: 'arrow-right', MoveLeft: 'arrow-left',
    MoveHorizontal: 'minus', MoveVertical: 'minus',
    MousePointer: 'cursor', MousePointer2: 'cursor',
    Undo: 'refresh', Undo2: 'refresh', Redo: 'refresh', Redo2: 'refresh',
    Delete: 'trash', Backspace: 'trash', Type: 'text',
    Bold: 'text', Italic: 'text', Underline: 'text',
    DollarSign: 'credit-card', Percent: 'bar-chart-2',
    Aperture: 'crosshair', Focus: 'crosshair',
    Square: 'rectangle', RectangleHorizontal: 'rectangle', Triangle: 'triangle',
    Hexagon: 'shapes', Pentagon: 'shapes', Octagon: 'shapes',
    FolderPlus: 'folder', FolderMinus: 'folder',
    FilePlus: 'file', FileMinus: 'file',
    Clipboard: 'copy', ClipboardCopy: 'copy', ClipboardList: 'layout-list',
    ScrollText: 'file-text', ReceiptText: 'file-text',
    Landmark: 'building', Split: 'layout', Combine: 'layout', Columns: 'layout',
    PanelLeft: 'layout', PanelRight: 'layout', PanelTop: 'layout', PanelBottom: 'layout',
    SidebarOpen: 'layout', SidebarClose: 'layout', Menu: 'layout-list',
    Wallet: 'credit-card', Wallet2: 'credit-card', Banknote: 'credit-card',
    HandCoins: 'credit-card', CircleDollarSign: 'credit-card',
    BadgeCheck: 'check-circle', BadgeAlert: 'alert-triangle', BadgeInfo: 'info', BadgeX: 'error',
    Fingerprint: 'shield', KeyRound: 'lock', Key: 'lock',
    Scan: 'crosshair', QrCode: 'grid-3x3',
    Loader: 'refresh', Loader2: 'refresh', LoaderCircle: 'refresh',
    ArrowUpCircle: 'arrow-up', ArrowDownCircle: 'arrow-down',
    ArrowLeftCircle: 'arrow-left', ArrowRightCircle: 'arrow-right',
    XOctagon: 'error', AlertOctagon: 'error',
    Repeat: 'refresh', Repeat1: 'refresh', Repeat2: 'refresh',
    ShieldAlert: 'shield', ShieldOff: 'shield',
    UserCheck: 'user', UserX: 'user', UserMinus: 'user',
    FileSearch: 'search', FileWarning: 'alert-triangle',
    BellOff: 'bell', BellMinus: 'bell', BellPlus: 'bell',
    LucideLineChart: 'line-chart',
};

const sizeMap = {
    10: 'xs', 11: 'xs', 12: 'xs',
    13: 'sm', 14: 'sm', 15: 'sm',
    16: 'md', 17: 'md', 18: 'lg',
    20: 'lg', 22: 'lg', 24: 'xl',
    28: 'xl', 32: 'xl', 36: 'xl', 40: 'xl', 48: 'xl',
};

function getAllFiles(dir, ext = ['.tsx', '.ts']) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            results = results.concat(getAllFiles(fullPath, ext));
        } else if (entry.isFile() && ext.some(e => entry.name.endsWith(e))) {
            results.push(fullPath);
        }
    }
    return results;
}

function getRelativeImportPath(filePath) {
    const rel = path.relative(path.dirname(filePath), path.join(srcDir, 'components', 'ui')).replace(/\\/g, '/');
    return rel.startsWith('.') ? `${rel}/Icon` : `./${rel}/Icon`;
}

function migrateFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf-8');
    const original = content;

    // Match lucide-react import
    const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"];?\s*\n?/g;
    const match = importRegex.exec(content);
    if (!match) return false;

    // Parse imported icon names
    const importedRaw = match[1];
    const imported = importedRaw.split(',').map(s => s.trim()).filter(Boolean);

    // Track aliases: "LineChart as LucideLineChart"
    const aliases = {};
    const cleanImports = imported.map(s => {
        const aliasMatch = s.match(/(\w+)\s+as\s+(\w+)/);
        if (aliasMatch) {
            aliases[aliasMatch[2]] = aliasMatch[1];
            return aliasMatch[2]; // Use the alias name for replacement
        }
        return s;
    });

    const unmapped = [];

    // Replace each icon usage
    for (const iconAlias of cleanImports) {
        const originalName = aliases[iconAlias] || iconAlias;
        const registryName = iconMap[originalName] || iconMap[iconAlias];

        if (!registryName) {
            unmapped.push(iconAlias);
            continue;
        }

        // Replace <IconName size={N} .../> patterns
        // Match: <IconName followed by space or />
        const usageRegex = new RegExp(`<${iconAlias}(\\s)`, 'g');

        if (usageRegex.test(content)) {
            // Reset regex
            content = content.replace(new RegExp(`<${iconAlias}\\s+size=\\{(\\d+)\\}`, 'g'), (m, size) => {
                const preset = sizeMap[parseInt(size)] || 'sm';
                return `<Icon name="${registryName}" size="${preset}"`;
            });
            // Without size prop
            content = content.replace(new RegExp(`<${iconAlias}\\s*/>`, 'g'), `<Icon name="${registryName}" size="sm" />`);
            // With other props but no size
            content = content.replace(new RegExp(`<${iconAlias}(\\s+)(?!name=)`, 'g'), `<Icon name="${registryName}" size="sm"$1`);
        }
    }

    // Remove the lucide-react import line
    content = content.replace(/import\s*\{[^}]+\}\s*from\s*['"]lucide-react['"];?\s*\n?/g, '');

    // Add Icon import if content changed
    if (content !== original) {
        const hasIconImport = /import\s.*Icon.*from\s+['"][^'"]*Icon['"]/.test(content);
        if (!hasIconImport) {
            const relPath = getRelativeImportPath(filePath);
            const importLine = `import { Icon } from '${relPath}';\n`;
            // Add after first import
            const firstImportIdx = content.indexOf('import ');
            if (firstImportIdx >= 0) {
                content = content.slice(0, firstImportIdx) + importLine + content.slice(firstImportIdx);
            } else {
                content = importLine + content;
            }
        }

        fs.writeFileSync(filePath, content, 'utf-8');

        if (unmapped.length > 0) {
            console.log(`  UPDATED ${path.basename(filePath)} (unmapped: ${unmapped.join(', ')})`);
        } else {
            console.log(`  UPDATED ${path.basename(filePath)}`);
        }
        return true;
    }

    return false;
}

console.log('Icon Migration Script (Node.js)');
console.log('================================');

const files = getAllFiles(srcDir);
const lucideFiles = files.filter(f => {
    const content = fs.readFileSync(f, 'utf-8');
    return content.includes("from 'lucide-react'") || content.includes('from "lucide-react"');
});

console.log(`Found ${lucideFiles.length} files with lucide-react imports\n`);

let updated = 0;
for (const f of lucideFiles) {
    if (migrateFile(f)) updated++;
}

console.log(`\n================================`);
console.log(`Updated: ${updated}/${lucideFiles.length} files`);
console.log('Done!');
