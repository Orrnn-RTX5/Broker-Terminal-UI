// ============================================================================
// CONTEXT MENU TYPES
// ============================================================================

import type { ReactNode } from 'react';

export interface ContextMenuItemConfig {
  label?: string;
  icon?: ReactNode;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  divider?: boolean;
  action?: () => void;
  submenu?: ContextMenuItemConfig[];
  autoClose?: boolean;
}
