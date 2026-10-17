/**
 * Shortcut Feedback Component
 * Visual feedback when shortcuts are triggered
 */

import { useEffect } from 'react';
interface ShortcutFeedbackProps {
  shortcutText: string | null;
  onClose: () => void;
}

export function ShortcutFeedback({ shortcutText, onClose }: ShortcutFeedbackProps) {
  useEffect(() => {
    if (shortcutText) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcutText]);

  return null;
}
