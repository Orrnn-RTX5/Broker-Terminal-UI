#!/usr/bin/env pwsh
# Bulk migration script: Replace lucide-react imports with Icon component
# This script processes all .tsx/.ts files that import from 'lucide-react'

param(
    [switch]$DryRun = $false
)

$srcDir = "c:\Users\aitra\Desktop\rtx-desktop\src"

# Map lucide-react component names to Icon registry names
$iconMap = @{
    'Play' = 'play'
    'Pause' = 'stop'
    'Settings' = 'settings'
    'Settings2' = 'settings'
    'Bell' = 'bell'
    'BellRing' = 'bell'
    'User' = 'user'
    'Users' = 'user'
    'Save' = 'save'
    'Printer' = 'print'
    'Camera' = 'camera'
    'Download' = 'download'
    'Upload' = 'upload'
    'Plus' = 'plus'
    'PlusSquare' = 'plus-circle'
    'PlusCircle' = 'plus-circle'
    'Minus' = 'minus'
    'MinusCircle' = 'minus'
    'X' = 'x-close'
    'XCircle' = 'x-close'
    'Check' = 'check'
    'CheckCircle' = 'check-circle'
    'CheckCircle2' = 'check-circle'
    'Layers' = 'layers'
    'Layout' = 'layout'
    'LayoutGrid' = 'grid'
    'LayoutList' = 'layout-list'
    'LayoutTemplate' = 'layout-template'
    'Filter' = 'filter'
    'SortAsc' = 'sort'
    'SortDesc' = 'sort'
    'RefreshCw' = 'refresh'
    'RefreshCcw' = 'refresh'
    'RotateCcw' = 'refresh'
    'Copy' = 'copy'
    'Trash' = 'trash'
    'Trash2' = 'trash'
    'Edit' = 'edit'
    'Edit2' = 'edit'
    'Edit3' = 'edit'
    'Pencil' = 'edit'
    'Eye' = 'eye'
    'EyeOff' = 'eye-off'
    'Lock' = 'lock'
    'Unlock' = 'unlock'
    'Search' = 'search'
    'ZoomIn' = 'zoom-in'
    'ZoomOut' = 'zoom-out'
    'ChevronDown' = 'chevron-down'
    'ChevronRight' = 'chevron-right'
    'ChevronLeft' = 'chevron-left'
    'ChevronUp' = 'chevron-up'
    'ArrowUp' = 'arrow-up'
    'ArrowDown' = 'arrow-down'
    'ArrowLeft' = 'arrow-left'
    'ArrowRight' = 'arrow-right'
    'ArrowUpRight' = 'move-up-right'
    'ArrowUpDown' = 'sort'
    'MoreVertical' = 'more-vertical'
    'MoreHorizontal' = 'more-vertical'
    'Briefcase' = 'briefcase'
    'Image' = 'image'
    'FileText' = 'file-text'
    'File' = 'file'
    'Folder' = 'folder'
    'FolderOpen' = 'folder-open'
    'Code' = 'code'
    'Code2' = 'code'
    'Terminal' = 'terminal'
    'Cpu' = 'cpu'
    'Database' = 'database'
    'HardDrive' = 'hard-drive'
    'Globe' = 'globe'
    'Globe2' = 'globe'
    'Server' = 'server'
    'Shield' = 'shield'
    'ShieldCheck' = 'shield'
    'Smartphone' = 'smartphone'
    'Mail' = 'mail'
    'Wifi' = 'wifi'
    'CreditCard' = 'credit-card'
    'Monitor' = 'monitor'
    'Box' = 'box'
    'Package' = 'box'
    'LogIn' = 'log-in'
    'LogOut' = 'log-out'
    'UserPlus' = 'user-plus'
    'TrendingUp' = 'trending-up'
    'TrendingDown' = 'trending-down'
    'Activity' = 'activity'
    'BarChart' = 'bar-chart'
    'BarChart2' = 'bar-chart-2'
    'BarChart3' = 'bar-chart-3'
    'BarChart4' = 'bar-chart-2'
    'PieChart' = 'pie-chart'
    'LineChart' = 'line-chart'
    'CandlestickChart' = 'candlestick'
    'Signal' = 'signal'
    'Zap' = 'zap'
    'Clock' = 'clock'
    'Clock1' = 'clock'
    'Timer' = 'clock'
    'History' = 'history'
    'Calendar' = 'calendar'
    'CalendarDays' = 'calendar'
    'Newspaper' = 'newspaper'
    'BookOpen' = 'book-open'
    'Book' = 'book-open'
    'Bot' = 'bot'
    'Building' = 'building'
    'Building2' = 'building'
    'ThumbsUp' = 'thumbs-up'
    'ThumbsDown' = 'thumbs-down'
    'AlertTriangle' = 'alert-triangle'
    'AlertCircle' = 'error'
    'Info' = 'info'
    'HelpCircle' = 'help-circle'
    'ExternalLink' = 'move-up-right'
    'Link' = 'move-up-right'
    'Share' = 'export'
    'Share2' = 'export'
    'Hash' = 'grid-3x3'
    'Grid' = 'grid-3x3'
    'Grid2' = 'grid-3x3'
    'Grid3x3' = 'grid-3x3'
    'Table' = 'grid-3x3'
    'Table2' = 'grid-3x3'
    'List' = 'layout-list'
    'Move' = 'cursor'
    'Crosshair' = 'crosshair'
    'Target' = 'crosshair'
    'Maximize' = 'grid'
    'Maximize2' = 'grid'
    'Minimize' = 'minus'
    'Minimize2' = 'minus'
    'ToggleLeft' = 'minus'
    'ToggleRight' = 'minus'
    'Send' = 'export'
    'PlayCircle' = 'play'
    'StopCircle' = 'stop'
    'PauseCircle' = 'stop'
    'Circle' = 'connected'
    'CircleDot' = 'connected'
    'Disc' = 'connected'
    'Radio' = 'signal'
    'Volume' = 'volume'
    'Volume1' = 'volume'
    'Volume2' = 'volume'
    'VolumeX' = 'volume'
    'MessageSquare' = 'callout'
    'MessageCircle' = 'callout'
    'Cloud' = 'globe'
    'CloudUpload' = 'upload'
    'CloudDownload' = 'download'
    'Laptop' = 'monitor'
    'ShoppingBag' = 'box'
    'ShoppingCart' = 'box'
    'Brain' = 'cpu'
    'GraduationCap' = 'help-circle'
    'Award' = 'check-circle'
    'Crown' = 'check-circle'
    'Star' = 'check-circle'
    'Heart' = 'check-circle'
    'Bookmark' = 'save'
    'Tag' = 'filter'
    'Palette' = 'palette'
    'Pipette' = 'palette'
    'Paintbrush' = 'paintbrush'
    'Eraser' = 'x-close'
    'Ruler' = 'ruler'
    'AlignLeft' = 'layout'
    'AlignCenter' = 'layout'
    'AlignRight' = 'layout'
    'AlignHorizontalJustifyCenter' = 'layout'
    'AlignVerticalJustifyCenter' = 'layout'
    'Sliders' = 'settings'
    'SlidersHorizontal' = 'settings'
    'RotateCw' = 'refresh'
    'Power' = 'play'
    'Plug' = 'connected'
    'PlugZap' = 'connected'
    'Unplug' = 'disconnected'
    'Wifi' = 'wifi'
    'WifiOff' = 'disconnected'
    'BatteryCharging' = 'zap'
    'Battery' = 'bar-chart-2'
    'Gauge' = 'activity'
    'Thermometer' = 'activity'
    'Navigation' = 'cursor'
    'Compass' = 'crosshair'
    'Map' = 'globe'
    'MapPin' = 'globe'
    'Sun' = 'settings'
    'Moon' = 'settings'
    'Flame' = 'zap'
    'Sparkles' = 'zap'
    'Wand' = 'zap'
    'Wand2' = 'zap'
    'MoveDown' = 'arrow-down'
    'MoveUp' = 'arrow-up'
    'MoveRight' = 'arrow-right'
    'MoveLeft' = 'arrow-left'
    'MoveHorizontal' = 'minus'
    'MoveVertical' = 'minus'
    'MousePointer' = 'cursor'
    'MousePointer2' = 'cursor'
    'Undo' = 'refresh'
    'Undo2' = 'refresh'
    'Redo' = 'refresh'
    'Redo2' = 'refresh'
    'Delete' = 'trash'
    'Backspace' = 'trash'
    'Type' = 'text'
    'Bold' = 'text'
    'Italic' = 'text'
    'Underline' = 'text'
    'Subscript' = 'text'
    'Superscript' = 'text'
    'AlignJustify' = 'layout'
    'DollarSign' = 'credit-card'
    'Percent' = 'bar-chart-2'
    'Aperture' = 'crosshair'
    'Focus' = 'crosshair'
    'Square' = 'rectangle'
    'RectangleHorizontal' = 'rectangle'
    'Triangle' = 'triangle'
    'Hexagon' = 'shapes'
    'Pentagon' = 'shapes'
    'Octagon' = 'shapes'
    'FolderPlus' = 'folder'
    'FolderMinus' = 'folder'
    'FilePlus' = 'file'
    'FileMinus' = 'file'
    'Clipboard' = 'copy'
    'ClipboardCopy' = 'copy'
    'ClipboardList' = 'layout-list'
    'ScrollText' = 'file-text'
    'ReceiptText' = 'file-text'
    'Landmark' = 'building'
    'Split' = 'layout'
    'Combine' = 'layout'
    'Columns' = 'layout'
    'PanelLeft' = 'layout'
    'PanelRight' = 'layout'
    'PanelTop' = 'layout'
    'PanelBottom' = 'layout'
    'SidebarOpen' = 'layout'
    'SidebarClose' = 'layout'
    'Menu' = 'layout-list'
    'Wallet' = 'credit-card'
    'Wallet2' = 'credit-card'
    'Banknote' = 'credit-card'
    'HandCoins' = 'credit-card'
    'CircleDollarSign' = 'credit-card'
    'BadgeCheck' = 'check-circle'
    'BadgeAlert' = 'alert-triangle'
    'BadgeInfo' = 'info'
    'BadgeX' = 'error'
    'Fingerprint' = 'shield'
    'KeyRound' = 'lock'
    'Key' = 'lock'
    'Scan' = 'crosshair'
    'QrCode' = 'grid-3x3'
    'Loader' = 'refresh'
    'Loader2' = 'refresh'
    'LoaderCircle' = 'refresh'
}

