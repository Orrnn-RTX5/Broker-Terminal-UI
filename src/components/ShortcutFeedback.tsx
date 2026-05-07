/**
 * Shortcut Feedback Component
 * Visual feedback when shortcuts are triggered
 */

import { Icon } from './ui/Icon';
import React, { useEffect, useState } from 'react';
interface ShortcutFeedbackProps {
  shortcutText: string | null;
  onClose: () => void;
}

export function ShortcutFeedback({ shortcutText, onClose }: ShortcutFeedbackProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (shortcutText) {
      setIsVisible(true);
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(onClose, 300); // Wait for fade out animation
      }, 1500);

      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcutText]);

  if (!shortcutText) return null;

  return (
    <div
      className={`fixed top-20 left-1/2 transform -translate-x-1/2 z-[9999] transition-all duration-300 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
      }`}
    >
      <div className="bg-gradient-to-r from-blue-600 to-blue-500 text-white px-6 py-3 rounded-lg shadow-xl flex items-center gap-3 border border-blue-400/50">
        <Icon name="zap" size="lg" className="text-yellow-300" />
        <span className="font-medium text-sm">{shortcutText}</span>
      </div>
    </div>
  );
}
