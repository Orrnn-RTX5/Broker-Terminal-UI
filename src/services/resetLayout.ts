import { useDockLayoutStore } from '../store/useDockLayoutStore';

/** Single entry point for every "Reset Layout" trigger: toolbar, Window menu, shortcut, empty workspace. */
// Reset restores panel geometry only. The interface locale stays exactly as the
// user set it in the existing i18n store, so this module never touches i18n.
export const resetWorkspaceLayout = () => {
  useDockLayoutStore.getState().resetWindows();
};
