/**
 * Keyboard Shortcut Help Dialog
 * Displays all available keyboard shortcuts organized by category
 */

import { Icon } from './ui/Icon';
import React from 'react';
import { useKeyboardShortcutContext } from '../contexts/KeyboardShortcutContext';
import { ShortcutBadge, parseShortcut } from './ShortcutHint';
import { SHORTCUT_CATEGORIES } from '../services/keyboardShortcutManager';
import { Keyboard } from 'lucide-react';

interface ShortcutHelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShortcutHelpDialog({ isOpen, onClose }: ShortcutHelpDialogProps) {
  const { getShortcutsByCategory, hasConflicts, getConflicts } = useKeyboardShortcutContext();
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedCategory, setSelectedCategory] = React.useState<string | null>(null);

  if (!isOpen) return null;

  const categories = Object.values(SHORTCUT_CATEGORIES);
  const conflicts = getConflicts();

  // Filter shortcuts by search query
  const filterShortcuts = (shortcuts: any[]) => {
    if (!searchQuery) return shortcuts;
    const query = searchQuery.toLowerCase();
    return shortcuts.filter(s =>
      s.description.toLowerCase().includes(query) ||
      s.key.toLowerCase().includes(query)
    );
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="rtx-shortcut-dialog bg-[#131316]/90 backdrop-blur-xl rounded-lg shadow-2xl border border-zinc-700 w-full max-w-4xl max-h-[80vh] flex flex-col animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700">
          <div className="flex items-center gap-3">
            <Keyboard className="text-blue-400" size={24} />
            <h2 className="text-lg font-semibold text-zinc-100">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 transition-colors p-1 hover:bg-zinc-700 rounded"
          >
            <Icon name="x-close" size="lg" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="px-6 py-3 border-b border-zinc-800">
          <div className="relative">
            <Icon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Search shortcuts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-800 text-zinc-200 pl-10 pr-4 py-2 rounded-lg border border-zinc-700 focus:border-zinc-600 focus:ring-1 focus:ring-blue-500 outline-none text-sm"
            />
          </div>
        </div>

        {/* Conflict Warning */}
        {hasConflicts() && (
          <div className="px-6 py-3 bg-yellow-500/10 border-b border-yellow-500/20">
            <div className="text-yellow-400 text-sm flex items-center gap-2">
              <span className="font-semibold">⚠️ Warning:</span>
              <span>{conflicts.length} shortcut conflict(s) detected</span>
            </div>
          </div>
        )}

        {/* Category Tabs */}
        <div className="px-6 py-3 border-b border-zinc-800">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${selectedCategory === null
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                }`}
            >
              All
            </button>
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${selectedCategory === category
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                  }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        {/* Shortcuts List */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {selectedCategory === null ? (
            // Show all categories
            categories.map((category) => {
              const shortcuts = filterShortcuts(getShortcutsByCategory(category));
              if (shortcuts.length === 0) return null;

              return (
                <div key={category} className="mb-6">
                  <h3 className="text-sm font-semibold text-zinc-400 mb-3 uppercase tracking-wide">
                    {category}
                  </h3>
                  <div className="space-y-2">
                    {shortcuts.map((shortcut) => (
                      <ShortcutRow key={shortcut.id} shortcut={shortcut} />
                    ))}
                  </div>
                </div>
              );
            })
          ) : (
            // Show selected category
            <div className="space-y-2">
              {filterShortcuts(getShortcutsByCategory(selectedCategory)).map((shortcut) => (
                <ShortcutRow key={shortcut.id} shortcut={shortcut} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-700 bg-zinc-900/50">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Press <kbd className="bg-zinc-800 px-2 py-1 rounded border border-zinc-700">Esc</kbd> to close</span>
            <span>MT5-compatible shortcuts</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShortcutRow({ shortcut }: { shortcut: any }) {
  const keys = React.useMemo(() => {
    const parts: string[] = [];
    if (shortcut.ctrl) parts.push('Ctrl');
    if (shortcut.shift) parts.push('Shift');
    if (shortcut.alt) parts.push('Alt');
    if (shortcut.meta) parts.push('Cmd');
    parts.push(shortcut.key.toUpperCase());
    return parts;
  }, [shortcut]);

  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-zinc-800/50 transition-colors group">
      <div className="flex-1">
        <div className="text-sm text-zinc-200 font-medium">{shortcut.description}</div>
        {!shortcut.enabled && (
          <div className="text-xs text-zinc-500 mt-0.5">(Disabled)</div>
        )}
      </div>
      <ShortcutBadge keys={keys} size="md" />
    </div>
  );
}