Write-Host "Icon Migration Script"
Write-Host "====================="
Write-Host "Dry Run: $DryRun"
Write-Host ""

$files = Get-ChildItem -Path $srcDir -Recurse -Include "*.tsx", "*.ts" | Where-Object {
    (Get-Content $_.FullName -Raw) -match "from\s+'lucide-react'"
}

Write-Host "Found $($files.Count) files to process"

$totalReplacements = 0

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $originalContent = $content
    $fileReplacements = 0

    # Skip already-migrated files
    if ($content -notmatch "from\s+'lucide-react'") {
        continue
    }

    # Extract the import block  
    $importPattern = "import\s*\{([^}]+)\}\s*from\s*'lucide-react'\s*;?"
    $importMatch = [regex]::Match($content, $importPattern)
    
    if (-not $importMatch.Success) {
        Write-Host "  WARNING: Could not parse import in $($file.Name)"
        continue
    }

    $importedIcons = $importMatch.Groups[1].Value -split "," | ForEach-Object { 
        $_.Trim() -replace '^\s+', '' -replace '\s+$', '' -replace '\s+as\s+\w+', ''
    } | Where-Object { $_ -ne '' }

    Write-Host "`nProcessing: $($file.FullName)"
    Write-Host "  Imported icons: $($importedIcons -join ', ')"

    # Check if Icon is already imported
    $hasIconImport = $content -match "import\s*.*Icon.*from\s*'[./]*components/ui/Icon'"
    
    # Replace each icon usage: <IconName size={N} ... /> -> <Icon name="mapped-name" size="preset" ... />
    foreach ($iconName in $importedIcons) {
        $cleanName = $iconName.Trim()
        if ($iconMap.ContainsKey($cleanName)) {
            $registryName = $iconMap[$cleanName]
            
            # Replace patterns like: <IconName size={14} className="text-..." />
            # and: <IconName size={14} />
            # Pattern: <IconName with optional props />
            $usagePattern = "<$cleanName\s+"
            if ($content -match $usagePattern) {
                # Replace size={N} with appropriate size preset
                $content = $content -replace "<$cleanName\s+size=\{12\}", "<Icon name=`"$registryName`" size=`"xs`""
                $content = $content -replace "<$cleanName\s+size=\{14\}", "<Icon name=`"$registryName`" size=`"sm`""
                $content = $content -replace "<$cleanName\s+size=\{15\}", "<Icon name=`"$registryName`" size=`"sm`""
                $content = $content -replace "<$cleanName\s+size=\{16\}", "<Icon name=`"$registryName`" size=`"md`""
                $content = $content -replace "<$cleanName\s+size=\{18\}", "<Icon name=`"$registryName`" size=`"lg`""
                $content = $content -replace "<$cleanName\s+size=\{20\}", "<Icon name=`"$registryName`" size=`"lg`""
                $content = $content -replace "<$cleanName\s+size=\{24\}", "<Icon name=`"$registryName`" size=`"xl`""
                $content = $content -replace "<$cleanName\s+size=\{28\}", "<Icon name=`"$registryName`" size=`"xl`""
                $content = $content -replace "<$cleanName\s+size=\{32\}", "<Icon name=`"$registryName`" size=`"xl`""
                $content = $content -replace "<$cleanName\s+size=\{36\}", "<Icon name=`"$registryName`" size=`"xl`""
                $content = $content -replace "<$cleanName\s+size=\{40\}", "<Icon name=`"$registryName`" size=`"xl`""
                $content = $content -replace "<$cleanName\s+size=\{48\}", "<Icon name=`"$registryName`" size=`"xl`""
                $content = $content -replace "<$cleanName\s+size=\{10\}", "<Icon name=`"$registryName`" size=`"xs`""
                # Catch remaining sizes
                $content = $content -replace "<$cleanName\s+size=\{\d+\}", "<Icon name=`"$registryName`" size=`"sm`""
                # Without size
                $content = $content -replace "<$cleanName(\s+)(?!name=)", "<Icon name=`"$registryName`"`$1"
                # Standalone (self-closing without space before />)
                $content = $content -replace "<$cleanName\s*/>", "<Icon name=`"$registryName`" size=`"sm`" />"
                
                $fileReplacements++
            }
        } else {
            Write-Host "  UNMAPPED: $cleanName (no mapping found)"
        }
    }

    # Remove the lucide-react import
    $content = $content -replace "import\s*\{[^}]+\}\s*from\s*'lucide-react'\s*;?\r?\n?", ""

    # Add Icon import if not already present
    if (-not $hasIconImport -and $content -ne $originalContent) {
        # Find the right place to add it - after other imports
        $firstImport = [regex]::Match($content, "^import\s", [System.Text.RegularExpressions.RegexOptions]::Multiline)
        if ($firstImport.Success) {
            # Calculate relative path from the file to the Icon component
            $relDir = $file.DirectoryName
            $iconPath = "c:\Users\aitra\Desktop\rtx-desktop\src\components\ui\Icon"
            
            # Determine relative path
            $fileDir = $file.DirectoryName.Replace("c:\Users\aitra\Desktop\rtx-desktop\src\", "").Replace("\", "/")
            $depth = ($fileDir -split "/").Count
            
            if ($fileDir -like "components/ui*") {
                $relImport = "./Icon"
            } elseif ($fileDir -like "components/layout*") {
                $relImport = "../ui/Icon"
            } elseif ($fileDir -like "components/settings*") {
                $relImport = "../ui/Icon"
            } elseif ($fileDir -like "components/dialogs*") {
                $relImport = "../ui/Icon"
            } elseif ($fileDir -like "components/notifications*") {
                $relImport = "../ui/Icon"
            } elseif ($fileDir -like "components*") {
                $relImport = "./ui/Icon"
            } elseif ($fileDir -like "helpers*") {
                $relImport = "../components/ui/Icon"
            } elseif ($fileDir -like "examples*") {
                $relImport = "../components/ui/Icon"
            } else {
                $relImport = "./components/ui/Icon"
            }

            $importLine = "import { Icon } from '$relImport';`n"
            $content = $importLine + $content
        }
    }

    if ($content -ne $originalContent) {
        $totalReplacements += $fileReplacements
        if (-not $DryRun) {
            Set-Content -Path $file.FullName -Value $content -NoNewline
            Write-Host "  UPDATED: $($file.Name) ($fileReplacements icon types replaced)"
        } else {
            Write-Host "  DRY RUN: Would update $($file.Name) ($fileReplacements icon types replaced)"
        }
    }
}

Write-Host "`n====================="
Write-Host "Total files processed: $($files.Count)"
Write-Host "Total icon types replaced: $totalReplacements"
Write-Host "Done!"
