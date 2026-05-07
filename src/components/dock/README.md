# Docking Layout System

A professional docking layout system for React applications, designed to match the behavior of trading terminals (MetaTrader, cTrader) and IDEs (VS Code).

## Features

### Core Docking
- **Drag & Drop** - Drag panels to reposition in the layout
- **5 Drop Zones** - Top, Bottom, Left, Right, Center (tab)
- **Split Layouts** - Horizontal and vertical splits with automatic ratio calculation
- **Tab Groups** - Multiple panels in tabbed containers
- **Nested Docking** - Unlimited nesting of splits and tabs

### Floating Panels
- **Float Any Panel** - Detach panels into floating windows
- **Re-dock** - Drag floating panels back to dock
- **Resize Floating** - Resize floating panels from corners
- **Move Floating** - Drag to reposition on screen

### Visual Feedback
- **Drop Zone Indicators** - Visual icons showing where panel will dock
- **Ghost Preview** - Semi-transparent preview of panel placement
- **Container Highlight** - Active container glow during drag
- **Snap Indicators** - Real-time feedback on drop position

### Interaction
- **Mouse Support** - Full mouse drag and drop
- **Touch Support** - Touch-optimized with larger hit targets
- **Keyboard Shortcuts** - ESC to cancel, Ctrl+Z for undo
- **Resize Handles** - Drag to resize panel proportions

### State Management
- **Undo/Redo** - Full history of layout changes
- **Save/Load** - Persist layouts to localStorage
- **Serialization** - Export/import layout as JSON

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Docking System                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │  DockManager    │    │  DockLayoutStore│                │
│  │  (Service)      │◄──►│  (Zustand)      │                │
│  │                 │    │                 │                │
│  │ • Layout tree   │    │ • Drag state    │                │
│  │ • Dock ops      │    │ • UI state      │                │
│  │ • History       │    │ • Actions       │                │
│  └─────────────────┘    └─────────────────┘                │
│           │                        │                        │
│           ▼                        ▼                        │
│  ┌──────────────────────────────────────────────────┐     │
│  │              UI Components                        │     │
│  ├──────────────────────────────────────────────────┤     │
│  │                                                   │     │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  │     │
│  │  │DockContainer│  │  DockPanel  │  │DropZone  │  │     │
│  │  │             │  │             │  │Overlay   │  │     │
│  │  │ • Root      │  │ • Header    │  │          │  │     │
│  │  │ • Splits    │  │ • Content   │  │ • Center │  │     │
│  │  │ • Tabs      │  │ • Actions   │  │ • Edges  │  │     │
│  │  └─────────────┘  └─────────────┘  └──────────┘  │     │
│  │                                                   │     │
│  │  ┌─────────────┐  ┌─────────────┐               │     │
│  │  │ResizeHandle │  │GhostPreview │               │     │
│  │  │             │  │             │               │     │
│  │  │ • Vertical  │  │ • Position  │               │     │
│  │  │ • Horizontal│  │ • Size      │               │     │
│  │  └─────────────┘  └─────────────┘               │     │
│  │                                                   │     │
│  └──────────────────────────────────────────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Installation

The docking system is already integrated. Import components from the dock directory:

```typescript
import {
  DockContainer,
  FloatingPanelsLayer,
  useDocking
} from './components/dock';
```

## Usage

### Basic Setup

```tsx
import { DockContainer, FloatingPanelsLayer, GhostPreview, GlobalDropZoneOverlay } from './components/dock';
import { useDocking } from './hooks/useDocking';

function App() {
  const { layout, addPanel } = useDocking();

  // Add some panels
  useEffect(() => {
    addPanel({
      id: 'panel-1',
      title: 'Market Watch',
      component: 'MarketWatch',
      minWidth: 200,
      minHeight: 200,
    });
  }, []);

  return (
    <div className="h-screen flex flex-col">
      {/* Toolbar */}
      <div className="h-12 border-b">
        <button onClick={() => addPanel(newPanel)}>Add Panel</button>
      </div>

      {/* Main dock area */}
      <div className="flex-1 relative">
        <DockContainer isRoot />

        {/* Floating panels */}
        <FloatingPanelsLayer />

        {/* Visual overlays */}
        <GhostPreview />
        <GlobalDropZoneOverlay />
      </div>
    </div>
  );
}
```

### Custom Panel Content

```tsx
<DockContainer
  isRoot
  renderPanel={(panel, isActive) => {
    switch (panel.component) {
      case 'MarketWatch':
        return <MarketWatchComponent />;
      case 'Chart':
        return <ChartComponent symbol={panel.props?.symbol} />;
      default:
        return <div>{panel.title}</div>;
    }
  }}
/>
```

### Using the Hook

