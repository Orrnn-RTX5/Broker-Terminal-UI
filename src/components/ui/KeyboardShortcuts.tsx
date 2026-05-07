import { Icon } from './/Icon';
import { useEffect, useState } from 'react';
import { Command } from 'lucide-react';
type Shortcut = {
  key: string;
  description: string;
  action: () => void;
  category?: string;
};

type KeyboardShortcutsProps = {
  shortcuts: Shortcut[];
  enabled?: boolean;
};

export function KeyboardShortcuts({ shortcuts, enabled = true }: KeyboardShortcutsProps) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = [
        e.ctrlKey && 'Ctrl',
        e.altKey && 'Alt',
        e.shiftKey && 'Shift',
        e.metaKey && 'Cmd',
        e.key.toUpperCase()
      ].filter(Boolean).join('+');

      const shortcut = shortcuts.find(s => s.key === key);
      if (shortcut) {
        e.preventDefault();
        shortcut.action();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, enabled]);

  return null;
}

export function KeyboardShortcutsModal({ shortcuts, onClose }: {
  shortcuts: Shortcut[];
  onClose: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === '?' && e.shiftKey) {
        setIsOpen(!isOpen);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  if (!isOpen) return null;

  // Group by category
  const grouped = shortcuts.reduce((acc, shortcut) => {
    const category = shortcut.category || 'General';
    if (!acc[category]) acc[category] = [];
    acc[category].push(shortcut);
    return acc;
  }, {} as Record<string, Shortcut[]>);

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[var(--z-modal)] flex items-center justify-center"
      onClick={() => setIsOpen(false)}
    >
      <div
        className="bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-auto m-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header flex items-center justify-between sticky top-0 bg-[var(--bg-secondary)] z-10">
          <div className="flex items-center gap-2">
            <Command size={18} className="text-zinc-400" />
            <h2 className="text-lg font-semibold text-zinc-200">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="text-zinc-400 hover:text-zinc-200 text-sm"
          >
            ESC
          </button>
        </div>

        <div className="p-4 space-y-6">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <h3 className="text-sm font-semibold text-zinc-400 mb-3 uppercase tracking-wide">
                {category}
              </h3>
              <div className="space-y-2">
                {items.map((shortcut, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-2 px-3 rounded hover:bg-zinc-800/50"
                  >
                    <span className="text-sm text-zinc-300">{shortcut.description}</span>
                    <kbd className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs font-mono text-zinc-300">
                      {shortcut.key.split('+').map((k, i, arr) => (
                        <span key={i}>
                          {k}
                          {i < arr.length - 1 && <span className="mx-1 text-zinc-600">+</span>}
                        </span>
                      ))}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="panel-header border-t border-zinc-800 text-center text-xs text-zinc-500">
          Press <kbd className="px-1 bg-zinc-800 rounded">?</kbd> to toggle this dialog
        </div>
      </div>
    </div>
  );
}
