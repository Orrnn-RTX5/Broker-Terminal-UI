import { useState, useCallback } from 'react';

export interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  data?: any;
}

export function useContextMenu() {
  const [state, setState] = useState<ContextMenuState>({
    isOpen: false,
    position: { x: 0, y: 0 },
    data: undefined
  });

  const open = useCallback((x: number, y: number, data?: any) => {
    setState({
      isOpen: true,
      position: { x, y },
      data
    });
  }, []);

  const close = useCallback(() => {
    setState(prev => ({
      ...prev,
      isOpen: false
    }));
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, data?: any) => {
    e.preventDefault();
    e.stopPropagation();
    open(e.clientX, e.clientY, data);
  }, [open]);

  return {
    state,
    open,
    close,
    handleContextMenu
  };
}
