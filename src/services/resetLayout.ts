import i18n, { changeInterfaceLanguage } from '../i18n';
import { translateUi } from '../hooks/useUiTranslation';
import { useDockLayoutStore } from '../store/useDockLayoutStore';

const DEFAULT_INTERFACE_LANGUAGE = 'en';

const reportLanguageResetFailure = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
    detail: { message: translateUi('Unable to change language. Please try again.'), type: 'error' },
  }));
};

// Resetting the layout restores the shipped terminal defaults, which include
// the interface language. A language bundle that cannot be loaded leaves the
// current language intact instead of half-translating the terminal.
const restoreDefaultInterfaceLanguage = async () => {
  if ((i18n.resolvedLanguage || i18n.language) === DEFAULT_INTERFACE_LANGUAGE) return;
  try {
    await changeInterfaceLanguage(DEFAULT_INTERFACE_LANGUAGE);
  } catch {
    reportLanguageResetFailure();
  }
};

/** Single entry point for every "Reset Layout" trigger: toolbar, Window menu, shortcut, empty workspace. */
export const resetWorkspaceLayout = () => {
  useDockLayoutStore.getState().resetWindows();
  void restoreDefaultInterfaceLanguage();
};
