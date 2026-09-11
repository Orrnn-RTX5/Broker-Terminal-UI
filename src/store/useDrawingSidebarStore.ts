import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useDrawingSidebarStore = create<{
  visible: boolean;
  toggle: () => void;
  requestedMenu: 'emojis' | 'stamps' | null;
  openMenu: (menu: 'emojis' | 'stamps') => void;
  clearMenuRequest: () => void;
}>()(persist((set) => ({
  visible: true,
  toggle: () => set((state) => ({ visible: !state.visible })),
  requestedMenu: null,
  openMenu: (requestedMenu) => set({ visible: true, requestedMenu }),
  clearMenuRequest: () => set({ requestedMenu: null }),
}), { name: 'rtx-drawing-sidebar', partialize: (state) => ({ visible: state.visible }) }));
