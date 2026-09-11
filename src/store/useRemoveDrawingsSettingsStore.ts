import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useRemoveDrawingsSettingsStore = create<{
  alwaysRemoveLocked: boolean;
  setAlwaysRemoveLocked: (enabled: boolean) => void;
}>()(persist((set) => ({
  alwaysRemoveLocked: false,
  setAlwaysRemoveLocked: (alwaysRemoveLocked) => set({ alwaysRemoveLocked }),
}), { name: 'rtx-remove-drawings-settings' }));
