import { create } from 'zustand';

// The terminal opens its shipped layout on launch/account change. Keep the
// selected label in this session so a persisted name cannot describe a layout
// that was never restored. Menu and shortcut owners share this selection.
export const useWorkspaceProfileSelectionStore = create<{
  accountId: string;
  profileName: string;
  selectProfile: (accountId: string, profileName: string) => void;
}>((set) => ({
  accountId: '',
  profileName: 'Default',
  selectProfile: (accountId, profileName) => set({ accountId, profileName }),
}));
