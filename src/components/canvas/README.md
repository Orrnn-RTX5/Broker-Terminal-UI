# CanvasSelection Component

A professional trading-style interactive canvas selection component with drag, resize, crop, and magnetic snap-to-zone functionality. Built for React 19+ with TypeScript, Zustand state management, and Tailwind CSS.

## Features

### Core Functionality
- **Click & Drag Selection** - Create rectangular selections by clicking and dragging
- **Move** - Drag selected areas to reposition
- **Resize** - 8 resize handles (corners + edges) for precise sizing
- **Crop** - Crop mode for adjusting selection boundaries
- **Snap to Zones** - Magnetic alignment to predefined layout zones

### Professional Features
- **Undo/Redo** - Full history support with keyboard shortcuts
- **Snap Guides** - Visual alignment guides (center, edges)
- **Zone Highlights** - Predefined layout zones with visual feedback
- **Aspect Ratio Lock** - Maintain proportions during resize

### Interaction Modes
- **Mouse** - Full mouse support with hover states
- **Touch** - Touch device optimized with larger hit targets
- **Keyboard** - Arrow key nudging, shortcuts for all actions

## Installation

The component is already integrated into your project. Import it from the components directory:

```typescript
import { CanvasSelection } from './components/canvas';
import { useCanvasSelection } from './hooks/useCanvasSelection';
```

## Usage

### Basic Example

```tsx
import { useState } from 'react';
import { CanvasSelection } from './components/canvas';
import type { Rect } from './store/useCanvasSelectionStore';

function MyComponent() {
  const [selection, setSelection] = useState<Rect | null>(null);

  return (
    <CanvasSelection
      width={800}
      height={600}
      onSelectionChange={(rect) => setSelection(rect)}
      onSelectionConfirm={(rect) => console.log('Confirmed:', rect)}
      onSelectionCancel={() => console.log('Cancelled')}
    >
      {/* Your content here */}
      <div>Canvas content goes here</div>
    </CanvasSelection>
  );
}
```

### With Custom Snap Zones

```tsx
import { CanvasSelection, createDefaultSnapZones } from './components/canvas';

const customZones = [
  { id: 'chart-main', label: 'Main Chart', rect: { x: 0, y: 0, width: 600, height: 300 }, priority: 1 },
  { id: 'panel-left', label: 'Market Watch', rect: { x: 600, y: 0, width: 200, height: 300 }, priority: 1 },
];

<CanvasSelection
  width={800}
  height={600}
  customSnapZones={customZones}
  accentColor="#10b981"
/>
```

### Using the Hook

```tsx
import { useCanvasSelection } from './hooks/useCanvasSelection';

function MyComponent() {
  const {
    selectionRect,
    mode,
    startSelection,
    updateSelection,
    endSelection,
    clearSelection,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useCanvasSelection({
    containerWidth: 800,
    containerHeight: 600,
    onSelectionChange: (rect) => console.log(rect),
  });

  // Use the state and actions in your component
}
```

## Props

### CanvasSelection Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `width` | `number` | required | Container width in pixels |
| `height` | `number` | required | Container height in pixels |
| `customSnapZones` | `SnapZone[]` | auto-generated | Custom snap zones |
| `onSelectionChange` | `(rect: Rect \| null) => void` | undefined | Called when selection changes |
| `onSelectionConfirm` | `(rect: Rect) => void` | undefined | Called when selection is confirmed |
| `onSelectionCancel` | `() => void` | undefined | Called when selection is cancelled |
| `features` | `object` | all enabled | Toggle specific features |
| `minSelectionSize` | `number` | 20 | Minimum selection size in pixels |
| `accentColor` | `string` | '#2196F3' | Primary accent color |
| `children` | `ReactNode` | undefined | Content to render inside canvas |

### Features Object

```typescript
{
  resize?: boolean;    // Enable resize handles
  move?: boolean;      // Enable moving selection
  crop?: boolean;      // Enable crop mode
  snap?: boolean;      // Enable snap to zones
  undoRedo?: boolean;  // Enable undo/redo
}
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Confirm selection |
| `Escape` | Cancel/Clear selection |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Arrow Keys` | Nudge selection 1px |
| `Shift+Arrow` | Nudge selection 10px |

## State Management

The component uses Zustand for state management. Access the store directly for advanced use cases:

```typescript
import { useCanvasSelectionStore } from './store/useCanvasSelectionStore';

function AdvancedComponent() {
  const {
    mode,
    selectionRect,
    snapZones,
    activeSnapZone,
    startCrop,
    applyCrop,
    setMaintainAspectRatio,
  } = useCanvasSelectionStore();

  // Access any state or action from the store
}
```

### Store State

```typescript
interface CanvasSelectionState {
  mode: 'idle' | 'selecting' | 'selected' | 'moving' | 'resizing' | 'cropping';
  selectionRect: Rect | null;
  snapZones: SnapZone[];
  activeSnapZone: SnapZone | null;
  snapGuides: SnapGuide[];
  isSnapped: boolean;
  isCropping: boolean;
  maintainAspectRatio: boolean;
  showSnapGuides: boolean;
  showZoneHighlights: boolean;
  // ... and more
}
```

## Default Snap Zones

The component includes predefined layout zones that simulate professional trading terminal layouts:

- **Corners**: top-left, top-right, bottom-left, bottom-right (30% of container)
- **Center**: Center zone (50% of container)
- **Sidebars**: left-sidebar, right-sidebar (25% width, 60% height)
- **Bars**: top-bar, bottom-bar (60% width, 20% height)

## Styling

The component uses Tailwind CSS classes and CSS custom properties. Override styles using the theme system:

```css
/* Custom accent color */
--color-primary: #10b981;

/* Selection glow */
--color-primary-glow: rgba(16, 185, 129, 0.4);
```

## Examples

See `CanvasSelectionExample.tsx` for complete working examples:

1. **Basic Selection** - Simple click and drag
2. **Chart Area Selector** - Select regions on charts for analysis
3. **Layout Zone Selector** - Snap to predefined trading terminal zones
4. **Screenshot Tool** - Capture specific regions
5. **Region Compare** - Select multiple regions for comparison

## Architecture

### Component Structure

```
CanvasSelection/
├── CanvasSelection.tsx      # Main component
├── CanvasSelection.css      # Component styles
├── index.ts                 # Exports
├── CanvasSelectionExample.tsx  # Demo/examples
└── README.md                # Documentation
```

### State Flow

1. **User clicks** → `startSelection` → `mode: 'selecting'`
2. **User drags** → `updateSelection` → `selectionRect` updates
3. **User releases** → `endSelection` → `mode: 'selected'`
4. **User moves** → `startMove` → `updateMove` → `endMove`
5. **User resizes** → `startResize` → `updateResize` → `endResize`

### Event Handling

- Mouse events: `mousedown`, `mousemove`, `mouseup`
- Touch events: `touchstart`, `touchmove`, `touchend`
- Keyboard: `keydown` for shortcuts and nudging

## Performance

- Uses CSS transforms for smooth animations
- Containment for paint/layout optimization
- Debounced state updates during drag operations
- Touch events use `preventDefault` to avoid scroll interference

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## TypeScript

Full TypeScript support with exported types:

```typescript
export type { Rect, SnapZone, SnapGuide, ResizeHandle, SelectionMode } from './store/useCanvasSelectionStore';
```