```tsx
const {
  // State
  layout,
  isDragging,

  // Panel Management
  addPanel,
  removePanel,
  dockPanel,
  floatPanel,
  moveToTab,

  // Drag Operations
  startDrag,
  updateDrag,
  endDrag,
  cancelDrag,

  // History
  undo,
  redo,
  canUndo,
  canRedo,

  // Persistence
  saveLayout,
  loadLayout,
  setLayout,
} = useDocking({
  onLayoutChange: (layout) => console.log('Layout changed:', layout),
  onPanelAdd: (panel) => console.log('Panel added:', panel),
  persistKey: 'my-app-layout',
});
```

## Components

### DockContainer
Main layout container that renders the dock tree.

```tsx
interface DockContainerProps {
  container?: DockContainer;  // Specific container (for nested)
  isRoot?: boolean;           // Is this the root container
  className?: string;
  style?: CSSProperties;
  renderPanel?: (panel: DockPanelConfig, isActive: boolean) => ReactNode;
}
```

### FloatingPanelsLayer
Renders floating panels on top of the main layout.

```tsx
interface FloatingPanelsLayerProps {
  renderPanel?: (panel: DockPanelConfig, isActive: boolean) => ReactNode;
}
```

### DockPanel
Individual panel component with header and content.

```tsx
interface DockPanelProps {
  panel: DockPanelConfig;
  isActive?: boolean;
  isFloating?: boolean;
  onClose?: () => void;
  onFloat?: () => void;
  onDock?: (direction: DockDirection) => void;
  onDragStart?: (e: MouseEvent | TouchEvent) => void;
}
```

## Drop Zones

When dragging a panel, 5 drop zones appear on target containers:

| Zone | Direction | Behavior |
|------|-----------|----------|
| Center | `center` | Add as tab to existing tabs, or create new tab group |
| Top | `top` | Split container horizontally, add panel to top |
| Bottom | `bottom` | Split container horizontally, add panel to bottom |
| Left | `left` | Split container vertically, add panel to left |
| Right | `right` | Split container vertically, add panel to right |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `ESC` | Cancel current drag operation |
| `Ctrl+Z` | Undo last layout change |
| `Ctrl+Shift+Z` | Redo undone change |

## State Management

The docking system uses Zustand for state management. Access the store directly for advanced use cases:

```typescript
import { useDockLayoutStore } from './store/useDockLayoutStore';

function MyComponent() {
  const {
    dragState,
    activeDropZone,
    startDrag,
    endDrag
  } = useDockLayoutStore();

  // Access state and actions directly
}
```

## Layout Tree Structure

```typescript
interface DockLayout {
  root: DockContainer;
  floatingPanels: DockContainer[];
  version: string;
}

interface DockContainer {
  id: string;
  type: 'root' | 'split' | 'tabs' | 'panel';
  direction?: 'horizontal' | 'vertical';
  ratio: number;
  children: (DockContainer | DockPanelConfig)[];
  activeTab?: string;
  isFloating?: boolean;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
}

interface DockPanelConfig {
  id: string;
  title: string;
  icon?: string;
  component: string;
  props?: Record<string, any>;
  minWidth?: number;
  minHeight?: number;
  preferredWidth?: number;
  preferredHeight?: number;
  closable?: boolean;
  floatable?: boolean;
  resizable?: boolean;
}
```

## Persistence

Save and restore layouts:

```typescript
// Save current layout
const { saveLayout } = useDocking();
saveLayout(); // Saves to localStorage

// Load saved layout on mount
const { loadLayout } = useDocking();
useEffect(() => {
  loadLayout(); // Loads from localStorage
}, []);

// Get layout as JSON
const json = dockManager.serialize();

// Restore from JSON
dockManager.deserialize(json);
```

## Customization

### Styling

The docking system uses CSS custom properties for theming:

```css
:root {
  --dock-panel-bg: var(--bg-secondary);
  --dock-panel-border: var(--border-primary);
  --dock-header-bg: var(--bg-tertiary);
  --dock-active-color: var(--color-primary);
  --dock-drop-zone-bg: var(--color-primary-dimmer);
}
```

### Drop Zone Thresholds

Modify drop zone sizes in `DockManager`:

```typescript
const zones = this.getDropZones(containerId, rect);
// Center zone is 30% of container
// Edge zones are 35% each
```

## Examples

See `DockExample.tsx` for a complete working example with:
- Multiple panel types (Market Watch, Chart, Trades, Orders, etc.)
- Toolbar with undo/redo
- Add panel dialog
- Save/Load layouts
- Floating panels
- Resize handles

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Performance

- Efficient re-rendering through Zustand selectors
- GPU-accelerated animations via CSS transforms
- Debounced resize operations
- Lazy loading of panel content
